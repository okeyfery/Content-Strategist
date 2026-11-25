/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, Database, Globe, RefreshCw, ShieldCheck, Youtube } from 'lucide-react';
import { auth } from '../firebase';
import { getAICacheCount } from '../services/firestoreService';

interface ServerQuotaStatus {
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
  primaryModel: string;
  fallbackModel: string;
  apiKeyConfigured: boolean;
  tavilyKeyConfigured: boolean;
}

export function AIQuotaWidget() {
  const [cachedCount, setCachedCount] = useState<number>(0);
  const [status, setStatus] = useState<ServerQuotaStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadStats = async () => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      const [quotaRes, count] = await Promise.all([
        fetch('/api/quota-status')
          .then((r) => (r.ok ? (r.json() as Promise<ServerQuotaStatus>) : null))
          .catch(() => null),
        user ? getAICacheCount(user.uid) : Promise.resolve(0),
      ]);
      setStatus(quotaRes);
      setCachedCount(count);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  const liveCalls = status?.liveGeminiCalls ?? 0;
  const cacheHits = status?.memoryCacheHits ?? 0;
  const ytSearches = status?.directYouTubeSearches ?? 0;
  const tavilySearches = status?.tavilySearches ?? 0;
  const quotaExhausted = Boolean(status?.quotaExhausted);
  const quotaErrors = status?.quotaErrors ?? 0;
  const tavilyMissing = status !== null && !status.tavilyKeyConfigured;

  const DAILY_SOFT_BUDGET = 60;
  const usagePercentage = quotaExhausted
    ? 100
    : Math.min(95, Math.round((liveCalls / DAILY_SOFT_BUDGET) * 100));

  let barColor = 'bg-[#10B981]';
  let statusText = 'موتور تحلیل رایگان فعال و آماده';
  let statusTextColor = 'text-[#10B981]';
  let warningMessage: string | null = null;
  let warningSeverity: 'error' | 'warn' = 'warn';

  if (quotaExhausted) {
    barColor = 'bg-rose-500';
    statusText = 'محدودیت موقت نرخ Gemini';
    statusTextColor = 'text-rose-400';
    warningSeverity = 'error';
    warningMessage =
      'محدودیت موقت نرخ درخواست‌های رایگان Gemini (gemini-2.5-flash و gemini-2.5-flash-lite) پر شده است. جستجوی زنده یوتیوب همچنان فعال است؛ لطفاً لحظاتی دیگر دوباره امتحان کنید.';
  } else if (tavilyMissing) {
    barColor = 'bg-amber-500';
    statusText = 'یوتیوب فعال • Tavily تنظیم نشده';
    statusTextColor = 'text-amber-400';
    warningSeverity = 'warn';
    warningMessage =
      'برای جستجوی زنده در اینستاگرام، تیک‌تاک، لینکدین و ایکس، کلید TAVILY_API_KEY را در بخش Settings > Secrets اضافه کنید. تحلیل متنی Gemini و جستجوی زنده یوتیوب بدون نیاز به کلید پولی فعال هستند.';
  } else if (usagePercentage >= 75 || quotaErrors > 0) {
    barColor = 'bg-amber-500';
    statusText = 'مصرف بالا (مدل جایگزین آماده)';
    statusTextColor = 'text-amber-400';
    warningSeverity = 'warn';
    warningMessage =
      'بخش قابل‌توجهی از بودجه روزانه مصرف شده است. سیستم به‌طور خودکار بین gemini-2.5-flash، gemini-2.5-flash-lite و کش ابری جابه‌جا می‌شود.';
  }

  return (
    <div className="p-5 bg-[#111827] border border-[#1F2937] rounded-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/20 flex items-center justify-center text-[#60A5FA]">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">وضعیت سهمیه و موتور جستجو</h3>
            <p className="text-[11px] text-[#94A3B8]">
              آمار واقعی امروز ({status?.dateKey || '...'})
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadStats()}
          disabled={loading}
          title="به‌روزرسانی وضعیت"
          className="p-1.5 text-[#94A3B8] hover:text-white bg-[#0B0F17] border border-[#1F2937] rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className={`font-medium ${statusTextColor}`}>{statusText}</span>
          <span className="font-mono tabular-nums text-[#CBD5E1]">
            {liveCalls} تحلیل Gemini
          </span>
        </div>
        <div className="w-full bg-[#0B0F17] h-2 rounded-full overflow-hidden border border-[#1F2937]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.max(liveCalls > 0 || quotaExhausted ? 8 : 2, usagePercentage)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[#64748B] font-mono" dir="ltr">
          <span>Model: {status?.lastModelUsed || status?.primaryModel || 'gemini-2.5-flash'}</span>
          <span className={status?.tavilyKeyConfigured ? 'text-[#10B981]' : 'text-amber-400'}>
            Tavily: {status?.tavilyKeyConfigured ? 'Ready' : 'Key Missing'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-[#1F2937] text-[11px]">
        <div className="bg-[#0B0F17] border border-[#1F2937] rounded-lg p-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[#94A3B8]">
            <Database className="w-3 h-3 text-[#10B981]" />
            <span>کش ابری</span>
          </div>
          <p className="font-mono tabular-nums text-sm font-semibold text-white">{cachedCount}</p>
        </div>

        <div className="bg-[#0B0F17] border border-[#1F2937] rounded-lg p-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[#94A3B8]">
            <ShieldCheck className="w-3 h-3 text-[#60A5FA]" />
            <span>صرفه‌جویی</span>
          </div>
          <p className="font-mono tabular-nums text-sm font-semibold text-white">{cacheHits}</p>
        </div>

        <div className="bg-[#0B0F17] border border-[#1F2937] rounded-lg p-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[#94A3B8]">
            <Youtube className="w-3 h-3 text-[#EF4444]" />
            <span>جستجوی YT</span>
          </div>
          <p className="font-mono tabular-nums text-sm font-semibold text-white">{ytSearches}</p>
        </div>

        <div className="bg-[#0B0F17] border border-[#1F2937] rounded-lg p-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[#94A3B8]">
            <Globe className="w-3 h-3 text-[#A78BFA]" />
            <span>Tavily</span>
          </div>
          <p className="font-mono tabular-nums text-sm font-semibold text-white">{tavilySearches}</p>
        </div>
      </div>

      {warningMessage && (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
            warningSeverity === 'error'
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
          }`}
        >
          <AlertTriangle
            className={`w-4 h-4 shrink-0 mt-0.5 ${warningSeverity === 'error' ? 'text-rose-400' : 'text-amber-400'}`}
          />
          <p>{warningMessage}</p>
        </div>
      )}
    </div>
  );
}
