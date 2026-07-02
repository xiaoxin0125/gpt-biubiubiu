import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountModal from './components/AccountModal';
import AgnesWorkbench from './components/AgnesWorkbench';
import CustomSelect from './components/CustomSelect';
import ImageBoard from './components/ImageBoard';
import ImageDetailModal from './components/ImageDetailModal';
import InstallPanel from './components/InstallPanel';
import PromptTools from './components/PromptTools';
import ScrollTopButton from './components/ScrollTopButton';
import SizeDialog from './components/SizeDialog';
import Topbar from './components/Topbar';
import Workbench from './components/Workbench';
import {
  API_CONFIG_SCOPE_AGNES,
  API_CONFIG_SCOPE_IMAGE,
  API_CONFIG_SCOPE_PROMPT,
  boardFilterOptions,
  BOARD_LOAD_DELAY_MS,
  BOARD_PAGE_SIZE,
  defaultApiConfigForm,
  defaultApiConfigItem,
  defaultForm,
  defaultSiteFlags,
  defaultSizeDraft,
  emptyAuthForm,
  emptyPasswordForm,
  emptyProfileForm,
  MAX_MASK_SIZE_BYTES,
  MAX_REFERENCE_IMAGES,
  wallFilterOptions,
} from './constants/options';
import {
  apiConfigHasKeyForScope,
  apiConfigLabelForScope,
  apiConfigSupportsScope,
  normalizeApiConfigItem,
  normalizeServerSettings,
  requestJson,
} from './lib/api';
import {
  canRenderBoardItem,
  formatDuration,
  getImageIdentity,
  getMasonryColumns,
  isSameImageIdentity,
  normalizeBoardImage,
} from './lib/board';
import {
  normalizeForm,
  normalizeResponseFormat,
  normalizeVisibleRevisedPrompt,
} from './lib/form';
import {
  createHistoryRecordsFromGeneratedItems,
  flattenHistoryImages,
  mergeHistoryRecords,
  readHistory,
  removeImageFromHistory,
  saveHistory,
} from './lib/history';
import {
  createImageDownloadSrc,
  createImageSrc,
  getGeneratedImageJobId,
  imageMimeForOutputFormat,
  imageToSavePayload,
  normalizeImageSource,
  revokeObjectImageUrls,
} from './lib/images';
import { getAvailableRatios, getDraftSize, parseSize } from './lib/size';
import { useGeneration } from './hooks/useGeneration';
import { useApiConfig } from './hooks/useApiConfig';
import { useSession } from './hooks/useSession';
import { useBoard } from './hooks/useBoard';
import { findWallItem as findWallItemIn, useWall } from './hooks/useWall';

const mainBoardSources = new Set(['generation', 'edit']);
const agnesSources = new Set(['agnes-image', 'agnes-video']);

const getItemSource = (item, fallback) => normalizeImageSource(item?.source || item?.form?.source || fallback);
const isMainBoardItem = (item) => mainBoardSources.has(getItemSource(item));
const isAgnesItem = (item) => agnesSources.has(getItemSource(item));
const getHistoryImageSource = (image, record) => getItemSource(image, record?.form?.source);
const getBoardDedupeIdentity = (item) => {
  if (item?.mediaType === 'video' || getItemSource(item) === 'agnes-video') {
    return String(item?.videoId || item?.video_id || item?.requestId || item?.id || item?.videoUrl || item?.video_url || '');
  }
  return String(createImageSrc(item) || getImageIdentity(item) || '');
};
const uniqueByBoardIdentity = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const identity = getBoardDedupeIdentity(item);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};
const filterHistoryRecordImages = (records, predicate) => (records || [])
  .map((record) => ({
    ...record,
    images: (record.images || []).filter((image) => predicate(image, record)),
  }))
  .filter((record) => (record.images || []).length > 0);

if (typeof window !== 'undefined') window.addEventListener('beforeunload', revokeObjectImageUrls);

function App() {
  const [view, setView] = useState('generate');
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [historyNextCursor, setHistoryNextCursor] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [agnesHistoryNextCursor, setAgnesHistoryNextCursor] = useState('');
  const [agnesHistoryHasMore, setAgnesHistoryHasMore] = useState(false);
  const [images, setImages] = useState([]);
  const [wallItems, setWallItems] = useState([]);
  const [wallNextCursor, setWallNextCursor] = useState('');
  const [wallHasMore, setWallHasMore] = useState(false);
  const [referenceImages, setReferenceImages] = useState([]);
  const [maskImage, setMaskImage] = useState(null);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authTab, setAuthTab] = useState('profile');
  const [accountApiSettingsTab, setAccountApiSettingsTab] = useState(API_CONFIG_SCOPE_IMAGE);
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [apiConfigForm, setApiConfigForm] = useState(defaultApiConfigForm);
  const [selectedImage, setSelectedImage] = useState(null);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '检查接口中' });
  const [apiKeySyncing, setApiKeySyncing] = useState(false);
  const [apiModelOptionsByConfigId, setApiModelOptionsByConfigId] = useState({});
  const [apiModelLoadingByConfigId, setApiModelLoadingByConfigId] = useState({});
  const [runningGenerations, setRunningGenerations] = useState(0);
  const [error, setError] = useState('');
  const [activeDialog, setActiveDialog] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(defaultSizeDraft);
  const [wallBusyId, setWallBusyId] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');
  const [boardScope, setBoardScope] = useState('generate');
  const [openSelect, setOpenSelect] = useState('');
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [imageLayoutMeta, setImageLayoutMeta] = useState({});
  const [siteFlags, setSiteFlags] = useState(defaultSiteFlags);
  const [siteSettings, setSiteSettings] = useState({ ...defaultSiteFlags, sharedApi: {} });
  const [installStatus, setInstallStatus] = useState({ checking: true, needsInstall: false });
  const {
    boardVisibleCount,
    setBoardVisibleCount,
    boardLoadingMore,
    setBoardLoadingMore,
    masonryColumnCount,
    boardRef,
    boardLoadSentinelRef,
  } = useBoard();
  const deletedRequestIdsRef = useRef(new Set());
  const apiKeyVaultRef = useRef(new Map());
  const accountModalScrollRef = useRef(null);
  const detailModalScrollRef = useRef(null);
  const detailPanelScrollRef = useRef(null);
  const detailScrollRefs = useMemo(() => [detailPanelScrollRef, detailModalScrollRef], []);

  const hasReferenceImages = referenceImages.length > 0;
  const responseFormat = normalizeResponseFormat(form.response_format);
  const canUseOutputFormat = responseFormat === 'url';
  const isGenerating = runningGenerations > 0;
  const referenceNames = referenceImages.map((image, index) => `图${index + 1}:${image.name}`).join('，');
  const availableRatios = getAvailableRatios(sizeDraft.resolution);
  const activeSize = getDraftSize(sizeDraft);
  const displaySize = activeSize || '自动';
  const userDisplayName = user?.displayName || user?.username || '';
  const allHistoryItems = useMemo(() => flattenHistoryImages(history).filter(canRenderBoardItem), [history]);
  const mainHistoryRecords = useMemo(
    () => filterHistoryRecordImages(history, (image, record) => mainBoardSources.has(getHistoryImageSource(image, record))),
    [history],
  );
  const visibleImages = useMemo(() => images.filter(canRenderBoardItem).filter(isMainBoardItem), [images]);
  const historyImages = useMemo(() => uniqueByBoardIdentity(allHistoryItems.filter(isMainBoardItem)), [allHistoryItems]);
  const agnesHistoryItems = useMemo(() => uniqueByBoardIdentity(allHistoryItems.filter(isAgnesItem)), [allHistoryItems]);
  const allLocalImages = useMemo(() => uniqueByBoardIdentity([...visibleImages, ...historyImages]), [historyImages, visibleImages]);
  const sourceBoardItems = view === 'wall' ? wallItems : boardScope === 'history' ? historyImages : boardScope === 'generate' ? visibleImages : allLocalImages;
  const activeFilterOptions = view === 'wall' ? wallFilterOptions : boardFilterOptions;
  const activeBoardFilter = activeFilterOptions.some((option) => option.value === boardFilter) ? boardFilter : 'all';
  const activeApiConfig = useMemo(() => {
    const configs = Array.isArray(apiConfigForm.apiConfigs) && apiConfigForm.apiConfigs.length ? apiConfigForm.apiConfigs : [normalizeApiConfigItem(apiConfigForm)];
    const activeConfig = configs.find((item) => String(item.id) === String(apiConfigForm.activeApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_IMAGE)) || configs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_IMAGE)) || configs[0];
    return { ...activeConfig, requestTimeout: apiConfigForm.requestTimeout };
  }, [apiConfigForm]);
  const activePromptApiConfig = useMemo(() => {
    const configs = Array.isArray(apiConfigForm.apiConfigs) && apiConfigForm.apiConfigs.length ? apiConfigForm.apiConfigs : [normalizeApiConfigItem(apiConfigForm)];
    const activeConfig = configs.find((item) => String(item.id) === String(apiConfigForm.activePromptApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_PROMPT)) || configs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_PROMPT)) || activeApiConfig;
    return { ...activeConfig, requestTimeout: apiConfigForm.requestTimeout };
  }, [activeApiConfig, apiConfigForm]);
  const activeAgnesApiConfig = useMemo(() => {
    const configs = Array.isArray(apiConfigForm.apiConfigs) && apiConfigForm.apiConfigs.length ? apiConfigForm.apiConfigs : [normalizeApiConfigItem(apiConfigForm)];
    const activeConfig = configs.find((item) => String(item.id) === String(apiConfigForm.activeAgnesApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_AGNES)) || configs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_AGNES)) || activeApiConfig;
    return { ...activeConfig, requestTimeout: apiConfigForm.requestTimeout };
  }, [activeApiConfig, apiConfigForm]);
  const currentApiScope = view === 'prompt-tools' ? API_CONFIG_SCOPE_PROMPT : view === 'agnes' ? API_CONFIG_SCOPE_AGNES : API_CONFIG_SCOPE_IMAGE;
  const currentActiveApiConfig = currentApiScope === API_CONFIG_SCOPE_PROMPT ? activePromptApiConfig : currentApiScope === API_CONFIG_SCOPE_AGNES ? activeAgnesApiConfig : activeApiConfig;
  const currentScopeConfigured = apiConfigHasKeyForScope(currentActiveApiConfig, currentApiScope);
  const currentScopeFallbackName = currentApiScope === API_CONFIG_SCOPE_AGNES ? 'Agnes API' : currentApiScope === API_CONFIG_SCOPE_PROMPT ? '提示词助手 API' : (status.apiName || defaultApiConfigItem.apiName);
  const statusText = currentScopeConfigured ? apiConfigLabelForScope(currentActiveApiConfig, currentApiScope, currentScopeFallbackName) : (user ? `未配置${currentScopeFallbackName}` : status.message);
  const canSubmitGeneration = Boolean(user) && !apiKeySyncing && apiConfigHasKeyForScope(activeApiConfig, API_CONFIG_SCOPE_IMAGE);

  const { updateApiConfig, addApiConfig, removeApiConfig, resetDirectSettings } = useApiConfig({
    apiConfigForm,
    setApiConfigForm,
    activeApiConfig,
    setForm,
  });

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const renderSelect = (props) => (
    <CustomSelect
      {...props}
      openSelect={openSelect}
      setOpenSelect={setOpenSelect}
    />
  );

  const mergeDirectApiKey = (settings, apiKey, apiKeys = {}) => {
    const normalized = normalizeServerSettings(settings || {});
    const directApiKey = String(apiKey || apiKeys.imageApi || '').trim();
    const agnesApiKey = String(apiKeys.agnesApi || '').trim();

    if (directApiKey) {
      apiKeyVaultRef.current.set(String(normalized.activeApiConfigId), directApiKey);
      apiKeyVaultRef.current.set(`${normalized.activeApiConfigId}:imageApi`, directApiKey);
    }
    if (agnesApiKey) apiKeyVaultRef.current.set(`${normalized.activeAgnesApiConfigId}:agnesApi`, agnesApiKey);
    setApiConfigForm(normalized);
    setStatus((current) => ({
      ...current,
      loading: false,
      configured: Boolean(directApiKey),
      apiName: normalized.apiName,
      message: directApiKey ? normalized.apiName : 'API Key 同步失败，请重新登录或重新保存。',
    }));
  };

  const syncDirectApiKey = async (settings) => {
    const normalized = normalizeServerSettings(settings || {});
    const hasOwnDirectKey = Boolean(
      (!normalized.isShared && normalized.hasApiKey)
      || (!normalized.activeAgnesConfig?.isShared && normalized.activeAgnesConfig?.agnesApi?.hasApiKey)
    );
    if (!hasOwnDirectKey) return normalized;

    setApiKeySyncing(true);
    try {
      const data = await requestJson('/api/settings/direct');
      mergeDirectApiKey(data.settings || normalized, data.apiKey || '', data.apiKeys || {});
      return normalizeServerSettings(data.settings || normalized);
    } finally {
      setApiKeySyncing(false);
    }
  };

  const applyServerSettings = (settings, nextUser = user) => {
    const normalized = normalizeServerSettings(settings || {});

    setForm((current) => ({ ...current, model: normalized.model || current.model }));
    setApiConfigForm(normalized);
    setStatus((current) => ({
      ...current,
      loading: false,
      configured: Boolean(normalized.hasApiKey),
      apiName: normalized.apiName,
      message: nextUser ? (normalized.hasApiKey ? normalized.apiName : '未配置 API Key') : '请先登录',
    }));
  };

  const switchActiveApiConfig = async (configId, apiScope = API_CONFIG_SCOPE_IMAGE) => {
    if (!user) {
      setError('请先登录后再切换 API。');
      return;
    }

    try {
      const data = await requestJson('/api/settings/active-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeApiConfigId: configId, category: apiScope }),
      });
      const normalized = normalizeServerSettings(data.settings || {});
      const nextActiveConfig = apiScope === API_CONFIG_SCOPE_PROMPT
        ? (normalized.apiConfigs || []).find((item) => String(item.id) === String(normalized.activePromptApiConfigId)) || normalized.activePromptConfig || normalized
        : apiScope === API_CONFIG_SCOPE_AGNES
          ? (normalized.apiConfigs || []).find((item) => String(item.id) === String(normalized.activeAgnesApiConfigId)) || normalized.activeAgnesConfig || normalized
          : normalized;
      setApiConfigForm(normalized);
      if (apiScope === API_CONFIG_SCOPE_IMAGE) setForm((current) => ({ ...current, model: normalized.model || current.model }));
      setStatus((current) => ({
        ...current,
        loading: false,
        configured: apiConfigHasKeyForScope(nextActiveConfig, apiScope),
        apiName: apiConfigLabelForScope(nextActiveConfig, apiScope, normalized.apiName),
        message: apiConfigHasKeyForScope(nextActiveConfig, apiScope) ? apiConfigLabelForScope(nextActiveConfig, apiScope, normalized.apiName) : '未配置 API Key',
      }));
      if (apiScope === API_CONFIG_SCOPE_IMAGE && normalized.hasApiKey) await syncDirectApiKey(normalized);
      if (apiScope === API_CONFIG_SCOPE_AGNES && nextActiveConfig?.agnesApi?.hasApiKey) await syncDirectApiKey(normalized);
      setOpenSelect('');
      setError('');
    } catch (switchError) {
      setStatus((current) => ({ ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' }));
      setError(switchError instanceof Error ? switchError.message : '切换 API 失败');
    }
  };

  const loadSiteSettings = async () => {
    try {
      const data = await requestJson('/api/admin/site-settings');
      if (data.site) setSiteSettings({ ...data.site, sharedApi: data.site.sharedApi || {} });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '网站设置加载失败');
    }
  };

  const saveSiteSettings = async () => {
    try {
      const data = await requestJson('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallRequireLogin: siteSettings.wallRequireLogin,
          registrationEnabled: siteSettings.registrationEnabled,
          sharedApiEnabled: siteSettings.sharedApiEnabled,
          sharedAgnesApiEnabled: siteSettings.sharedAgnesApiEnabled,
          promptToolsEnabled: siteSettings.promptToolsEnabled,
          sharedApi: {
            imageApi: {
              ...(siteSettings.sharedApi?.imageApi || {}),
              confirmApiKeySave: Boolean(siteSettings.sharedApi?.imageApi?.apiKey),
            },
            promptApi: {
              ...(siteSettings.sharedApi?.promptApi || {}),
              confirmApiKeySave: Boolean(siteSettings.sharedApi?.promptApi?.apiKey),
            },
            agnesApi: {
              ...(siteSettings.sharedApi?.agnesApi || {}),
              confirmApiKeySave: Boolean(siteSettings.sharedApi?.agnesApi?.apiKey),
            },
          },
        }),
      });
      if (data.site) {
        setSiteSettings({ ...data.site, sharedApi: data.site.sharedApi || {} });
        setSiteFlags({
          wallRequireLogin: Boolean(data.site.wallRequireLogin),
          registrationEnabled: Boolean(data.site.registrationEnabled),
          sharedApiEnabled: Boolean(data.site.sharedApiEnabled),
          sharedAgnesApiEnabled: Boolean(data.site.sharedAgnesApiEnabled),
          promptToolsEnabled: Boolean(data.site.promptToolsEnabled),
        });
      }
      setError('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '网站设置保存失败');
    }
  };

  const wallLocked = siteFlags.wallRequireLogin && !user;

  const loadWall = useCallback(async ({ append = false, resetBoard = true } = {}) => {
    if (wallLocked) {
      setWallItems([]);
      setWallNextCursor('');
      setWallHasMore(false);
      return;
    }

    const cursor = append ? wallNextCursor : '';
    if (append && !cursor) return;
    if (!append && resetBoard) {
      setBoardVisibleCount(BOARD_PAGE_SIZE);
      if (boardRef.current) boardRef.current.scrollTop = 0;
    }

    try {
      const query = new URLSearchParams({ limit: String(Math.max(BOARD_PAGE_SIZE * 2, 40)) });
      if (cursor) query.set('cursor', cursor);
      const data = await requestJson(`/api/wall?${query.toString()}`);
      const nextItems = Array.isArray(data.items) ? data.items : [];

      setWallItems((current) => {
        if (!append) return nextItems;
        const seenIds = new Set(current.map((item) => String(item.id || item.wallItemId || createImageSrc(item))));
        return [
          ...current,
          ...nextItems.filter((item) => !seenIds.has(String(item.id || item.wallItemId || createImageSrc(item)))),
        ];
      });
      setWallHasMore(Boolean(data.hasMore));
      setWallNextCursor(data.nextCursor ? String(data.nextCursor) : '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '作品墙加载失败');
    }
  }, [wallLocked, wallNextCursor, setBoardVisibleCount, boardRef]);

  const syncGeneratedImages = useCallback(async ({ append = false, user: syncUser = user } = {}) => {
    if (!syncUser) {
      setHistory(readHistory());
      setHistoryNextCursor('');
      setHistoryHasMore(false);
      setAgnesHistoryNextCursor('');
      setAgnesHistoryHasMore(false);
      return;
    }

    const cursor = append ? historyNextCursor : '';
    if (append && !cursor) return;

    try {
      const query = new URLSearchParams({ limit: String(Math.max(BOARD_PAGE_SIZE * 2, 40)) });
      if (cursor) query.set('cursor', cursor);
      const data = await requestJson(`/api/generated-images?${query.toString()}`);
      const generatedItems = Array.isArray(data.items) ? data.items : [];
      const syncedRecords = createHistoryRecordsFromGeneratedItems(generatedItems);

      setHistory((current) => {
        const currentHistory = current.length ? current : readHistory();
        const nextHistory = mergeHistoryRecords(currentHistory, syncedRecords);
        saveHistory(nextHistory);
        return nextHistory;
      });
      setHistoryHasMore(Boolean(data.hasMore));
      setHistoryNextCursor(data.nextCursor ? String(data.nextCursor) : '');
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : '生成作品同步失败';
      if (message !== '请先登录') setError(message);
    }
  }, [historyNextCursor, user]);

  const syncAgnesGeneratedImages = useCallback(async ({ append = false, user: syncUser = user } = {}) => {
    if (!syncUser) {
      setAgnesHistoryNextCursor('');
      setAgnesHistoryHasMore(false);
      return;
    }

    const cursor = append ? agnesHistoryNextCursor : '';
    if (append && !cursor) return;

    try {
      const query = new URLSearchParams({
        scope: 'agnes-image',
        limit: String(Math.max(BOARD_PAGE_SIZE * 2, 40)),
      });
      if (cursor) query.set('cursor', cursor);
      const data = await requestJson(`/api/generated-images?${query.toString()}`);
      const generatedItems = Array.isArray(data.items) ? data.items : [];
      const syncedRecords = createHistoryRecordsFromGeneratedItems(generatedItems);

      setHistory((current) => {
        const currentHistory = current.length ? current : readHistory();
        const nextHistory = mergeHistoryRecords(currentHistory, syncedRecords);
        saveHistory(nextHistory);
        return nextHistory;
      });
      setAgnesHistoryHasMore(Boolean(data.hasMore));
      setAgnesHistoryNextCursor(data.nextCursor ? String(data.nextCursor) : '');
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Agnes 历史同步失败';
      if (message !== '请先登录') setError(message);
    }
  }, [agnesHistoryNextCursor, user]);

  const refreshBoard = async () => {
    if (!user) {
      setHistory(readHistory());
      setHistoryNextCursor('');
      setHistoryHasMore(false);
      setAgnesHistoryNextCursor('');
      setAgnesHistoryHasMore(false);
      return;
    }

    await Promise.all([syncGeneratedImages(), loadWall({ resetBoard: view === 'wall' })]);
  };

  const loadMoreGeneratedImages = useCallback(
    () => syncGeneratedImages({ append: true }),
    [syncGeneratedImages],
  );

  const refreshGeneratedImages = useCallback(
    () => syncGeneratedImages(),
    [syncGeneratedImages],
  );

  const loadMoreAgnesGeneratedImages = useCallback(
    () => syncAgnesGeneratedImages({ append: true }),
    [syncAgnesGeneratedImages],
  );

  const refreshAgnesGeneratedImages = useCallback(
    () => syncAgnesGeneratedImages(),
    [syncAgnesGeneratedImages],
  );

  useEffect(() => {
    let cancelled = false;

    const resetSignedOutState = () => {
      saveHistory([]);
      apiKeyVaultRef.current.clear();
      setImages([]);
      setHistory([]);
      setHistoryNextCursor('');
      setHistoryHasMore(false);
      setAgnesHistoryNextCursor('');
      setAgnesHistoryHasMore(false);
      setSelectedImage(null);
      setBoardScope('generate');
      setApiConfigForm(defaultApiConfigForm);
      setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
    };

    const initialize = async () => {
      setHistory(readHistory());

      try {
        const install = await requestJson('/api/install/status');
        if (cancelled) return;
        setInstallStatus({ ...install, checking: false });
        if (install.needsInstall) {
          setStatus((current) => ({ ...current, loading: false, configured: false, message: '需要完成安装配置' }));
          return;
        }
      } catch (installError) {
        if (cancelled) return;
        setInstallStatus({
          checking: false,
          needsInstall: true,
          message: installError instanceof Error ? installError.message : '安装状态检查失败',
        });
        setStatus((current) => ({ ...current, loading: false, configured: false, message: '需要完成安装配置' }));
        return;
      }

      requestJson('/api/health')
        .then((data) => {
          if (cancelled) return;
          if (data.site) {
            setSiteFlags({
              wallRequireLogin: Boolean(data.site.wallRequireLogin),
              registrationEnabled: Boolean(data.site.registrationEnabled),
              sharedApiEnabled: Boolean(data.site.sharedApiEnabled),
              sharedAgnesApiEnabled: Boolean(data.site.sharedAgnesApiEnabled),
              promptToolsEnabled: Boolean(data.site.promptToolsEnabled),
            });
          }
        })
        .catch(() => {});

      requestJson('/api/auth/me')
        .then((data) => {
          if (cancelled) return;
          const nextUser = data.user || null;
          setUser(nextUser);
          if (nextUser) {
            applyServerSettings(data.settings, nextUser);
            const normalizedSettings = normalizeServerSettings(data.settings || {});
            if (normalizedSettings.hasApiKey || normalizedSettings.activeAgnesConfig?.agnesApi?.hasApiKey) syncDirectApiKey(normalizedSettings).catch(() => {
              setStatus((current) => ({ ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' }));
            });
            syncGeneratedImages({ user: nextUser });
            syncAgnesGeneratedImages({ user: nextUser });
          } else {
            resetSignedOutState();
          }
        })
        .catch(() => {
          if (cancelled) return;
          resetSignedOutState();
        });
    };

    initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view === 'wall') loadWall();
  }, [view, user, siteFlags.wallRequireLogin]);

  useEffect(() => {
    if (view === 'prompt-tools' && siteFlags.promptToolsEnabled === false) setView('generate');
  }, [siteFlags.promptToolsEnabled, view]);

  useEffect(() => {
    if (user) return;
    setHistoryNextCursor('');
    setHistoryHasMore(false);
    setAgnesHistoryNextCursor('');
    setAgnesHistoryHasMore(false);
  }, [user]);

  useEffect(() => {
    setProfileForm({ displayName: user?.displayName || user?.username || '' });
  }, [user]);

  useEffect(() => {
    if (user?.isAdmin) loadSiteSettings();
  }, [user?.isAdmin]);

  useEffect(() => {
    if (view === 'wall' && !wallFilterOptions.some((option) => option.value === boardFilter)) setBoardFilter('all');
  }, [boardFilter, view]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!error) return undefined;

    const timer = window.setTimeout(() => setError(''), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!openSelect) return undefined;

    const closeOpenSelect = (event) => {
      if (event.target instanceof Element && event.target.closest('.custom-select-field')) return;
      setOpenSelect('');
    };

    document.addEventListener('pointerdown', closeOpenSelect);
    return () => document.removeEventListener('pointerdown', closeOpenSelect);
  }, [openSelect]);

  const findWallItem = (image) => findWallItemIn(wallItems, image);

  const boardItems = sourceBoardItems.filter((image) => {
    const wallItem = findWallItem(image);
    const text = [
      image.prompt,
      image.revised_prompt,
      image.form?.prompt,
      image.form?.size,
      image.form?.quality,
      image.form?.output_format,
      image.authorName,
      image.referenceName,
      image.status,
      image.error,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const keyword = boardSearch.trim().toLowerCase();

    if (keyword && !text.includes(keyword)) return false;
    if (activeBoardFilter === 'on-wall') return Boolean(wallItem);
    if (activeBoardFilter === 'off-wall') return !wallItem;
    if (activeBoardFilter === 'generation') return normalizeImageSource(image.source) === 'generation';
    if (activeBoardFilter === 'edit') return normalizeImageSource(image.source) === 'edit';
    return true;
  });
  const renderableBoardItems = boardItems.filter(canRenderBoardItem);
  const visibleBoardItems = renderableBoardItems.slice(0, boardVisibleCount);
  const hasMoreLoadedBoardItems = visibleBoardItems.length < renderableBoardItems.length;
  const hasMoreHistoryItems = Boolean(user && view === 'generate' && ['all', 'history'].includes(boardScope) && historyHasMore);
  const hasMoreBoardItems = hasMoreLoadedBoardItems || (view === 'wall' && wallHasMore) || hasMoreHistoryItems;
  const masonryColumns = useMemo(
    () => getMasonryColumns(visibleBoardItems, masonryColumnCount, imageLayoutMeta),
    [imageLayoutMeta, masonryColumnCount, visibleBoardItems],
  );

  const isSameImage = isSameImageIdentity;
  const serverPagedBoard = view === 'wall' || Boolean(user && view === 'generate' && ['all', 'history'].includes(boardScope));
  const boardResetSourceLength = serverPagedBoard ? 0 : sourceBoardItems.length;

  useEffect(() => {
    setBoardVisibleCount(BOARD_PAGE_SIZE);
    setBoardLoadingMore(false);
    if (boardRef.current) boardRef.current.scrollTop = 0;
  }, [activeBoardFilter, boardScope, boardSearch, boardResetSourceLength, view]);

  useEffect(() => {
    if (!hasMoreBoardItems || boardLoadingMore) return undefined;

    const loadNextPage = () => {
      setBoardLoadingMore(true);
      if (hasMoreLoadedBoardItems) {
        window.setTimeout(() => {
          setBoardVisibleCount((count) => Math.min(count + BOARD_PAGE_SIZE, renderableBoardItems.length));
          setBoardLoadingMore(false);
        }, BOARD_LOAD_DELAY_MS);
        return;
      }

      if (view === 'wall' && wallHasMore) {
        loadWall({ append: true }).finally(() => setBoardLoadingMore(false));
        return;
      }

      if (hasMoreHistoryItems) {
        syncGeneratedImages({ append: true }).finally(() => setBoardLoadingMore(false));
        return;
      }

      setBoardLoadingMore(false);
    };

    const sentinel = boardLoadSentinelRef.current;
    const board = boardRef.current;
    const usePageScroll = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const scrollRoot = usePageScroll ? null : board;

    if (sentinel && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
      }, { root: scrollRoot, rootMargin: '260px 0px 260px 0px' });
      observer.observe(sentinel);
      return () => observer.disconnect();
    }

    const scrollTarget = usePageScroll ? window : board;
    if (!scrollTarget) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        if (usePageScroll) {
          const doc = document.documentElement;
          if (window.innerHeight + window.scrollY >= doc.scrollHeight - 260) loadNextPage();
        } else if (board && board.scrollTop + board.clientHeight >= board.scrollHeight - 260) {
          loadNextPage();
        }
      });
    };
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', onScroll);
  }, [boardLoadingMore, hasMoreBoardItems, hasMoreHistoryItems, hasMoreLoadedBoardItems, loadWall, renderableBoardItems.length, syncGeneratedImages, view, wallHasMore]);

  const openSizeDialog = () => {
    if (!form.size) {
      setSizeDraft((draft) => ({ ...draft, mode: 'auto' }));
      setActiveDialog('size');
      return;
    }

    const current = parseSize(form.size);
    setSizeDraft((draft) => ({
      ...draft,
      customWidth: current.width,
      customHeight: current.height,
    }));
    setActiveDialog('size');
  };

  const applySize = () => {
    updateForm('size', activeSize);
    setActiveDialog(null);
  };

  const clearHistory = async () => {
    if (!historyImages.length || !window.confirm('确认清空历史记录？')) return;

    const previousHistory = history;
    const previousHistoryNextCursor = historyNextCursor;
    const previousHistoryHasMore = historyHasMore;
    const nextHistory = filterHistoryRecordImages(history, (image, record) => !mainBoardSources.has(getHistoryImageSource(image, record)));
    setHistory(nextHistory);
    setHistoryNextCursor('');
    setHistoryHasMore(false);
    saveHistory(nextHistory);
    if (boardScope === 'history') setSelectedImage(null);

    if (!user) return;
    try {
      await requestJson('/api/generated-images', { method: 'DELETE' });
    } catch (deleteError) {
      setHistory(previousHistory);
      setHistoryNextCursor(previousHistoryNextCursor);
      setHistoryHasMore(previousHistoryHasMore);
      saveHistory(previousHistory);
      setError(deleteError instanceof Error ? deleteError.message : '服务端历史记录删除失败');
    }
  };

  const persistAgnesImageResults = useCallback(async ({ requestId, images: agnesImages = [], form: resultForm = {}, prompt = '', apiName = '', startedAt = '', finishedAt = '', durationSeconds = null }) => {
    if (!user) return agnesImages;

    const source = normalizeImageSource(resultForm.source || 'agnes-image');
    const computedDurationSeconds = startedAt && finishedAt ? Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000) : null;
    const safeDurationSeconds = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Math.floor(Number(durationSeconds))
      : Number.isFinite(computedDurationSeconds) && computedDurationSeconds > 0
        ? computedDurationSeconds
        : null;
    const saveForm = { ...resultForm, apiName, source };
    if (startedAt) saveForm.startedAt = startedAt;
    if (finishedAt) saveForm.finishedAt = finishedAt;
    if (safeDurationSeconds !== null) saveForm.durationSeconds = safeDurationSeconds;
    const savedImages = [];

    for (const image of agnesImages) {
      const imagePayload = imageToSavePayload(image, imageMimeForOutputFormat(saveForm.output_format));
      const saved = await requestJson('/api/generated-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          mode: source,
          image: imagePayload,
          prompt,
          revised_prompt: normalizeVisibleRevisedPrompt(prompt, image.revised_prompt),
          form: saveForm,
          params: saveForm,
          startedAt: saveForm.startedAt,
          finishedAt: saveForm.finishedAt,
          durationSeconds: saveForm.durationSeconds,
        }),
      });

      savedImages.push(normalizeBoardImage({
        ...image,
        ...(saved.item || {}),
        upstreamImageId: image.upstreamImageId || image.id || '',
        source,
        apiName,
        prompt,
        form: saveForm,
      }));
    }

    if (!savedImages.length) return agnesImages;

    const record = {
      id: requestId,
      form: saveForm,
      images: savedImages,
      createdAt: savedImages[0]?.createdAt || new Date().toISOString(),
    };

    setHistory((items) => {
      const nextHistory = mergeHistoryRecords(items, [record]);
      saveHistory(nextHistory);
      return nextHistory;
    });

    return savedImages;
  }, [user]);

  const persistAgnesVideoTask = useCallback((task) => {
    const source = 'agnes-video';
    const videoId = String(task?.videoId || task?.video_id || '').trim();
    const videoUrl = String(task?.videoUrl || task?.video_url || task?.url || '').trim();
    const requestId = String(task?.requestId || task?.id || (videoId ? `agnes-video-${videoId}` : '')).trim();
    if (!requestId) return task;

    const form = {
      ...(task.form || {}),
      prompt: task.prompt || task.form?.prompt || '',
      size: task.form?.size || task.size || (task.width && task.height ? `${task.width}x${task.height}` : ''),
      response_format: 'url',
      responseFormat: 'url',
      source,
      videoId,
    };
    const savedTask = {
      id: requestId,
      requestId,
      status: task.status || (videoUrl ? 'completed' : 'running'),
      rawStatus: task.rawStatus || '',
      source,
      mediaType: 'video',
      prompt: task.prompt || form.prompt || '',
      apiName: task.apiName || form.apiName || '',
      videoId,
      videoUrl,
      url: '',
      image_url: '',
      mode: task.mode || form.mode || '',
      width: task.width || form.width || '',
      height: task.height || form.height || '',
      frameRate: task.frameRate || form.frameRate || '',
      numFrames: task.numFrames || form.numFrames || '',
      progress: task.progress || '',
      seconds: task.seconds || '',
      error: task.error || '',
      createdAt: task.createdAt || new Date().toISOString(),
      startedAt: task.startedAt || task.createdAt || '',
      updatedAt: task.updatedAt || new Date().toISOString(),
      finishedAt: task.finishedAt || null,
      form,
    };
    const record = {
      id: requestId,
      form,
      images: [savedTask],
      createdAt: savedTask.createdAt,
    };

    setHistory((items) => {
      const nextHistory = mergeHistoryRecords(items, [record]);
      saveHistory(nextHistory);
      return nextHistory;
    });

    return savedTask;
  }, []);

  const deleteImage = async (image) => {
    if (!image) return;

    const removeFromAgnes = typeof image.removeFromAgnes === 'function' ? image.removeFromAgnes : null;
    const jobId = getGeneratedImageJobId(image);

    if (removeFromAgnes && !jobId) {
      if (!window.confirm('确认删除这个 Agnes 作品记录？')) return;
      removeFromAgnes();
      const nextHistory = removeImageFromHistory(history, image, isSameImage);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setSelectedImage((current) => (current && isSameImage(current, image) ? null : current));
      if (selectedImage && isSameImage(selectedImage, image)) setActiveDialog(null);
      return;
    }

    if (!window.confirm(image?.mediaType === 'video' || image?.source === 'agnes-video' ? '确认删除这个视频记录？' : '确认删除这张图片记录？')) return;

    const requestId = image.requestId || image.id;
    if (requestId) deletedRequestIdsRef.current.add(requestId);

    const previousImages = images;
    const previousHistory = history;
    const previousSelectedImage = selectedImage;
    const previousDialog = activeDialog;
    setImages((items) => items.filter((item) => !isSameImage(item, image)));
    const nextHistory = removeImageFromHistory(history, image, isSameImage);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    setSelectedImage((current) => (current && isSameImage(current, image) ? null : current));
    if (selectedImage && isSameImage(selectedImage, image)) setActiveDialog(null);

    if (!user || !jobId) return;

    try {
      await requestJson(`/api/generated-images/${jobId}`, { method: 'DELETE' });
      if (removeFromAgnes) removeFromAgnes();
    } catch (deleteError) {
      setImages(previousImages);
      setHistory(previousHistory);
      saveHistory(previousHistory);
      setSelectedImage(previousSelectedImage);
      setActiveDialog(previousDialog);
      if (requestId) deletedRequestIdsRef.current.delete(requestId);
      setError(deleteError instanceof Error ? deleteError.message : '服务端图片记录删除失败');
    }
  };

  const openDetail = (image) => {
    setSelectedImage(image);
    setActiveDialog('detail');
  };

  const closeDialog = () => {
    setActiveDialog(null);
    setSelectedImage(null);
    setOpenSelect('');
  };

  const getRequestStartedAtMs = (item) => {
    const value = String(item?.requestId || item?.request_id || item?.id || '').trim();
    const matched = value.match(/^(?:request|agnes-image|agnes-video)-(\d{10,})/);
    if (!matched) return null;
    const timestamp = Number(matched[1]);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return timestamp > 1e12 ? timestamp : timestamp * 1000;
  };

  const getElapsedSeconds = (item) => {
    if (!item) return null;
    const explicitDuration = item.durationSeconds ?? item.duration_seconds ?? item.form?.durationSeconds ?? item.form?.duration_seconds;
    if (explicitDuration !== undefined && explicitDuration !== null && explicitDuration !== '') {
      const explicitSeconds = Math.floor(Number(explicitDuration));
      return Number.isFinite(explicitSeconds) && explicitSeconds > 0 ? explicitSeconds : null;
    }

    const startedAt = item.startedAt || item.started_at || item.form?.startedAt || item.form?.started_at || '';
    const finishedAt = item.finishedAt || item.finished_at || item.completedAt || item.completed_at || item.form?.finishedAt || item.form?.finished_at || '';
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : getRequestStartedAtMs(item);
    const finishedAtMs = finishedAt ? new Date(finishedAt).getTime() : new Date(item.createdAt || item.created_at || '').getTime();
    if (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs) && finishedAtMs > startedAtMs) {
      return Math.max(1, Math.floor((finishedAtMs - startedAtMs) / 1000));
    }

    if (item.status === 'pending' || item.status === 'running') {
      const pendingStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : new Date(item.createdAt || Date.now()).getTime();
      return Number.isFinite(pendingStartedAtMs) ? Math.max(0, Math.floor((nowTick - pendingStartedAtMs) / 1000)) : null;
    }
    return null;
  };

  const { checkWallState, toggleWall } = useWall({
    wallItems,
    setWallItems,
    user,
    form,
    activeApiConfig,
    status,
    getElapsedSeconds,
    setImages,
    setHistory,
    setSelectedImage,
    setWallBusyId,
    setError,
  });

  const handleReferenceChange = (event) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;

    setReferenceImages((current) => {
      const remaining = Math.max(0, MAX_REFERENCE_IMAGES - current.length);
      const nextFiles = files.slice(0, remaining).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      }));

      if (files.length > remaining) setError(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张，已保留前 ${MAX_REFERENCE_IMAGES} 张。`);
      return [...current, ...nextFiles];
    });
    event.target.value = '';
  };

  const handleMaskChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/png') {
      setError('mask 必须是 PNG 图片。');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_MASK_SIZE_BYTES) {
      setError('mask 文件必须小于 4MB。');
      event.target.value = '';
      return;
    }

    if (maskImage?.previewUrl) URL.revokeObjectURL(maskImage.previewUrl);
    setMaskImage({ file, name: file.name, previewUrl: URL.createObjectURL(file) });
    event.target.value = '';
  };

  const removeReference = (id) => {
    const willClearMask = referenceImages.length === 1 && referenceImages[0]?.id === id;
    setReferenceImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
    if (willClearMask && maskImage?.previewUrl) {
      URL.revokeObjectURL(maskImage.previewUrl);
      setMaskImage(null);
    }
  };

  const clearReference = () => {
    referenceImages.forEach((image) => {
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    });
    if (maskImage?.previewUrl) URL.revokeObjectURL(maskImage.previewUrl);
    setReferenceImages([]);
    setMaskImage(null);
  };

  const clearMask = () => {
    if (maskImage?.previewUrl) URL.revokeObjectURL(maskImage.previewUrl);
    setMaskImage(null);
  };

  const fetchApiModels = async (configId, categoryKey = 'imageApi') => {
    const modelKey = `${configId}:${categoryKey}`;
    const rawConfigId = String(configId);
    const isSharedSiteConfig = rawConfigId === 'shared';
    const config = isSharedSiteConfig
      ? { ...(siteSettings.sharedApi || {}), id: 'shared' }
      : (apiConfigForm.apiConfigs || []).find((item) => String(item.id) === rawConfigId);
    const category = config?.[categoryKey] || (categoryKey === 'imageApi' ? config : {});
    const apiCategory = categoryKey === 'promptApi' ? 'prompt' : categoryKey === 'agnesApi' ? 'agnes' : 'image';
    if (!config) {
      setError('API 配置不存在。');
      return;
    }

    setApiModelLoadingByConfigId((current) => ({ ...current, [modelKey]: true }));
    setError('');

    try {
      const data = await requestJson('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: config.id,
          category: apiCategory,
          apiBaseUrl: category.apiBaseUrl,
          apiKey: category.apiKey || '',
          requestTimeout: category.requestTimeout || apiConfigForm.requestTimeout,
        }),
      });
      const models = Array.isArray(data.models) ? data.models : [];
      const options = models
        .map((model) => (typeof model === 'string' ? model : model?.id || model?.value || model?.model || ''))
        .map((model) => String(model).trim())
        .filter(Boolean)
        .filter((model, index, list) => list.indexOf(model) === index)
        .map((model) => ({ label: model, value: model }));

      setApiModelOptionsByConfigId((current) => ({ ...current, [modelKey]: options }));
      if (!options.length) {
        setError('没有获取到可用模型。');
        return;
      }
      if (!String(category.model || '').trim()) {
        if (isSharedSiteConfig) {
          setSiteSettings((current) => ({
            ...current,
            sharedApi: {
              ...(current.sharedApi || {}),
              [categoryKey]: { ...((current.sharedApi || {})[categoryKey] || {}), model: options[0].value },
            },
          }));
        } else {
          setApiConfigForm((current) => ({
            ...current,
            apiConfigs: (current.apiConfigs || []).map((item) => (
              String(item.id) === rawConfigId
                ? {
                    ...item,
                    [categoryKey]: { ...(item[categoryKey] || {}), model: options[0].value },
                    ...(categoryKey === 'imageApi' ? { model: options[0].value } : {}),
                    ...(categoryKey === 'promptApi' ? { promptModel: options[0].value } : {}),
                    ...(categoryKey === 'agnesApi' ? { agnesModel: options[0].value } : {}),
                  }
                : item
            )),
          }));
        }
      }
    } catch (modelError) {
      setApiModelOptionsByConfigId((current) => ({ ...current, [modelKey]: [] }));
      setError(modelError instanceof Error ? modelError.message : '获取模型失败');
    } finally {
      setApiModelLoadingByConfigId((current) => ({ ...current, [modelKey]: false }));
    }
  };

  const { generate } = useGeneration({
    form,
    hasReferenceImages,
    referenceNames,
    activeApiConfig,
    status,
    apiConfigForm,
    apiKeyVaultRef,
    deletedRequestIdsRef,
    referenceImages,
    maskImage,
    user,
    syncDirectApiKey,
    setError,
    setRunningGenerations,
    setStatus,
    setView,
    setBoardScope,
    setImages,
    setSelectedImage,
    setHistory,
  });

  const { submitAuth, logout, saveAccountSettings, saveProfile, changePassword } = useSession({
    authMode,
    authForm,
    profileForm,
    passwordForm,
    apiConfigForm,
    activeApiConfig,
    user,
    apiKeySyncing,
    apiKeyVaultRef,
    applyServerSettings,
    syncDirectApiKey,
    syncGeneratedImages,
    setUser,
    setError,
    setImages,
    setHistory,
    setWallItems,
    setSelectedImage,
    setBoardScope,
    setBoardFilter,
    setProfileForm,
    setPasswordForm,
    setApiConfigForm,
    setApiKeySyncing,
    setApiModelOptionsByConfigId,
    setApiModelLoadingByConfigId,
    setStatus,
    setForm,
    setAuthForm,
    setAuthTab,
    setActiveDialog,
  });

  const reuseConfig = (image) => {
    if (image?.form) setForm(normalizeForm(image.form));
    setView('generate');
    setBoardScope('generate');
    closeDialog();
  };

  const detailParams = selectedImage?.form || form;
  const detailMediaType = selectedImage?.mediaType === 'video' ? 'video' : 'image';
  const detailSrc = detailMediaType === 'image' ? createImageSrc(selectedImage) : '';
  const detailVideoSrc = detailMediaType === 'video' ? String(selectedImage?.videoUrl || selectedImage?.url || '').trim() : '';
  const detailDownloadSrc = detailMediaType === 'video' && /^https?:\/\//i.test(detailVideoSrc) ? detailVideoSrc : detailMediaType === 'image' ? createImageDownloadSrc(selectedImage) : '';
  const detailIsFailed = selectedImage?.status === 'failed' && !detailSrc && !detailVideoSrc;
  const detailIsPending = ['pending', 'running'].includes(selectedImage?.status) && !detailSrc && !detailVideoSrc;
  const detailInputPrompt = selectedImage?.prompt || detailParams.prompt || '';
  const detailRevisedPrompt = normalizeVisibleRevisedPrompt(detailInputPrompt, selectedImage?.revised_prompt);
  const detailElapsedSeconds = selectedImage ? getElapsedSeconds(selectedImage) : null;
  const detailElapsed = detailElapsedSeconds === null ? '' : formatDuration(detailElapsedSeconds);
  const selectedWallItem = detailSrc ? findWallItem(selectedImage) : null;
  const selectedOnWall = Boolean(selectedWallItem);
  const selectedOwnerId = selectedImage?.userId || selectedImage?.user_id || selectedWallItem?.userId || selectedWallItem?.user_id || null;
  const selectedJobId = getGeneratedImageJobId(selectedImage);
  const canManageSelectedWall = Boolean(user && (user.isAdmin || (selectedOwnerId && Number(selectedOwnerId) === Number(user.id)) || (!selectedOnWall && selectedJobId)));
  const busySelected = selectedImage && wallBusyId === String(selectedImage.wallItemId || selectedImage.id || detailSrc);
  const modalFrameClassByDialog = {
    auth: 'modal-frame account-modal-frame',
    detail: 'modal-frame detail-modal-frame',
    size: 'modal-frame size-modal-frame',
  };
  const modalFrameClass = modalFrameClassByDialog[activeDialog] || 'modal-frame';

  if (installStatus.checking) {
    return (
      <main className="playground-shell install-shell">
        <section className="modal-card install-card">
          <div className="modal-head install-head">
            <div>
              <h2>检查站点配置</h2>
              <p>正在确认 MySQL 与运行密钥是否可用。</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (installStatus.needsInstall) {
    return (
      <main className="playground-shell install-shell">
        <InstallPanel installStatus={installStatus} onInstalled={() => window.setTimeout(() => window.location.reload(), 900)} />
      </main>
    );
  }

  return (
    <main className="playground-shell">
      {error ? <div className="error-toast" role="alert">{error}</div> : null}

      <Topbar
        view={view}
        setView={setView}
        user={user}
        userDisplayName={userDisplayName}
        status={status}
        statusText={statusText}
        activeApiConfig={activeApiConfig}
        activePromptApiConfig={activePromptApiConfig}
        activeAgnesApiConfig={activeAgnesApiConfig}
        apiConfigForm={apiConfigForm}
        siteFlags={siteFlags}
        switchActiveApiConfig={switchActiveApiConfig}
        renderSelect={renderSelect}
        openAccount={() => {
          setAccountApiSettingsTab(API_CONFIG_SCOPE_IMAGE);
          setAuthTab('profile');
          setActiveDialog('auth');
        }}
      />

      {view === 'generate' || view === 'wall' ? (
        <ImageBoard
          view={view}
          boardScope={boardScope}
          setBoardScope={setBoardScope}
          boardFilter={boardFilter}
          setBoardFilter={setBoardFilter}
          activeBoardFilter={activeBoardFilter}
          boardSearch={boardSearch}
          setBoardSearch={setBoardSearch}
          renderSelect={renderSelect}
          loadWall={loadWall}
          refreshHistory={refreshBoard}
          clearHistory={clearHistory}
          history={mainHistoryRecords}
          renderableBoardItems={renderableBoardItems}
          masonryColumnCount={masonryColumnCount}
          masonryColumns={masonryColumns}
          boardRef={boardRef}
          boardLoadSentinelRef={boardLoadSentinelRef}
          hasMoreBoardItems={hasMoreBoardItems}
          boardLoadingMore={boardLoadingMore}
          imageLayoutMeta={imageLayoutMeta}
          setImageLayoutMeta={setImageLayoutMeta}
          openDetail={openDetail}
          deleteImage={deleteImage}
          status={status}
          activeApiConfig={activeApiConfig}
          userDisplayName={userDisplayName}
          wallLocked={wallLocked}
        />
      ) : null}

      {view === 'generate' || view === 'wall' ? (
        <ScrollTopButton
          targetRef={boardRef}
          className={view === 'generate' ? 'is-page is-generate-board' : 'is-page'}
          refreshKey={`${view}-${renderableBoardItems.length}`}
        />
      ) : null}

      {view === 'prompt-tools' ? (
        <PromptTools
          user={user}
          siteFlags={siteFlags}
          renderSelect={renderSelect}
          setView={setView}
          updateForm={updateForm}
          setError={setError}
        />
      ) : null}

      {view === 'agnes' ? (
        <AgnesWorkbench
          user={user}
          activeAgnesApiConfig={activeAgnesApiConfig}
          apiConfigForm={apiConfigForm}
          apiKeyVaultRef={apiKeyVaultRef}
          syncDirectApiKey={syncDirectApiKey}
          renderSelect={renderSelect}
          setError={setError}
          openAccount={() => {
            setAccountApiSettingsTab(API_CONFIG_SCOPE_AGNES);
            setAuthTab('settings');
            setActiveDialog('auth');
          }}
          openDetail={openDetail}
          deleteImage={deleteImage}
          persistImageResults={persistAgnesImageResults}
          persistVideoTask={persistAgnesVideoTask}
          historyImages={agnesHistoryItems}
          historyHasMore={agnesHistoryHasMore}
          loadMoreHistory={loadMoreAgnesGeneratedImages}
          refreshHistory={refreshAgnesGeneratedImages}
        />
      ) : null}

      {view === 'generate' ? (
        <Workbench
          form={form}
          updateForm={updateForm}
          generate={generate}
          workbenchExpanded={workbenchExpanded}
          setWorkbenchExpanded={setWorkbenchExpanded}
          openSizeDialog={openSizeDialog}
          renderSelect={renderSelect}
          responseFormat={responseFormat}
          canUseOutputFormat={canUseOutputFormat}
          hasReferenceImages={hasReferenceImages}
          referenceNames={referenceNames}
          referenceImages={referenceImages}
          maskImage={maskImage}
          canSubmitGeneration={canSubmitGeneration}
          isGenerating={isGenerating}
          handleReferenceChange={handleReferenceChange}
          handleMaskChange={handleMaskChange}
          removeReference={removeReference}
          clearMask={clearMask}
          clearReference={clearReference}
        />
      ) : null}

      {activeDialog ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={closeDialog} />

          <div className={modalFrameClass}>
            <button type="button" className="close-button modal-close-button" aria-label="关闭弹窗" onClick={closeDialog}>×</button>

            {activeDialog === 'detail' && selectedImage ? (
            <ImageDetailModal
              selectedImage={selectedImage}
              view={view}
              detailParams={detailParams}
              detailMediaType={detailMediaType}
              detailSrc={detailSrc}
              detailDownloadSrc={detailDownloadSrc}
              detailIsFailed={detailIsFailed}
              detailIsPending={detailIsPending}
              detailInputPrompt={detailInputPrompt}
              detailRevisedPrompt={detailRevisedPrompt}
              detailElapsed={detailElapsed}
              selectedOnWall={selectedOnWall}
              canManageSelectedWall={canManageSelectedWall}
              busySelected={busySelected}
              reuseConfig={reuseConfig}
              checkWallState={checkWallState}
              deleteImage={deleteImage}
              toggleWall={toggleWall}
              detailModalRef={detailModalScrollRef}
              detailPanelRef={detailPanelScrollRef}
            />
          ) : null}

          {activeDialog === 'auth' ? (
            <AccountModal
              user={user}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authTab={authTab}
              setAuthTab={setAuthTab}
              initialApiSettingsTab={accountApiSettingsTab}
              authForm={authForm}
              setAuthForm={setAuthForm}
              profileForm={profileForm}
              setProfileForm={setProfileForm}
              passwordForm={passwordForm}
              setPasswordForm={setPasswordForm}
              apiConfigForm={apiConfigForm}
              setApiConfigForm={setApiConfigForm}
              userDisplayName={userDisplayName}
              submitAuth={submitAuth}
              saveProfile={saveProfile}
              changePassword={changePassword}
              logout={logout}
              updateApiConfig={updateApiConfig}
              removeApiConfig={removeApiConfig}
              addApiConfig={addApiConfig}
              resetDirectSettings={resetDirectSettings}
              saveAccountSettings={saveAccountSettings}
              fetchApiModels={fetchApiModels}
              apiModelOptionsByConfigId={apiModelOptionsByConfigId}
              apiModelLoadingByConfigId={apiModelLoadingByConfigId}
              renderSelect={renderSelect}
              siteFlags={siteFlags}
              siteSettings={siteSettings}
              setSiteSettings={setSiteSettings}
              saveSiteSettings={saveSiteSettings}
              scrollRef={accountModalScrollRef}
            />
          ) : null}

          {activeDialog === 'size' ? (
            <SizeDialog
              sizeDraft={sizeDraft}
              setSizeDraft={setSizeDraft}
              availableRatios={availableRatios}
              displaySize={displaySize}
              closeDialog={closeDialog}
              applySize={applySize}
            />
          ) : null}

          {activeDialog === 'auth' ? (
            <ScrollTopButton targetRef={accountModalScrollRef} className="is-modal" refreshKey={authTab} />
          ) : null}

          {activeDialog === 'detail' ? (
            <ScrollTopButton
              targetRefs={detailScrollRefs}
              className="is-modal"
              refreshKey={selectedImage?.id || detailSrc || ''}
            />
          ) : null}
          </div>

        </div>
      ) : null}
    </main>
  );
}

export default App;