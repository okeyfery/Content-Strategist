import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import {
  formatCompactTavilyBlock,
  isTavilyConfigured,
  sanitizeHttpUrl,
  searchSocialPlatformsWithTavily,
  searchTavily,
  TAVILY_PLATFORM_DOMAINS,
  TavilyError,
  type PlatformTavilySearchBundle,
  type TavilyCleanResult,
} from './server/tavilySearch.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Free-tier compatible Gemini text models (no built-in Google Search grounding tool required)
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// --- In-memory TTL cache (6 hours) for real verified responses only ---
interface MemoryCacheEntry {
  data: unknown;
  createdAt: number;
}
const memoryCache = new Map<string, MemoryCacheEntry>();
const MEMORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MEMORY_CACHE_ENTRIES = 200;

function computeHash(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function getMemoryCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setMemoryCache(key: string, data: unknown): void {
  if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { data, createdAt: Date.now() });
}

// --- Real Runtime Quota & Telemetry Tracker ---
interface QuotaTracker {
  dateKey: string;
  liveGeminiCalls: number;
  primaryModelCalls: number;
  fallbackModelCalls: number;
  directYouTubeSearches: number;
  tavilySearches: number;
  memoryCacheHits: number;
  quotaErrors: number;
  lastModelUsed: string | null;
  lastQuotaErrorAt: string | null;
  quotaExhausted: boolean;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const quotaTracker: QuotaTracker = {
  dateKey: todayKey(),
  liveGeminiCalls: 0,
  primaryModelCalls: 0,
  fallbackModelCalls: 0,
  directYouTubeSearches: 0,
  tavilySearches: 0,
  memoryCacheHits: 0,
  quotaErrors: 0,
  lastModelUsed: null,
  lastQuotaErrorAt: null,
  quotaExhausted: false,
};

function ensureQuotaDay() {
  const today = todayKey();
  if (quotaTracker.dateKey !== today) {
    quotaTracker.dateKey = today;
    quotaTracker.liveGeminiCalls = 0;
    quotaTracker.primaryModelCalls = 0;
    quotaTracker.fallbackModelCalls = 0;
    quotaTracker.directYouTubeSearches = 0;
    quotaTracker.tavilySearches = 0;
    quotaTracker.memoryCacheHits = 0;
    quotaTracker.quotaErrors = 0;
    quotaTracker.quotaExhausted = false;
    quotaTracker.lastQuotaErrorAt = null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof TavilyError) return false;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429');
}

function isModelNotFoundError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.includes('NOT_FOUND') || raw.includes('404') || raw.includes('is not found');
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TavilyError) return false;
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('500') ||
    raw.includes('INTERNAL') ||
    raw.includes('ETIMEDOUT') ||
    raw.includes('ECONNRESET')
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Standard Text-Only Gemini Cascade ---
// Tries gemini-2.5-flash -> gemini-2.5-flash-lite first, and falls back to active free-tier
// Gemini text models (gemini-4-hydrogen -> gemini-3.1-flash-lite) if a model returns 429, 404, or 503 UNAVAILABLE.
// No googleSearch or urlContext grounding tools are used so free GEMINI_API_KEY works smoothly.
const FREE_MODEL_CASCADE = [
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

interface GeminiCallOptions {
  contents: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

async function callGeminiWithCascade(
  options: GeminiCallOptions
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  ensureQuotaDay();
  const ai = getAiClient();
  let lastError: unknown;

  for (const model of FREE_MODEL_CASCADE) {
    const config: Record<string, unknown> = {};
    if (options.responseMimeType) {
      config.responseMimeType = options.responseMimeType;
    }
    if (options.responseSchema) {
      config.responseSchema = options.responseSchema;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        });
        quotaTracker.liveGeminiCalls += 1;
        if (model === PRIMARY_MODEL) quotaTracker.primaryModelCalls += 1;
        else quotaTracker.fallbackModelCalls += 1;
        quotaTracker.lastModelUsed = model;
        quotaTracker.quotaExhausted = false;
        return { response, modelUsed: model };
      } catch (err) {
        lastError = err;
        if (isQuotaError(err)) {
          console.warn(`[Gemini 429] model=${model}, switching to next free-tier model if available`);
          break;
        }
        if (isModelNotFoundError(err)) {
          console.warn(`[Gemini 404] model=${model} unavailable in this environment, cascading to next model`);
          break;
        }
        if (isTransientError(err)) {
          if (attempt === 0) {
            await sleep(800);
            continue;
          }
          console.warn(`[Gemini 503/Transient] model=${model} busy/unavailable, cascading to next model`);
          break;
        }
        throw err;
      }
    }
  }

  if (isQuotaError(lastError)) {
    quotaTracker.quotaErrors += 1;
    quotaTracker.lastQuotaErrorAt = new Date().toISOString();
    quotaTracker.quotaExhausted = true;
  }
  throw lastError;
}

// --- Real Live YouTube Search Engine (100% genuine ytInitialData extraction) ---
const YT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function parseHumanCount(text: string | undefined): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, '').trim();
  const match = cleaned.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return 0;
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'B') return Math.round(base * 1_000_000_000);
  if (suffix === 'M') return Math.round(base * 1_000_000);
  if (suffix === 'K') return Math.round(base * 1_000);
  return Math.round(base);
}

function extractYtInitialData(html: string): Record<string, unknown> | null {
  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface RealYouTubeChannel {
  name: string;
  handle: string;
  url: string;
  subscribers: number;
  subscribersText: string;
  description: string;
}

interface RealYouTubeVideo {
  videoId: string;
  title: string;
  channelName: string;
  channelUrl: string;
  views: number;
  viewsText: string;
  publishedLabel: string;
  durationText: string;
  isShort: boolean;
  url: string;
}

async function searchYouTubeChannels(query: string, limit = 8): Promise<RealYouTubeChannel[]> {
  try {
    // sp=EgIQAg%3D%3D filters strictly to YouTube Channels
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%3D%3D`;
    const res = await fetch(searchUrl, {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const data = extractYtInitialData(html) as {
      contents?: {
        twoColumnSearchResultsRenderer?: {
          primaryContents?: {
            sectionListRenderer?: {
              contents?: Array<{
                itemSectionRenderer?: {
                  contents?: Array<{ channelRenderer?: Record<string, unknown> }>;
                };
              }>;
            };
          };
        };
      };
    } | null;

    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const items = sections.flatMap((s) => s.itemSectionRenderer?.contents || []);

    const results: RealYouTubeChannel[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const ch = item.channelRenderer as {
        title?: { simpleText?: string };
        subscriberCountText?: { simpleText?: string };
        videoCountText?: { simpleText?: string };
        descriptionSnippet?: { runs?: Array<{ text?: string }> };
        navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: string } };
      } | undefined;
      if (!ch) continue;

      const name = ch.title?.simpleText?.trim();
      const canonical = ch.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl?.trim() || '';
      if (!name || !canonical) continue;

      const fieldA = ch.subscriberCountText?.simpleText?.trim() || '';
      const fieldB = ch.videoCountText?.simpleText?.trim() || '';
      const handle = fieldA.startsWith('@')
        ? fieldA
        : fieldB.startsWith('@')
          ? fieldB
          : canonical.startsWith('/@')
            ? canonical.slice(1)
            : `@${name.replace(/\s+/g, '')}`;

      const subsText = /subscriber/i.test(fieldB)
        ? fieldB
        : /subscriber/i.test(fieldA)
          ? fieldA
          : '';
      const subscribers = parseHumanCount(subsText);
      const url = `https://www.youtube.com${canonical}`;
      const desc = (ch.descriptionSnippet?.runs || []).map((r) => r.text || '').join('').trim();

      if (seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());

      results.push({
        name,
        handle,
        url,
        subscribers,
        subscribersText: subsText,
        description: desc,
      });

      if (results.length >= limit) break;
    }

    if (results.length > 0) {
      ensureQuotaDay();
      quotaTracker.directYouTubeSearches += 1;
    }
    return results;
  } catch (err) {
    console.warn('[YouTube Channel Search Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

async function searchYouTubeVideos(
  query: string,
  period: string = '30d',
  limit = 16
): Promise<RealYouTubeVideo[]> {
  try {
    const spMap: Record<string, string> = {
      '7d': 'EgIIAw%3D%3D',
      '14d': 'EgIIBA%3D%3D',
      '30d': 'EgIIBA%3D%3D',
      '90d': 'EgIIBQ%3D%3D',
    };
    const sp = spMap[period] || 'EgIIBA%3D%3D';
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`;

    const res = await fetch(searchUrl, {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const data = extractYtInitialData(html) as {
      contents?: {
        twoColumnSearchResultsRenderer?: {
          primaryContents?: {
            sectionListRenderer?: {
              contents?: Array<{
                itemSectionRenderer?: {
                  contents?: Array<{ videoRenderer?: Record<string, unknown> }>;
                };
              }>;
            };
          };
        };
      };
    } | null;

    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const items = sections.flatMap((s) => s.itemSectionRenderer?.contents || []);

    const results: RealYouTubeVideo[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const v = item.videoRenderer as {
        videoId?: string;
        title?: { runs?: Array<{ text?: string }> };
        ownerText?: {
          runs?: Array<{
            text?: string;
            navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: string } };
          }>;
        };
        viewCountText?: { simpleText?: string; runs?: Array<{ text?: string }> };
        publishedTimeText?: { simpleText?: string };
        lengthText?: { simpleText?: string };
      } | undefined;

      if (!v?.videoId) continue;
      if (seen.has(v.videoId)) continue;

      const title = v.title?.runs?.map((r) => r.text || '').join('').trim();
      const channelName = v.ownerText?.runs?.[0]?.text?.trim() || 'کانال یوتیوب';
      const channelPath = v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
      const viewsText =
        v.viewCountText?.simpleText ||
        v.viewCountText?.runs?.map((r) => r.text || '').join('') ||
        '';
      const views = parseHumanCount(viewsText);
      const publishedLabel = v.publishedTimeText?.simpleText?.trim() || 'اخیر';
      const durationText = v.lengthText?.simpleText?.trim() || '';

      if (!title || views <= 0) continue;

      let isShort = false;
      const parts = durationText.split(':').map((n) => Number(n));
      if (parts.length === 2 && parts[0] === 0 && parts[1] <= 60) {
        isShort = true;
      }

      seen.add(v.videoId);
      results.push({
        videoId: v.videoId,
        title,
        channelName,
        channelUrl: channelPath ? `https://www.youtube.com${channelPath}` : '',
        views,
        viewsText,
        publishedLabel,
        durationText,
        isShort,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
      });

      if (results.length >= limit) break;
    }

    if (results.length > 0) {
      ensureQuotaDay();
      quotaTracker.directYouTubeSearches += 1;
    }
    return results;
  } catch (err) {
    console.warn('[YouTube Video Search Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

async function fetchYouTubeOEmbed(videoUrl: string): Promise<{ title: string; authorName: string } | null> {
  try {
    const parsed = new URL(videoUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host !== 'youtube.com' &&
      host !== 'www.youtube.com' &&
      host !== 'm.youtube.com' &&
      host !== 'youtu.be'
    ) {
      return null;
    }
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    if (!data.title) return null;
    return {
      title: data.title.trim(),
      authorName: (data.author_name || 'کانال یوتیوب').trim(),
    };
  } catch {
    return null;
  }
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatYouTubeChannelsCompactBlock(channels: RealYouTubeChannel[]): string {
  if (channels.length === 0) return '';
  const lines = channels.map(
    (ch, idx) =>
      `${idx + 1}. Name: ${ch.name} | Handle: ${ch.handle} | Subscribers: ${ch.subscribersText || ch.subscribers} | URL: ${ch.url}\n   Snippet: ${(ch.description || 'N/A').slice(0, 260)}`
  );
  return `[Platform: youtube | Live YouTube Channel Search]\n${lines.join('\n')}`;
}

function formatYouTubeVideosCompactBlock(
  videos: Array<RealYouTubeVideo & { baselineViews: number; outlierMultiplier: number }>,
  medianViews: number
): string {
  if (videos.length === 0) return '';
  const lines = videos.map(
    (v, idx) =>
      `${idx + 1}. Title: ${v.title} | Channel: ${v.channelName} | Format: ${v.isShort ? 'YouTube Shorts' : 'Long-form YouTube'} | Views: ${v.views} | MedianBaseline: ${v.baselineViews} | Multiplier: ${v.outlierMultiplier}x | Published: ${v.publishedLabel} | URL: ${v.url}`
  );
  return `[Platform: youtube | Live YouTube Video Search | Niche Median Views: ${medianViews}]\n${lines.join('\n')}`;
}

function parseJsonFromText<T>(rawText: string | undefined): T {
  const text = (rawText ?? '').trim();
  if (!text) {
    throw new Error('مدل پاسخی برنگرداند. لطفاً دوباره تلاش کنید.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim()) as T;
    }
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    const start =
      firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
    const endObj = text.lastIndexOf('}');
    const endArr = text.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new Error('ساختار خروجی هوش مصنوعی قابل پردازش نبود. لطفاً دوباره امتحان کنید.');
  }
}

function formatApiError(error: unknown): { status: number; message: string; code?: string } {
  if (error instanceof TavilyError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  const raw = error instanceof Error ? error.message : String(error);
  console.error('[API Error]', raw);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      code: 'API_KEY_INVALID',
      message: 'کلید GEMINI_API_KEY معتبر نیست یا دسترسی ندارد. لطفاً کلید را در بخش Settings > Secrets بررسی کنید.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message:
        'محدودیت موقت نرخ درخواست‌های رایگان Gemini (gemini-2.5-flash و gemini-2.5-flash-lite) پر شده است. لطفاً یک دقیقه صبر کنید و دوباره امتحان کنید یا از نتایج کش‌شده استفاده کنید.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      status: 503,
      code: 'MODEL_OVERLOADED',
      message:
        'سرورهای مدل هوش مصنوعی Gemini در این لحظه با ترافیک بسیار بالا مواجه هستند (خطای موقت ۵۰۳). سیستم تمام مدل‌های جایگزین را بررسی کرد؛ لطفاً چند ثانیه دیگر مجدداً تلاش کنید.',
    };
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      code: 'MISSING_KEY',
      message: 'کلید GEMINI_API_KEY در بخش Settings > Secrets تنظیم نشده است.',
    };
  }
  return {
    status: 500,
    message: raw.length > 260 ? 'خطایی در پردازش درخواست هوش مصنوعی رخ داد. لطفاً دوباره تلاش کنید.' : raw,
  };
}

const PLATFORM_LABELS_FA: Record<string, string> = {
  youtube: 'یوتیوب',
  instagram: 'اینستاگرام',
  tiktok: 'تیک‌تاک',
  linkedin: 'لینکدین',
  x: 'ایکس (توییتر)',
};

interface ResolvedAccountRange {
  tier: string;
  minFollowers: number;
  maxFollowers: number | null;
  minViews: number;
  labelFa: string;
  discoverTavilyHint: string;
  outlierTavilyHint: string;
}

function formatCompactRangeNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function resolveAccountRange(raw?: {
  tier?: string;
  minFollowers?: number;
  maxFollowers?: number;
  minViews?: number;
}): ResolvedAccountRange {
  const tier = typeof raw?.tier === 'string' ? raw.tier : 'all';

  const presetMap: Record<
    string,
    { minFollowers: number; maxFollowers: number | null; defaultMinViews: number }
  > = {
    all: { minFollowers: 0, maxFollowers: null, defaultMinViews: 0 },
    established: { minFollowers: 10_000, maxFollowers: null, defaultMinViews: 10_000 },
    micro: { minFollowers: 10_000, maxFollowers: 50_000, defaultMinViews: 5_000 },
    mid: { minFollowers: 50_000, maxFollowers: 250_000, defaultMinViews: 25_000 },
    macro: { minFollowers: 250_000, maxFollowers: 1_000_000, defaultMinViews: 80_000 },
    mega: { minFollowers: 1_000_000, maxFollowers: null, defaultMinViews: 250_000 },
  };

  const preset = presetMap[tier] ?? presetMap.all;

  const parseSafeNum = (val: unknown): number | null => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(Math.round(n), 500_000_000);
  };

  const customMinF = parseSafeNum(raw?.minFollowers);
  const customMaxF = parseSafeNum(raw?.maxFollowers);
  const customMinV = parseSafeNum(raw?.minViews);

  let minFollowers = tier === 'custom' ? (customMinF ?? 0) : preset.minFollowers;
  let maxFollowers =
    tier === 'custom'
      ? customMaxF !== null && customMaxF > 0
        ? customMaxF
        : null
      : preset.maxFollowers;
  if (maxFollowers !== null && maxFollowers < minFollowers) {
    maxFollowers = null;
  }

  const minViews = customMinV !== null && customMinV > 0 ? customMinV : preset.defaultMinViews;

  let labelFa = 'همه اندازه‌ها (بدون محدودیت)';
  if (minFollowers > 0 && maxFollowers !== null) {
    labelFa = `${formatCompactRangeNum(minFollowers)} تا ${formatCompactRangeNum(maxFollowers)} فالوئر`;
  } else if (minFollowers > 0) {
    labelFa = `بالای ${formatCompactRangeNum(minFollowers)} فالوئر`;
  } else if (maxFollowers !== null) {
    labelFa = `تا ${formatCompactRangeNum(maxFollowers)} فالوئر`;
  }
  if (minViews > 0) {
    labelFa += ` · حداقل ${formatCompactRangeNum(minViews)} بازدید`;
  }

  let discoverTavilyHint = '';
  let outlierTavilyHint = '';
  if (minFollowers >= 1_000_000) {
    discoverTavilyHint = 'million followers';
    outlierTavilyHint = 'viral million views';
  } else if (minFollowers >= 250_000) {
    discoverTavilyHint = 'K followers top creator';
    outlierTavilyHint = 'viral views popular';
  } else if (minFollowers >= 50_000) {
    discoverTavilyHint = 'K followers';
    outlierTavilyHint = 'viral views';
  } else if (minFollowers >= 10_000) {
    discoverTavilyHint = 'followers';
    outlierTavilyHint = 'views';
  }

  return {
    tier,
    minFollowers,
    maxFollowers,
    minViews,
    labelFa,
    discoverTavilyHint,
    outlierTavilyHint,
  };
}

function matchesFollowerRange(followers: number, range: ResolvedAccountRange): boolean {
  if (range.minFollowers > 0 && followers < range.minFollowers) return false;
  if (range.maxFollowers !== null && followers > range.maxFollowers) return false;
  return true;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 0. Real Runtime Quota & Engine Status
  app.get('/api/quota-status', (_req: Request, res: Response) => {
    ensureQuotaDay();
    res.json({
      ...quotaTracker,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      memoryCacheEntries: memoryCache.size,
      apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      tavilyKeyConfigured: isTavilyConfigured(),
    });
  });

  // 1. Discover REAL channels & accounts (YouTube Live Search + Tavily site: Search -> Gemini text-only analysis)
  app.post('/api/discover', async (req: Request, res: Response) => {
    try {
      const { niche, platforms, regionLanguage, brandContext, accountRange, forceRefresh } = req.body as {
        niche?: string;
        platforms?: string[];
        regionLanguage?: string;
        brandContext?: { name?: string; audience?: string; tone?: string };
        accountRange?: { tier?: string; minFollowers?: number; maxFollowers?: number; minViews?: number };
        forceRefresh?: boolean;
      };

      if (!niche || !niche.trim()) {
        res.status(400).json({ error: 'لطفاً موضوع یا فیلد تخصصی را وارد کنید.' });
        return;
      }

      const cleanNiche = niche.trim().slice(0, 220);
      const range = resolveAccountRange(accountRange);
      const validPlatforms =
        Array.isArray(platforms) && platforms.length > 0
          ? platforms.filter((p) => ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'].includes(p))
          : ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];

      const wantsYouTube = validPlatforms.includes('youtube');
      const tavilyPlatforms = validPlatforms.filter((p) => p !== 'youtube');
      const tavilyReady = isTavilyConfigured();

      if (tavilyPlatforms.length > 0 && !tavilyReady && !wantsYouTube) {
        const missingNames = tavilyPlatforms.map((p) => PLATFORM_LABELS_FA[p] || p).join('، ');
        res.status(400).json({
          code: 'TAVILY_KEY_MISSING',
          error: `برای جستجوی زنده در ${missingNames}، کلید TAVILY_API_KEY مورد نیاز است. لطفاً TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید (جستجوی یوتیوب بدون نیاز به این کلید فعال است).`,
        });
        return;
      }

      const cacheKey = `discover:${computeHash(
        JSON.stringify({
          cleanNiche,
          validPlatforms,
          regionLanguage,
          brandContext,
          range: {
            tier: range.tier,
            minFollowers: range.minFollowers,
            maxFollowers: range.maxFollowers,
          },
          tavilyReady,
        })
      )}`;
      if (!forceRefresh) {
        const memCached = getMemoryCache<Record<string, unknown>>(cacheKey);
        if (memCached) {
          ensureQuotaDay();
          quotaTracker.memoryCacheHits += 1;
          res.json({ ...memCached, cached: true });
          return;
        }
      }

      // Fetch a wider pool of real YouTube channels (24) so we can strictly filter out weak/tiny channels
      const ytPromise = wantsYouTube
        ? (async () => {
            const primaryChannels = await searchYouTubeChannels(cleanNiche, 24);
            let pool = primaryChannels;
            const strictMatches = pool.filter((ch) => matchesFollowerRange(ch.subscribers, range));
            if (strictMatches.length < 5 && range.minFollowers >= 10_000) {
              const extraChannels = await searchYouTubeChannels(`${cleanNiche} channel`, 20);
              const seen = new Set(pool.map((c) => c.url.toLowerCase()));
              for (const ch of extraChannels) {
                if (!seen.has(ch.url.toLowerCase())) {
                  seen.add(ch.url.toLowerCase());
                  pool.push(ch);
                }
              }
            }
            const filtered = pool.filter((ch) => matchesFollowerRange(ch.subscribers, range));
            if (filtered.length > 0) {
              return {
                channels: filtered.sort((a, b) => b.subscribers - a.subscribers).slice(0, 12),
                relaxedRange: false,
              };
            }
            // If no exact range match exists on YouTube, return strongest real channels sorted by subscribers
            return {
              channels: [...pool].sort((a, b) => b.subscribers - a.subscribers).slice(0, 10),
              relaxedRange: pool.length > 0 && (range.minFollowers > 0 || range.maxFollowers !== null),
            };
          })()
        : Promise.resolve({ channels: [] as RealYouTubeChannel[], relaxedRange: false });

      const tavilyPromise: Promise<PlatformTavilySearchBundle> =
        tavilyPlatforms.length > 0 && tavilyReady
          ? searchSocialPlatformsWithTavily(tavilyPlatforms, cleanNiche, range.discoverTavilyHint)
          : Promise.resolve({ allResults: [], compactTextBlock: '', sources: [], queriesExecuted: 0 });

      const [ytResult, tavilyBundle] = await Promise.all([ytPromise, tavilyPromise]);
      const ytChannels = ytResult.channels;

      if (tavilyBundle.queriesExecuted > 0) {
        ensureQuotaDay();
        quotaTracker.tavilySearches += tavilyBundle.queriesExecuted;
      }

      const rawBlocks = [
        formatYouTubeChannelsCompactBlock(ytChannels),
        tavilyBundle.compactTextBlock,
      ].filter(Boolean);

      if (rawBlocks.length === 0) {
        res.status(404).json({
          error:
            'نتیجه واقعی و معتبری برای این کلیدواژه در پلتفرم‌های انتخابی یافت نشد. لطفاً کلیدواژه را شفاف‌تر یا گسترده‌تر وارد کنید.',
        });
        return;
      }

      const sources: { title: string; uri: string }[] = [...tavilyBundle.sources];
      if (ytChannels.length > 0 && sources.length < 12) {
        sources.push({
          title: `جستجوی زنده کانال‌های یوتیوب برای «${cleanNiche}»`,
          uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanNiche)}&sp=EgIQAg%3D%3D`,
        });
      }

      const notices: string[] = [];
      if (tavilyPlatforms.length > 0 && !tavilyReady) {
        notices.push(
          `کانال‌های واقعی یوتیوب با موفقیت جستجو و تحلیل شدند. برای فعال‌سازی جستجوی زنده در ${tavilyPlatforms
            .map((p) => PLATFORM_LABELS_FA[p] || p)
            .join('، ')}، کلید TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید.`
        );
      }

      const rangeInstruction =
        range.minFollowers > 0 || range.maxFollowers !== null
          ? `فیلتر بازه اندازه اکانت انتخابی کاربر: «${range.labelFa}» (حداقل فالوئر: ${range.minFollowers}${
              range.maxFollowers !== null ? `، حداکثر فالوئر: ${range.maxFollowers}` : ''
            }). اکیداً پیج‌های نوپا، بسیار کوچک یا ضعیف خارج از این بازه را حذف کن و قوی‌ترین اکانت‌های واقعی هم‌تراز با این بازه را اولویت بده.`
          : 'محدودیت اندازه خاصی انتخاب نشده است، اما پیج‌های فعال، معتبر و باکیفیت را در اولویت قرار بده و از اکانت‌های خالی یا غیرفعال صرف‌نظر کن.';

      const compactContext = rawBlocks.join('\n\n');
      const prompt = `
شما یک تحلیلگر ارشد استراتژی محتوا و کشف کانال‌های شبکه‌های اجتماعی هستید.
داده‌های خام زیر نتایج واقعی و زنده جمع‌آوری‌شده از جستجوی یوتیوب و موتور جستجوی Tavily برای حوزه «${cleanNiche}» هستند:

${compactContext}

ترجیح زبان/منطقه کاربر: ${regionLanguage || 'ترکیبی از پیج‌های برتر فارسی و بین‌المللی'}.
${rangeInstruction}
${brandContext?.name ? `زمینه برند کاربر: ${brandContext.name} | مخاطب هدف: ${brandContext.audience || 'نامشخص'} | لحن: ${brandContext.tone || 'نامشخص'}` : ''}

الزامات حیاتی:
- **فقط و فقط** اکانت‌ها، پیج‌ها و کانال‌هایی را استخراج و تحلیل کن که در متن داده‌های خام بالا وجود دارند. هرگز اکانت یا لینک خیالی نساز.
- برای کانال‌های یوتیوب، دقیقاً همان تعداد سابسکرایبر واقعی داده‌شده در متن بالا را در estimatedFollowers بگذار. برای سایر پلتفرم‌ها اگر عدد فالوئر در اسنیپت ذکر شده همان را بگذار و در غیر این صورت برآورد واقعی و محافظه‌کارانه ارائه بده.
- لینک (url) و پلتفرم هر اکانت را دقیقاً از داده‌های خام بالا بردار و بین ۵ تا ۱۰ مورد باکیفیت، تثبیت‌شده و مرتبط (مطابق بازه فالوئر درخواستی) انتخاب کن.
- فیلدهای category، contentStyle و whyRelevant را به فارسی روان، دقیق و استراتژیک بنویس.
- خروجی را **صرفاً** به صورت یک JSON معتبر با ساختار زیر برگردان:
{
  "accounts": [
    {
      "name": "نام واقعی کانال یا پیج",
      "handle": "@handle",
      "platform": "youtube | instagram | tiktok | linkedin | x",
      "url": "لینک واقعی استخراج‌شده از داده‌های بالا",
      "category": "زیرشاخه موضوعی (فارسی)",
      "estimatedBaselineViews": 15000,
      "estimatedFollowers": 50000,
      "contentStyle": "توضیح دقیق و فشرده فارسی درباره سبک محتوا و ارزش ارائه شده",
      "whyRelevant": "چرا این اکانت برای الهام‌گیری یا رصد رقیب در این فیلد مهم است (فارسی)"
    }
  ]
}`;

      try {
        const { response, modelUsed } = await callGeminiWithCascade({
          contents: prompt,
          responseMimeType: 'application/json',
        });

        const parsed = parseJsonFromText<{ accounts?: Array<Record<string, unknown>> }>(response.text);
        const sanitizedAccounts = (Array.isArray(parsed.accounts) ? parsed.accounts : []).map((acc) => ({
          ...acc,
          estimatedFollowers: Number(acc.estimatedFollowers) || 0,
          estimatedBaselineViews: Number(acc.estimatedBaselineViews) || 0,
          url: sanitizeHttpUrl(typeof acc.url === 'string' ? acc.url : undefined) || '',
        }));

        // Enforce deterministic follower range filter on the analyzed output
        let finalAccounts = sanitizedAccounts;
        if (range.minFollowers > 0 || range.maxFollowers !== null) {
          const inRange = sanitizedAccounts.filter((acc) =>
            matchesFollowerRange(acc.estimatedFollowers, range)
          );
          if (inRange.length > 0) {
            finalAccounts = inRange.sort((a, b) => b.estimatedFollowers - a.estimatedFollowers);
          } else if (sanitizedAccounts.length > 0) {
            finalAccounts = [...sanitizedAccounts].sort(
              (a, b) => b.estimatedFollowers - a.estimatedFollowers
            );
            notices.push(
              `اکانت دقیقی در بازه «${range.labelFa}» در نتایج زنده یافت نشد؛ قوی‌ترین اکانت‌های واقعی موجود به ترتیب تعداد فالوئر نمایش داده شده‌اند.`
            );
          }
        } else {
          finalAccounts = [...sanitizedAccounts].sort(
            (a, b) => b.estimatedFollowers - a.estimatedFollowers
          );
        }

        const engineLabel =
          tavilyBundle.queriesExecuted > 0 && ytChannels.length > 0
            ? `${modelUsed} + Tavily + YouTube Live`
            : tavilyBundle.queriesExecuted > 0
              ? `${modelUsed} + Tavily`
              : `${modelUsed} + YouTube Live`;

        const combinedNotice = notices.length > 0 ? notices.join(' ') : undefined;
        const resultObj = {
          accounts: finalAccounts,
          sources,
          engine: engineLabel,
          mode: tavilyBundle.queriesExecuted > 0 ? 'tavily_gemini' : 'youtube_ai_enriched',
          ...(combinedNotice ? { notice: combinedNotice } : {}),
        };

        if (!combinedNotice) {
          setMemoryCache(cacheKey, resultObj);
        }
        res.json({ ...resultObj, cached: false });
        return;
      } catch (geminiError) {
        if (!isQuotaError(geminiError)) {
          throw geminiError;
        }

        // If Gemini free-tier rate limit hits 429, still return 100% REAL YouTube channels directly if available
        if (ytChannels.length > 0) {
          const realYtAccounts = ytChannels.map((ch) => ({
            name: ch.name,
            handle: ch.handle,
            platform: 'youtube',
            url: ch.url,
            category: cleanNiche,
            estimatedBaselineViews: ch.subscribers > 0 ? Math.round(ch.subscribers * 0.18) : 0,
            estimatedFollowers: ch.subscribers,
            contentStyle:
              ch.description ||
              `کانال واقعی یوتیوب در حوزه «${cleanNiche}» (${ch.subscribersText || 'فعال'})`,
            whyRelevant: `کانال واقعی استخراج‌شده از نتایج جستجوی زنده یوتیوب برای «${cleanNiche}»${
              ch.subscribersText ? ` با ${ch.subscribersText}` : ''
            }.`,
          }));

          res.json({
            accounts: realYtAccounts,
            sources,
            engine: 'YouTube Live Search',
            mode: 'youtube_direct',
            cached: false,
            notice:
              'محدودیت موقت نرخ پاسخ‌دهی مدل رایگان Gemini رخ داد؛ کانال‌های واقعی زیر مستقیماً از جستجوی زنده یوتیوب مطابق فیلتر شما نمایش داده شده‌اند.',
          });
          return;
        }

        throw geminiError;
      }
    } catch (error) {
      const { status, message, code } = formatApiError(error);
      res.status(status).json({ error: message, code });
    }
  });

  // 2. Hunt REAL Outlier videos/posts (YouTube Statistical Engine + Tavily site: Search -> Gemini text-only analysis)
  app.post('/api/outliers/hunt', async (req: Request, res: Response) => {
    try {
      const { niche, platforms, period, watchlistNames, brand, accountRange, forceRefresh } = req.body as {
        niche?: string;
        platforms?: string[];
        period?: string;
        watchlistNames?: string[];
        brand?: { name?: string; niche?: string; audience?: string; tone?: string };
        accountRange?: { tier?: string; minFollowers?: number; maxFollowers?: number; minViews?: number };
        forceRefresh?: boolean;
      };

      const targetNiche = (niche || brand?.niche || '').trim().slice(0, 220);
      if (!targetNiche) {
        res.status(400).json({ error: 'حوزه موضوعی برای شکار Outlier مشخص نیست.' });
        return;
      }

      const range = resolveAccountRange(accountRange);
      const validPlatforms =
        Array.isArray(platforms) && platforms.length > 0
          ? platforms.filter((p) => ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'].includes(p))
          : ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];

      const wantsYouTube = validPlatforms.includes('youtube');
      const tavilyPlatforms = validPlatforms.filter((p) => p !== 'youtube');
      const tavilyReady = isTavilyConfigured();

      if (tavilyPlatforms.length > 0 && !tavilyReady && !wantsYouTube) {
        const missingNames = tavilyPlatforms.map((p) => PLATFORM_LABELS_FA[p] || p).join('، ');
        res.status(400).json({
          code: 'TAVILY_KEY_MISSING',
          error: `برای شکار محتوای Outlier در ${missingNames}، کلید TAVILY_API_KEY لازم است. لطفاً TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید (شکار آماری یوتیوب بدون این کلید فعال است).`,
        });
        return;
      }

      const targetPeriod = period || '30d';
      const periodMap: Record<string, string> = {
        '7d': '۷ روز گذشته',
        '14d': '۱۴ روز گذشته',
        '30d': '۳۰ روز گذشته',
        '90d': '۹۰ روز گذشته',
      };
      const periodLabel = periodMap[targetPeriod] || '۳۰ روز گذشته';

      const cacheKey = `hunt:${computeHash(
        JSON.stringify({
          targetNiche,
          validPlatforms,
          targetPeriod,
          watchlistNames: (watchlistNames || []).slice(0, 10),
          brandName: brand?.name,
          range: {
            tier: range.tier,
            minFollowers: range.minFollowers,
            maxFollowers: range.maxFollowers,
            minViews: range.minViews,
          },
          tavilyReady,
        })
      )}`;
      if (!forceRefresh) {
        const memCached = getMemoryCache<Record<string, unknown>>(cacheKey);
        if (memCached) {
          ensureQuotaDay();
          quotaTracker.memoryCacheHits += 1;
          res.json({ ...memCached, cached: true });
          return;
        }
      }

      // Fetch wider pool (30 real YouTube videos) so we can filter out low-view videos while keeping honest median stats
      const ytVideosPromise = wantsYouTube
        ? searchYouTubeVideos(targetNiche, targetPeriod, 30)
        : Promise.resolve<RealYouTubeVideo[]>([]);

      const tavilyPromise: Promise<PlatformTavilySearchBundle> =
        tavilyPlatforms.length > 0 && tavilyReady
          ? searchSocialPlatformsWithTavily(tavilyPlatforms, targetNiche, range.outlierTavilyHint)
          : Promise.resolve({ allResults: [], compactTextBlock: '', sources: [], queriesExecuted: 0 });

      const [ytVideos, tavilyBundle] = await Promise.all([ytVideosPromise, tavilyPromise]);

      if (tavilyBundle.queriesExecuted > 0) {
        ensureQuotaDay();
        quotaTracker.tavilySearches += tavilyBundle.queriesExecuted;
      }

      const medianViews =
        ytVideos.length > 0 ? Math.max(100, Math.round(computeMedian(ytVideos.map((v) => v.views)))) : 0;
      const scoredYt = ytVideos.map((v) => ({
        ...v,
        baselineViews: medianViews,
        outlierMultiplier: Math.round((v.views / Math.max(1, medianViews)) * 10) / 10,
      }));

      const ytFilteredByViews =
        range.minViews > 0 ? scoredYt.filter((v) => v.views >= range.minViews) : scoredYt;
      const ytRelaxed = range.minViews > 0 && ytFilteredByViews.length === 0 && scoredYt.length > 0;
      const rankedYtOutliers = (ytFilteredByViews.length > 0 ? ytFilteredByViews : scoredYt)
        .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier || b.views - a.views)
        .slice(0, 10);

      const rawBlocks = [
        formatYouTubeVideosCompactBlock(rankedYtOutliers, medianViews),
        tavilyBundle.compactTextBlock,
      ].filter(Boolean);

      if (rawBlocks.length === 0) {
        res.status(404).json({
          error:
            'محتوای واقعی و پربازدیدی برای این حوزه و بازه زمانی یافت نشد. لطفاً کلیدواژه یا بازه زمانی را تغییر دهید.',
        });
        return;
      }

      const sources: { title: string; uri: string }[] = [...tavilyBundle.sources];
      if (rankedYtOutliers.length > 0 && sources.length < 12) {
        sources.push({
          title: `جستجوی زنده ویدیوهای یوتیوب برای «${targetNiche}» (${periodLabel})`,
          uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(targetNiche)}`,
        });
      }

      const notices: string[] = [];
      if (tavilyPlatforms.length > 0 && !tavilyReady) {
        notices.push(
          `ویدیوهای واقعی یوتیوب با موفقیت استخراج و کالبدشکافی شدند. برای شکار محتوای ${tavilyPlatforms
            .map((p) => PLATFORM_LABELS_FA[p] || p)
            .join('، ')}، کلید TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید.`
        );
      }
      if (ytRelaxed && tavilyBundle.allResults.length === 0) {
        notices.push(
          `در بازه زمانی انتخابی، ویدیویی با بیش از ${formatCompactRangeNum(range.minViews)} بازدید یافت نشد؛ پربازدیدترین ویدیوهای واقعی موجود نمایش داده شده‌اند.`
        );
      }

      const rangeInstruction =
        range.minFollowers > 0 || range.maxFollowers !== null || range.minViews > 0
          ? `فیلتر بازه اکانت و کف بازدید انتخابی کاربر: «${range.labelFa}». اکیداً محتواهای ضعیف و کم‌بازدید از پیج‌های نوپا را کنار بگذار و فقط محتواهای موفق و Outlier از اکانت‌های هم‌سطح این بازه (با حداقل ${range.minViews} بازدید در صورت موجود بودن) را انتخاب و تحلیل کن.`
          : 'محتواهای واقعاً موفق، پربازدید و با ضریب Outlier بالا را انتخاب کن و از محتواهای ضعیف و کم‌تعامل صرف‌نظر کن.';

      const compactContext = rawBlocks.join('\n\n');
      const prompt = `
شما یک شکارچی حرفه‌ای ویدیوهای وایرال و محتوای Outlier و استراتژیست شبکه‌های اجتماعی هستید.
داده‌های خام زیر نتایج واقعی و زنده جمع‌آوری‌شده در حوزه «${targetNiche}» برای بازه «${periodLabel}» هستند:

${compactContext}

${rangeInstruction}
${watchlistNames && watchlistNames.length > 0 ? `اولویت برند و رقبای واتچ‌لیست: ${watchlistNames.slice(0, 12).join('، ')}` : ''}
${brand?.name ? `هویت برند کاربر برای بخش ایده تطبیق: نام برند «${brand.name}»، مخاطب «${brand.audience || 'عمومی'}»، لحن «${brand.tone || 'حرفه‌ای'}».` : ''}

قوانین حیاتی:
- **فقط و فقط** محتواها و پست‌هایی را گزارش کن که در داده‌های خام بالا وجود دارند. از ساخت عنوان یا لینک خیالی اکیداً خودداری کن.
- برای ویدیوهای یوتیوب، دقیقاً همان عنوان، نام کانال، لینک، views، baselineViews و outlierMultiplier داده‌شده در متن بالا را حفظ کن.
- برای پست‌های اینستاگرام، تیک‌تاک، لینکدین و ایکس (از نتایج Tavily)، لینک و عنوان واقعی را حفظ کن و بر اساس اسنیپت، فرمت و شاخص‌های عملکرد و دلیل جذابیت را دقیق تحلیل کن.
- بین ۵ تا ۸ مورد برتر و متنوع (از پلتفرم‌های موجود در داده‌های بالا) انتخاب کن و تمام تحلیل‌های hookPattern، whyItWorked، structureBreakdown و brandAdaptationIdea را به فارسی روان و کاربردی بنویس.
- خروجی را **صرفاً** به صورت JSON معتبر برگردان:
{
  "outliers": [
    {
      "accountName": "نام کانال یا پیج",
      "platform": "youtube | instagram | tiktok | linkedin | x",
      "format": "YouTube Shorts | ویدیو بلند یوتیوب | Instagram Reel | پست اسلایدی | ویدیو کوتاه TikTok | پست متنی تحلیلی | رشته‌توییت (Thread)",
      "title": "عنوان دقیق یا هوک اصلی محتوا",
      "url": "لینک واقعی استخراج‌شده از داده‌های بالا",
      "publishedLabel": "مثلاً ۱۲ روز پیش",
      "views": 120000,
      "baselineViews": 25000,
      "outlierMultiplier": 4.8,
      "likes": 0,
      "comments": 0,
      "engagementRate": 0,
      "hookPattern": "الگوی هوک آغازین و دلیل جلب توجه فوری",
      "whyItWorked": "تحلیل عمیق روان‌شناختی و الگوریتمی دلیل موفقیت این محتوا",
      "structureBreakdown": "ساختار گام‌به‌گام (شروع -> تنش/کنجکاوی -> اوج ارزش -> CTA)",
      "brandAdaptationIdea": "پیشنهاد مشخص که برند کاربر چطور همین فرمول را با زاویه اختصاصی خودش اجرا کند"
    }
  ]
}`;

      try {
        const { response, modelUsed } = await callGeminiWithCascade({
          contents: prompt,
          responseMimeType: 'application/json',
        });

        const parsed = parseJsonFromText<{ outliers?: Array<Record<string, unknown>> }>(response.text);
        const sanitizedOutliers = (Array.isArray(parsed.outliers) ? parsed.outliers : []).map((o) => ({
          ...o,
          views: Number(o.views) || 0,
          baselineViews: Number(o.baselineViews) || 0,
          outlierMultiplier: Number(o.outlierMultiplier) || 0,
          url: sanitizeHttpUrl(typeof o.url === 'string' ? o.url : undefined) || '',
        }));

        // Deterministically filter by minimum views when configured (falling back transparently if none meet threshold)
        let finalOutliers = sanitizedOutliers;
        if (range.minViews > 0) {
          const aboveFloor = sanitizedOutliers.filter((o) => o.views >= range.minViews);
          if (aboveFloor.length > 0) {
            finalOutliers = aboveFloor;
          } else if (sanitizedOutliers.length > 0 && !ytRelaxed) {
            notices.push(
              `محتوایی با حداقل ${formatCompactRangeNum(range.minViews)} بازدید در این بازه یافت نشد؛ موفق‌ترین محتواهای واقعی موجود نمایش داده شده‌اند.`
            );
          }
        }
        finalOutliers = [...finalOutliers].sort(
          (a, b) => b.outlierMultiplier - a.outlierMultiplier || b.views - a.views
        );

        const engineLabel =
          tavilyBundle.queriesExecuted > 0 && rankedYtOutliers.length > 0
            ? `${modelUsed} + Tavily + YouTube Live`
            : tavilyBundle.queriesExecuted > 0
              ? `${modelUsed} + Tavily`
              : `${modelUsed} + YouTube Live`;

        const combinedNotice = notices.length > 0 ? notices.join(' ') : undefined;
        const resultObj = {
          outliers: finalOutliers,
          sources,
          engine: engineLabel,
          mode: tavilyBundle.queriesExecuted > 0 ? 'tavily_gemini' : 'youtube_ai_enriched',
          ...(combinedNotice ? { notice: combinedNotice } : {}),
        };

        if (!combinedNotice) {
          setMemoryCache(cacheKey, resultObj);
        }
        res.json({ ...resultObj, cached: false });
        return;
      } catch (geminiError) {
        if (!isQuotaError(geminiError)) {
          throw geminiError;
        }

        // Preserve real statistical YouTube outlier fallback if Gemini free-tier hits 429
        if (rankedYtOutliers.length > 0) {
          const directOutliers = rankedYtOutliers.map((v) => ({
            accountName: v.channelName,
            platform: 'youtube',
            format: v.isShort ? 'YouTube Shorts' : 'ویدیو بلند یوتیوب',
            title: v.title,
            url: v.url,
            publishedLabel: v.publishedLabel,
            views: v.views,
            baselineViews: v.baselineViews,
            outlierMultiplier: v.outlierMultiplier,
            likes: 0,
            comments: 0,
            engagementRate: 0,
            hookPattern: `عنوان واقعی ویدیو: «${v.title}» (${v.durationText || 'ویدیو'}) — برای کالبدشکافی عمیق هوش مصنوعی لحظاتی دیگر دکمه «کالبدشکافی» را بزنید.`,
            whyItWorked: `این ویدیو با ${v.views.toLocaleString('en-US')} بازدید، معادل ${v.outlierMultiplier} برابر میانه بازدید ویدیوهای مشابه در حوزه «${targetNiche}» (${v.baselineViews.toLocaleString('en-US')} بازدید) عمل کرده است.`,
            structureBreakdown: '',
            brandAdaptationIdea: '',
          }));

          res.json({
            outliers: directOutliers,
            sources,
            engine: 'YouTube Live Statistical Engine',
            mode: 'youtube_direct',
            cached: false,
            notice:
              'محدودیت موقت نرخ پاسخ‌دهی مدل رایگان Gemini رخ داد؛ ویدیوهای زیر مستقیماً از جستجوی زنده یوتیوب مطابق فیلتر شما استخراج و ضریب Outlier آن‌ها به صورت آماری محاسبه شده است.',
          });
          return;
        }

        throw geminiError;
      }
    } catch (error) {
      const { status, message, code } = formatApiError(error);
      res.status(status).json({ error: message, code });
    }
  });

  // 3. Deconstruct a specific Outlier (Tavily/YouTube Metadata Lookup -> Gemini text-only analysis)
  app.post('/api/outliers/deconstruct', async (req: Request, res: Response) => {
    try {
      const { url, title, accountName, platform, format, views, baselineViews, brand } = req.body as {
        url?: string;
        title?: string;
        accountName?: string;
        platform?: string;
        format?: string;
        views?: number;
        baselineViews?: number;
        brand?: { name?: string; niche?: string; audience?: string; tone?: string; usp?: string };
      };

      if (url && !title) {
        const safeUrl = sanitizeHttpUrl(url);
        if (!safeUrl) {
          res.status(400).json({ error: 'لینک واردشده معتبر نیست. لطفاً یک لینک استاندارد http/https وارد کنید.' });
          return;
        }

        const parsedUrl = new URL(safeUrl);
        const host = parsedUrl.hostname.toLowerCase();
        const isYouTubeUrl =
          host === 'youtube.com' ||
          host === 'www.youtube.com' ||
          host === 'm.youtube.com' ||
          host === 'youtu.be';

        let compactContext = '';
        let sources: { title: string; uri: string }[] = [{ title: safeUrl, uri: safeUrl }];

        if (isYouTubeUrl) {
          const oembed = await fetchYouTubeOEmbed(safeUrl);
          if (oembed) {
            compactContext = `[Platform: youtube | YouTube Metadata]\nTitle: ${oembed.title}\nChannel: ${oembed.authorName}\nURL: ${safeUrl}`;
            sources = [{ title: `${oembed.authorName}: ${oembed.title}`, uri: safeUrl }];
          }
        }

        if (!compactContext) {
          if (!isTavilyConfigured()) {
            res.status(400).json({
              code: 'TAVILY_KEY_MISSING',
              error:
                'برای استخراج خودکار اطلاعات این لینک از وب، کلید TAVILY_API_KEY لازم است. لطفاً TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید یا عنوان محتوا را به صورت دستی وارد کنید.',
            });
            return;
          }
          const tavilyResults = await searchTavily(safeUrl, { searchDepth: 'basic', maxResults: 5 });
          ensureQuotaDay();
          quotaTracker.tavilySearches += 1;

          if (tavilyResults.length === 0) {
            res.status(404).json({
              error:
                'اطلاعات عمومی برای این لینک از طریق جستجوی وب یافت نشد. لطفاً عنوان و مشخصات محتوا را به صورت دستی وارد کنید تا کالبدشکافی انجام شود.',
            });
            return;
          }

          compactContext = formatCompactTavilyBlock([
            { label: 'Target URL Lookup', query: safeUrl, results: tavilyResults },
          ]);
          sources = tavilyResults.slice(0, 5).map((r) => ({ title: r.title, uri: r.url }));
        }

        const prompt = `
بر اساس داده‌های واقعی استخراج‌شده زیر برای لینک ${safeUrl}، این محتوا را برای برند «${brand?.name || 'برند کاربر'}» در حوزه «${brand?.niche || 'محتوا'}» با لحن «${brand?.tone || 'حرفه‌ای'}» کالبدشکافی کن:

${compactContext}

خروجی را **صرفاً** به صورت JSON معتبر با ساختار زیر برگردان:
{
  "accountName": "نام پیج یا کانال",
  "platform": "youtube | instagram | tiktok | linkedin | x",
  "format": "فرمت محتوا",
  "title": "عنوان یا هوک اصلی محتوا",
  "publishedLabel": "بازه انتشار",
  "views": 0,
  "baselineViews": 0,
  "likes": 0,
  "comments": 0,
  "hookPattern": "الگوی هوک آغازین (فارسی)",
  "whyItWorked": "تحلیل دلیل عملکرد فراتر از میانگین (فارسی)",
  "structureBreakdown": "کالبدشکافی ساختار روایی و ریتم (فارسی)",
  "brandAdaptationIdea": "پیشنهاد اجرایی بومی‌شده برای برند کاربر (فارسی)"
}`;

        const { response, modelUsed } = await callGeminiWithCascade({
          contents: prompt,
          responseMimeType: 'application/json',
        });

        const parsed = parseJsonFromText<Record<string, unknown>>(response.text);
        res.json({ item: parsed, sources, engine: `${modelUsed}${isYouTubeUrl ? ' + YouTube' : ' + Tavily'}` });
        return;
      }

      if (!title) {
        res.status(400).json({ error: 'لینک یا عنوان محتوا برای کالبدشکافی الزامی است.' });
        return;
      }

      const multiplier =
        baselineViews && baselineViews > 0 && views
          ? (views / baselineViews).toFixed(1)
          : 'نامشخص';

      const { response, modelUsed } = await callGeminiWithCascade({
        contents: `محتوای Outlier زیر را به زبان فارسی عمیقاً کالبدشکافی کن:
عنوان/هوک: ${title}
اکانت: ${accountName || 'نامشخص'} | پلتفرم: ${platform || 'نامشخص'} | فرمت: ${format || 'ویدیو/پست'}
بازدید: ${views ?? 0} | میانگین کانال: ${baselineViews ?? 0} | ضریب Outlier: ${multiplier}x
پروفایل برند برای بخش ایده تطبیق: نام «${brand?.name || ''}»، حوزه «${brand?.niche || ''}»، مخاطب «${brand?.audience || ''}»، لحن «${brand?.tone || ''}»، مزیت رقابتی «${brand?.usp || ''}».`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hookPattern: {
              type: Type.STRING,
              description: 'الگوی هوک ۳ ثانیه اول و قلاب ذهنی مخاطب به فارسی',
            },
            whyItWorked: {
              type: Type.STRING,
              description: 'دلایل روان‌شناختی، پکیجینگ و الگوریتمی جهش بازدید به فارسی',
            },
            structureBreakdown: {
              type: Type.STRING,
              description: 'ساختار بخش‌به‌بخش روایت و حفظ مخاطب (Retention) به فارسی',
            },
            brandAdaptationIdea: {
              type: Type.STRING,
              description: 'ایده دقیق و اختصاصی برای اجرای این الگو توسط برند کاربر به فارسی',
            },
          },
          required: ['hookPattern', 'whyItWorked', 'structureBreakdown', 'brandAdaptationIdea'],
        },
      });

      const parsed = parseJsonFromText<Record<string, unknown>>(response.text);
      res.json({ analysis: parsed, engine: modelUsed });
    } catch (error) {
      const { status, message, code } = formatApiError(error);
      res.status(status).json({ error: message, code });
    }
  });

  // 4. Periodic Watchlist Audit (YouTube Live + Tavily site: Search -> Gemini text-only analysis)
  app.post('/api/watchlist/audit', async (req: Request, res: Response) => {
    try {
      const { brand, accounts, period, forceRefresh } = req.body as {
        brand?: { name?: string; niche?: string; audience?: string; tone?: string; pillars?: string[] };
        accounts?: Array<{
          name: string;
          handle: string;
          platform: string;
          category?: string;
          baselineViews?: number;
        }>;
        period?: string;
        forceRefresh?: boolean;
      };

      if (!accounts || accounts.length === 0) {
        res.status(400).json({ error: 'برای پایش دوره‌ای حداقل یک اکانت در واتچ‌لیست لازم است.' });
        return;
      }

      const targetPeriod = period || '30d';
      const periodMap: Record<string, string> = {
        '7d': '۷ روز گذشته (پایش هفتگی)',
        '14d': '۱۴ روز گذشته (پایش دوهفته‌ای)',
        '30d': '۳۰ روز گذشته (پایش ماهانه)',
        '90d': '۹۰ روز گذشته (پایش فصلی)',
      };
      const periodLabel = periodMap[targetPeriod] || '۳۰ روز گذشته';

      const ytAccounts = accounts.filter((a) => a.platform === 'youtube').slice(0, 4);
      const nonYtAccounts = accounts
        .filter((a) => Boolean(TAVILY_PLATFORM_DOMAINS[a.platform]))
        .slice(0, 4);
      const tavilyReady = isTavilyConfigured();

      if (nonYtAccounts.length > 0 && !tavilyReady && ytAccounts.length === 0) {
        res.status(400).json({
          code: 'TAVILY_KEY_MISSING',
          error:
            'برای پایش زنده اکانت‌های اینستاگرام، تیک‌تاک، لینکدین و ایکس در واتچ‌لیست، کلید TAVILY_API_KEY لازم است. لطفاً آن را در بخش Settings > Secrets اضافه کنید.',
        });
        return;
      }

      const cacheKey = `audit:${computeHash(
        JSON.stringify({
          brandName: brand?.name,
          period: targetPeriod,
          handles: accounts.map((a) => `${a.platform}:${a.handle}`).sort(),
          tavilyReady,
        })
      )}`;
      if (!forceRefresh) {
        const memCached = getMemoryCache<Record<string, unknown>>(cacheKey);
        if (memCached) {
          ensureQuotaDay();
          quotaTracker.memoryCacheHits += 1;
          res.json({ ...memCached, cached: true });
          return;
        }
      }

      const ytPromise = Promise.all(
        ytAccounts.map((acc) => searchYouTubeVideos(acc.name || acc.handle, targetPeriod, 5))
      );

      const tavilyPromise = tavilyReady
        ? Promise.all(
            nonYtAccounts.map(async (acc) => {
              const domain = TAVILY_PLATFORM_DOMAINS[acc.platform];
              const cleanHandle = acc.handle.replace(/^@/, '').trim();
              const query = `site:${domain} ${cleanHandle || acc.name}`.trim();
              const results = await searchTavily(query, {
                searchDepth: 'basic',
                maxResults: 5,
                platform: acc.platform,
              });
              return { label: `${acc.platform}: ${acc.name}`, query, results };
            })
          )
        : Promise.resolve<Array<{ label: string; query: string; results: TavilyCleanResult[] }>>([]);

      const [ytBatches, tavilySections] = await Promise.all([ytPromise, tavilyPromise]);

      if (tavilySections.length > 0) {
        ensureQuotaDay();
        quotaTracker.tavilySearches += tavilySections.length;
      }

      const realVideos = ytBatches.flat().slice(0, 15);
      const ytBlock =
        realVideos.length > 0
          ? `[Live YouTube Recent Activity]\n${realVideos
              .map(
                (v, i) =>
                  `${i + 1}. Channel: ${v.channelName} | Title: ${v.title} | Views: ${v.views} | Published: ${v.publishedLabel} | URL: ${v.url}`
              )
              .join('\n')}`
          : '';
      const tavilyBlock = formatCompactTavilyBlock(tavilySections);

      const sources: { title: string; uri: string }[] = [];
      for (const sec of tavilySections) {
        for (const r of sec.results) {
          if (sources.length < 12) sources.push({ title: r.title, uri: r.url });
        }
      }
      for (const v of realVideos) {
        if (sources.length < 12) sources.push({ title: `${v.channelName}: ${v.title}`, uri: v.url });
      }

      const accountListText = accounts
        .slice(0, 15)
        .map(
          (a, idx) =>
            `${idx + 1}. ${a.name} (${a.handle}) - پلتفرم: ${a.platform} - دسته: ${a.category || 'عمومی'} - میانگین بازدید: ${a.baselineViews ?? 0}`
        )
        .join('\n');

      const gatheredContext = [ytBlock, tavilyBlock].filter(Boolean).join('\n\n');

      const prompt = `
شما مدیر استراتژی و تحلیل داده شبکه‌های اجتماعی برای برند «${brand?.name || 'برند کاربر'}» در حوزه «${brand?.niche || 'نامشخص'}» هستید.
مخاطب هدف: ${brand?.audience || 'نامشخص'} | لحن برند: ${brand?.tone || 'حرفه‌ای'} | ستون‌های محتوایی: ${(brand?.pillars || []).join('، ') || 'نامشخص'}.

لیست اکانت‌های واتچ‌لیست:
${accountListText}

داده‌های زنده جمع‌آوری‌شده از فعالیت اخیر این اکانت‌ها در بازه «${periodLabel}»:
${gatheredContext || 'داده زنده خاصی از جستجو برنگشت؛ بر اساس ترکیب اکانت‌های واتچ‌لیست و حوزه تخصصی تحلیل کن.'}

خروجی را **صرفاً** به صورت یک JSON معتبر و کاملاً به زبان فارسی دقیق و مدیریتی برگردان:
{
  "title": "عنوان دقیق گزارش پایش (مثلاً: گزارش پایش ۳۰ روزه رقبا و ترندهای حوزه ...)",
  "executiveSummary": "خلاصه مدیریتی ۳ تا ۵ جمله‌ای از مهم‌ترین تغییرات محتوایی این بازه زمانی و سیگنال‌های کلیدی بازار",
  "risingTopics": ["موضوع در حال رشد ۱", "موضوع ۲", "موضوع ۳", "موضوع ۴", "موضوع ۵"],
  "winningFormats": ["فرمت و الگوی برنده ۱ همراه با توضیح کوتاه پلتفرم", "فرمت ۲", "فرمت ۳", "فرمت ۴"],
  "contentGaps": ["شکاف محتوایی و فرصتی که رقبا پوشش نداده‌اند ۱", "فرصت ۲", "فرصت ۳", "فرصت ۴"],
  "actionPlan": ["اقدام اجرایی مشخص برای برند در بازه بعدی ۱", "اقدام ۲", "اقدام ۳", "اقدام ۴", "اقدام ۵"]
}`;

      const { response, modelUsed } = await callGeminiWithCascade({
        contents: prompt,
        responseMimeType: 'application/json',
      });

      const parsed = parseJsonFromText<Record<string, unknown>>(response.text);
      const engineLabel =
        tavilySections.length > 0 && realVideos.length > 0
          ? `${modelUsed} + Tavily + YouTube Live`
          : tavilySections.length > 0
            ? `${modelUsed} + Tavily`
            : `${modelUsed} + YouTube Live`;

      const resultObj = {
        report: parsed,
        sources,
        engine: engineLabel,
        mode: tavilySections.length > 0 ? 'tavily_gemini' : 'youtube_ai_enriched',
      };

      setMemoryCache(cacheKey, resultObj);
      res.json({ ...resultObj, cached: false });
    } catch (error) {
      const { status, message, code } = formatApiError(error);
      res.status(status).json({ error: message, code });
    }
  });

  // 5. Brand-Aware Content Studio Generator (Standard text-only Gemini cascade)
  app.post('/api/content/generate', async (req: Request, res: Response) => {
    try {
      const { brand, topic, platform, format, language, goal, extraNotes, outlierBlueprint } = req.body as {
        brand?: {
          name?: string;
          niche?: string;
          audience?: string;
          tone?: string;
          usp?: string;
          forbiddenTerms?: string;
          pillars?: string[];
        };
        topic?: string;
        platform?: string;
        format?: string;
        language?: 'fa' | 'en';
        goal?: string;
        extraNotes?: string;
        outlierBlueprint?: {
          title?: string;
          outlierMultiplier?: number;
          hookPattern?: string;
          whyItWorked?: string;
          structureBreakdown?: string;
        } | null;
      };

      if (!topic || !topic.trim()) {
        res.status(400).json({ error: 'لطفاً موضوع محتوا را وارد کنید.' });
        return;
      }

      const targetLang =
        language === 'en' ? 'English' : 'Persian (فارسی طبیعی، محاوره‌ای-حرفه‌ای و بدون لحن ترجمه‌ای)';

      const prompt = `
Create a complete, high-retention, ready-to-publish social media content package tailored specifically for this brand:

Brand Profile:
- Brand Name: ${brand?.name || 'Brand'}
- Niche / Industry: ${brand?.niche || 'General'}
- Target Audience: ${brand?.audience || 'General Audience'}
- Tone of Voice: ${brand?.tone || 'Clear, insightful, authoritative'}
- Unique Selling Proposition (USP): ${brand?.usp || 'Not specified'}
- Content Pillars: ${(brand?.pillars || []).join(', ') || 'Not specified'}
- Forbidden Terms / Avoid: ${brand?.forbiddenTerms || 'None'}

Content Brief:
- Topic: ${topic.trim()}
- Target Platform: ${platform || 'instagram'}
- Format: ${format || 'Short-form Video'}
- Primary Goal: ${goal || 'Reach & High Retention'}
- Output Language: ${targetLang}
${extraNotes ? `- Additional Direction: ${extraNotes}` : ''}

${
  outlierBlueprint
    ? `Reference Outlier Blueprint to Reverse-Engineer (DO NOT copy verbatim; adapt its psychological mechanics and pacing to the brand):
- Original Outlier Title: ${outlierBlueprint.title || ''} (${outlierBlueprint.outlierMultiplier || ''}x baseline)
- Proven Hook Pattern: ${outlierBlueprint.hookPattern || ''}
- Why It Outperformed: ${outlierBlueprint.whyItWorked || ''}
- Structural Flow: ${outlierBlueprint.structureBreakdown || ''}`
    : ''
}

Deliver concrete, production-ready output in ${targetLang}:
- For video formats (YouTube, Reels, TikTok, Shorts), write a timestamped script with visual/b-roll cues in [brackets].
- For Carousels/Documents, write slide-by-slide copy (Slide 1 to Slide 7-9).
- For X Threads, write numbered tweet-by-tweet copy optimized for bookmarking and replies.
- For LinkedIn posts, use crisp formatting with scroll-stopping opening lines and substantive insight.
- In brandFitNotes, briefly explain in Persian why this angle matches the brand's voice and audience.`;

      const { response, modelUsed } = await callGeminiWithCascade({
        contents: prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Main working title or headline in the target output language',
            },
            hooks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 distinct high-retention hook variations in the target output language',
            },
            bodyScript: {
              type: Type.STRING,
              description: 'Full ready-to-shoot script, slide breakdown, or post/thread body in the target output language',
            },
            caption: {
              type: Type.STRING,
              description: 'Platform-optimized caption and 3-5 relevant hashtags in the target output language',
            },
            cta: {
              type: Type.STRING,
              description: 'Clear, natural call-to-action in the target output language',
            },
            visualConcept: {
              type: Type.STRING,
              description: 'Concrete thumbnail, cover frame, visual framing, or b-roll art direction',
            },
            brandFitNotes: {
              type: Type.STRING,
              description: 'Concise strategic explanation (in Persian) of how this aligns with the brand positioning and outlier mechanics',
            },
          },
          required: ['title', 'hooks', 'bodyScript', 'caption', 'cta', 'visualConcept', 'brandFitNotes'],
        },
      });

      const parsed = parseJsonFromText<Record<string, unknown>>(response.text);
      res.json({ content: parsed, engine: modelUsed });
    } catch (error) {
      const { status, message, code } = formatApiError(error);
      res.status(status).json({ error: message, code });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Content Radar Studio running on http://0.0.0.0:${port}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
