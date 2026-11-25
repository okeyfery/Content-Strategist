import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpLeft, Compass, FileText, Flame, Plus, Radar, Sparkles } from 'lucide-react';
import { AIQuotaWidget } from './AIQuotaWidget';
import {
  formatCompactNumber,
  PERIOD_LABELS,
  PLATFORM_META,
  type AuditReport,
  type Brand,
  type ContentDraft,
  type OutlierItem,
  type Platform,
  type WatchlistAccount,
} from '../types';

export type NavTab = 'overview' | 'discover' | 'watchlist' | 'outliers' | 'studio';

interface OverviewViewProps {
  brand: Brand;
  accounts: WatchlistAccount[];
  outliers: OutlierItem[];
  reports: AuditReport[];
  drafts: ContentDraft[];
  onNavigate: (tab: NavTab) => void;
  onGenerateFromOutlier: (outlier: OutlierItem) => void;
  onEditBrand: () => void;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];

export function OverviewView({
  brand,
  accounts,
  outliers,
  reports,
  drafts,
  onNavigate,
  onGenerateFromOutlier,
  onEditBrand,
}: OverviewViewProps) {
  const maxMultiplier = useMemo(() => {
    if (outliers.length === 0) return 0;
    return Math.max(...outliers.map((o) => o.outlierMultiplier));
  }, [outliers]);

  const topOutliersChart = useMemo(() => {
    return outliers.slice(0, 7).map((o) => ({
      name: o.title.length > 22 ? `${o.title.slice(0, 22)}…` : o.title,
      multiplier: o.outlierMultiplier,
      views: o.views,
      platform: PLATFORM_META[o.platform]?.labelFa || o.platform,
    }));
  }, [outliers]);

  const platformBreakdown = useMemo(() => {
    return ALL_PLATFORMS.map((p) => {
      const accCount = accounts.filter((a) => a.platform === p).length;
      const outCount = outliers.filter((o) => o.platform === p).length;
      const drfCount = drafts.filter((d) => d.platform === p).length;
      return {
        platform: p,
        label: PLATFORM_META[p].labelFa,
        color: PLATFORM_META[p].color,
        accounts: accCount,
        outliers: outCount,
        drafts: drfCount,
        total: accCount + outCount + drfCount,
      };
    });
  }, [accounts, outliers, drafts]);

  const latestReport = reports[0] || null;
  const maxPlatformTotal = Math.max(1, ...platformBreakdown.map((p) => p.total));

  return (
    <div className="space-y-8">
      {/* Brand Summary Strip */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#1F2937]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
            <span>فضای کاری برند فعال</span>
            <span aria-hidden="true">·</span>
            <span>{brand.niche}</span>
            {brand.pillars.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{brand.pillars.slice(0, 3).join(' / ')}</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-white">{brand.name}</h1>
          {brand.tone && (
            <p className="text-sm text-[#94A3B8] max-w-2xl">
              لحن برند: {brand.tone}
              {brand.audience ? ` · مخاطب هدف: ${brand.audience}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onEditBrand}
            className="px-3.5 py-2 text-xs font-medium text-[#CBD5E1] hover:text-white bg-[#111827] hover:bg-[#161F30] border border-[#1F2937] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            ویرایش پروفایل برند
          </button>
          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            تولید محتوای جدید
          </button>
        </div>
      </div>

      {/* 4-Column Flat KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('watchlist')}
          className="text-right p-5 bg-[#111827] border border-[#1F2937] hover:border-[#2D3A4F] rounded-xl transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>اکانت‌های واتچ‌لیست</span>
            <Radar className="w-4 h-4 text-[#64748B]" />
          </div>
          <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-white">
            {accounts.length}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            {reports.length} گزارش پایش دوره‌ای ثبت‌شده
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('outliers')}
          className="text-right p-5 bg-[#111827] border border-[#1F2937] hover:border-[#2D3A4F] rounded-xl transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>محتواهای Outlier کشف‌شده</span>
            <Flame className="w-4 h-4 text-[#10B981]" />
          </div>
          <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-white">
            {outliers.length}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            آماده کالبدشکافی و الگوگیری برای برند
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('outliers')}
          className="text-right p-5 bg-[#111827] border border-[#1F2937] hover:border-[#2D3A4F] rounded-xl transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>بالاترین ضریب جهش</span>
            <ArrowUpLeft className="w-4 h-4 text-[#60A5FA]" />
          </div>
          <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-[#10B981]">
            {maxMultiplier > 0 ? `${maxMultiplier.toFixed(1)}x` : '—'}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">نسبت به میانگین بازدید کانال منبع</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('studio')}
          className="text-right p-5 bg-[#111827] border border-[#1F2937] hover:border-[#2D3A4F] rounded-xl transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>کتابخانه محتوای برند</span>
            <FileText className="w-4 h-4 text-[#64748B]" />
          </div>
          <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-white">
            {drafts.length}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            {drafts.filter((d) => d.status === 'ready').length} مورد آماده انتشار
          </p>
        </button>
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Outlier Multiplier Distribution Chart */}
        <div className="lg:col-span-7 bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">مقایسه ضریب جهش برترین Outlierها</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                نسبت بازدید محتوا به میانگین پایه همان کانال (سبز: جهش بالای ۳ برابر)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('outliers')}
              className="text-xs text-[#60A5FA] hover:text-[#93C5FD] transition-colors cursor-pointer whitespace-nowrap"
            >
              مدیریت Outlierها
            </button>
          </div>

          {topOutliersChart.length > 0 ? (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topOutliersChart} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#1F2937' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    unit="x"
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      backgroundColor: '#0B0F17',
                      border: '1px solid #1F2937',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                    formatter={(val: unknown) => [`${Number(val).toFixed(1)}x`, 'ضریب Outlier']}
                  />
                  <Bar dataKey="multiplier" radius={[6, 6, 0, 0]} maxBarSize={42}>
                    {topOutliersChart.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={entry.multiplier >= 3 ? '#10B981' : '#3B82F6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center border border-dashed border-[#1F2937] rounded-lg p-6 space-y-3">
              <p className="text-sm font-medium text-[#CBD5E1]">هنوز محتوای Outlier ثبت نشده است</p>
              <p className="text-xs text-[#64748B] max-w-sm">
                از بخش شکارچی Outlier ویدیوهای موفق فیلد خود را جستجو کنید یا آمار پیج‌ها را وارد نمایید.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('outliers')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg transition-colors cursor-pointer"
              >
                <Flame className="w-3.5 h-3.5" />
                شروع شکار Outlier
              </button>
            </div>
          )}
        </div>

        {/* Platform Coverage Breakdown */}
        <div className="lg:col-span-5 bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">پوشش پلتفرم‌ها در این برند</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">توزیع واتچ‌لیست، Outlier و پیش‌نویس‌ها</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('discover')}
              className="text-xs text-[#60A5FA] hover:text-[#93C5FD] transition-colors cursor-pointer whitespace-nowrap"
            >
              کشف کانال
            </button>
          </div>

          <div className="space-y-4">
            {platformBreakdown.map((item) => {
              const pct = Math.round((item.total / maxPlatformTotal) * 100);
              return (
                <div key={item.platform} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">{item.label}</span>
                    <span className="text-[#94A3B8] font-mono tabular-nums">
                      {item.accounts} پیج · {item.outliers} Outlier · {item.drafts} محتوا
                    </span>
                  </div>
                  <div className="h-2 bg-[#0B0F17] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${item.total === 0 ? 4 : Math.max(8, pct)}%`,
                        backgroundColor: item.total === 0 ? '#1F2937' : item.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-[#1F2937] flex items-center justify-between gap-3">
            <span className="text-xs text-[#94A3B8]">گام سریع بعدی برای تقویت دیتای برند</span>
            <button
              type="button"
              onClick={() => onNavigate(accounts.length === 0 ? 'discover' : 'watchlist')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#60A5FA] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {accounts.length === 0 ? (
                <>
                  <Compass className="w-3.5 h-3.5" />
                  کشف پیج‌های مرتبط
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  اجرای پایش دوره‌ای
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Split: Top Outliers Table + Latest Audit Snapshot */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937]">
            <h2 className="text-sm font-semibold text-white">برترین Outlierهای ثبت‌شده</h2>
            <button
              type="button"
              onClick={() => onNavigate('outliers')}
              className="text-xs text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
            >
              مشاهده همه ({outliers.length})
            </button>
          </div>

          {outliers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-[#1F2937] text-[11px] text-[#64748B]">
                    <th className="py-2.5 px-6 font-medium">محتوا و کانال</th>
                    <th className="py-2.5 px-4 font-medium">بازدید</th>
                    <th className="py-2.5 px-4 font-medium">ضریب</th>
                    <th className="py-2.5 px-6 font-medium text-left">اکشن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2937] text-xs">
                  {outliers.slice(0, 5).map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-6 max-w-xs">
                        <p className="font-medium text-white truncate">{item.title}</p>
                        <p className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
                          {item.accountName} · {PLATFORM_META[item.platform].labelFa} · {item.format}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#CBD5E1] whitespace-nowrap">
                        {formatCompactNumber(item.views)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            item.outlierMultiplier >= 3
                              ? 'text-[#10B981] font-semibold'
                              : 'text-[#60A5FA] font-medium'
                          }
                        >
                          {item.outlierMultiplier.toFixed(1)}x
                        </span>
                      </td>
                      <td className="py-3 px-6 text-left whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onGenerateFromOutlier(item)}
                          className="text-xs font-medium text-[#60A5FA] hover:text-white transition-colors cursor-pointer"
                        >
                          بازآفرینی
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-[#64748B]">
              پس از شکار یا ورود آمار ویدیوهای موفق، برترین الگوها اینجا فهرست می‌شوند.
            </div>
          )}
        </div>

        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">آخرین گزارش پایش واتچ‌لیست</h2>
              <button
                type="button"
                onClick={() => onNavigate('watchlist')}
                className="text-xs text-[#60A5FA] hover:text-[#93C5FD] cursor-pointer"
              >
                آرشیو گزارش‌ها
              </button>
            </div>

            {latestReport ? (
              <div className="space-y-4">
                <div className="text-xs text-[#94A3B8] flex items-center gap-2">
                  <span>بازه {PERIOD_LABELS[latestReport.period]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{latestReport.accountsReviewed.length} اکانت پایش‌شده</span>
                </div>
                <p className="text-sm font-semibold text-white leading-snug">{latestReport.title}</p>
                <p className="text-xs text-[#CBD5E1] leading-relaxed">{latestReport.executiveSummary}</p>
                {latestReport.contentGaps.length > 0 && (
                  <div className="pt-3 border-t border-[#1F2937] space-y-2">
                    <p className="text-xs font-medium text-[#94A3B8]">کلیدی‌ترین شکاف‌های محتوایی:</p>
                    <ul className="space-y-1.5 text-xs text-[#CBD5E1]">
                      {latestReport.contentGaps.slice(0, 3).map((gap, i) => (
                        <li key={i} className="leading-relaxed">
                          {i + 1}. {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center space-y-3">
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  هنوز گزارش پایش بازه زمانی برای این برند اجرا نشده است. ابتدا اکانت‌های مرتبط را به واتچ‌لیست اضافه
                  کنید و سپس گزارش ۷ تا ۹۰ روزه بگیرید.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(accounts.length === 0 ? 'discover' : 'watchlist')}
                  className="px-4 py-2 text-xs font-medium bg-[#161F30] hover:bg-[#1F2937] text-white border border-[#2D3A4F] rounded-lg transition-colors cursor-pointer"
                >
                  {accounts.length === 0 ? 'کشف اولین اکانت‌ها' : 'اجرای اولین پایش دوره‌ای'}
                </button>
              </div>
            )}
          </div>

          <AIQuotaWidget />
        </div>
      </div>
    </div>
  );
}

