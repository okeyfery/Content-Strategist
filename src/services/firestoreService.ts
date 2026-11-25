import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  clipNum,
  clipStr,
  clipStringList,
  LIMITS,
  type AuditReport,
  type Brand,
  type BrandDefaultLanguage,
  type ContentDraft,
  type ContentLanguage,
  type DraftStatus,
  type GroundingSource,
  type OutlierItem,
  type OutlierSourceType,
  type PeriodWindow,
  type Platform,
  type WatchlistAccount,
} from '../types';

function makeSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function sanitizePlatform(p: unknown): Platform {
  if (p === 'youtube' || p === 'instagram' || p === 'tiktok' || p === 'linkedin' || p === 'x') {
    return p;
  }
  return 'youtube';
}

function sanitizePeriod(p: unknown): PeriodWindow {
  if (p === '7d' || p === '14d' || p === '30d' || p === '90d') return p;
  return '30d';
}

function sanitizeDefaultLang(l: unknown): BrandDefaultLanguage {
  if (l === 'fa' || l === 'en' || l === 'both') return l;
  return 'both';
}

function sanitizeContentLang(l: unknown): ContentLanguage {
  return l === 'en' ? 'en' : 'fa';
}

function sanitizeSourceType(s: unknown): OutlierSourceType {
  if (s === 'ai_discovery' || s === 'manual_entry' || s === 'csv_import' || s === 'url_analysis') {
    return s;
  }
  return 'manual_entry';
}

function sanitizeSources(sources: unknown): GroundingSource[] {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((item) => {
      const s = item as { title?: unknown; uri?: unknown };
      const uri = clipStr(s?.uri, 580);
      if (!uri) return null;
      return {
        title: clipStr(s?.title, 220) || uri.slice(0, 120),
        uri,
      };
    })
    .filter((s): s is GroundingSource => s !== null)
    .slice(0, 15);
}

// --- User Workspace (Active Brand Sync) ---

export async function getActiveBrandId(userId: string): Promise<string> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) {
      const data = snap.data() as { activeBrandId?: string };
      return data.activeBrandId || '';
    }
    return '';
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function setActiveBrandId(userId: string, activeBrandId: string): Promise<void> {
  const path = `users/${userId}`;
  const cleanBrandId = clipStr(activeBrandId, LIMITS.ID).replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    const ref = doc(db, 'users', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: userId,
        activeBrandId: cleanBrandId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        activeBrandId: cleanBrandId,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Brands ---

export function subscribeBrands(
  userId: string,
  onData: (brands: Brand[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/brands`;
  const q = query(
    collection(db, 'users', userId, 'brands'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: Brand[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Brand, 'id'>),
        }))
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createBrand(
  userId: string,
  input: Omit<Brand, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const brandId = makeSafeId('br');
  const path = `users/${userId}/brands/${brandId}`;
  const payload = {
    ownerId: userId,
    name: clipStr(input.name, LIMITS.BRAND_NAME) || 'برند جدید',
    niche: clipStr(input.niche, LIMITS.BRAND_NICHE) || 'عمومی',
    audience: clipStr(input.audience, LIMITS.BRAND_AUDIENCE),
    tone: clipStr(input.tone, LIMITS.BRAND_TONE),
    usp: clipStr(input.usp, LIMITS.BRAND_USP),
    forbiddenTerms: clipStr(input.forbiddenTerms, LIMITS.BRAND_FORBIDDEN),
    defaultLanguage: sanitizeDefaultLang(input.defaultLanguage),
    pillars: clipStringList(input.pillars, 10, 120),
    platforms: (input.platforms || ['youtube', 'instagram']).map(sanitizePlatform).slice(0, 5),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', userId, 'brands', brandId), payload);
    return brandId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBrand(
  userId: string,
  brandId: string,
  input: Omit<Brand, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${userId}/brands/${brandId}`;
  const payload = {
    name: clipStr(input.name, LIMITS.BRAND_NAME) || 'برند',
    niche: clipStr(input.niche, LIMITS.BRAND_NICHE) || 'عمومی',
    audience: clipStr(input.audience, LIMITS.BRAND_AUDIENCE),
    tone: clipStr(input.tone, LIMITS.BRAND_TONE),
    usp: clipStr(input.usp, LIMITS.BRAND_USP),
    forbiddenTerms: clipStr(input.forbiddenTerms, LIMITS.BRAND_FORBIDDEN),
    defaultLanguage: sanitizeDefaultLang(input.defaultLanguage),
    pillars: clipStringList(input.pillars, 10, 120),
    platforms: (input.platforms || ['youtube', 'instagram']).map(sanitizePlatform).slice(0, 5),
    updatedAt: serverTimestamp(),
  };
  try {
    await updateDoc(doc(db, 'users', userId, 'brands', brandId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteBrand(userId: string, brandId: string): Promise<void> {
  const path = `users/${userId}/brands/${brandId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'brands', brandId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Watchlist Accounts ---

export function subscribeWatchlistAccounts(
  userId: string,
  brandId: string,
  onData: (accounts: WatchlistAccount[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/watchlistAccounts`;
  const q = query(
    collection(db, 'users', userId, 'watchlistAccounts'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: WatchlistAccount[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WatchlistAccount, 'id'>),
        }))
        .filter((item) => item.brandId === brandId)
        .sort((a, b) => b.baselineViews - a.baselineViews);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createWatchlistAccount(
  userId: string,
  brandId: string,
  input: Omit<WatchlistAccount, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const accountId = makeSafeId('acc');
  const path = `users/${userId}/watchlistAccounts/${accountId}`;
  const payload = {
    ownerId: userId,
    brandId,
    platform: sanitizePlatform(input.platform),
    name: clipStr(input.name, LIMITS.ACCOUNT_NAME) || 'اکانت جدید',
    handle: clipStr(input.handle, LIMITS.ACCOUNT_HANDLE) || '@account',
    url: clipStr(input.url, LIMITS.URL),
    category: clipStr(input.category, LIMITS.CATEGORY) || 'عمومی',
    baselineViews: clipNum(input.baselineViews),
    followersCount: clipNum(input.followersCount),
    cadence: sanitizePeriod(input.cadence),
    contentStyle: clipStr(input.contentStyle, LIMITS.CONTENT_STYLE),
    notes: clipStr(input.notes, LIMITS.NOTES),
    lastAuditedAt: clipStr(input.lastAuditedAt, 64),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', userId, 'watchlistAccounts', accountId), payload);
    return accountId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateWatchlistAccountCadence(
  userId: string,
  accountId: string,
  cadence: PeriodWindow,
  lastAuditedAt: string
): Promise<void> {
  const path = `users/${userId}/watchlistAccounts/${accountId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'watchlistAccounts', accountId), {
      cadence: sanitizePeriod(cadence),
      lastAuditedAt: clipStr(lastAuditedAt, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWatchlistAccount(userId: string, accountId: string): Promise<void> {
  const path = `users/${userId}/watchlistAccounts/${accountId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'watchlistAccounts', accountId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Outliers ---

export function subscribeOutliers(
  userId: string,
  brandId: string,
  onData: (outliers: OutlierItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/outliers`;
  const q = query(
    collection(db, 'users', userId, 'outliers'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: OutlierItem[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OutlierItem, 'id'>),
        }))
        .filter((item) => item.brandId === brandId)
        .sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createOutlierItem(
  userId: string,
  brandId: string,
  input: Omit<OutlierItem, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const outlierId = makeSafeId('out');
  const path = `users/${userId}/outliers/${outlierId}`;
  const views = clipNum(input.views);
  const baselineViews = clipNum(input.baselineViews);
  const likes = clipNum(input.likes);
  const comments = clipNum(input.comments);
  const computedMultiplier =
    input.outlierMultiplier > 0
      ? clipNum(input.outlierMultiplier)
      : baselineViews > 0
        ? Math.round((views / baselineViews) * 10) / 10
        : 1;
  const computedEng =
    input.engagementRate > 0
      ? clipNum(input.engagementRate)
      : views > 0
        ? Math.round(((likes + comments) / views) * 10000) / 100
        : 0;

  const payload = {
    ownerId: userId,
    brandId,
    accountId: clipStr(input.accountId, LIMITS.ID).replace(/[^a-zA-Z0-9_-]/g, ''),
    accountName: clipStr(input.accountName, LIMITS.ACCOUNT_NAME) || 'کانال نامشخص',
    platform: sanitizePlatform(input.platform),
    format: clipStr(input.format, LIMITS.OUTLIER_FORMAT) || 'ویدیو',
    title: clipStr(input.title, LIMITS.OUTLIER_TITLE) || 'محتوای Outlier',
    url: clipStr(input.url, LIMITS.URL),
    publishedLabel: clipStr(input.publishedLabel, LIMITS.OUTLIER_PUBLISHED) || 'اخیر',
    views,
    baselineViews,
    outlierMultiplier: computedMultiplier,
    likes,
    comments,
    engagementRate: computedEng,
    hookPattern: clipStr(input.hookPattern, LIMITS.OUTLIER_HOOK),
    whyItWorked: clipStr(input.whyItWorked, LIMITS.OUTLIER_WHY),
    structureBreakdown: clipStr(input.structureBreakdown, LIMITS.OUTLIER_STRUCTURE),
    brandAdaptationIdea: clipStr(input.brandAdaptationIdea, LIMITS.OUTLIER_ADAPTATION),
    sourceType: sanitizeSourceType(input.sourceType),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', userId, 'outliers', outlierId), payload);
    return outlierId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateOutlierDeconstruction(
  userId: string,
  outlierId: string,
  analysis: {
    hookPattern: string;
    whyItWorked: string;
    structureBreakdown: string;
    brandAdaptationIdea: string;
  }
): Promise<void> {
  const path = `users/${userId}/outliers/${outlierId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'outliers', outlierId), {
      hookPattern: clipStr(analysis.hookPattern, LIMITS.OUTLIER_HOOK),
      whyItWorked: clipStr(analysis.whyItWorked, LIMITS.OUTLIER_WHY),
      structureBreakdown: clipStr(analysis.structureBreakdown, LIMITS.OUTLIER_STRUCTURE),
      brandAdaptationIdea: clipStr(analysis.brandAdaptationIdea, LIMITS.OUTLIER_ADAPTATION),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteOutlierItem(userId: string, outlierId: string): Promise<void> {
  const path = `users/${userId}/outliers/${outlierId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'outliers', outlierId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Audit Reports ---

export function subscribeAuditReports(
  userId: string,
  brandId: string,
  onData: (reports: AuditReport[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/auditReports`;
  const q = query(
    collection(db, 'users', userId, 'auditReports'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: AuditReport[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AuditReport, 'id'>),
        }))
        .filter((item) => item.brandId === brandId)
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createAuditReport(
  userId: string,
  brandId: string,
  input: Omit<AuditReport, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const reportId = makeSafeId('rep');
  const path = `users/${userId}/auditReports/${reportId}`;
  const payload = {
    ownerId: userId,
    brandId,
    period: sanitizePeriod(input.period),
    title: clipStr(input.title, LIMITS.REPORT_TITLE) || 'گزارش پایش دوره‌ای',
    executiveSummary: clipStr(input.executiveSummary, LIMITS.REPORT_SUMMARY),
    accountsReviewed: clipStringList(input.accountsReviewed, 25, 140),
    risingTopics: clipStringList(input.risingTopics, 12, 300),
    winningFormats: clipStringList(input.winningFormats, 10, 300),
    contentGaps: clipStringList(input.contentGaps, 10, 350),
    actionPlan: clipStringList(input.actionPlan, 12, 350),
    sources: sanitizeSources(input.sources),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', userId, 'auditReports', reportId), payload);
    return reportId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteAuditReport(userId: string, reportId: string): Promise<void> {
  const path = `users/${userId}/auditReports/${reportId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'auditReports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Content Drafts ---

export function subscribeContentDrafts(
  userId: string,
  brandId: string,
  onData: (drafts: ContentDraft[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/contentDrafts`;
  const q = query(
    collection(db, 'users', userId, 'contentDrafts'),
    where('ownerId', '==', userId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: ContentDraft[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ContentDraft, 'id'>),
        }))
        .filter((item) => item.brandId === brandId)
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export async function createContentDraft(
  userId: string,
  brandId: string,
  input: Omit<ContentDraft, 'id' | 'ownerId' | 'brandId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const draftId = makeSafeId('drf');
  const path = `users/${userId}/contentDrafts/${draftId}`;
  const status: DraftStatus =
    input.status === 'idea' || input.status === 'draft' || input.status === 'ready'
      ? input.status
      : 'draft';

  const payload = {
    ownerId: userId,
    brandId,
    sourceOutlierId: clipStr(input.sourceOutlierId, LIMITS.ID).replace(/[^a-zA-Z0-9_-]/g, ''),
    platform: sanitizePlatform(input.platform),
    format: clipStr(input.format, LIMITS.OUTLIER_FORMAT) || 'ویدیو کوتاه',
    language: sanitizeContentLang(input.language),
    topic: clipStr(input.topic, LIMITS.DRAFT_TOPIC) || 'موضوع محتوا',
    title: clipStr(input.title, LIMITS.DRAFT_TITLE) || 'پیش‌نویس جدید',
    hooks: clipStringList(input.hooks, 6, 480),
    bodyScript: clipStr(input.bodyScript, LIMITS.DRAFT_SCRIPT),
    caption: clipStr(input.caption, LIMITS.DRAFT_CAPTION),
    cta: clipStr(input.cta, LIMITS.DRAFT_CTA),
    visualConcept: clipStr(input.visualConcept, LIMITS.DRAFT_VISUAL),
    brandFitNotes: clipStr(input.brandFitNotes, LIMITS.DRAFT_FIT),
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', userId, 'contentDrafts', draftId), payload);
    return draftId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateContentDraft(
  userId: string,
  draftId: string,
  patch: Partial<
    Pick<
      ContentDraft,
      'title' | 'hooks' | 'bodyScript' | 'caption' | 'cta' | 'visualConcept' | 'brandFitNotes' | 'status'
    >
  >
): Promise<void> {
  const path = `users/${userId}/contentDrafts/${draftId}`;
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) updates.title = clipStr(patch.title, LIMITS.DRAFT_TITLE) || 'پیش‌نویس';
  if (patch.hooks !== undefined) updates.hooks = clipStringList(patch.hooks, 6, 480);
  if (patch.bodyScript !== undefined) updates.bodyScript = clipStr(patch.bodyScript, LIMITS.DRAFT_SCRIPT);
  if (patch.caption !== undefined) updates.caption = clipStr(patch.caption, LIMITS.DRAFT_CAPTION);
  if (patch.cta !== undefined) updates.cta = clipStr(patch.cta, LIMITS.DRAFT_CTA);
  if (patch.visualConcept !== undefined)
    updates.visualConcept = clipStr(patch.visualConcept, LIMITS.DRAFT_VISUAL);
  if (patch.brandFitNotes !== undefined)
    updates.brandFitNotes = clipStr(patch.brandFitNotes, LIMITS.DRAFT_FIT);
  if (patch.status !== undefined) updates.status = patch.status;

  try {
    await updateDoc(doc(db, 'users', userId, 'contentDrafts', draftId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteContentDraft(userId: string, draftId: string): Promise<void> {
  const path = `users/${userId}/contentDrafts/${draftId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'contentDrafts', draftId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Authenticated Per-User AI Cache (Synchronized with hardened aiCache rules) ---

export async function buildAICacheKey(
  queryType: 'discover' | 'hunt' | 'audit',
  payloadObj: unknown
): Promise<{ cacheKey: string; payloadHash: string }> {
  const raw = JSON.stringify(payloadObj);
  let hashHex = '';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    hashHex = Math.abs(h).toString(16);
  }
  const payloadHash = hashHex.slice(0, 64);
  const cacheKey = `${queryType}_${payloadHash}`.slice(0, 128).replace(/[^a-zA-Z0-9_-]/g, '_');
  return { cacheKey, payloadHash };
}

export async function getAICacheEntry<T>(
  userId: string,
  cacheKey: string,
  maxAgeSeconds = 86400
): Promise<T | null> {
  if (!userId || !cacheKey) return null;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'aiCache', cacheKey));
    if (!snap.exists()) return null;
    const data = snap.data() as { responseJson?: string; updatedAt?: { seconds?: number } };
    const updatedSec = data.updatedAt?.seconds ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (data.responseJson && (maxAgeSeconds <= 0 || nowSec - updatedSec < maxAgeSeconds)) {
      return JSON.parse(data.responseJson) as T;
    }
    return null;
  } catch (err) {
    console.warn('[Firestore aiCache Read]', err);
    return null;
  }
}

export async function setAICacheEntry(
  userId: string,
  cacheKey: string,
  queryType: 'discover' | 'hunt' | 'audit',
  payloadHash: string,
  responseObj: unknown
): Promise<void> {
  if (!userId || !cacheKey) return;
  try {
    const responseJson = JSON.stringify(responseObj);
    if (responseJson.length < 2 || responseJson.length > 48000) return;
    const ref = doc(db, 'users', userId, 'aiCache', cacheKey);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: userId,
        cacheKey,
        queryType,
        payloadHash: payloadHash.slice(0, 128),
        responseJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        payloadHash: payloadHash.slice(0, 128),
        responseJson,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('[Firestore aiCache Write]', err);
  }
}

export async function getAICacheCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const q = query(
      collection(db, 'users', userId, 'aiCache'),
      where('ownerId', '==', userId)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch (err) {
    console.warn('[Firestore aiCache Count]', err);
    return 0;
  }
}

