import { useState } from 'react';
import { ArrowLeft, Radar, ShieldCheck, Layers, TrendingUp, Sparkles } from 'lucide-react';
import { signInWithGoogle } from '../firebase';

const STUDIO_BACKDROP = '/src/assets/images/auth_studio_backdrop_1795548676361.jpg';

export function AuthGate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ورود با گوگل ناموفق بود.';
      if (msg.includes('popup-closed-by-user')) {
        setError('پنجره ورود بسته شد. برای ادامه مجدداً روی ورود با گوگل کلیک کنید.');
      } else {
        setError('خطا در احراز هویت گوگل. لطفاً مسدودکننده پاپ‌آپ را بررسی کرده و دوباره تلاش کنید.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] grid lg:grid-cols-12">
      {/* Right Column (RTL primary): Sign-In & Value Proposition */}
      <div className="lg:col-span-5 flex flex-col justify-between p-8 sm:p-12 lg:p-14 border-l border-[#1F2937]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#60A5FA]">
            <Radar className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">رادار محتوا</span>
        </div>

        <div className="my-12 space-y-8 max-w-md">
          <div className="space-y-4">
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-white">
              استودیوی تحلیل رقبا، شکار Outlier و تولید محتوای برند
            </h1>
            <p className="text-sm sm:text-base text-[#94A3B8] leading-relaxed">
              کانال‌ها و پیج‌های برتر هر حوزه را در یوتیوب، اینستاگرام، تیک‌تاک، لینکدین و ایکس رصد کنید، ویدیوهای
              جهش‌یافته را کالبدشکافی کنید و محتوای بومی‌شده به فارسی و انگلیسی بسازید.
            </p>
          </div>

          <div className="space-y-4 pt-2 border-t border-[#1F2937]">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-4 h-4 text-[#60A5FA] mt-1 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-white">کشف کانال و شکار ویدیوهای Outlier</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  محاسبه ضریب جهش نسبت به میانگین پیج و تحلیل ساختار هوک ۳ ثانیه اول
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers className="w-4 h-4 text-[#60A5FA] mt-1 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-white">واتچ‌لیست هوشمند و پایش بازه زمانی</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  گزارش‌گیری ۷، ۱۴، ۳۰ و ۹۰ روزه از تغییرات فرمت و شکاف‌های محتوایی رقبا
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-[#60A5FA] mt-1 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-white">تولید محتوای دوزبانه اختصاصی هر برند</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  سناریوی کامل ویدیو، کاروسل، پست لینکدین و رشته‌توییت به فارسی و انگلیسی
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{loading ? 'در حال اتصال به حساب گوگل...' : 'ورود با حساب گوگل و همگام‌سازی ابری'}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>

            {error && (
              <p className="text-xs text-red-400 leading-relaxed bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                {error}
              </p>
            )}

            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>تمام برندها، واتچ‌لیست‌ها و گزارش‌های شما به‌صورت خصوصی در فضای ابری ذخیره می‌شوند.</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-[#64748B] flex items-center gap-2">
          <span>YouTube</span>
          <span>·</span>
          <span>Instagram</span>
          <span>·</span>
          <span>TikTok</span>
          <span>·</span>
          <span>LinkedIn</span>
          <span>·</span>
          <span>X</span>
        </div>
      </div>

      {/* Left Column (RTL visual anchor): Dark Studio Architectural Backdrop */}
      <div className="hidden lg:flex lg:col-span-7 relative overflow-hidden bg-[#0E1420] items-end p-14">
        {!imgFailed ? (
          <img
            src={STUDIO_BACKDROP}
            alt="فضای استودیوی تحلیلی رادار محتوا"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] via-[#111827] to-[#0B0F17]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/55 to-transparent" />

        <div className="relative z-10 max-w-xl space-y-6">
          <div className="grid grid-cols-3 gap-6 border-t border-white/15 pt-6">
            <div>
              <p className="font-mono tabular-nums text-2xl font-semibold text-white">5</p>
              <p className="text-xs text-[#94A3B8] mt-1">پلتفرم تحت پوشش هم‌زمان</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-2xl font-semibold text-[#10B981]">3x–12x</p>
              <p className="text-xs text-[#94A3B8] mt-1">کشف جهش‌های واقعی Outlier</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-2xl font-semibold text-white">FA / EN</p>
              <p className="text-xs text-[#94A3B8] mt-1">تولید محتوای دوزبانه برند</p>
            </div>
          </div>
          <p className="text-sm text-[#CBD5E1] leading-relaxed">
            تصمیم‌گیری محتوایی مبتنی بر داده؛ به‌جای حدس‌زدن موضوع، الگوهای اثبات‌شده بازار را رصد کنید و با صدای
            منحصربه‌فرد برند خود اجرا کنید.
          </p>
        </div>
      </div>
    </div>
  );
}
