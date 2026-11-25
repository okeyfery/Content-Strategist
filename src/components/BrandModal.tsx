import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  LIMITS,
  PLATFORM_META,
  type Brand,
  type BrandDefaultLanguage,
  type Platform,
} from '../types';

interface BrandModalProps {
  initialBrand?: Brand | null;
  onClose: () => void;
  onSave: (data: Omit<Brand, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  dismissible?: boolean;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];

export function BrandModal({
  initialBrand,
  onClose,
  onSave,
  dismissible = true,
}: BrandModalProps) {
  const [name, setName] = useState(initialBrand?.name || '');
  const [niche, setNiche] = useState(initialBrand?.niche || '');
  const [audience, setAudience] = useState(initialBrand?.audience || '');
  const [tone, setTone] = useState(initialBrand?.tone || 'تحلیلی، صمیمی و کاربردی');
  const [usp, setUsp] = useState(initialBrand?.usp || '');
  const [forbiddenTerms, setForbiddenTerms] = useState(initialBrand?.forbiddenTerms || '');
  const [pillarsText, setPillarsText] = useState((initialBrand?.pillars || []).join('، '));
  const [defaultLanguage, setDefaultLanguage] = useState<BrandDefaultLanguage>(
    initialBrand?.defaultLanguage || 'both'
  );
  const [platforms, setPlatforms] = useState<Platform[]>(
    initialBrand?.platforms?.length ? initialBrand.platforms : ['youtube', 'instagram', 'linkedin']
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((item) => item !== p) : prev) : [...prev, p]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !niche.trim()) {
      setError('نام برند و حوزه تخصصی الزامی هستند.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const pillars = pillarsText
        .split(/[،,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

      await onSave({
        name: name.trim(),
        niche: niche.trim(),
        audience: audience.trim(),
        tone: tone.trim(),
        usp: usp.trim(),
        forbiddenTerms: forbiddenTerms.trim(),
        defaultLanguage,
        pillars,
        platforms,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره برند.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl w-full max-w-2xl my-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937]">
          <div>
            <h2 className="text-base font-bold text-white">
              {initialBrand ? 'ویرایش هویت برند' : 'تعریف برند جدید'}
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              تمام کشف‌ها، پایش‌های واتچ‌لیست و تولید محتوا بر اساس پروفایل برند فعال شخصی‌سازی می‌شوند.
            </p>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="بستن"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">نام برند یا پروژه *</span>
              <input
                type="text"
                required
                maxLength={LIMITS.BRAND_NAME}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً: استودیو نوا، فین‌تک راد"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">حوزه تخصصی / فیلد *</span>
              <input
                type="text"
                required
                maxLength={LIMITS.BRAND_NICHE}
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="مثلاً: هوش مصنوعی کاربردی، قهوه تخصصی، SaaS"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">مخاطب هدف</span>
              <input
                type="text"
                maxLength={LIMITS.BRAND_AUDIENCE}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="مثلاً: بنیان‌گذاران استارتاپ و مدیران محصول ۲۴ تا ۴۰ ساله"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">لحن و شخصیت برند</span>
              <input
                type="text"
                maxLength={LIMITS.BRAND_TONE}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="مثلاً: داده‌محور، شفاف، بدون کلیشه و کمی جسور"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#CBD5E1]">مزیت رقابتی و زاویه نگاه برند (USP)</span>
            <textarea
              rows={2}
              maxLength={LIMITS.BRAND_USP}
              value={usp}
              onChange={(e) => setUsp(e.target.value)}
              placeholder="چه چیزی محتوا یا محصول این برند را از رقبا متمایز می‌کند؟"
              className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none resize-none"
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">ستون‌های محتوایی (با ویرگول جدا کنید)</span>
              <input
                type="text"
                value={pillarsText}
                onChange={(e) => setPillarsText(e.target.value)}
                placeholder="آموزش کوتاه، کیس‌استادی واقعی، نقد ابزارها، پشت‌صحنه"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#CBD5E1]">کلمات ممنوعه یا خط قرمزها</span>
              <input
                type="text"
                maxLength={LIMITS.BRAND_FORBIDDEN}
                value={forbiddenTerms}
                onChange={(e) => setForbiddenTerms(e.target.value)}
                placeholder="مثلاً: کلیک‌بیت زرد، وعده‌های غیرواقعی، لحن بیش از حد رسمی"
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-2">
              <span className="text-xs font-medium text-[#CBD5E1] block">پلتفرم‌های فعال برند</span>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => {
                  const active = platforms.includes(p);
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
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-[#CBD5E1] block">زبان پیش‌فرض تولید محتوا</span>
              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-[#1F2937] rounded-lg">
                {(
                  [
                    { id: 'both', label: 'فارسی و انگلیسی' },
                    { id: 'fa', label: 'فقط فارسی' },
                    { id: 'en', label: 'English' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDefaultLanguage(opt.id)}
                    className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      defaultLanguage === opt.id
                        ? 'bg-[#1F2937] text-white'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1F2937]">
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
              >
                انصراف
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {saving ? 'در حال ذخیره...' : initialBrand ? 'ذخیره تغییرات برند' : 'ساخت فضای کاری برند'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
