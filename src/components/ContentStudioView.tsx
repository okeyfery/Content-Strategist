import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  Flame,
  Lock,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  DRAFT_STATUS_LABELS,
  PLATFORM_META,
  type Brand,
  type ContentDraft,
  type ContentLanguage,
  type DraftStatus,
  type OutlierItem,
  type Platform,
} from '../types';

interface ContentStudioViewProps {
  brand: Brand;
  outliers: OutlierItem[];
  drafts: ContentDraft[];
  preselectedOutlier: OutlierItem | null;
  preselectedTopic: string;
  onClearPreselection: () => void;
  onSaveNewDraft: (
    draft: Omit<ContentDraft, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onUpdateDraft: (
    draftId: string,
    patch: Partial<
      Pick<
        ContentDraft,
        'title' | 'hooks' | 'bodyScript' | 'caption' | 'cta' | 'visualConcept' | 'brandFitNotes' | 'status'
      >
    >
  ) => Promise<void>;
  onDeleteDraft: (draftId: string) => Promise<void>;
}

const ALL_PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok', 'linkedin', 'x'];
const GOALS = [
  'وایرال و جذب مخاطب جدید (Reach)',
  'ذخیره و اشتراک‌گذاری بالا (Save & Share)',
  'جذب سرنخ و فروش (Conversion)',
  'اعتبارسازی و رهبری فکری (Authority)',
];

export function ContentStudioView({
  brand,
  outliers,
  drafts,
  preselectedOutlier,
  preselectedTopic,
  onClearPreselection,
  onSaveNewDraft,
  onUpdateDraft,
  onDeleteDraft,
}: ContentStudioViewProps) {
  const [topic, setTopic] = useState(preselectedTopic || '');
  const [platform, setPlatform] = useState<Platform>(
    preselectedOutlier?.platform || brand.platforms?.[0] || 'instagram'
  );
  const [format, setFormat] = useState(
    PLATFORM_META[preselectedOutlier?.platform || brand.platforms?.[0] || 'instagram'].formats[0]
  );
  const [language, setLanguage] = useState<ContentLanguage>(
    brand.defaultLanguage === 'en' ? 'en' : 'fa'
  );
  const [goal, setGoal] = useState(GOALS[0]);
  const [extraNotes, setExtraNotes] = useState('');
  const [linkedOutlierId, setLinkedOutlierId] = useState<string>(preselectedOutlier?.id || '');

  // Generated / Active Draft Editor State
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [hooks, setHooks] = useState<string[]>([]);
  const [bodyScript, setBodyScript] = useState('');
  const [caption, setCaption] = useState('');
  const [cta, setCta] = useState('');
  const [visualConcept, setVisualConcept] = useState('');
  const [brandFitNotes, setBrandFitNotes] = useState('');
  const [status, setStatus] = useState<DraftStatus>('draft');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<Platform | 'all'>('all');

  useEffect(() => {
    if (preselectedOutlier) {
      setLinkedOutlierId(preselectedOutlier.id);
      setPlatform(preselectedOutlier.platform);
      setFormat(
        PLATFORM_META[preselectedOutlier.platform].formats[0] || preselectedOutlier.format
      );
      setTopic(
        preselectedOutlier.brandAdaptationIdea
          ? preselectedOutlier.brandAdaptationIdea.slice(0, 180)
          : `بازآفرینی الگوی: ${preselectedOutlier.title}`
      );
      setActiveDraftId(null);
      onClearPreselection();
    } else if (preselectedTopic) {
      setTopic(preselectedTopic);
      setActiveDraftId(null);
      onClearPreselection();
    }
  }, [preselectedOutlier, preselectedTopic, onClearPreselection]);

  const linkedOutlier = useMemo(
    () => outliers.find((o) => o.id === linkedOutlierId) || null,
    [outliers, linkedOutlierId]
  );

  const activeSavedDraft = useMemo(
    () => drafts.find((d) => d.id === activeDraftId) || null,
    [drafts, activeDraftId]
  );

  const isArchivedLocked = activeSavedDraft?.status === 'archived';

  const filteredDrafts = useMemo(() => {
    if (libraryFilter === 'all') return drafts;
    return drafts.filter((d) => d.platform === libraryFilter);
  }, [drafts, libraryFilter]);

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    setFormat(PLATFORM_META[p].formats[0]);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: {
            name: brand.name,
            niche: brand.niche,
            audience: brand.audience,
            tone: brand.tone,
            usp: brand.usp,
            forbiddenTerms: brand.forbiddenTerms,
            pillars: brand.pillars,
          },
          topic: topic.trim(),
          platform,
          format,
          language,
          goal,
          extraNotes: extraNotes.trim(),
          outlierBlueprint: linkedOutlier
            ? {
                title: linkedOutlier.title,
                outlierMultiplier: linkedOutlier.outlierMultiplier,
                hookPattern: linkedOutlier.hookPattern,
                whyItWorked: linkedOutlier.whyItWorked,
                structureBreakdown: linkedOutlier.structureBreakdown,
              }
            : null,
        }),
      });
      const data = (await res.json()) as {
        content?: {
          title?: string;
          hooks?: string[];
          bodyScript?: string;
          caption?: string;
          cta?: string;
          visualConcept?: string;
          brandFitNotes?: string;
        };
        error?: string;
      };
      if (!res.ok || !data.content) {
        throw new Error(data.error || 'خطا در تولید محتوا');
      }

      const c = data.content;
      const newTitle = c.title || topic.trim();
      const newHooks = Array.isArray(c.hooks) ? c.hooks : [];
      const newScript = c.bodyScript || '';
      const newCaption = c.caption || '';
      const newCta = c.cta || '';
      const newVisual = c.visualConcept || '';
      const newFit = c.brandFitNotes || '';

      setTitle(newTitle);
      setHooks(newHooks);
      setBodyScript(newScript);
      setCaption(newCaption);
      setCta(newCta);
      setVisualConcept(newVisual);
      setBrandFitNotes(newFit);
      setStatus('draft');

      // Persist immediately to cloud library
      const createdId = await onSaveNewDraft({
        sourceOutlierId: linkedOutlier?.id || '',
        platform,
        format,
        language,
        topic: topic.trim(),
        title: newTitle,
        hooks: newHooks,
        bodyScript: newScript,
        caption: newCaption,
        cta: newCta,
        visualConcept: newVisual,
        brandFitNotes: newFit,
        status: 'draft',
      });
      setActiveDraftId(createdId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید محتوا');
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenDraft = (d: ContentDraft) => {
    setActiveDraftId(d.id);
    setTopic(d.topic);
    setPlatform(d.platform);
    setFormat(d.format);
    setLanguage(d.language);
    setLinkedOutlierId(d.sourceOutlierId || '');
    setTitle(d.title);
    setHooks(d.hooks || []);
    setBodyScript(d.bodyScript);
    setCaption(d.caption);
    setCta(d.cta);
    setVisualConcept(d.visualConcept);
    setBrandFitNotes(d.brandFitNotes);
    setStatus(d.status);
    setError(null);
  };

  const handleSaveEdits = async () => {
    if (!activeDraftId || isArchivedLocked) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdateDraft(activeDraftId, {
        title,
        hooks,
        bodyScript,
        caption,
        cta,
        visualConcept,
        brandFitNotes,
        status,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تغییرات');
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const fullPackageText = useMemo(() => {
    return [
      `# ${title}`,
      hooks.length > 0 ? `\n## Hooks:\n${hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : '',
      bodyScript ? `\n## Script / Body:\n${bodyScript}` : '',
      caption ? `\n## Caption:\n${caption}` : '',
      cta ? `\n## CTA:\n${cta}` : '',
      visualConcept ? `\n## Visual / Thumbnail Direction:\n${visualConcept}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }, [title, hooks, bodyScript, caption, cta, visualConcept]);

  const contentDir = language === 'en' ? 'ltr' : 'rtl';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-white">استودیو تولید محتوای اختصاصی برند</h1>
        <p className="text-xs text-[#94A3B8]">
          بر اساس هویت برند «{brand.name}» و الگوی ویدیوهای Outlier، اسکریپت کامل، هوک‌ها، کپشن و کانسپت بصری به
          فارسی یا انگلیسی تولید کنید.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Left/Right Studio Brief Panel */}
        <div className="lg:col-span-5 space-y-5">
          <form
            onSubmit={handleGenerate}
            className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4"
          >
            {/* Linked Outlier Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#CBD5E1] flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#10B981]" />
                  الهام از الگوی Outlier (اختیاری)
                </span>
                {linkedOutlier && (
                  <button
                    type="button"
                    onClick={() => setLinkedOutlierId('')}
                    className="text-[11px] text-[#94A3B8] hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    حذف پیوند
                  </button>
                )}
              </div>
              <select
                value={linkedOutlierId}
                onChange={(e) => setLinkedOutlierId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              >
                <option value="">بدون الگوی Outlier (تولید آزاد بر اساس موضوع)</option>
                {outliers.map((o) => (
                  <option key={o.id} value={o.id}>
                    [{o.outlierMultiplier.toFixed(1)}x · {PLATFORM_META[o.platform].labelFa}] {o.title}
                  </option>
                ))}
              </select>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-[#CBD5E1]">موضوع یا زاویه محتوا *</span>
              <textarea
                required
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="مثلاً: ۵ اشتباه رایج استارتاپ‌ها در انتخاب استراتژی محتوای یوتیوب در سال ۲۰۲۶"
                className="w-full p-3 text-sm bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none resize-none"
              />
            </label>

            {/* Platform & Format */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-[#CBD5E1] block">پلتفرم مقصد</span>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePlatformChange(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                      platform === p
                        ? 'bg-[#3B82F6]/15 border-[#3B82F6] text-white'
                        : 'bg-[#0B0F17] border-[#1F2937] text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {PLATFORM_META[p].labelFa}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-[#CBD5E1]">فرمت محتوا</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
                >
                  {PLATFORM_META[platform].formats.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-[#CBD5E1] block">زبان خروجی محتوا</span>
                <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-[#1F2937] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setLanguage('fa')}
                    className={`flex-1 py-1 text-xs font-medium rounded-md cursor-pointer ${
                      language === 'fa' ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8]'
                    }`}
                  >
                    فارسی
                  </button>
                  <button
                    type="button"
                    onClick={() => setLanguage('en')}
                    className={`flex-1 py-1 text-xs font-medium rounded-md cursor-pointer font-mono ${
                      language === 'en' ? 'bg-[#1F2937] text-white' : 'text-[#94A3B8]'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-[#CBD5E1]">هدف اصلی محتوا</span>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none"
              >
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-[#CBD5E1]">نکات یا مثال‌های اضافه (اختیاری)</span>
              <input
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                placeholder="مثلاً: اشاره به آمار جدید، لحن چالشی‌تر، دعوت به دانلود فایل"
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white placeholder:text-[#475569] outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={generating}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              {generating ? 'در حال نگارش پکیج محتوا...' : 'تولید پکیج کامل محتوا'}
            </button>
          </form>

          {/* Saved Drafts Library */}
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1F2937] flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-white">
                کتابخانه محتوای برند ({drafts.length})
              </h2>
              <select
                value={libraryFilter}
                onChange={(e) => setLibraryFilter(e.target.value as Platform | 'all')}
                className="px-2 py-1 text-[11px] bg-[#0B0F17] border border-[#1F2937] rounded text-[#94A3B8] outline-none"
              >
                <option value="all">همه پلتفرم‌ها</option>
                {ALL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_META[p].labelFa}
                  </option>
                ))}
              </select>
            </div>

            {filteredDrafts.length > 0 ? (
              <div className="divide-y divide-[#1F2937] max-h-80 overflow-y-auto">
                {filteredDrafts.map((d) => {
                  const selected = activeDraftId === d.id;
                  return (
                    <div
                      key={d.id}
                      className={`p-3.5 flex items-start justify-between gap-2 transition-colors ${
                        selected ? 'bg-[#161F30]' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenDraft(d)}
                        className="text-right flex-1 min-w-0 cursor-pointer space-y-1"
                      >
                        <p className="text-xs font-medium text-white truncate">{d.title}</p>
                        <p className="text-[11px] text-[#94A3B8] truncate">
                          {PLATFORM_META[d.platform].labelFa} · {d.language === 'en' ? 'EN' : 'FA'} ·{' '}
                          {DRAFT_STATUS_LABELS[d.status]}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeDraftId === d.id) {
                            setActiveDraftId(null);
                            setTitle('');
                            setBodyScript('');
                            setHooks([]);
                          }
                          void onDeleteDraft(d.id);
                        }}
                        className="p-1 text-[#64748B] hover:text-red-400 cursor-pointer shrink-0"
                        title="حذف پیش‌نویس"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-[#64748B]">
                محتواهای تولیدشده شما به‌طور خودکار اینجا ذخیره می‌شوند.
              </div>
            )}
          </div>
        </div>

        {/* Studio Output & Live Editor Panel */}
        <div className="lg:col-span-7 bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          {error && (
            <div className="m-5 p-3.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
              {error}
            </div>
          )}

          {generating ? (
            <div className="p-6 space-y-5 animate-pulse">
              <div className="h-6 w-2/3 bg-[#1F2937] rounded" />
              <div className="space-y-2">
                <div className="h-4 w-32 bg-[#1F2937] rounded" />
                <div className="h-10 w-full bg-[#1F2937]/70 rounded" />
                <div className="h-10 w-full bg-[#1F2937]/70 rounded" />
              </div>
              <div className="h-56 w-full bg-[#1F2937]/60 rounded" />
            </div>
          ) : title || bodyScript ? (
            <div className="divide-y divide-[#1F2937]">
              {/* Editor Toolbar */}
              <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-[#0E1523]">
                <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                  <span style={{ color: PLATFORM_META[platform].color }}>
                    {PLATFORM_META[platform].labelFa}
                  </span>
                  <span>·</span>
                  <span>{format}</span>
                  <span>·</span>
                  <span className="font-mono">{language.toUpperCase()}</span>
                  {isArchivedLocked && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-[#F59E0B]">
                        <Lock className="w-3 h-3" />
                        بایگانی‌شده (فقط‌خواندنی)
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    disabled={isArchivedLocked}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DraftStatus)}
                    className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-[#1F2937] rounded-lg text-white outline-none disabled:opacity-50"
                  >
                    <option value="idea">ایده اولیه</option>
                    <option value="draft">در حال ویرایش</option>
                    <option value="ready">آماده انتشار</option>
                    <option value="archived">بایگانی‌شده (قفل)</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => copyText('full', fullPackageText)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161F30] hover:bg-[#1F2937] text-white border border-[#2D3A4F] rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    {copiedKey === 'full' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#10B981]" />
                        کپی شد
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        کپی کل پکیج
                      </>
                    )}
                  </button>

                  {activeDraftId && !isArchivedLocked && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveEdits}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-60 text-white rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                    </button>
                  )}
                </div>
              </div>

              {/* Title & Hooks */}
              <div className="p-6 space-y-5">
                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-[#94A3B8]">عنوان / تیتر اصلی</span>
                  <input
                    dir={contentDir}
                    disabled={isArchivedLocked}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-base font-bold bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-white outline-none disabled:opacity-60"
                  />
                </label>

                {hooks.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-[#60A5FA] block">
                      گزینه‌های هوک آغازین (Hooks)
                    </span>
                    <div className="space-y-2">
                      {hooks.map((h, i) => (
                        <div
                          key={i}
                          dir={contentDir}
                          className="flex items-start justify-between gap-3 p-3 bg-[#0B0F17] border border-[#1F2937] rounded-lg text-xs text-[#E2E8F0] leading-relaxed"
                        >
                          <span>
                            <strong className="font-mono text-[#64748B] ml-1.5">{i + 1}.</strong> {h}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(`hook-${i}`, h)}
                            className="p-1 text-[#64748B] hover:text-white shrink-0 cursor-pointer"
                            title="کپی هوک"
                          >
                            {copiedKey === `hook-${i}` ? (
                              <Check className="w-3.5 h-3.5 text-[#10B981]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main Script / Body Editor */}
                <label className="space-y-1.5 block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#94A3B8]">
                      سناریو کامل / متن اسلایدها یا رشته‌توییت
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('script', bodyScript)}
                      className="text-[11px] text-[#60A5FA] hover:text-white cursor-pointer"
                    >
                      {copiedKey === 'script' ? 'کپی شد' : 'کپی متن'}
                    </button>
                  </div>
                  <textarea
                    dir={contentDir}
                    disabled={isArchivedLocked}
                    rows={12}
                    value={bodyScript}
                    onChange={(e) => setBodyScript(e.target.value)}
                    className="w-full p-4 text-sm leading-relaxed bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-[#F1F5F9] outline-none disabled:opacity-60"
                  />
                </label>

                {/* Caption & CTA */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="space-y-1.5 block">
                    <span className="text-xs font-medium text-[#94A3B8]">کپشن و هشتگ‌ها</span>
                    <textarea
                      dir={contentDir}
                      disabled={isArchivedLocked}
                      rows={4}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      className="w-full p-3 text-xs leading-relaxed bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-[#CBD5E1] outline-none disabled:opacity-60"
                    />
                  </label>

                  <div className="space-y-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-[#94A3B8]">فراخوان اقدام (CTA)</span>
                      <input
                        dir={contentDir}
                        disabled={isArchivedLocked}
                        value={cta}
                        onChange={(e) => setCta(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-[#CBD5E1] outline-none disabled:opacity-60"
                      />
                    </label>

                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-[#94A3B8]">
                        کارگردانی بصری / ایده تامبنیل و کاور
                      </span>
                      <textarea
                        dir={contentDir}
                        disabled={isArchivedLocked}
                        rows={2}
                        value={visualConcept}
                        onChange={(e) => setVisualConcept(e.target.value)}
                        className="w-full p-2.5 text-xs leading-relaxed bg-[#0B0F17] border border-[#1F2937] focus:border-[#3B82F6] rounded-lg text-[#CBD5E1] outline-none disabled:opacity-60"
                      />
                    </label>
                  </div>
                </div>

                {/* Strategic Brand Fit Notes (Always Persian RTL) */}
                {brandFitNotes && (
                  <div className="p-4 bg-[#0B0F17] border border-[#1F2937] rounded-lg space-y-1">
                    <p className="text-xs font-semibold text-[#10B981]">
                      تحلیل انطباق با هویت برند «{brand.name}»
                    </p>
                    <p className="text-xs text-[#CBD5E1] leading-relaxed">{brandFitNotes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-14 text-center space-y-3">
              <FileText className="w-8 h-8 text-[#475569] mx-auto" />
              <p className="text-sm font-medium text-white">میز کار استودیو آماده نگارش است</p>
              <p className="text-xs text-[#94A3B8] max-w-md mx-auto leading-relaxed">
                موضوع دلخواه یا یک Outlier ثبت‌شده را انتخاب کنید، زبان خروجی (فارسی یا English) و پلتفرم مقصد را
                تعیین کنید و دکمه «تولید پکیج کامل محتوا» را بزنید.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
