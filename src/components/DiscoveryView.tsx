import React, { useState } from 'react';
import { AlertCircle, Check, Compass, ExternalLink, Plus, RefreshCw, Search } from 'lucide-react';
import { auth } from '../firebase';
import { buildAICacheKey, getAICacheEntry, setAICacheEntry } from '../services/firestoreService';
import {
  ACCOUNT_SIZE_TIERS,
  formatCompactNumber,
  PLATFORM_META,
  type AccountSizeTier,
  type Brand,
  type DiscoveredAccount,
  type GroundingSource,
  type Platform,
  type WatchlistAccount,
} from '../types';

interface DiscoveryViewProps {
  brand: Brand;
  existingAccounts: WatchlistAccount[];
  onAddToWatchlist: (account: DiscoveredAccount) => Promise<void>;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];
const TIER_KEYS: AccountSizeTier[] = ['established', 'micro', 'mid', 'macro', 'mega', 'all', 'custom'];

export function DiscoveryView({
  brand,
  existingAccounts,
  onAddToWatchlist,
}: DiscoveryViewProps) {
  const [niche, setNiche] = useState(brand.niche);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(
    brand.platforms?.length ? brand.platforms : ALL_PLATFORMS
  );
  const [regionLanguage, setRegionLanguage] = useState('ترکیبی از پیج‌های برتر فارسی و بین‌المللی');
  const [accountTier, setAccountTier] = useState<AccountSizeTier>('established');
  const [customMinFollowers, setCustomMinFollowers] = useState('20000');
  const [customMaxFollowers, setCustomMaxFollowers] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<{ engine: string; cached: boolean } | null>(null);
  const [results, setResults] = useState<DiscoveredAccount[]>([]);
  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [addingHandle, setAddingHandle] = useState<string | null>(null);
  const [addedHandles, setAddedHandles] = useState<Set<string>>(new Set());

  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]
    );
  };

  const isAlreadyInWatchlist = (acc: DiscoveredAccount) => {
    const key = `${acc.platform}:${acc.handle.toLowerCase()}`;
    if (addedHandles.has(key)) return true;
    return existingAccounts.some(
      (e) =>
        e.platform === acc.platform &&
        (e.handle.toLowerCase() === acc.handle.toLowerCase() ||
          e.name.toLowerCase() === acc.name.toLowerCase())
    );
  };

  const runDiscover = async (forceRefresh = false) => {
    if (!niche.trim()) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    const accountRange =
      accountTier === 'custom'
        ? {
            tier: 'custom' as const,
            minFollowers: Number(customMinFollowers) > 0 ? Number(customMinFollowers) : 0,
            maxFollowers: Number(customMaxFollowers) > 0 ? Number(customMaxFollowers) : undefined,
          }
        : {
            tier: accountTier,
            minFollowers: ACCOUNT_SIZE_TIERS[accountTier].minFollowers,
            maxFollowers: ACCOUNT_SIZE_TIERS[accountTier].maxFollowers,
          };

    const payload = {
      niche: niche.trim(),
      platforms: selectedPlatforms,
      regionLanguage,
      accountRange,
      brandContext: {
        name: brand.name,
        audience: brand.audience,
        tone: brand.tone,
      },
    };

    try {
      const uid = auth.currentUser?.uid || '';
      const { cacheKey, payloadHash } = await buildAICacheKey('discover', payload);

      if (!forceRefresh && uid) {
        const cached = await getAICacheEntry<{
          accounts: DiscoveredAccount[];
          sources: GroundingSource[];
          engine?: string;
        }>(uid, cacheKey);
        if (cached && Array.isArray(cached.accounts) && cached.accounts.length > 0) {
          setResults(cached.accounts);
          setSources(cached.sources || []);
          setSearchMeta({ engine: cached.engine || 'Firestore Cache', cached: true });
          return;
        }
      }

      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, forceRefresh }),
      });
      const data = (await res.json()) as {
        accounts?: DiscoveredAccount[];
        sources?: GroundingSource[];
        engine?: string;
        mode?: string;
        cached?: boolean;
        notice?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'خطا در کشف کانال‌ها');
      }

      const accountsList = data.accounts || [];
      const sourcesList = data.sources || [];
      setResults(accountsList);
      setSources(sourcesList);
      setSearchMeta({ engine: data.engine || 'Live Search', cached: Boolean(data.cached) });
      if (data.notice) setNotice(data.notice);

      // Only save complete verified searches (without missing-key/partial notices) to 24h cloud cache
      if (uid && accountsList.length > 0 && data.mode !== 'youtube_direct' && !data.notice) {
        void setAICacheEntry(uid, cacheKey, 'discover', payloadHash, {
          accounts: accountsList,
          sources: sourcesList,
          engine: data.engine || 'gemini',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    await runDiscover(false);
  };

  const handleAdd = async (acc: DiscoveredAccount) => {
    const key = `${acc.platform}:${acc.handle.toLowerCase()}`;
    setAddingHandle(key);
    try {
      await onAddToWatchlist(acc);
      setAddedHandles((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در افزودن به واتچ‌لیست');
    } finally {
      setAddingHandle(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-white">کشف کانال‌ها و اکانت‌های مرتبط هر فیلد</h1>
        <p className="text-xs text-[#94A3B8]">
          فیلد تخصصی و پلتفرم‌ها را مشخص کنید تا موتور جستجوی زنده، پیج‌ها و کانال‌های اثرگذار واقعی را شناسایی و
          تحلیل کند.
        </p>
      </div>

      {/* Discovery Query Panel */}
      <form
        onSubmit={handleDiscover}
        className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4"
      >
        <div className="grid md:grid-cols-12 gap-4">
          <label className="md:col-span-5 space-y-1.5">
            <span className="text-xs font-medium text-[#CBD5E1] block">حوزه تخصصی، موضوع یا کلیدواژه</span>
            <div className="relative">
              <Search className="w-4 h-4 text-[#64748B] absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="مثلاً: طراحی محصول و UX، هوش مصنوعی کاربردی، استارتاپ"
                className="w-full pr-10 pl-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </div>
          </label>

          <label className="md:col-span-3 space-y-1.5">
            <span className="text-xs font-medium text-[#CBD5E1] block">بازه اندازه اکانت (فالوئر)</span>
            <select
              value={accountTier}
              onChange={(e) => setAccountTier(e.target.value as AccountSizeTier)}
              className="w-full px-3 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
            >
              {TIER_KEYS.map((tier) => (
                <option key={tier} value={tier}>
                  {ACCOUNT_SIZE_TIERS[tier].labelFa}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-2 space-y-1.5">
            <span className="text-xs font-medium text-[#CBD5E1] block">دامنه زبانی</span>
            <select
              value={regionLanguage}
              onChange={(e) => setRegionLanguage(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
            >
              <option value="ترکیبی از پیج‌های برتر فارسی و بین‌المللی">ترکیبی (فارسی + جهانی)</option>
              <option value="پیج‌ها و کانال‌های برتر فارسی‌زبان">فقط فارسی‌زبان</option>
              <option value="Top Global English-speaking creators and brands">فقط بین‌المللی (EN)</option>
            </select>
          </label>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {loading ? 'در حال جستجو...' : 'کشف اکانت‌ها'}
            </button>
          </div>
        </div>

        {accountTier === 'custom' && (
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-[#1F2937]">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-[#94A3B8] block">حداقل فالوئر / سابسکرایبر</span>
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
              <span className="text-[11px] font-medium text-[#94A3B8] block">
                حداکثر فالوئر / سابسکرایبر (اختیاری)
              </span>
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

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1F2937]">
          <span className="text-xs text-[#94A3B8] ml-2">پلتفرم‌های هدف:</span>
          {ALL_PLATFORMS.map((p) => {
            const active = selectedPlatforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
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
      </form>

      {error && (
        <div className="p-4 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl leading-relaxed">
          {error}
        </div>
      )}

      {notice && !error && (
        <div className="flex items-start gap-2.5 p-4 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl leading-relaxed">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p>{notice}</p>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl divide-y divide-[#1F2937]">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="p-5 flex items-center justify-between gap-4 animate-pulse">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-48 bg-[#1F2937] rounded" />
                <div className="h-3 w-96 max-w-full bg-[#1F2937]/70 rounded" />
              </div>
              <div className="h-8 w-28 bg-[#1F2937] rounded-lg shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Results List */}
      {!loading && results.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-[#1F2937]">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-white">
                اکانت‌های کشف‌شده ({results.length} مورد واقعی)
              </h2>
              {searchMeta && (
                <p className="text-[11px] text-[#94A3B8]">
                  منبع تحلیل:{' '}
                  <span className="font-mono text-[#CBD5E1]" dir="ltr">
                    {searchMeta.engine}
                  </span>
                  {searchMeta.cached ? ' · بازیابی‌شده از کش ۲۴ ساعته' : ' · جستجوی زنده همین لحظه'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {searchMeta?.cached && (
                <button
                  type="button"
                  onClick={() => void runDiscover(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#60A5FA] hover:text-white bg-[#0B0F17] border border-[#1F2937] rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  جستجوی زنده مجدد
                </button>
              )}
              <span className="text-xs text-[#94A3B8]">
                واتچ‌لیست برند «{brand.name}»
              </span>
            </div>
          </div>

          <div className="divide-y divide-[#1F2937]">
            {results.map((acc, idx) => {
              const key = `${acc.platform}:${acc.handle.toLowerCase()}`;
              const exists = isAlreadyInWatchlist(acc);
              const isAdding = addingHandle === key;
              return (
                <div
                  key={`${key}-${idx}`}
                  className="p-5 hover:bg-white/[0.015] transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-sm font-semibold text-white">{acc.name}</span>
                      <span className="font-mono text-[#94A3B8]" dir="ltr">
                        {acc.handle}
                      </span>
                      <span className="text-[#475569]">·</span>
                      <span
                        className="font-medium"
                        style={{ color: PLATFORM_META[acc.platform]?.color || '#94A3B8' }}
                      >
                        {PLATFORM_META[acc.platform]?.labelFa || acc.platform}
                      </span>
                      <span className="text-[#475569]">·</span>
                      <span className="text-[#94A3B8]">{acc.category}</span>
                    </div>

                    <p className="text-xs text-[#CBD5E1] leading-relaxed">{acc.contentStyle}</p>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">
                      چرا ارزشمند است: {acc.whyRelevant}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-[#64748B] font-mono tabular-nums">
                      <span>تخمین فالوور: {formatCompactNumber(acc.estimatedFollowers)}</span>
                      <span>میانگین بازدید پایه: {formatCompactNumber(acc.estimatedBaselineViews)}</span>
                      {acc.url && (
                        <a
                          href={acc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#60A5FA] hover:text-white font-sans"
                        >
                          مشاهده پروفایل
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      disabled={exists || isAdding}
                      onClick={() => handleAdd(acc)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        exists
                          ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/25 cursor-default'
                          : 'bg-[#161F30] hover:bg-[#3B82F6] text-white border border-[#2D3A4F] hover:border-[#3B82F6] cursor-pointer'
                      }`}
                    >
                      {exists ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          در واتچ‌لیست است
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          {isAdding ? 'در حال افزودن...' : 'افزودن به واتچ‌لیست'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grounding Sources */}
      {!loading && sources.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold text-[#94A3B8]">منابع جستجوی زنده وب</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {sources.map((src, i) => (
              <a
                key={`${src.uri}-${i}`}
                href={src.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#60A5FA] hover:text-white truncate max-w-xs"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{src.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && !error && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-12 text-center space-y-3">
          <Compass className="w-8 h-8 text-[#475569] mx-auto" />
          <p className="text-sm font-medium text-white">آماده کشف کانال‌ها و رقبای کلیدی</p>
          <p className="text-xs text-[#94A3B8] max-w-md mx-auto leading-relaxed">
            موضوع یا فیلد مورد نظر خود را وارد کنید (مثلاً «{brand.niche}») و روی «کشف اکانت‌ها» بزنید تا بهترین
            پیج‌های فعال در یوتیوب، اینستاگرام، تیک‌تاک، لینکدین و ایکس را پیدا و به واتچ‌لیست اضافه کنید.
          </p>
        </div>
      )}
    </div>
  );
}
