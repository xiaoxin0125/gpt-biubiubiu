import { useEffect, useMemo, useRef, useState } from 'react';
import AccountModal from './components/AccountModal';
import CustomSelect from './components/CustomSelect';
import ImageBoard from './components/ImageBoard';
import ImageDetailModal from './components/ImageDetailModal';
import PromptTools from './components/PromptTools';
import SizeDialog from './components/SizeDialog';
import Topbar from './components/Topbar';
import Workbench from './components/Workbench';
import {
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
  normalizeRevisedPrompt,
} from './lib/form';
import {
  flattenHistoryImages,
  readHistory,
  removeImageFromHistory,
  saveHistory,
} from './lib/history';
import {
  createImageDownloadSrc,
  createImageSrc,
  getGeneratedImageJobId,
  normalizeImageSource,
  revokeObjectImageUrls,
} from './lib/images';
import { getAvailableRatios, getDraftSize, parseSize } from './lib/size';
import { applyWallPatch } from './lib/optimistic';
import { useGeneration } from './hooks/useGeneration';
import { useApiConfig } from './hooks/useApiConfig';
import { useSession } from './hooks/useSession';
import { useBoard } from './hooks/useBoard';
import { findWallItem as findWallItemIn, useWall } from './hooks/useWall';

if (typeof window !== 'undefined') window.addEventListener('beforeunload', revokeObjectImageUrls);

function App() {
  const [view, setView] = useState('generate');
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [images, setImages] = useState([]);
  const [wallItems, setWallItems] = useState([]);
  const [referenceImages, setReferenceImages] = useState([]);
  const [maskImage, setMaskImage] = useState(null);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authTab, setAuthTab] = useState('profile');
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

  const hasReferenceImages = referenceImages.length > 0;
  const responseFormat = normalizeResponseFormat(form.response_format);
  const canUseOutputFormat = responseFormat === 'url';
  const isGenerating = runningGenerations > 0;
  const referenceNames = referenceImages.map((image, index) => `图${index + 1}:${image.name}`).join('，');
  const availableRatios = getAvailableRatios(sizeDraft.resolution);
  const activeSize = getDraftSize(sizeDraft);
  const displaySize = activeSize || '自动';
  const userDisplayName = user?.displayName || user?.username || '';
  const visibleImages = useMemo(() => images.filter(canRenderBoardItem), [images]);
  const historyImages = useMemo(() => flattenHistoryImages(history).filter(canRenderBoardItem), [history]);
  const allLocalImages = useMemo(() => {
    const seen = new Set();
    return [...visibleImages, ...historyImages].filter((image) => {
      const identity = getImageIdentity(image);
      if (!identity) return true;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [historyImages, visibleImages]);
  const sourceBoardItems = view === 'wall' ? wallItems : boardScope === 'history' ? historyImages : boardScope === 'generate' ? visibleImages : allLocalImages;
  const activeFilterOptions = view === 'wall' ? wallFilterOptions : boardFilterOptions;
  const activeBoardFilter = activeFilterOptions.some((option) => option.value === boardFilter) ? boardFilter : 'all';
  const activeApiConfig = useMemo(() => {
    const configs = Array.isArray(apiConfigForm.apiConfigs) && apiConfigForm.apiConfigs.length ? apiConfigForm.apiConfigs : [normalizeApiConfigItem(apiConfigForm)];
    const activeConfig = configs.find((item) => String(item.id) === String(apiConfigForm.activeApiConfigId)) || configs[0];
    return { ...activeConfig, requestTimeout: apiConfigForm.requestTimeout };
  }, [apiConfigForm]);
  const statusText = status.configured ? (status.apiName || activeApiConfig?.apiName || status.message || defaultApiConfigItem.apiName) : status.message;
  const canSubmitGeneration = Boolean(user) && !apiKeySyncing && (status.configured || Boolean(activeApiConfig?.hasApiKey));

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

  const mergeDirectApiKey = (settings, apiKey) => {
    const normalized = normalizeServerSettings(settings || {});
    const directApiKey = String(apiKey || '').trim();

    if (directApiKey) apiKeyVaultRef.current.set(String(normalized.activeApiConfigId), directApiKey);
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
    if (!normalized.hasApiKey) return normalized;

    setApiKeySyncing(true);
    try {
      const data = await requestJson('/api/settings/direct');
      mergeDirectApiKey(data.settings || normalized, data.apiKey || '');
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

  const switchActiveApiConfig = async (configId) => {
    if (!user) {
      setError('请先登录后再切换 API。');
      return;
    }

    try {
      const data = await requestJson('/api/settings/active-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeApiConfigId: configId }),
      });
      const normalized = normalizeServerSettings(data.settings || {});
      setApiConfigForm(normalized);
      setForm((current) => ({ ...current, model: normalized.model || current.model }));
      setStatus((current) => ({
        ...current,
        loading: false,
        configured: Boolean(normalized.hasApiKey),
        apiName: normalized.apiName,
        message: normalized.hasApiKey ? normalized.apiName : '未配置 API Key',
      }));
      if (normalized.hasApiKey) await syncDirectApiKey(normalized);
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
          promptToolsEnabled: siteSettings.promptToolsEnabled,
          sharedApi: {
            apiName: siteSettings.sharedApi?.apiName,
            apiBaseUrl: siteSettings.sharedApi?.apiBaseUrl,
            model: siteSettings.sharedApi?.model,
            promptModel: siteSettings.sharedApi?.promptModel,
            visionModel: siteSettings.sharedApi?.visionModel,
            apiKey: siteSettings.sharedApi?.apiKey,
            clearApiKey: Boolean(siteSettings.sharedApi?.clearApiKey),
          },
        }),
      });
      if (data.site) {
        setSiteSettings({ ...data.site, sharedApi: data.site.sharedApi || {} });
        setSiteFlags({
          wallRequireLogin: Boolean(data.site.wallRequireLogin),
          registrationEnabled: Boolean(data.site.registrationEnabled),
          sharedApiEnabled: Boolean(data.site.sharedApiEnabled),
          promptToolsEnabled: Boolean(data.site.promptToolsEnabled),
        });
      }
      setError('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '网站设置保存失败');
    }
  };

  const wallLocked = siteFlags.wallRequireLogin && !user;

  const loadWall = async () => {
    if (wallLocked) {
      setWallItems([]);
      return;
    }
    try {
      const data = await requestJson('/api/wall');
      setWallItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '作品墙加载失败');
    }
  };

  const syncGeneratedImages = async () => {
    try {
      const data = await requestJson('/api/generated-images');
      const generatedItems = Array.isArray(data.items) ? data.items : [];
      const recordsByRequest = new Map();

      generatedItems.forEach((item) => {
        const requestId = item.requestId || item.request_id || `job-${item.jobId || item.id}`;
        const formDraft = normalizeForm({ ...(item.form || {}), prompt: item.prompt || item.form?.prompt || '' });
        const image = normalizeBoardImage({
          ...item,
          id: item.id || `job-${item.jobId}`,
          requestId,
          status: 'completed',
          url: item.url || item.image_url || '',
          image_url: item.image_url || item.url || '',
          downloadUrl: item.downloadUrl || item.originalUrl || item.original_url || '',
          originalUrl: item.originalUrl || item.downloadUrl || item.original_url || '',
          b64_json: item.url || item.image_url ? '' : item.b64_json || '',
          form: formDraft,
          prompt: item.prompt || formDraft.prompt || '',
          source: normalizeImageSource(item.source),
          isOnWall: Boolean(item.wallItemId),
          createdAt: item.createdAt || item.completedAt || item.finishedAt || new Date().toISOString(),
        });

        if (!recordsByRequest.has(requestId)) {
          recordsByRequest.set(requestId, {
            id: requestId,
            form: formDraft,
            images: [],
            createdAt: image.createdAt,
          });
        }

        recordsByRequest.get(requestId).images.push(image);
      });

      const syncedRecords = Array.from(recordsByRequest.values())
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

      setHistory((current) => {
        const currentHistory = current.length ? current : readHistory();
        const syncedIds = new Set(syncedRecords.map((record) => record.id));
        const retainedHistory = currentHistory
          .filter((record) => !syncedIds.has(record.id));
        const nextHistory = [...syncedRecords, ...retainedHistory].slice(0, 30);
        saveHistory(nextHistory);
        return nextHistory;
      });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : '生成作品同步失败';
      if (message !== '请先登录') setError(message);
    }
  };

  const refreshBoard = async () => {
    if (!user) {
      setHistory(readHistory());
      return;
    }

    await Promise.all([syncGeneratedImages(), loadWall()]);
  };

  useEffect(() => {
    setHistory(readHistory());

    requestJson('/api/health')
      .then((data) => {
        if (data.site) {
          setSiteFlags({
            wallRequireLogin: Boolean(data.site.wallRequireLogin),
            registrationEnabled: Boolean(data.site.registrationEnabled),
            sharedApiEnabled: Boolean(data.site.sharedApiEnabled),
            promptToolsEnabled: Boolean(data.site.promptToolsEnabled),
          });
        }
      })
      .catch(() => {});

    requestJson('/api/auth/me')
      .then((data) => {
        const nextUser = data.user || null;
        setUser(nextUser);
        if (nextUser) {
          applyServerSettings(data.settings, nextUser);
          const normalizedSettings = normalizeServerSettings(data.settings || {});
          if (normalizedSettings.hasApiKey) syncDirectApiKey(normalizedSettings).catch(() => {
            setStatus((current) => ({ ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' }));
          });
          syncGeneratedImages();
        } else {
          saveHistory([]);
          apiKeyVaultRef.current.clear();
          setImages([]);
          setHistory([]);
          setSelectedImage(null);
          setBoardScope('generate');
          setApiConfigForm(defaultApiConfigForm);
          setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
        }
      })
      .catch(() => {
        saveHistory([]);
        apiKeyVaultRef.current.clear();
        setImages([]);
        setHistory([]);
        setSelectedImage(null);
        setBoardScope('generate');
        setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
      });
  }, []);

  useEffect(() => {
    if (view === 'wall') loadWall();
  }, [view, user, siteFlags.wallRequireLogin]);

  useEffect(() => {
    if (view === 'prompt-tools' && siteFlags.promptToolsEnabled === false) setView('generate');
  }, [siteFlags.promptToolsEnabled, view]);

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
  const hasMoreBoardItems = visibleBoardItems.length < renderableBoardItems.length;
  const masonryColumns = useMemo(
    () => getMasonryColumns(visibleBoardItems, masonryColumnCount, imageLayoutMeta),
    [imageLayoutMeta, masonryColumnCount, visibleBoardItems],
  );

  const isSameImage = isSameImageIdentity;

  useEffect(() => {
    setBoardVisibleCount(BOARD_PAGE_SIZE);
    setBoardLoadingMore(false);
    if (boardRef.current) boardRef.current.scrollTop = 0;
  }, [activeBoardFilter, boardScope, boardSearch, sourceBoardItems.length, view]);

  useEffect(() => {
    if (!hasMoreBoardItems || boardLoadingMore) return undefined;

    const loadNextPage = () => {
      setBoardLoadingMore(true);
      window.setTimeout(() => {
        setBoardVisibleCount((count) => Math.min(count + BOARD_PAGE_SIZE, renderableBoardItems.length));
        setBoardLoadingMore(false);
      }, BOARD_LOAD_DELAY_MS);
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
  }, [boardLoadingMore, hasMoreBoardItems, renderableBoardItems.length]);

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
    if (!history.length || !window.confirm('确认清空历史记录？')) return;

    const previousHistory = history;
    setHistory([]);
    saveHistory([]);
    if (boardScope === 'history') setSelectedImage(null);

    if (!user) return;
    try {
      await requestJson('/api/generated-images', { method: 'DELETE' });
    } catch (deleteError) {
      setHistory(previousHistory);
      saveHistory(previousHistory);
      setError(deleteError instanceof Error ? deleteError.message : '服务端历史记录删除失败');
    }
  };

  const deleteImage = async (image) => {
    if (!image || !window.confirm('确认删除这张图片记录？')) return;

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

    const jobId = getGeneratedImageJobId(image);
    if (!user || !jobId) return;

    try {
      await requestJson(`/api/generated-images/${jobId}`, { method: 'DELETE' });
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

  const getElapsedSeconds = (item) => {
    if (!item) return null;
    if (item.durationSeconds !== undefined && item.durationSeconds !== null && item.durationSeconds !== '') return Math.max(0, Math.floor(Number(item.durationSeconds) || 0));
    if (item.finishedAt && (item.startedAt || item.createdAt)) {
      return Math.max(0, Math.floor((new Date(item.finishedAt).getTime() - new Date(item.startedAt || item.createdAt).getTime()) / 1000));
    }
    if (item.status === 'pending') {
      return Math.max(0, Math.floor((nowTick - new Date(item.startedAt || item.createdAt || Date.now()).getTime()) / 1000));
    }
    return null;
  };

  const { clearWallState, checkWallState, toggleWall } = useWall({
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

  const fetchApiModels = async (configId) => {
    const modelKey = String(configId);
    const isSharedSiteConfig = modelKey === 'shared';
    const config = isSharedSiteConfig
      ? { ...(siteSettings.sharedApi || {}), id: 'shared' }
      : (apiConfigForm.apiConfigs || []).find((item) => String(item.id) === modelKey);
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
          apiBaseUrl: config.apiBaseUrl,
          apiKey: config.apiKey || '',
          requestTimeout: apiConfigForm.requestTimeout,
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
      if (!String(config.model || '').trim()) {
        if (isSharedSiteConfig) {
          setSiteSettings((current) => ({
            ...current,
            sharedApi: { ...(current.sharedApi || {}), model: options[0].value },
          }));
        } else {
          updateApiConfig(config.id, 'model', options[0].value);
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
  const detailSrc = createImageSrc(selectedImage);
  const detailDownloadSrc = createImageDownloadSrc(selectedImage);
  const detailIsFailed = selectedImage?.status === 'failed' && !detailSrc;
  const detailIsPending = selectedImage?.status === 'pending' && !detailSrc;
  const detailInputPrompt = selectedImage?.prompt || detailParams.prompt || '';
  const detailRevisedPrompt = normalizeRevisedPrompt(selectedImage?.revised_prompt);
  const detailElapsedSeconds = selectedImage ? getElapsedSeconds(selectedImage) : null;
  const detailElapsed = detailElapsedSeconds === null ? '' : formatDuration(detailElapsedSeconds);
  const selectedWallItem = detailSrc ? findWallItem(selectedImage) : null;
  const selectedOnWall = Boolean(selectedWallItem);
  const selectedOwnerId = selectedImage?.userId || selectedImage?.user_id || selectedWallItem?.userId || selectedWallItem?.user_id || null;
  const selectedJobId = getGeneratedImageJobId(selectedImage);
  const canManageSelectedWall = Boolean(user && (user.isAdmin || (selectedOwnerId && Number(selectedOwnerId) === Number(user.id)) || (!selectedOnWall && selectedJobId)));
  const busySelected = selectedImage && wallBusyId === String(selectedImage.wallItemId || selectedImage.id || detailSrc);

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
        apiConfigForm={apiConfigForm}
        siteFlags={siteFlags}
        switchActiveApiConfig={switchActiveApiConfig}
        renderSelect={renderSelect}
        openAccount={() => {
          setAuthTab('profile');
          setActiveDialog('auth');
        }}
      />

      {view !== 'prompt-tools' ? (
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
          history={history}
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

          {activeDialog === 'detail' && selectedImage ? (
            <ImageDetailModal
              selectedImage={selectedImage}
              view={view}
              detailParams={detailParams}
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
              closeDialog={closeDialog}
              reuseConfig={reuseConfig}
              checkWallState={checkWallState}
              deleteImage={deleteImage}
              toggleWall={toggleWall}
            />
          ) : null}

          {activeDialog === 'auth' ? (
            <AccountModal
              user={user}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authTab={authTab}
              setAuthTab={setAuthTab}
              authForm={authForm}
              setAuthForm={setAuthForm}
              profileForm={profileForm}
              setProfileForm={setProfileForm}
              passwordForm={passwordForm}
              setPasswordForm={setPasswordForm}
              apiConfigForm={apiConfigForm}
              setApiConfigForm={setApiConfigForm}
              userDisplayName={userDisplayName}
              closeDialog={closeDialog}
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

        </div>
      ) : null}
    </main>
  );
}

export default App;