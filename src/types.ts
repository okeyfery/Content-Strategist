export type Platform = 'youtube' | 'instagram' | 'tiktok' | 'linkedin' | 'x';
export type PeriodWindow = '7d' | '14d' | '30d' | '90d';
export type ContentLanguage = 'fa' | 'en';
export type BrandDefaultLanguage = 'fa' | 'en' | 'both';
export type DraftStatus = 'idea' | 'draft' | 'ready' | 'archived';
export type OutlierSourceType = 'ai_discovery' | 'manual_entry' | 'csv_import' | 'url_analysis';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface Brand {
  id: string;
  ownerId: string;
  name: string;
  niche: string;
  audience: string;
  tone: string;
  usp: string;
  forbiddenTerms: string;
  defaultLanguage: BrandDefaultLanguage;
  pillars: string[];
  platforms: Platform[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WatchlistAccount {
  id: string;
  ownerId: string;
  brandId: string;
  platform: Platform;
  name: string;
  handle: string;
  url: string;
  category: string;
  baselineViews: number;
  followersCount: number;
  cadence: PeriodWindow;
  contentStyle: string;
  notes: string;
  lastAuditedAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OutlierItem {
  id: string;
  ownerId: string;
  brandId: string;
  accountId: string;
  accountName: string;
  platform: Platform;
  format: string;
  title: string;
  url: string;
  publishedLabel: string;
  views: number;
  baselineViews: number;
  outlierMultiplier: number;
  likes: number;
  comments: number;
  engagementRate: number;
  hookPattern: string;
  whyItWorked: string;
  structureBreakdown: string;
  brandAdaptationIdea: string;
  sourceType: OutlierSourceType;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditReport {
  id: string;
  ownerId: string;
  brandId: string;
  period: PeriodWindow;
  title: string;
  executiveSummary: string;
  accountsReviewed: string[];
  risingTopics: string[];
  winningFormats: string[];
  contentGaps: string[];
  actionPlan: string[];
  sources: GroundingSource[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ContentDraft {
  id: string;
  ownerId: string;
  brandId: string;
  sourceOutlierId: string;
  platform: Platform;
  format: string;
  language: ContentLanguage;
  topic: string;
  title: string;
  hooks: string[];
  bodyScript: string;
  caption: string;
  cta: string;
  visualConcept: string;
  brandFitNotes: string;
  status: DraftStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DiscoveredAccount {
  name: string;
  handle: string;
  platform: Platform;
  url: string;
  category: string;
  estimatedBaselineViews: number;
  estimatedFollowers: number;
  contentStyle: string;
  whyRelevant: string;
}

export interface DiscoveredOutlier {
  accountName: string;
  platform: Platform;
  format: string;
  title: string;
  url: string;
  publishedLabel: string;
  views: number;
  baselineViews: number;
  outlierMultiplier: number;
  likes: number;
  comments: number;
  engagementRate: number;
  hookPattern: string;
  whyItWorked: string;
  structureBreakdown: string;
  brandAdaptationIdea: string;
}

export const PLATFORM_META: Record<
  Platform,
  { labelFa: string; labelEn: string; formats: string[]; color: string }
> = {
  youtube: {
    labelFa: 'یوتیوب',
    labelEn: 'YouTube',
    formats: ['ویدیو بلند یوتیوب', 'YouTube Shorts'],
    color: '#EF4444',
  },
  instagram: {
    labelFa: 'اینستاگرام',
    labelEn: 'Instagram',
    formats: ['Instagram Reel', 'پست اسلایدی (Carousel)', 'استوری سریالی'],
    color: '#E1306C',
  },
  tiktok: {
    labelFa: 'تیک‌تاک',
    labelEn: 'TikTok',
    formats: ['ویدیو کوتاه TikTok', 'اسلایدشو TikTok'],
    color: '#22D3EE',
  },
  linkedin: {
    labelFa: 'لینکدین',
    labelEn: 'LinkedIn',
    formats: ['پست متنی تحلیلی', 'اسلاید PDF (Document)', 'ویدیو کوتاه لینکدین'],
    color: '#3B82F6',
  },
  x: {
    labelFa: 'ایکس (X)',
    labelEn: 'X',
    formats: ['رشته‌توییت (Thread)', 'توییت کوتاه وایرال', 'مقاله کوتاه X'],
    color: '#94A3B8',
  },
};

export const PERIOD_LABELS: Record<PeriodWindow, string> = {
  '7d': '۷ روز اخیر',
  '14d': '۱۴ روز اخیر',
  '30d': '۳۰ روز اخیر',
  '90d': '۹۰ روز اخیر',
};

export type AccountSizeTier =
  | 'established'
  | 'micro'
  | 'mid'
  | 'macro'
  | 'mega'
  | 'all'
  | 'custom';

export interface AccountRangeFilter {
  tier: AccountSizeTier;
  minFollowers?: number;
  maxFollowers?: number;
  minViews?: number;
}

export const ACCOUNT_SIZE_TIERS: Record<
  AccountSizeTier,
  {
    labelFa: string;
    shortFa: string;
    minFollowers: number;
    maxFollowers?: number;
    defaultMinViews: number;
  }
> = {
  established: {
    labelFa: 'تثبیت‌شده (+۱۰K فالوئر · حذف پیج‌های نوپا)',
    shortFa: '+۱۰K فالوئر',
    minFollowers: 10_000,
    defaultMinViews: 10_000,
  },
  micro: {
    labelFa: 'میکرو و در حال رشد (۱۰K تا ۵۰K فالوئر)',
    shortFa: '۱۰K – ۵۰K',
    minFollowers: 10_000,
    maxFollowers: 50_000,
    defaultMinViews: 5_000,
  },
  mid: {
    labelFa: 'حرفه‌ای و میانی (۵۰K تا ۲۵۰K فالوئر)',
    shortFa: '۵۰K – ۲۵۰K',
    minFollowers: 50_000,
    maxFollowers: 250_000,
    defaultMinViews: 25_000,
  },
  macro: {
    labelFa: 'بزرگ و اثرگذار (۲۵۰K تا ۱M فالوئر)',
    shortFa: '۲۵۰K – ۱M',
    minFollowers: 250_000,
    maxFollowers: 1_000_000,
    defaultMinViews: 80_000,
  },
  mega: {
    labelFa: 'تاپ و مرجع (بالای ۱M فالوئر)',
    shortFa: '+۱M فالوئر',
    minFollowers: 1_000_000,
    defaultMinViews: 250_000,
  },
  all: {
    labelFa: 'همه اندازه‌ها (بدون محدودیت فالوئر)',
    shortFa: 'همه اندازه‌ها',
    minFollowers: 0,
    defaultMinViews: 0,
  },
  custom: {
    labelFa: 'بازه دلخواه (تعیین دقیق حداقل و حداکثر)',
    shortFa: 'بازه دلخواه',
    minFollowers: 0,
    defaultMinViews: 0,
  },
};

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  idea: 'ایده اولیه',
  draft: 'در حال ویرایش',
  ready: 'آماده انتشار',
  archived: 'بایگانی‌شده',
};

// Synchronized verbatim with firebase-blueprint.json maxLength limits
export const LIMITS = {
  ID: 128,
  BRAND_NAME: 120,
  BRAND_NICHE: 160,
  BRAND_AUDIENCE: 400,
  BRAND_TONE: 240,
  BRAND_USP: 500,
  BRAND_FORBIDDEN: 300,
  ACCOUNT_NAME: 140,
  ACCOUNT_HANDLE: 140,
  URL: 500,
  CATEGORY: 120,
  CONTENT_STYLE: 500,
  NOTES: 1000,
  OUTLIER_TITLE: 300,
  OUTLIER_FORMAT: 80,
  OUTLIER_PUBLISHED: 80,
  OUTLIER_HOOK: 500,
  OUTLIER_WHY: 1500,
  OUTLIER_STRUCTURE: 1500,
  OUTLIER_ADAPTATION: 1000,
  REPORT_TITLE: 200,
  REPORT_SUMMARY: 2500,
  DRAFT_TOPIC: 240,
  DRAFT_TITLE: 240,
  DRAFT_SCRIPT: 8000,
  DRAFT_CAPTION: 2500,
  DRAFT_CTA: 500,
  DRAFT_VISUAL: 1200,
  DRAFT_FIT: 1200,
} as const;

export function clipStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function clipNum(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function clipStringList(arr: unknown, maxItems: number, maxItemLen = 480): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => clipStr(String(item ?? ''), maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function formatCompactNumber(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return Math.round(num).toLocaleString('en-US');
}
