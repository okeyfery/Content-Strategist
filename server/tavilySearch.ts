/**
 * Server-side Tavily Search Service for targeted social media discovery & analysis.
 * Uses https://api.tavily.com/search with process.env.TAVILY_API_KEY (never exposed to browser).
 */

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export const TAVILY_PLATFORM_DOMAINS: Record<string, string> = {
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
  x: 'x.com',
};

export interface TavilyCleanResult {
  title: string;
  url: string;
  content: string;
  platform?: string;
}

export class TavilyError extends Error {
  code: 'TAVILY_KEY_MISSING' | 'TAVILY_KEY_INVALID' | 'TAVILY_QUOTA_EXHAUSTED' | 'TAVILY_API_ERROR';
  status: number;

  constructor(
    code: 'TAVILY_KEY_MISSING' | 'TAVILY_KEY_INVALID' | 'TAVILY_QUOTA_EXHAUSTED' | 'TAVILY_API_ERROR',
    status: number,
    message: string
  ) {
    super(message);
    this.name = 'TavilyError';
    this.code = code;
    this.status = status;
  }
}

function getNormalizedTavilyKey(): string {
  const candidates = [process.env.TAVILY_API_KEY, process.env.VITE_TAVILY_API_KEY];
  for (const raw of candidates) {
    const unquoted = (raw ?? '').trim().replace(/^['"]+|['"]+$/g, '').trim();
    const withoutBearer = unquoted.replace(/^Bearer\s+/i, '').trim();
    if (
      withoutBearer &&
      !/^MY_TAVILY_API_KEY$/i.test(withoutBearer) &&
      !/^YOUR_TAVILY_API_KEY$/i.test(withoutBearer)
    ) {
      return withoutBearer;
    }
  }
  return '';
}

export function isTavilyConfigured(): boolean {
  return Boolean(getNormalizedTavilyKey());
}

/**
 * Validates that a URL uses http: or https: and does not point to loopback,
 * private network, or link-local metadata addresses.
 */
export function sanitizeHttpUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanCompactText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export async function searchTavily(
  query: string,
  options?: {
    searchDepth?: 'basic' | 'advanced';
    maxResults?: number;
    platform?: string;
  }
): Promise<TavilyCleanResult[]> {
  const apiKey = getNormalizedTavilyKey();
  if (!apiKey) {
    const isVercel = Boolean(process.env.VERCEL);
    throw new TavilyError(
      'TAVILY_KEY_MISSING',
      400,
      isVercel
        ? 'کلید TAVILY_API_KEY در Vercel تنظیم نشده است. وارد Vercel → Project Settings → Environment Variables شوید، متغیر TAVILY_API_KEY را برای Production اضافه کنید و سپس یک‌بار Redeploy بزنید.'
        : 'کلید TAVILY_API_KEY تنظیم نشده است. برای جستجوی زنده در اینستاگرام، تیک‌تاک، لینکدین و ایکس، لطفاً TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید.'
    );
  }

  const cleanQuery = query.trim().slice(0, 350);
  if (!cleanQuery) return [];

  const searchDepth = options?.searchDepth ?? 'basic';
  const maxResults = Math.min(Math.max(options?.maxResults ?? 5, 1), 10);

  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'aistudio-build',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: cleanQuery,
      search_depth: searchDepth,
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    console.warn(`[Tavily API Error] status=${response.status}`);
    if (response.status === 401) {
      throw new TavilyError(
        'TAVILY_KEY_INVALID',
        401,
        'کلید TAVILY_API_KEY نامعتبر است. لطفاً مقدار دقیق کلید Tavily (شروع‌شونده با tvly-) را در بخش Settings > Secrets بررسی و ذخیره کنید.'
      );
    }
    if (response.status === 403) {
      throw new TavilyError(
        'TAVILY_KEY_INVALID',
        403,
        'دسترسی به Tavily API رد شد (کد ۴۰۳). لطفاً اعتبار حساب Tavily و کلید TAVILY_API_KEY را در بخش Settings > Secrets بررسی کنید.'
      );
    }
    if (response.status === 429) {
      throw new TavilyError(
        'TAVILY_QUOTA_EXHAUSTED',
        429,
        'سهمیه سرویس جستجوی Tavily تکمیل شده است. لطفاً وضعیت کلید TAVILY_API_KEY را در حساب Tavily یا بخش Settings > Secrets بررسی کنید.'
      );
    }
    throw new TavilyError(
      'TAVILY_API_ERROR',
      502,
      `خطا در دریافت نتایج جستجو از سرویس Tavily (کد ${response.status}). لطفاً دوباره تلاش کنید.`
    );
  }

  const payload = (await response.json()) as {
    results?: Array<{
      title?: unknown;
      url?: unknown;
      content?: unknown;
    }>;
  };

  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const cleaned: TavilyCleanResult[] = [];
  const seenUrls = new Set<string>();

  for (const item of rawResults) {
    const safeUrl = sanitizeHttpUrl(typeof item.url === 'string' ? item.url : undefined);
    if (!safeUrl || seenUrls.has(safeUrl.toLowerCase())) continue;

    const title = cleanCompactText(item.title, 160);
    const content = cleanCompactText(item.content, 360);
    if (!title && !content) continue;

    seenUrls.add(safeUrl.toLowerCase());
    cleaned.push({
      title: title || safeUrl,
      url: safeUrl,
      content,
      platform: options?.platform,
    });
  }

  return cleaned;
}

export interface PlatformTavilySearchBundle {
  allResults: TavilyCleanResult[];
  compactTextBlock: string;
  sources: { title: string; uri: string }[];
  queriesExecuted: number;
}

/**
 * Formats extracted Tavily title/url/content entries into a compact structured text block
 * to minimize Gemini prompt token usage.
 */
export function formatCompactTavilyBlock(
  sections: Array<{ label: string; query: string; results: TavilyCleanResult[] }>
): string {
  const blocks: string[] = [];

  for (const section of sections) {
    if (section.results.length === 0) continue;
    const lines = section.results.map(
      (r, idx) =>
        `${idx + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.content || 'N/A'}`
    );
    blocks.push(`[${section.label} | Query: ${section.query}]\n${lines.join('\n')}`);
  }

  return blocks.join('\n\n');
}

/**
 * Runs targeted site:-operator Tavily searches in parallel for Instagram, TikTok, LinkedIn, and X.
 */
export async function searchSocialPlatformsWithTavily(
  platforms: string[],
  topic: string,
  extraKeywords?: string
): Promise<PlatformTavilySearchBundle> {
  const supported = platforms.filter((p) => Boolean(TAVILY_PLATFORM_DOMAINS[p]));
  if (supported.length === 0) {
    return { allResults: [], compactTextBlock: '', sources: [], queriesExecuted: 0 };
  }

  const cleanTopic = topic.trim().slice(0, 180);
  const suffix = extraKeywords ? ` ${extraKeywords.trim().slice(0, 80)}` : '';

  const sectionTasks = supported.map(async (platform) => {
    const domain = TAVILY_PLATFORM_DOMAINS[platform];
    const query = `site:${domain} ${cleanTopic}${suffix}`.trim();
    const results = await searchTavily(query, {
      searchDepth: 'basic',
      maxResults: 5,
      platform,
    });
    return {
      label: `Platform: ${platform}`,
      query,
      results,
    };
  });

  const sections = await Promise.all(sectionTasks);
  const allResults = sections.flatMap((s) => s.results);
  const compactTextBlock = formatCompactTavilyBlock(sections);

  const seenUri = new Set<string>();
  const sources: { title: string; uri: string }[] = [];
  for (const item of allResults) {
    if (!seenUri.has(item.url) && sources.length < 12) {
      seenUri.add(item.url);
      sources.push({
        title: item.title.slice(0, 220),
        uri: item.url.slice(0, 580),
      });
    }
  }

  return {
    allResults,
    compactTextBlock,
    sources,
    queriesExecuted: supported.length,
  };
}
