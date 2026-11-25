import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Flame,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { buildAICacheKey, getAICacheEntry, setAICacheEntry } from '../services/firestoreService';
import {
  ACCOUNT_SIZE_TIERS,
  formatCompactNumber,
  PERIOD_LABELS,
  PLATFORM_META,
  type AccountSizeTier,
  type Brand,
  type DiscoveredOutlier,
  type GroundingSource,
  type OutlierItem,
  type PeriodWindow,
  type Platform,
  type WatchlistAccount,
} from '../types';

interface OutlierHunterViewProps {
  brand: Brand;
  accounts: WatchlistAccount[];
  outliers: OutlierItem[];
  onSaveOutlier: (
    item: Omit<OutlierItem, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onUpdateDeconstruction: (
    outlierId: string,
    analysis: {
      hookPattern: string;
      whyItWorked: string;
      structureBreakdown: string;
      brandAdaptationIdea: string;
    }
  ) => Promise<void>;
  onDeleteOutlier: (outlierId: string) => Promise<void>;
  onGenerateFromOutlier: (outlier: OutlierItem) => void;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];
const PERIODS: PeriodWindow[] = ['7d', '14d', '30d', '90d'];
const TIER_KEYS: AccountSizeTier[] = ['established', 'micro', 'mid', 'macro', 'mega', 'all', 'custom'];

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function OutlierHunterView({
  brand,
  accounts,
  outliers,
  onSaveOutlier,
  onUpdateDeconstruction,
  onDeleteOutlier,
  onGenerateFromOutlier,
}: OutlierHunterViewProps) {
  // Hunting Controls
  const [huntNiche, setHuntNiche] = useState(brand.niche);
  const [huntPeriod, setHuntPeriod] = useState<PeriodWindow>('30d');
  const [huntAccountTier, setHuntAccountTier] = useState<AccountSizeTier>('established');
  const [huntMinViews, setHuntMinViews] = useState<string>('auto');
  const [customMinFollowers, setCustomMinFollowers] = useState('20000');
  const [customMaxFollowers, setCustomMaxFollowers] = useState('');
  const [huntPlatforms, setHuntPlatforms] = useState<Platform[]>(
    brand.platforms?.length ? brand.platforms : ALL_PLATFORMS
  );
  const [useWatchlistContext, setUseWatchlistContext] = useState(true);
  const [hunting, setHunting] = useState(false);
  const [huntError, setHuntError] = useState<string | null>(null);
  const [huntNotice, setHuntNotice] = useState<string | null>(null);
  const [huntMeta, setHuntMeta] = useState<{ engine: string; cached: boolean } | null>(null);
  const [huntedResults, setHuntedResults] = useState<DiscoveredOutlier[]>([]);
  const [huntSources, setHuntSources] = useState<GroundingSource[]>([]);
  const [savedTitles, setSavedTitles] = useState<Set<string>>(new Set());

  // Direct URL Analyzer
  const [urlInput, setUrlInput] = useState('');
  const [analyzingUrl, setAnalyzingUrl] = useState(false);

  // Table Filters & Drawer
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [minMultiplier, setMinMultiplier] = useState<number>(0);
  const [selectedOutlier, setSelectedOutlier] = useState<OutlierItem | null>(null);
  const [deconstructingId, setDeconstructingId] = useState<string | null>(null);

  // Manual & CSV Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTab, setImportTab] = useState<'single' | 'csv'>('single');
  const [sTitle, setSTitle] = useState('');
  const [sAccount, setSAccount] = useState('');
  const [sPlatform, setSPlatform] = useState<Platform>('youtube');
  const [sFormat, setSFormat] = useState(PLATFORM_META.youtube.formats[0]);
  const [sViews, setSViews] = useState('185000');
  const [sBaseline, setSBaseline] = useState('32000');
  const [sLikes, setSLikes] = useState('9400');
  const [sComments, setSComments] = useState('380');
  const [sUrl, setSUrl] = useState('');
  const [csvAccount, setCsvAccount] = useState('');
  const [csvPlatform, setCsvPlatform] = useState<Platform>('youtube');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);

  const toggleHuntPlatform = (p: Platform) => {
    setHuntPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]
    );
  };

  const filteredOutliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return outliers.filter((o) => {
      if (platformFilter !== 'all' && o.platform !== platformFilter) return false;
      if (o.outlierMultiplier < minMultiplier) return false;
      if (
        q &&
        !o.title.toLowerCase().includes(q) &&
        !o.accountName.toLowerCase().includes(q) &&
        !o.hookPattern.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [outliers, platformFilter, searchQuery, minMultiplier]);

  const scatterData = useMemo(() => {
    return filteredOutliers.slice(0, 25).map((o) => ({
      title: o.title,
      account: o.accountName,
      viewsK: Math.round((o.views / 1000) * 10) / 10,
      multiplier: o.outlierMultiplier,
      engagement: Math.max(2, o.engagementRate),
      platform: PLATFORM_META[o.platform].labelFa,
    }));
  }, [filteredOutliers]);

  const runHunt = async (forceRefresh = false) => {
    if (!huntNiche.trim()) return;
    setHunting(true);
    setHuntError(null);
    setHuntNotice(null);

    const explicitMinViews =
      huntMinViews === 'auto'
        ? ACCOUNT_SIZE_TIERS[huntAccountTier].defaultMinViews
        : Number(huntMinViews) || 0;

    const accountRange =
      huntAccountTier === 'custom'
        ? {
            tier: 'custom' as const,
            minFollowers: Number(customMinFollowers) > 0 ? Number(customMinFollowers) : 0,
            maxFollowers: Number(customMaxFollowers) > 0 ? Number(customMaxFollowers) : undefined,
            minViews: explicitMinViews,
          }
        : {
            tier: huntAccountTier,
            minFollowers: ACCOUNT_SIZE_TIERS[huntAccountTier].minFollowers,
            maxFollowers: ACCOUNT_SIZE_TIERS[huntAccountTier].maxFollowers,
            minViews: explicitMinViews,
          };

    const payload = {
      niche: huntNiche.trim(),
      platforms: huntPlatforms,
      period: huntPeriod,
      accountRange,
      watchlistNames: useWatchlistContext ? accounts.map((a) => a.name) : [],
      brand: {
        name: brand.name,
        niche: brand.niche,
        audience: brand.audience,
        tone: brand.tone,
      },
    };

    try {
      const uid = auth.currentUser?.uid || '';
      const { cacheKey, payloadHash } = await buildAICacheKey('hunt', payload);

      if (!forceRefresh && uid) {
        const cached = await getAICacheEntry<{
          outliers: DiscoveredOutlier[];
          sources: GroundingSource[];
          engine?: string;
        }>(uid, cacheKey);
        if (cached && Array.isArray(cached.outliers) && cached.outliers.length > 0) {
          setHuntedResults(cached.outliers);
          setHuntSources(cached.sources || []);
          setHuntMeta({ engine: cached.engine || 'Firestore Cache', cached: true });
          return;
        }
      }

      const res = await fetch('/api/outliers/hunt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, forceRefresh }),
      });
      const data = (await res.json()) as {
        outliers?: DiscoveredOutlier[];
        sources?: GroundingSource[];
        engine?: string;
        mode?: string;
        cached?: boolean;
        notice?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'خطا در شکار ویدیوهای Outlier');
      }

      const outliersList = data.outliers || [];
      const sourcesList = data.sources || [];
      setHuntedResults(outliersList);
      setHuntSources(sourcesList);
      setHuntMeta({ engine: data.engine || 'Live Search', cached: Boolean(data.cached) });
      if (data.notice) setHuntNotice(data.notice);

      if (uid && outliersList.length > 0 && data.mode !== 'youtube_direct' && !data.notice) {
        void setAICacheEntry(uid, cacheKey, 'hunt', payloadHash, {
          outliers: outliersList,
          sources: sourcesList,
          engine: data.engine || 'gemini',
        });
      }
    } catch (err) {
      setHuntError(err instanceof Error ? err.message : 'خطا در ارتباط با سرور');
    } finally {
      setHunting(false);
    }
  };

  const handleHunt = async (e: React.FormEvent) => {
    e.preventDefault();
    await runHunt(false);
  };

  const handleSaveDiscovered = async (item: DiscoveredOutlier) => {
    await onSaveOutlier({
      accountId: '',
      accountName: item.accountName,
      platform: item.platform,
      format: item.format,
      title: item.title,
      url: item.url,
      publishedLabel: item.publishedLabel,
      views: item.views,
      baselineViews: item.baselineViews,
      outlierMultiplier: item.outlierMultiplier,
      likes: item.likes,
      comments: item.comments,
      engagementRate: item.engagementRate,
      hookPattern: item.hookPattern,
      whyItWorked: item.whyItWorked,
      structureBreakdown: item.structureBreakdown,
      brandAdaptationIdea: item.brandAdaptationIdea,
      sourceType: 'ai_discovery',
    });
    setSavedTitles((prev) => new Set(prev).add(item.title));
  };

  const handleSaveAllDiscovered = async () => {
    for (const item of huntedResults) {
      if (!savedTitles.has(item.title) && !outliers.some((o) => o.title === item.title)) {
        await handleSaveDiscovered(item);
      }
    }
  };

  const handleAnalyzeUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setAnalyzingUrl(true);
    setHuntError(null);
    try {
      const res = await fetch('/api/outliers/deconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.trim(),
          brand: {
            name: brand.name,
            niche: brand.niche,
            audience: brand.audience,
            tone: brand.tone,
            usp: brand.usp,
          },
        }),
      });
      const data = (await res.json()) as {
        item?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok || !data.item) {
        throw new Error(data.error || 'خطا در تحلیل لینک');
      }
      const it = data.item;
      const views = Number(it.views) || 0;
      const baseline = Number(it.baselineViews) || 0;
      const mult = baseline > 0 ? Math.round((views / baseline) * 10) / 10 : 3.0;
      await onSaveOutlier({
        accountId: '',
        accountName: String(it.accountName || 'کانال منبع'),
        platform: (it.platform as Platform) || 'youtube',
        format: String(it.format || 'ویدیو'),
        title: String(it.title || urlInput.trim()),
        url: urlInput.trim(),
        publishedLabel: String(it.publishedLabel || 'تحلیل لینک'),
        views,
        baselineViews: baseline,
        outlierMultiplier: mult,
        likes: Number(it.likes) || 0,
        comments: Number(it.comments) || 0,
        engagementRate: 0,
        hookPattern: String(it.hookPattern || ''),
        whyItWorked: String(it.whyItWorked || ''),
        structureBreakdown: String(it.structureBreakdown || ''),
        brandAdaptationIdea: String(it.brandAdaptationIdea || ''),
        sourceType: 'url_analysis',
      });
      setUrlInput('');
    } catch (err) {
      setHuntError(err instanceof Error ? err.message : 'خطا در تحلیل لینک');
    } finally {
      setAnalyzingUrl(false);
    }
  };

  const handleDeconstructExisting = async (item: OutlierItem) => {
    setDeconstructingId(item.id);
    setHuntError(null);
    try {
      const res = await fetch('/api/outliers/deconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          accountName: item.accountName,
          platform: item.platform,
          format: item.format,
          views: item.views,
          baselineViews: item.baselineViews,
          brand: {
            name: brand.name,
            niche: brand.niche,
            audience: brand.audience,
            tone: brand.tone,
            usp: brand.usp,
          },
        }),
      });
      const data = (await res.json()) as {
        analysis?: {
          hookPattern: string;
          whyItWorked: string;
          structureBreakdown: string;
          brandAdaptationIdea: string;
        };
        error?: string;
      };
      if (!res.ok || !data.analysis) {
        throw new Error(data.error || 'خطا در کالبدشکافی محتوا');
      }
      await onUpdateDeconstruction(item.id, data.analysis);
      setSelectedOutlier({ ...item, ...data.analysis });
    } catch (err) {
      setHuntError(err instanceof Error ? err.message : 'خطا در کالبدشکافی');
    } finally {
      setDeconstructingId(null);
    }
  };

  const handleSingleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sTitle.trim() || !sAccount.trim()) return;
    setImporting(true);
    try {
      const views = Number(sViews) || 0;
      const baseline = Number(sBaseline) || 1;
      await onSaveOutlier({
        accountId: '',
        accountName: sAccount.trim(),
        platform: sPlatform,
        format: sFormat,
        title: sTitle.trim(),
        url: sUrl.trim(),
        publishedLabel: 'ثبت دستی',
        views,
        baselineViews: baseline,
        outlierMultiplier: Math.round((views / Math.max(1, baseline)) * 10) / 10,
        likes: Number(sLikes) || 0,
        comments: Number(sComments) || 0,
        engagementRate: 0,
        hookPattern: '',
        whyItWorked: '',
        structureBreakdown: '',
        brandAdaptationIdea: '',
        sourceType: 'manual_entry',
      });
      setSTitle('');
      setSUrl('');
      setShowImportModal(false);
    } finally {
      setImporting(false);
    }
  };

  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setImporting(true);
    try {
      // Parse lines: title, views, likes, comments, url(optional)
      const parsed = lines
        .map((line) => {
          const cols = line.split(/[,\t;]+/).map((c) => c.trim());
          if (cols.length < 2) return null;
          const views = Number(cols[1].replace(/[^\d.]/g, '')) || 0;
          if (views <= 0) return null;
          return {
            title: cols[0],
            views,
            likes: Number((cols[2] || '0').replace(/[^\d.]/g, '')) || 0,
            comments: Number((cols[3] || '0').replace(/[^\d.]/g, '')) || 0,
            url: cols[4] || '',
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (parsed.length === 0) {
        setHuntError('فرمت CSV معتبر نبود. هر سطر باید حداقل شامل «عنوان، تعداد بازدید» باشد.');
        return;
      }

      const median = computeMedian(parsed.map((p) => p.views));
      // Keep items with multiplier >= 1.5x (or top 5 if small list)
      const ranked = parsed
        .map((p) => ({
          ...p,
          multiplier: median > 0 ? Math.round((p.views / median) * 10) / 10 : 1,
        }))
        .sort((a, b) => b.multiplier - a.multiplier);

      const outliersToSave = ranked.filter((r) => r.multiplier >= 1.5);
      const finalBatch = (outliersToSave.length > 0 ? outliersToSave : ranked.slice(0, 5)).slice(0, 10);

      for (const item of finalBatch) {
        await onSaveOutlier({
          accountId: '',
          accountName: csvAccount.trim() || 'ایمپورت CSV',
          platform: csvPlatform,
          format: PLATFORM_META[csvPlatform].formats[0],
          title: item.title,
          url: item.url,
          publishedLabel: 'ایمپورت CSV',
          views: item.views,
          baselineViews: Math.round(median),
          outlierMultiplier: item.multiplier,
          likes: item.likes,
          comments: item.comments,
          engagementRate: 0,
          hookPattern: '',
          whyItWorked: '',
          structureBreakdown: '',
          brandAdaptationIdea: '',
          sourceType: 'csv_import',
        });
      }

      setCsvText('');
      setShowImportModal(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">شکارچی و کالبدشکاف ویدیوهای Outlier</h1>
          <p className="text-xs text-[#94A3B8]">
            ویدیوها و پست‌هایی را پیدا کنید که چندین برابر میانگین کانال دیده شده‌اند، دلیل موفقیتشان را تحلیل کنید
            و برای برند خود بازآفرینی نمایید.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowImportModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#111827] hover:bg-[#161F30] text-white border border-[#1F2937] rounded-lg transition-colors cursor-pointer whitespace-nowrap self-start md:self-auto"
        >
          <Upload className="w-3.5 h-3.5" />
          ثبت دستی یا ایمپورت CSV آمار
        </button>
      </div>

      {/* Dual Tool Strip: Live AI Outlier Hunt + Direct URL Analyzer */}
      <div className="grid lg:grid-cols-12 gap-4">
        <form
          onSubmit={handleHunt}
          className="lg:col-span-8 bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4"
        >
          <div className="grid sm:grid-cols-12 gap-3">
            <label className="sm:col-span-6 space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1] block">موضوع یا فیلد شکار Outlier</span>
              <input
                required
                value={huntNiche}
                onChange={(e) => setHuntNiche(e.target.value)}
                placeholder="مثلاً: هوش مصنوعی، بازاریابی محتوایی، فین‌تک"
                className="w-full px-3.5 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              />
            </label>
            <label className="sm:col-span-3 space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1] block">بازه زمانی</span>
              <select
                value={huntPeriod}
                onChange={(e) => setHuntPeriod(e.target.value as PeriodWindow)}
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-3 flex items-end">
              <button
                type="submit"
                disabled={hunting}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap h-[38px]"
              >
                <Flame className="w-3.5 h-3.5" />
                {hunting ? 'در حال شکار...' : 'شکار Outlier'}
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-12 gap-3 pt-2 border-t border-[#1F2937]">
            <label className="sm:col-span-7 space-y-1.5">
              <span className="text-[11px] font-medium text-[#94A3B8] block">
                بازه اندازه اکانت هدف (فالوئر / سابسکرایبر)
              </span>
              <select
                value={huntAccountTier}
                onChange={(e) => setHuntAccountTier(e.target.value as AccountSizeTier)}
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              >
                {TIER_KEYS.map((tier) => (
                  <option key={tier} value={tier}>
                    {ACCOUNT_SIZE_TIERS[tier].labelFa}
                  </option>
                ))}
              </select>
            </label>

            <label className="sm:col-span-5 space-y-1.5">
              <span className="text-[11px] font-medium text-[#94A3B8] block">کف بازدید محتوای موفق</span>
              <select
                value={huntMinViews}
                onChange={(e) => setHuntMinViews(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              >
                <option value="auto">خودکار (متناسب با بازه اکانت)</option>
                <option value="0">بدون کف بازدید</option>
                <option value="10000">حداقل ۱۰K بازدید</option>
                <option value="25000">حداقل ۲۵K بازدید</option>
                <option value="50000">حداقل ۵۰K بازدید</option>
                <option value="100000">حداقل ۱۰۰K بازدید</option>
                <option value="500000">حداقل ۵۰۰K بازدید</option>
              </select>
            </label>
          </div>

          {huntAccountTier === 'custom' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-[#94A3B8] block">حداقل فالوئر</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={customMinFollowers}
                  onChange={(e) => setCustomMinFollowers(e.target.value)}
                  placeholder="مثلاً 20000"
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-[#94A3B8] block">حداکثر فالوئر (اختیاری)</span>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={customMaxFollowers}
                  onChange={(e) => setCustomMaxFollowers(e.target.value)}
                  placeholder="خالی = بدون سقف"
                  dir="ltr"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1F2937]">
            <div className="flex flex-wrap items-center gap-1.5">
              {ALL_PLATFORMS.map((p) => {
                const active = huntPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleHuntPlatform(p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#3B82F6]/15 border-[#3B82F6] text-white'
                        : 'bg-[#0B0F17] border-[#1F2937] text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {PLATFORM_META[p].labelFa}
                  </button>
                );
              })}
            </div>

            {accounts.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-[#94A3B8] cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWatchlistContext}
                  onChange={(e) => setUseWatchlistContext(e.target.checked)}
                  className="rounded border-[#334155] bg-[#0B0F17] text-[#3B82F6]"
                />
                <span>اولویت با اکانت‌های واتچ‌لیست ({accounts.length})</span>
              </label>
            )}
          </div>
        </form>

        {/* Direct URL Deconstructor */}
        <form
          onSubmit={handleAnalyzeUrl}
          className="lg:col-span-4 bg-[#111827] border border-[#1F2937] rounded-xl p-5 flex flex-col justify-between space-y-3"
        >
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[#CBD5E1] flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#60A5FA]" />
              تحلیل و کالبدشکافی مستقیم لینک
            </span>
            <p className="text-[11px] text-[#64748B]">
              لینک ویدیوی یوتیوب، ریلز، تیک‌تاک، پست لینکدین یا توییت را وارد کنید.
            </p>
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              dir="ltr"
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={analyzingUrl}
            className="w-full py-2 px-4 text-xs font-medium bg-[#161F30] hover:bg-[#1F2937] disabled:opacity-60 text-white border border-[#2D3A4F] rounded-lg transition-colors cursor-pointer"
          >
            {analyzingUrl ? 'در حال بررسی لینک...' : 'تحلیل لینک و افزودن به Outlierها'}
          </button>
        </form>
      </div>

      {huntError && (
        <div className="p-4 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl leading-relaxed">
          {huntError}
        </div>
      )}

      {huntNotice && !huntError && (
        <div className="flex items-start gap-2.5 p-4 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl leading-relaxed">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p>{huntNotice}</p>
        </div>
      )}

      {/* Freshly Hunted Preview Tray */}
      {huntedResults.length > 0 && (
        <div className="bg-[#111827] border border-[#3B82F6]/40 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#1F2937] bg-[#3B82F6]/5">
            <div>
              <h2 className="text-sm font-semibold text-white">
                نتایج شکار Outlier ({huntedResults.length} مورد واقعی)
              </h2>
              <p className="text-[11px] text-[#94A3B8]">
                {huntMeta ? (
                  <>
                    موتور تحلیل:{' '}
                    <span className="font-mono text-[#CBD5E1]" dir="ltr">
                      {huntMeta.engine}
                    </span>
                    {huntMeta.cached ? ' · بازیابی‌شده از کش ۲۴ ساعته' : ' · استخراج زنده'}
                  </>
                ) : (
                  'موارد دلخواه را در دیتابیس ابری برند ذخیره کنید تا همیشه برای تحلیل و تولید محتوا در دسترس باشند.'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {huntMeta?.cached && (
                <button
                  type="button"
                  onClick={() => void runHunt(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#60A5FA] hover:text-white bg-[#0B0F17] border border-[#1F2937] rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3 h-3" />
                  جستجوی زنده مجدد
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveAllDiscovered}
                className="px-3.5 py-1.5 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                ذخیره همه در کتابخانه Outlier
              </button>
              <button
                type="button"
                onClick={() => setHuntedResults([])}
                className="p-1.5 text-[#94A3B8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#1F2937]">
            {huntedResults.map((item, idx) => {
              const saved =
                savedTitles.has(item.title) || outliers.some((o) => o.title === item.title);
              return (
                <div
                  key={`${item.title}-${idx}`}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.015]"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono tabular-nums font-semibold text-[#10B981]">
                        {item.outlierMultiplier.toFixed(1)}x
                      </span>
                      <span className="text-[#475569]">·</span>
                      <span className="font-semibold text-white">{item.title}</span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">
                      {item.accountName} · {PLATFORM_META[item.platform]?.labelFa || item.platform} ·{' '}
                      {item.format} · بازدید {formatCompactNumber(item.views)} (میانگین{' '}
                      {formatCompactNumber(item.baselineViews)})
                    </p>
                    <p className="text-xs text-[#CBD5E1] leading-relaxed">{item.hookPattern}</p>
                  </div>
                  <button
                    type="button"
                    disabled={saved}
                    onClick={() => handleSaveDiscovered(item)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
                      saved
                        ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/25 cursor-default'
                        : 'bg-[#161F30] hover:bg-[#3B82F6] text-white border border-[#2D3A4F] cursor-pointer'
                    }`}
                  >
                    {saved ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        ذخیره شد
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        ذخیره Outlier
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {huntSources.length > 0 && (
            <div className="px-5 py-3 border-t border-[#1F2937] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#64748B]">
              <span>منابع وب:</span>
              {huntSources.slice(0, 6).map((s, i) => (
                <a
                  key={`${s.uri}-${i}`}
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#60A5FA] hover:text-white truncate max-w-[200px]"
                >
                  {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scatter Distribution Chart (When Outliers Exist) */}
      {scatterData.length >= 2 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">نقشه پراکندگی Outlierها (بازدید در برابر ضریب جهش)</h2>
              <p className="text-[11px] text-[#94A3B8]">
                نقاط سبز نشان‌دهنده ویدیوها و پست‌های جهش‌یافته بالای ۳ برابر میانگین کانال هستند
              </p>
            </div>
          </div>
          <div className="h-52 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                <XAxis
                  type="number"
                  dataKey="viewsK"
                  name="Views"
                  unit="K"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: '#1F2937' }}
                />
                <YAxis
                  type="number"
                  dataKey="multiplier"
                  name="Outlier"
                  unit="x"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                />
                <ZAxis type="number" dataKey="engagement" range={[55, 220]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: '#334155' }}
                  contentStyle={{
                    backgroundColor: '#0B0F17',
                    border: '1px solid #1F2937',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#F1F5F9',
                  }}
                  formatter={(val: unknown, name: unknown) => {
                    if (name === 'Views') return [`${val}K`, 'بازدید'];
                    if (name === 'Outlier') return [`${val}x`, 'ضریب Outlier'];
                    return [String(val), String(name)];
                  }}
                />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, idx) => (
                    <Cell
                      key={`pt-${idx}`}
                      fill={entry.multiplier >= 3 ? '#10B981' : '#3B82F6'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Saved Outliers Filter & Table */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlatformFilter('all')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                platformFilter === 'all' ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              همه ({outliers.length})
            </button>
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatformFilter(p)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  platformFilter === p ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {PLATFORM_META[p].labelFa}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={minMultiplier}
              onChange={(e) => setMinMultiplier(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-[#1F2937] rounded-lg text-[#CBD5E1] outline-none"
            >
              <option value={0}>همه ضریب‌ها</option>
              <option value={2}>ضریب بالای 2x</option>
              <option value={3}>ضریب بالای 3x</option>
              <option value={5}>ضریب بالای 5x</option>
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#64748B] absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو در عنوان یا هوک..."
                className="pr-8 pl-3 py-1.5 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none w-48"
              />
            </div>
          </div>
        </div>

        {filteredOutliers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] text-[#64748B]">
                  <th className="py-3 px-5 font-medium">عنوان / هوک و کانال</th>
                  <th className="py-3 px-4 font-medium">پلتفرم و فرمت</th>
                  <th className="py-3 px-4 font-medium">بازدید / میانگین</th>
                  <th className="py-3 px-4 font-medium">ضریب Outlier</th>
                  <th className="py-3 px-4 font-medium">تعامل</th>
                  <th className="py-3 px-5 font-medium text-left">اکشن‌ها</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937] text-xs">
                {filteredOutliers.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedOutlier(item)}
                    className="hover:bg-white/[0.025] transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-5 max-w-md">
                      <p className="font-medium text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
                        {item.accountName} · {item.publishedLabel}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className="font-medium"
                        style={{ color: PLATFORM_META[item.platform].color }}
                      >
                        {PLATFORM_META[item.platform].labelFa}
                      </span>
                      <span className="text-[#475569] mx-1.5">·</span>
                      <span className="text-[#94A3B8]">{item.format}</span>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      <span className="text-white">{formatCompactNumber(item.views)}</span>
                      <span className="text-[#64748B]">
                        {' '}
                        / {formatCompactNumber(item.baselineViews)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      <span
                        className={
                          item.outlierMultiplier >= 3
                            ? 'text-[#10B981] font-semibold'
                            : item.outlierMultiplier >= 2
                              ? 'text-[#60A5FA] font-semibold'
                              : 'text-[#CBD5E1]'
                        }
                      >
                        {item.outlierMultiplier.toFixed(1)}x
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-[#94A3B8] whitespace-nowrap">
                      {item.engagementRate > 0 ? `${item.engagementRate.toFixed(1)}%` : '—'}
                    </td>
                    <td
                      className="py-3.5 px-5 text-left whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedOutlier(item)}
                          className="text-xs text-[#CBD5E1] hover:text-white cursor-pointer"
                        >
                          کالبدشکافی
                        </button>
                        <button
                          type="button"
                          onClick={() => onGenerateFromOutlier(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#60A5FA] hover:text-white cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3" />
                          بازآفرینی
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedOutlier?.id === item.id) setSelectedOutlier(null);
                            void onDeleteOutlier(item.id);
                          }}
                          className="p-1 text-[#64748B] hover:text-red-400 cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <Flame className="w-8 h-8 text-[#475569] mx-auto" />
            <p className="text-sm font-medium text-white">هنوز ویدیو یا پست Outlier ذخیره نشده است</p>
            <p className="text-xs text-[#94A3B8] max-w-md mx-auto">
              دکمه «شکار Outlier» را در بالا بزنید، لینک یک محتوای موفق را وارد کنید، یا فایل CSV آمار کانال رقیب را
              ایمپورت کنید تا ضریب Outlier محاسبه شود.
            </p>
          </div>
        )}
      </div>

      {/* Deconstruction Slide-Over Drawer */}
      {selectedOutlier && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end"
          onClick={() => setSelectedOutlier(null)}
        >
          <div
            className="w-full max-w-xl bg-[#111827] border-r border-[#1F2937] h-full overflow-y-auto p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#1F2937]">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                  <span style={{ color: PLATFORM_META[selectedOutlier.platform].color }}>
                    {PLATFORM_META[selectedOutlier.platform].labelFa}
                  </span>
                  <span>·</span>
                  <span>{selectedOutlier.accountName}</span>
                  <span>·</span>
                  <span>{selectedOutlier.format}</span>
                </div>
                <h2 className="text-base font-bold text-white leading-snug">{selectedOutlier.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOutlier(null)}
                className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Key Metrics Strip */}
            <div className="grid grid-cols-3 gap-4 py-3 border-b border-[#1F2937]">
              <div>
                <p className="text-[11px] text-[#64748B]">ضریب Outlier</p>
                <p className="font-mono tabular-nums text-xl font-bold text-[#10B981] mt-0.5">
                  {selectedOutlier.outlierMultiplier.toFixed(1)}x
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#64748B]">بازدید / میانگین پایه</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-white mt-1.5">
                  {formatCompactNumber(selectedOutlier.views)}{' '}
                  <span className="text-[#64748B] font-normal">
                    / {formatCompactNumber(selectedOutlier.baselineViews)}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#64748B]">نرخ تعامل</p>
                <p className="font-mono tabular-nums text-sm font-semibold text-white mt-1.5">
                  {selectedOutlier.engagementRate > 0
                    ? `${selectedOutlier.engagementRate.toFixed(2)}%`
                    : '—'}
                </p>
              </div>
            </div>

            {/* Deconstruction Body */}
            {selectedOutlier.hookPattern || selectedOutlier.whyItWorked ? (
              <div className="space-y-5 text-xs">
                <div className="space-y-1.5">
                  <h3 className="font-semibold text-[#60A5FA]">الگوی هوک و قلاب ۳ ثانیه اول</h3>
                  <p className="text-[#CBD5E1] leading-relaxed">{selectedOutlier.hookPattern}</p>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-[#1F2937]">
                  <h3 className="font-semibold text-[#10B981]">چرا فراتر از میانگین کانال دیده شد؟</h3>
                  <p className="text-[#CBD5E1] leading-relaxed">{selectedOutlier.whyItWorked}</p>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-[#1F2937]">
                  <h3 className="font-semibold text-white">ساختار روایی و حفظ مخاطب</h3>
                  <p className="text-[#CBD5E1] leading-relaxed">{selectedOutlier.structureBreakdown}</p>
                </div>

                <div className="space-y-1.5 pt-3 border-t border-[#1F2937]">
                  <h3 className="font-semibold text-[#F59E0B]">
                    پیشنهاد بومی‌سازی برای برند «{brand.name}»
                  </h3>
                  <p className="text-[#CBD5E1] leading-relaxed">{selectedOutlier.brandAdaptationIdea}</p>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center space-y-3 border border-dashed border-[#1F2937] rounded-xl p-6">
                <p className="text-xs text-[#94A3B8]">
                  این آیتم به‌صورت دستی یا CSV ثبت شده و هنوز کالبدشکافی هوش مصنوعی روی آن اجرا نشده است.
                </p>
                <button
                  type="button"
                  disabled={deconstructingId === selectedOutlier.id}
                  onClick={() => handleDeconstructExisting(selectedOutlier)}
                  className="px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg cursor-pointer"
                >
                  {deconstructingId === selectedOutlier.id
                    ? 'در حال کالبدشکافی عمیق...'
                    : 'اجرای کالبدشکافی عمیق با هوش مصنوعی'}
                </button>
              </div>
            )}

            <div className="pt-4 border-t border-[#1F2937] flex flex-wrap items-center justify-between gap-3">
              {selectedOutlier.url ? (
                <a
                  href={selectedOutlier.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-white"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  مشاهده محتوای اصلی
                </a>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {(selectedOutlier.hookPattern || selectedOutlier.whyItWorked) && (
                  <button
                    type="button"
                    disabled={deconstructingId === selectedOutlier.id}
                    onClick={() => handleDeconstructExisting(selectedOutlier)}
                    className="px-3.5 py-2 text-xs font-medium text-[#CBD5E1] hover:text-white bg-[#0B0F17] border border-[#1F2937] rounded-lg cursor-pointer"
                  >
                    {deconstructingId === selectedOutlier.id ? 'در حال بازتحلیل...' : 'بازتحلیل'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedOutlier;
                    setSelectedOutlier(null);
                    onGenerateFromOutlier(target);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  بازآفرینی برای برند من در استودیو
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Entry & CSV Bulk Outlier Importer Modal */}
      {showImportModal && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937]">
              <h2 className="text-sm font-bold text-white">ورود آمار دقیق و محاسبه خودکار Outlier</h2>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-[#1F2937] rounded-lg">
                <button
                  type="button"
                  onClick={() => setImportTab('single')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    importTab === 'single' ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8]'
                  }`}
                >
                  ثبت تکی ویدیو / پست
                </button>
                <button
                  type="button"
                  onClick={() => setImportTab('csv')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    importTab === 'csv' ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8]'
                  }`}
                >
                  ایمپورت دسته‌ای CSV (محاسبه خودکار میانه کانال)
                </button>
              </div>
            </div>

            {importTab === 'single' ? (
              <form onSubmit={handleSingleImport} className="p-6 space-y-4">
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">عنوان یا هوک محتوا *</span>
                  <input
                    required
                    value={sTitle}
                    onChange={(e) => setSTitle(e.target.value)}
                    placeholder="مثلاً: چطور در ۳۰ روز فروش SaaS را ۳ برابر کردیم"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none focus:border-[#3B82F6]"
                  />
                </label>

                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">نام کانال *</span>
                    <input
                      required
                      value={sAccount}
                      onChange={(e) => setSAccount(e.target.value)}
                      placeholder="نام پیج"
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">پلتفرم</span>
                    <select
                      value={sPlatform}
                      onChange={(e) => {
                        const p = e.target.value as Platform;
                        setSPlatform(p);
                        setSFormat(PLATFORM_META[p].formats[0]);
                      }}
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    >
                      {ALL_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_META[p].labelFa}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">فرمت</span>
                    <select
                      value={sFormat}
                      onChange={(e) => setSFormat(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    >
                      {PLATFORM_META[sPlatform].formats.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">بازدید پست</span>
                    <input
                      type="number"
                      min={1}
                      value={sViews}
                      onChange={(e) => setSViews(e.target.value)}
                      dir="ltr"
                      className="w-full px-3 py-2 text-sm font-mono bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">میانگین کانال</span>
                    <input
                      type="number"
                      min={1}
                      value={sBaseline}
                      onChange={(e) => setSBaseline(e.target.value)}
                      dir="ltr"
                      className="w-full px-3 py-2 text-sm font-mono bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">لایک</span>
                    <input
                      type="number"
                      min={0}
                      value={sLikes}
                      onChange={(e) => setSLikes(e.target.value)}
                      dir="ltr"
                      className="w-full px-3 py-2 text-sm font-mono bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">کامنت</span>
                    <input
                      type="number"
                      min={0}
                      value={sComments}
                      onChange={(e) => setSComments(e.target.value)}
                      dir="ltr"
                      className="w-full px-3 py-2 text-sm font-mono bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                </div>

                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">لینک محتوا (اختیاری)</span>
                  <input
                    type="url"
                    value={sUrl}
                    onChange={(e) => setSUrl(e.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                  />
                </label>

                <div className="flex items-center justify-between pt-3 border-t border-[#1F2937]">
                  <span className="text-xs text-[#94A3B8] font-mono tabular-nums">
                    ضریب محاسبه‌شده:{' '}
                    <strong className="text-[#10B981]">
                      {((Number(sViews) || 0) / Math.max(1, Number(sBaseline) || 1)).toFixed(1)}x
                    </strong>
                  </span>
                  <button
                    type="submit"
                    disabled={importing}
                    className="px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer"
                  >
                    {importing ? 'در حال ثبت...' : 'ذخیره در لیست Outlierها'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCsvImport} className="p-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">نام کانال / پیج منبع *</span>
                    <input
                      required
                      value={csvAccount}
                      onChange={(e) => setCsvAccount(e.target.value)}
                      placeholder="مثلاً: TechReview"
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-xs text-[#CBD5E1]">پلتفرم</span>
                    <select
                      value={csvPlatform}
                      onChange={(e) => setCsvPlatform(e.target.value as Platform)}
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none"
                    >
                      {ALL_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_META[p].labelFa}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">
                    آمار پست‌های اخیر کانال را پیست کنید (هر سطر: عنوان، بازدید، لایک، کامنت)
                  </span>
                  <textarea
                    required
                    rows={6}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={`اشتباهات طراحی لندینگ پیج, 145000, 6200, 310\nمقایسه ابزارهای هوش مصنوعی, 32000, 1100, 45\nچطور از صفر شروع کردم, 29000, 950, 38\nراز رشد ارگانیک اینستاگرام, 240000, 14000, 820`}
                    className="w-full p-3 text-xs font-mono bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
                  />
                  <p className="text-[11px] text-[#64748B]">
                    سیستم به‌طور خودکار میانه بازدید (Median) کانال را محاسبه و ویدیوهای بالای 1.5x را به عنوان
                    Outlier استخراج و ذخیره می‌کند.
                  </p>
                </label>

                <div className="flex justify-end pt-2 border-t border-[#1F2937]">
                  <button
                    type="submit"
                    disabled={importing}
                    className="px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer"
                  >
                    {importing ? 'در حال محاسبه و ذخیره...' : 'استخراج و ذخیره Outlierها'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
