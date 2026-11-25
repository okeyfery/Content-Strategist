import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  CalendarClock,
  ChevronDown,
  Compass,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Radar,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { auth, signOutUser } from './firebase';
import {
  createAuditReport,
  createBrand,
  createContentDraft,
  createOutlierItem,
  createWatchlistAccount,
  deleteAuditReport,
  deleteContentDraft,
  deleteOutlierItem,
  deleteWatchlistAccount,
  getActiveBrandId,
  setActiveBrandId,
  subscribeAuditReports,
  subscribeBrands,
  subscribeContentDrafts,
  subscribeOutliers,
  subscribeWatchlistAccounts,
  updateBrand,
  updateContentDraft,
  updateOutlierDeconstruction,
  updateWatchlistAccountCadence,
} from './services/firestoreService';
import type {
  AuditReport,
  Brand,
  ContentDraft,
  DiscoveredAccount,
  OutlierItem,
  PeriodWindow,
  WatchlistAccount,
} from './types';
import { AuthGate } from './components/AuthGate';
import { BrandModal } from './components/BrandModal';
import { ContentStudioView } from './components/ContentStudioView';
import { DiscoveryView } from './components/DiscoveryView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OutlierHunterView } from './components/OutlierHunterView';
import { OverviewView, type NavTab } from './components/OverviewView';
import { WatchlistView } from './components/WatchlistView';

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'نمای کلی و داشبورد', icon: LayoutDashboard },
  { id: 'discover', label: 'کشف کانال و رقیب', icon: Compass },
  { id: 'watchlist', label: 'واتچ‌لیست دوره‌ای', icon: CalendarClock },
  { id: 'outliers', label: 'شکارچی Outlier', icon: Flame },
  { id: 'studio', label: 'استودیو تولید محتوا', icon: Sparkles },
];

function StudioApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Core Cloud Entities
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsLoaded, setBrandsLoaded] = useState(false);
  const [activeBrandId, setActiveBrandIdState] = useState<string>('');
  const [accounts, setAccounts] = useState<WatchlistAccount[]>([]);
  const [outliers, setOutliers] = useState<OutlierItem[]>([]);
  const [reports, setReports] = useState<AuditReport[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);

  // UI Navigation & Modals
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandModalMode, setBrandModalMode] = useState<'create' | 'edit' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);

  // Cross-view handoff into Studio
  const [studioOutlier, setStudioOutlier] = useState<OutlierItem | null>(null);
  const [studioTopic, setStudioTopic] = useState('');

  if (runtimeError) {
    throw runtimeError;
  }

  // Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setBrands([]);
        setBrandsLoaded(false);
        setActiveBrandIdState('');
        setAccounts([]);
        setOutliers([]);
        setReports([]);
        setDrafts([]);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe Brands when signed in
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void getActiveBrandId(user.uid)
      .then((savedId) => {
        if (!cancelled && savedId) {
          setActiveBrandIdState(savedId);
        }
      })
      .catch(() => {
        // First time workspace doc may not exist yet
      });

    const unsub = subscribeBrands(
      user.uid,
      (list) => {
        setBrands(list);
        setBrandsLoaded(true);
        setActiveBrandIdState((prev) => {
          if (prev && list.some((b) => b.id === prev)) return prev;
          return list[0]?.id || '';
        });
      },
      (err) => setRuntimeError(err)
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeBrandId) || brands[0] || null,
    [brands, activeBrandId]
  );

  // Subscribe Brand-Scoped Collections
  useEffect(() => {
    if (!user || !activeBrand) {
      setAccounts([]);
      setOutliers([]);
      setReports([]);
      setDrafts([]);
      return;
    }

    const u1 = subscribeWatchlistAccounts(
      user.uid,
      activeBrand.id,
      setAccounts,
      (err) => setRuntimeError(err)
    );
    const u2 = subscribeOutliers(
      user.uid,
      activeBrand.id,
      setOutliers,
      (err) => setRuntimeError(err)
    );
    const u3 = subscribeAuditReports(
      user.uid,
      activeBrand.id,
      setReports,
      (err) => setRuntimeError(err)
    );
    const u4 = subscribeContentDrafts(
      user.uid,
      activeBrand.id,
      setDrafts,
      (err) => setRuntimeError(err)
    );

    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [user, activeBrand]);

  const handleSelectBrand = async (brandId: string) => {
    setActiveBrandIdState(brandId);
    setBrandMenuOpen(false);
    if (user) {
      try {
        await setActiveBrandId(user.uid, brandId);
      } catch {
        // Non-blocking preference sync
      }
    }
  };

  const handleSaveBrand = async (
    data: Omit<Brand, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => {
    if (!user) return;
    if (brandModalMode === 'edit' && activeBrand) {
      await updateBrand(user.uid, activeBrand.id, data);
    } else {
      const newId = await createBrand(user.uid, data);
      await handleSelectBrand(newId);
    }
  };

  const handleAddDiscoveredToWatchlist = async (acc: DiscoveredAccount) => {
    if (!user || !activeBrand) return;
    await createWatchlistAccount(user.uid, activeBrand.id, {
      platform: acc.platform,
      name: acc.name,
      handle: acc.handle,
      url: acc.url,
      category: acc.category,
      baselineViews: acc.estimatedBaselineViews,
      followersCount: acc.estimatedFollowers,
      cadence: '30d',
      contentStyle: acc.contentStyle,
      notes: acc.whyRelevant,
      lastAuditedAt: 'پایش‌نشده',
    });
  };

  const handleGenerateFromOutlier = useCallback((outlier: OutlierItem) => {
    setStudioOutlier(outlier);
    setStudioTopic('');
    setActiveTab('studio');
  }, []);

  const handleSendTopicToStudio = useCallback((topic: string) => {
    setStudioOutlier(null);
    setStudioTopic(topic);
    setActiveTab('studio');
  }, []);

  const handleClearPreselection = useCallback(() => {
    setStudioOutlier(null);
    setStudioTopic('');
  }, []);

  if (!authReady) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0B0F17] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[#94A3B8]">
          <Radar className="w-5 h-5 text-[#3B82F6] animate-spin" />
          <span>در حال اتصال به استودیو...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  const currentTabLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'نمای کلی';

  return (
    <div dir="rtl" className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex">
      {/* Persistent Right Sidebar (256px desktop, drawer on mobile) */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-64 bg-[#0E1420] border-l border-[#1F2937] flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 space-y-6">
          {/* App Brand Wordmark */}
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#60A5FA]">
                <Radar className="w-4 h-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
                رادار محتوا
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 text-[#94A3B8] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Active Brand Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setBrandMenuOpen((o) => !o)}
              className="w-full px-3 py-2.5 bg-[#111827] hover:bg-[#161F30] border border-[#1F2937] rounded-lg flex items-center justify-between gap-2 text-right transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-[11px] text-[#64748B]">برند فعال</p>
                <p className="text-xs font-semibold text-white truncate mt-0.5">
                  {activeBrand ? activeBrand.name : 'ساخت اولین برند'}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-[#94A3B8] shrink-0" />
            </button>

            {brandMenuOpen && (
              <div className="absolute left-0 right-0 mt-1.5 z-30 bg-[#111827] border border-[#2D3A4F] rounded-lg overflow-hidden shadow-xl">
                <div className="max-h-52 overflow-y-auto divide-y divide-[#1F2937]">
                  {brands.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectBrand(b.id)}
                      className={`w-full px-3.5 py-2.5 text-right text-xs transition-colors cursor-pointer flex items-center justify-between ${
                        b.id === activeBrand?.id
                          ? 'bg-[#3B82F6]/15 text-white font-semibold'
                          : 'text-[#CBD5E1] hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      <span className="text-[10px] text-[#64748B] truncate max-w-[90px]">{b.niche}</span>
                    </button>
                  ))}
                </div>
                <div className="border-t border-[#1F2937] p-1.5 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setBrandMenuOpen(false);
                      setBrandModalMode('create');
                    }}
                    className="w-full px-2.5 py-2 text-xs text-[#60A5FA] hover:bg-white/5 rounded-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    تعریف برند جدید
                  </button>
                  {activeBrand && (
                    <button
                      type="button"
                      onClick={() => {
                        setBrandMenuOpen(false);
                        setBrandModalMode('edit');
                      }}
                      className="w-full px-2.5 py-2 text-xs text-[#94A3B8] hover:text-white hover:bg-white/5 rounded-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      تنظیمات برند فعلی
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Primary Navigation */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#161F30] text-white'
                      : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-[#60A5FA]' : 'text-[#64748B]'}`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Account Footer */}
        <div className="p-4 border-t border-[#1F2937] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {user.displayName || 'کاربر استودیو'}
            </p>
            <p className="text-[11px] text-[#64748B] truncate font-mono" dir="ltr">
              {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="p-2 text-[#94A3B8] hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer shrink-0"
            title="خروج از حساب"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on right + 1 crisp CTA on left */}
        <header className="h-14 px-6 border-b border-[#1F2937] bg-[#0B0F17]/95 backdrop-blur-xs sticky top-0 z-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-[#94A3B8] hover:text-white rounded-md"
              aria-label="باز کردن منو"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-[#94A3B8] truncate">
              <span className="truncate">{activeBrand?.name || 'فضای کاری'}</span>
              <span className="text-[#475569]">/</span>
              <span className="text-white font-medium truncate">{currentTabLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setBrandModalMode('create')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#CBD5E1] hover:text-white bg-[#111827] border border-[#1F2937] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              برند جدید
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('outliers')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Flame className="w-3.5 h-3.5" />
              شکار Outlier
            </button>
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="flex-1 p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {!brandsLoaded ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 w-56 bg-[#111827] rounded" />
              <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-28 bg-[#111827] rounded-xl" />
                ))}
              </div>
            </div>
          ) : !activeBrand ? (
            <div className="max-w-lg mx-auto my-16 bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center space-y-4">
              <div className="w-11 h-11 rounded-xl bg-[#3B82F6]/15 border border-[#3B82F6]/30 text-[#60A5FA] flex items-center justify-center mx-auto">
                <Radar className="w-6 h-6" />
              </div>
              <h1 className="text-lg font-bold text-white">اولین برند خود را تعریف کنید</h1>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                برای شروع کشف کانال‌های مرتبط، ساخت واتچ‌لیست بازه زمانی، شکار ویدیوهای Outlier و تولید محتوای
                اختصاصی، ابتدا مشخصات اولین برند یا پروژه خود را ثبت کنید.
              </p>
              <button
                type="button"
                onClick={() => setBrandModalMode('create')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                ساخت اولین برند
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  brand={activeBrand}
                  accounts={accounts}
                  outliers={outliers}
                  reports={reports}
                  drafts={drafts}
                  onNavigate={setActiveTab}
                  onGenerateFromOutlier={handleGenerateFromOutlier}
                  onEditBrand={() => setBrandModalMode('edit')}
                />
              )}

              {activeTab === 'discover' && (
                <DiscoveryView
                  brand={activeBrand}
                  existingAccounts={accounts}
                  onAddToWatchlist={handleAddDiscoveredToWatchlist}
                />
              )}

              {activeTab === 'watchlist' && (
                <WatchlistView
                  brand={activeBrand}
                  accounts={accounts}
                  reports={reports}
                  onAddManualAccount={async (acc) => {
                    await createWatchlistAccount(user.uid, activeBrand.id, acc);
                  }}
                  onUpdateAccountCadence={async (accId, cadence: PeriodWindow, lastAuditedAt) => {
                    await updateWatchlistAccountCadence(user.uid, accId, cadence, lastAuditedAt);
                  }}
                  onDeleteAccount={async (accId) => {
                    await deleteWatchlistAccount(user.uid, accId);
                  }}
                  onSaveAuditReport={async (rep) => {
                    return createAuditReport(user.uid, activeBrand.id, rep);
                  }}
                  onDeleteAuditReport={async (repId) => {
                    await deleteAuditReport(user.uid, repId);
                  }}
                  onSendTopicToStudio={handleSendTopicToStudio}
                />
              )}

              {activeTab === 'outliers' && (
                <OutlierHunterView
                  brand={activeBrand}
                  accounts={accounts}
                  outliers={outliers}
                  onSaveOutlier={async (item) => {
                    return createOutlierItem(user.uid, activeBrand.id, item);
                  }}
                  onUpdateDeconstruction={async (id, analysis) => {
                    await updateOutlierDeconstruction(user.uid, id, analysis);
                  }}
                  onDeleteOutlier={async (id) => {
                    await deleteOutlierItem(user.uid, id);
                  }}
                  onGenerateFromOutlier={handleGenerateFromOutlier}
                />
              )}

              {activeTab === 'studio' && (
                <ContentStudioView
                  brand={activeBrand}
                  outliers={outliers}
                  drafts={drafts}
                  preselectedOutlier={studioOutlier}
                  preselectedTopic={studioTopic}
                  onClearPreselection={handleClearPreselection}
                  onSaveNewDraft={async (draft) => {
                    return createContentDraft(user.uid, activeBrand.id, draft);
                  }}
                  onUpdateDraft={async (draftId, patch) => {
                    await updateContentDraft(user.uid, draftId, patch);
                  }}
                  onDeleteDraft={async (draftId) => {
                    await deleteContentDraft(user.uid, draftId);
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Brand Create / Edit Modal */}
      {brandModalMode && (
        <BrandModal
          initialBrand={brandModalMode === 'edit' ? activeBrand : null}
          onClose={() => setBrandModalMode(null)}
          onSave={handleSaveBrand}
          dismissible={brands.length > 0}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StudioApp />
    </ErrorBoundary>
  );
}
