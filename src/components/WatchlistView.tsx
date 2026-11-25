import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  ExternalLink,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { buildAICacheKey, getAICacheEntry, setAICacheEntry } from '../services/firestoreService';
import {
  formatCompactNumber,
  LIMITS,
  PERIOD_LABELS,
  PLATFORM_META,
  type AuditReport,
  type Brand,
  type GroundingSource,
  type PeriodWindow,
  type Platform,
  type WatchlistAccount,
} from '../types';

interface WatchlistViewProps {
  brand: Brand;
  accounts: WatchlistAccount[];
  reports: AuditReport[];
  onAddManualAccount: (
    account: Omit<WatchlistAccount, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateAccountCadence: (accountId: string, cadence: PeriodWindow, lastAuditedAt: string) => Promise<void>;
  onDeleteAccount: (accountId: string) => Promise<void>;
  onSaveAuditReport: (
    report: Omit<AuditReport, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onDeleteAuditReport: (reportId: string) => Promise<void>;
  onSendTopicToStudio: (topic: string) => void;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];
const PERIODS: PeriodWindow[] = ['7d', '14d', '30d', '90d'];

export function WatchlistView({
  brand,
  accounts,
  reports,
  onAddManualAccount,
  onUpdateAccountCadence,
  onDeleteAccount,
  onSaveAuditReport,
  onDeleteAuditReport,
  onSendTopicToStudio,
}: WatchlistViewProps) {
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [auditPeriod, setAuditPeriod] = useState<PeriodWindow>('30d');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Manual Account Form State
  const [mName, setMName] = useState('');
  const [mHandle, setMHandle] = useState('');
  const [mPlatform, setMPlatform] = useState<Platform>('youtube');
  const [mUrl, setMUrl] = useState('');
  const [mCategory, setMCategory] = useState(brand.niche);
  const [mBaseline, setMBaseline] = useState('25000');
  const [mFollowers, setMFollowers] = useState('80000');
  const [mCadence, setMCadence] = useState<PeriodWindow>('30d');
  const [mStyle, setMStyle] = useState('');
  const [mSaving, setMSaving] = useState(false);

  const filteredAccounts = useMemo(() => {
    if (platformFilter === 'all') return accounts;
    return accounts.filter((a) => a.platform === platformFilter);
  }, [accounts, platformFilter]);

  const activeReport = useMemo(() => {
    if (reports.length === 0) return null;
    if (selectedReportId) {
      return reports.find((r) => r.id === selectedReportId) || reports[0];
    }
    return reports[0];
  }, [reports, selectedReportId]);

  const handleRunAudit = async () => {
    const targetAccounts = filteredAccounts.length > 0 ? filteredAccounts : accounts;
    if (targetAccounts.length === 0) {
      setAuditError('ابتدا حداقل یک اکانت به واتچ‌لیست اضافه کنید.');
      return;
    }
    setAuditing(true);
    setAuditError(null);

    const payload = {
      brand: {
        name: brand.name,
        niche: brand.niche,
        audience: brand.audience,
        tone: brand.tone,
        pillars: brand.pillars,
      },
      accounts: targetAccounts.map((a) => ({
        name: a.name,
        handle: a.handle,
        platform: a.platform,
        category: a.category,
        baselineViews: a.baselineViews,
      })),
      period: auditPeriod,
    };

    try {
      const uid = auth.currentUser?.uid || '';
      const { cacheKey, payloadHash } = await buildAICacheKey('audit', {
        brandName: brand.name,
        period: auditPeriod,
        handles: targetAccounts.map((a) => `${a.platform}:${a.handle}`).sort(),
      });

      type AuditResponse = {
        report?: {
          title?: string;
          executiveSummary?: string;
          risingTopics?: string[];
          winningFormats?: string[];
          contentGaps?: string[];
          actionPlan?: string[];
        };
        sources?: GroundingSource[];
        error?: string;
      };

      let data: AuditResponse | null = null;

      if (uid) {
        const cached = await getAICacheEntry<AuditResponse>(uid, cacheKey);
        if (cached?.report) {
          data = cached;
        }
      }

      if (!data) {
        const res = await fetch('/api/watchlist/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        data = (await res.json()) as AuditResponse;
        if (!res.ok || !data.report) {
          throw new Error(data.error || 'خطا در اجرای پایش دوره‌ای');
        }
        if (uid) {
          void setAICacheEntry(uid, cacheKey, 'audit', payloadHash, {
            report: data.report,
            sources: data.sources || [],
          });
        }
      }

      if (!data.report) {
        throw new Error('خطا در دریافت گزارش پایش');
      }

      const newReportId = await onSaveAuditReport({
        period: auditPeriod,
        title: data.report.title || `گزارش پایش ${PERIOD_LABELS[auditPeriod]}`,
        executiveSummary: data.report.executiveSummary || '',
        accountsReviewed: targetAccounts.map((a) => `${a.name} (${PLATFORM_META[a.platform].labelFa})`),
        risingTopics: data.report.risingTopics || [],
        winningFormats: data.report.winningFormats || [],
        contentGaps: data.report.contentGaps || [],
        actionPlan: data.report.actionPlan || [],
        sources: data.sources || [],
      });
      setSelectedReportId(newReportId);

      // Stamp lastAuditedAt on reviewed accounts
      const todayLabel = new Intl.DateTimeFormat('fa-IR', {
        month: 'short',
        day: 'numeric',
      }).format(new Date());
      await Promise.all(
        targetAccounts.slice(0, 15).map((acc) =>
          onUpdateAccountCadence(acc.id, acc.cadence, todayLabel)
        )
      );
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'خطا در پایش واتچ‌لیست');
    } finally {
      setAuditing(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mName.trim() || !mHandle.trim()) return;
    setMSaving(true);
    try {
      await onAddManualAccount({
        name: mName.trim(),
        handle: mHandle.trim().startsWith('@') ? mHandle.trim() : `@${mHandle.trim()}`,
        platform: mPlatform,
        url: mUrl.trim(),
        category: mCategory.trim() || brand.niche,
        baselineViews: Number(mBaseline) || 0,
        followersCount: Number(mFollowers) || 0,
        cadence: mCadence,
        contentStyle: mStyle.trim(),
        notes: '',
        lastAuditedAt: 'پایش‌نشده',
      });
      setMName('');
      setMHandle('');
      setMUrl('');
      setMStyle('');
      setShowAddModal(false);
    } finally {
      setMSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Periodic Audit Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">واتچ‌لیست و پایش بازه زمانی رقبا</h1>
          <p className="text-xs text-[#94A3B8]">
            اکانت‌های کلیدی برند «{brand.name}» را مدیریت کنید و در بازه‌های ۷ تا ۹۰ روزه گزارش تحلیلی روندها و
            شکاف‌های محتوایی بگیرید.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAuditPeriod(p)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  auditPeriod === p ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#111827] hover:bg-[#161F30] text-white border border-[#1F2937] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            افزودن اکانت دستی
          </button>

          <button
            type="button"
            onClick={handleRunAudit}
            disabled={auditing || accounts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${auditing ? 'animate-spin' : ''}`} />
            {auditing ? 'در حال پایش بازه زمانی...' : `اجرای پایش ${PERIOD_LABELS[auditPeriod]}`}
          </button>
        </div>
      </div>

      {auditError && (
        <div className="p-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl">
          {auditError}
        </div>
      )}

      {/* Platform Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPlatformFilter('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
            platformFilter === 'all'
              ? 'bg-[#1F2937] text-white'
              : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
          }`}
        >
          همه پلتفرم‌ها ({accounts.length})
        </button>
        {ALL_PLATFORMS.map((p) => {
          const count = accounts.filter((a) => a.platform === p).length;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPlatformFilter(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                platformFilter === p
                  ? 'bg-[#1F2937] text-white'
                  : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
              }`}
            >
              {PLATFORM_META[p].labelFa} ({count})
            </button>
          );
        })}
      </div>

      {/* Watchlist Accounts Table */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        {filteredAccounts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] text-[#64748B]">
                  <th className="py-3 px-5 font-medium">نام کانال / اکانت</th>
                  <th className="py-3 px-4 font-medium">پلتفرم و دسته</th>
                  <th className="py-3 px-4 font-medium">میانگین بازدید</th>
                  <th className="py-3 px-4 font-medium">فالوور</th>
                  <th className="py-3 px-4 font-medium">دوره بررسی</th>
                  <th className="py-3 px-4 font-medium">آخرین پایش</th>
                  <th className="py-3 px-5 font-medium text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937] text-xs">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-5">
                      <p className="font-medium text-white">{acc.name}</p>
                      <p className="font-mono text-[11px] text-[#64748B]" dir="ltr">
                        {acc.handle}
                      </p>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className="font-medium"
                        style={{ color: PLATFORM_META[acc.platform].color }}
                      >
                        {PLATFORM_META[acc.platform].labelFa}
                      </span>
                      <span className="text-[#475569] mx-1.5">·</span>
                      <span className="text-[#94A3B8]">{acc.category}</span>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#CBD5E1] whitespace-nowrap">
                      {formatCompactNumber(acc.baselineViews)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#94A3B8] whitespace-nowrap">
                      {formatCompactNumber(acc.followersCount)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <select
                        value={acc.cadence}
                        onChange={(e) =>
                          onUpdateAccountCadence(
                            acc.id,
                            e.target.value as PeriodWindow,
                            acc.lastAuditedAt
                          )
                        }
                        className="bg-[#0B0F17] border border-[#1F2937] rounded-md px-2 py-1 text-xs text-[#CBD5E1] outline-none focus:border-[#3B82F6]"
                      >
                        {PERIODS.map((p) => (
                          <option key={p} value={p}>
                            {PERIOD_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-4 text-[#94A3B8] whitespace-nowrap">
                      {acc.lastAuditedAt || 'پایش‌نشده'}
                    </td>
                    <td className="py-3 px-5 text-left whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {acc.url && (
                          <a
                            href={acc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-[#94A3B8] hover:text-white rounded-md hover:bg-white/5"
                            title="باز کردن لینک پروفایل"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteAccount(acc.id)}
                          className="p-1.5 text-[#64748B] hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="حذف از واتچ‌لیست"
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
          <div className="p-10 text-center space-y-3">
            <CalendarClock className="w-7 h-7 text-[#475569] mx-auto" />
            <p className="text-sm font-medium text-white">واتچ‌لیست در این فیلتر خالی است</p>
            <p className="text-xs text-[#94A3B8]">
              از بخش «کشف کانال» اکانت‌های مرتبط را پیدا کنید یا به‌صورت دستی پیج‌های رقیب را اضافه نمایید.
            </p>
          </div>
        )}
      </div>

      {/* Periodic Audit Reports Section */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Saved Reports Archive */}
        <div className="lg:col-span-4 bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937]">
            <h2 className="text-sm font-semibold text-white">آرشیو گزارش‌های پایش ({reports.length})</h2>
          </div>
          {reports.length > 0 ? (
            <div className="divide-y divide-[#1F2937] max-h-[520px] overflow-y-auto">
              {reports.map((rep) => {
                const selected = activeReport?.id === rep.id;
                return (
                  <div
                    key={rep.id}
                    className={`p-4 transition-colors flex items-start justify-between gap-2 ${
                      selected ? 'bg-[#161F30]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedReportId(rep.id)}
                      className="text-right flex-1 min-w-0 cursor-pointer space-y-1"
                    >
                      <p className="text-xs font-semibold text-white truncate">{rep.title}</p>
                      <p className="text-[11px] text-[#94A3B8]">
                        بازه {PERIOD_LABELS[rep.period]} · {rep.accountsReviewed.length} اکانت
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAuditReport(rep.id)}
                      className="p-1 text-[#64748B] hover:text-red-400 rounded cursor-pointer shrink-0"
                      title="حذف گزارش"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-xs text-[#64748B] text-center">
              هنوز گزارشی ثبت نشده است. بازه زمانی را انتخاب کرده و روی «اجرای پایش» کلیک کنید.
            </div>
          )}
        </div>

        {/* Active Report Detailed Readout */}
        <div className="lg:col-span-8 bg-[#111827] border border-[#1F2937] rounded-xl p-6">
          {auditing ? (
            <div className="space-y-4 animate-pulse py-4">
              <div className="h-5 w-64 bg-[#1F2937] rounded" />
              <div className="h-20 w-full bg-[#1F2937]/70 rounded" />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="h-32 bg-[#1F2937]/60 rounded" />
                <div className="h-32 bg-[#1F2937]/60 rounded" />
              </div>
            </div>
          ) : activeReport ? (
            <div className="space-y-6">
              <div className="space-y-2 pb-4 border-b border-[#1F2937]">
                <div className="text-xs text-[#94A3B8] flex flex-wrap items-center gap-2">
                  <span>بازه پایش: {PERIOD_LABELS[activeReport.period]}</span>
                  <span>·</span>
                  <span>اکانت‌ها: {activeReport.accountsReviewed.join('، ')}</span>
                </div>
                <h2 className="text-base font-bold text-white">{activeReport.title}</h2>
                <p className="text-sm text-[#CBD5E1] leading-relaxed">{activeReport.executiveSummary}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-[#60A5FA]">موضوعات داغ و رو‌به‌رشد دوره</h3>
                  <ul className="space-y-2 text-xs text-[#CBD5E1]">
                    {activeReport.risingTopics.map((topic, idx) => (
                      <li
                        key={idx}
                        className="flex items-start justify-between gap-2 pb-2 border-b border-[#1F2937]/70 last:border-0"
                      >
                        <span className="leading-relaxed">{topic}</span>
                        <button
                          type="button"
                          onClick={() => onSendTopicToStudio(topic)}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[#60A5FA] hover:text-white cursor-pointer"
                          title="ساخت محتوا از این موضوع"
                        >
                          <Sparkles className="w-3 h-3" />
                          تولید
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-[#10B981]">فرمت‌های برنده این بازه</h3>
                  <ul className="space-y-2 text-xs text-[#CBD5E1]">
                    {activeReport.winningFormats.map((fmt, idx) => (
                      <li
                        key={idx}
                        className="leading-relaxed pb-2 border-b border-[#1F2937]/70 last:border-0"
                      >
                        {idx + 1}. {fmt}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-6 pt-2 border-t border-[#1F2937]">
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-[#F59E0B]">شکاف‌های محتوایی (فرصت برند شما)</h3>
                  <ul className="space-y-2 text-xs text-[#CBD5E1]">
                    {activeReport.contentGaps.map((gap, idx) => (
                      <li
                        key={idx}
                        className="flex items-start justify-between gap-2 pb-2 border-b border-[#1F2937]/70 last:border-0"
                      >
                        <span className="leading-relaxed">{gap}</span>
                        <button
                          type="button"
                          onClick={() => onSendTopicToStudio(gap)}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[#60A5FA] hover:text-white cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3" />
                          اجرا
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-white">برنامه اقدام پیشنهادی</h3>
                  <ul className="space-y-2 text-xs text-[#CBD5E1]">
                    {activeReport.actionPlan.map((step, idx) => (
                      <li
                        key={idx}
                        className="leading-relaxed pb-2 border-b border-[#1F2937]/70 last:border-0"
                      >
                        {idx + 1}. {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {activeReport.sources.length > 0 && (
                <div className="pt-4 border-t border-[#1F2937] space-y-2">
                  <p className="text-[11px] font-medium text-[#64748B]">منابع وب استنادشده:</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
                    {activeReport.sources.map((s, i) => (
                      <a
                        key={`${s.uri}-${i}`}
                        href={s.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#60A5FA] hover:text-white max-w-xs truncate"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center space-y-2">
              <p className="text-sm font-medium text-white">گزارش پایش بازه زمانی آماده اجراست</p>
              <p className="text-xs text-[#94A3B8] max-w-md">
                پس از اجرای پایش دوره‌ای، تحلیل تغییرات رقبا، فرمت‌های برنده و شکاف‌های محتوایی اینجا ذخیره و نمایش
                داده می‌شود.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Manual Account Modal */}
      {showAddModal && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937]">
              <h2 className="text-sm font-bold text-white">افزودن دستی اکانت به واتچ‌لیست</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3.5">
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">نام کانال یا پیج *</span>
                  <input
                    required
                    maxLength={LIMITS.ACCOUNT_NAME}
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    placeholder="مثلاً: علی ابدال"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">آیدی (Handle) *</span>
                  <input
                    required
                    maxLength={LIMITS.ACCOUNT_HANDLE}
                    value={mHandle}
                    onChange={(e) => setMHandle(e.target.value)}
                    placeholder="@aliabdaal"
                    dir="ltr"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white font-mono outline-none"
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">پلتفرم</span>
                  <select
                    value={mPlatform}
                    onChange={(e) => setMPlatform(e.target.value as Platform)}
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                  >
                    {ALL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_META[p].labelFa}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">دوره پایش</span>
                  <select
                    value={mCadence}
                    onChange={(e) => setMCadence(e.target.value as PeriodWindow)}
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                  >
                    {PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">میانگین بازدید پایه کانال</span>
                  <input
                    type="number"
                    min={0}
                    value={mBaseline}
                    onChange={(e) => setMBaseline(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white font-mono outline-none"
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-xs text-[#CBD5E1]">تعداد دنبال‌کننده</span>
                  <input
                    type="number"
                    min={0}
                    value={mFollowers}
                    onChange={(e) => setMFollowers(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white font-mono outline-none"
                  />
                </label>
              </div>

              <label className="space-y-1.5 block">
                <span className="text-xs text-[#CBD5E1]">لینک پروفایل (اختیاری)</span>
                <input
                  type="url"
                  maxLength={LIMITS.URL}
                  value={mUrl}
                  onChange={(e) => setMUrl(e.target.value)}
                  placeholder="https://youtube.com/@..."
                  dir="ltr"
                  className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white font-mono outline-none"
                />
              </label>

              <label className="space-y-1.5 block">
                <span className="text-xs text-[#CBD5E1]">دسته‌بندی و سبک محتوا</span>
                <input
                  maxLength={LIMITS.CATEGORY}
                  value={mCategory}
                  onChange={(e) => setMCategory(e.target.value)}
                  placeholder="زیرشاخه موضوعی"
                  className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                />
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1F2937]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs text-[#94A3B8] hover:text-white cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={mSaving}
                  className="px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer"
                >
                  {mSaving ? 'در حال ثبت...' : 'افزودن به واتچ‌لیست'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
