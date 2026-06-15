import { useEffect, useMemo, useRef, useState } from 'react';
import AccountModal from './components/AccountModal';
import CustomSelect from './components/CustomSelect';
import ImageBoard from './components/ImageBoard';
import ImageDetailModal from './components/ImageDetailModal';
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
  defaultSizeDraft,
  emptyAuthForm,
  emptyPasswordForm,
  emptyProfileForm,
  MAX_MASK_SIZE_BYTES,
  MAX_REFERENCE_IMAGES,
  MAX_REQUEST_TIMEOUT_SECONDS,
  wallFilterOptions,
} from './constants/options';
import {
  createLocalApiConfigId,
  normalizeApiConfigItem,
  normalizeDirectImageResponse,
  normalizeServerSettings,
  requestDirectImageFormData,
  requestDirectImageJson,
  requestJson,
} from './lib/api';
import {
  canRenderBoardItem,
  formatDuration,
  getImageIdentity,
  getMasonryColumns,
  getResponsiveMasonryColumnCount,
  isSameImageIdentity,
  normalizeBoardImage,
} from './lib/board';
import {
  normalizeBackground,
  normalizeForm,
  normalizeModeration,
  normalizeOutputCount,
  normalizeOutputFormat,
  normalizeQuality,
  normalizeResponseFormat,
  normalizeRevisedPrompt,
} from './lib/form';
import {
  flattenHistoryImages,
  prependHistoryRecord,
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
  const [boardVisibleCount, setBoardVisibleCount] = useState(BOARD_PAGE_SIZE);
  const [boardLoadingMore, setBoardLoadingMore] = useState(false);
  const [masonryColumnCount, setMasonryColumnCount] = useState(getResponsiveMasonryColumnCount);
  const [imageLayoutMeta, setImageLayoutMeta] = useState({});
  const boardRef = useRef(null);
  const boardLoadSentinelRef = useRef(null);
  const deletedRequestIdsRef = useRef(new Set());

  const hasReferenceImages = referenceImages.length > 0;
  const responseFormat = normalizeResponseFormat(form.response_format);
  const canUseOutputFormat = responseFormat === 'url';
  const isGenerating = runningGenerations > 0;
  const canSubmitGeneration = status.configured && !apiKeySyncing;
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
    return configs.find((item) => String(item.id) === String(apiConfigForm.activeApiConfigId)) || configs[0];
  }, [apiConfigForm]);
  const statusText = status.configured ? (status.apiName || activeApiConfig?.apiName || status.message || defaultApiConfigItem.apiName) : status.message;

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

  const buildGenerationPayload = (formDraft, apiConfig = activeApiConfig) => {
    const normalized = normalizeForm({ ...formDraft, model: apiConfig?.model || formDraft.model });
    const useStream = Boolean(apiConfig?.stream ?? apiConfigForm.stream);
    const responseFormat = useStream ? 'url' : normalizeResponseFormat(normalized.response_format);
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const payload = {
      model: normalized.model || defaultForm.model,
      prompt: normalized.prompt,
      n: normalizeOutputCount(normalized.n),
      response_format: responseFormat,
      moderation: normalizeModeration(normalized.moderation),
    };

    if (responseFormat === 'url') payload.output_format = outputFormat;
    if (normalized.size) payload.size = normalized.size;
    if (useStream && responseFormat === 'url') payload.stream = true;
    if (normalizeQuality(normalized.quality) !== 'auto') payload.quality = normalizeQuality(normalized.quality);
    if (normalizeBackground(normalized.background) !== 'auto') payload.background = normalizeBackground(normalized.background);

    return payload;
  };

  const buildEditPayload = (formDraft, apiConfig = activeApiConfig) => {
    const normalized = normalizeForm({ ...formDraft, model: apiConfig?.model || formDraft.model });
    const responseFormat = normalizeResponseFormat(normalized.response_format);
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const canUseOutputFormat = responseFormat === 'url';
    const payload = new FormData();

    payload.append('model', normalized.model || defaultForm.model);
    payload.append('prompt', normalized.prompt);
    payload.append('n', String(normalizeOutputCount(normalized.n)));
    payload.append('response_format', responseFormat);
    payload.append('moderation', normalizeModeration(normalized.moderation));
    referenceImages.forEach((image) => {
      payload.append('image[]', image.file, image.name || image.file.name || 'reference-image');
    });

    if (canUseOutputFormat) payload.append('output_format', outputFormat);
    if (normalized.size) payload.append('size', normalized.size);
    if (normalizeQuality(normalized.quality) !== 'auto') payload.append('quality', normalizeQuality(normalized.quality));
    if (normalizeBackground(normalized.background) !== 'auto') payload.append('background', normalizeBackground(normalized.background));
    if (maskImage?.file) payload.append('mask', maskImage.file, maskImage.name || maskImage.file.name || 'mask.png');

    return payload;
  };

  const updateApiConfig = (id, key, value) => {
    setApiConfigForm((current) => ({
      ...current,
      apiConfigs: (current.apiConfigs || []).map((item) => (String(item.id) === String(id) ? { ...item, [key]: value } : item)),
    }));
  };

  const addApiConfig = () => {
    const nextConfig = normalizeApiConfigItem({
      id: createLocalApiConfigId(),
      apiName: `API 配置 ${(apiConfigForm.apiConfigs || []).length + 1}`,
      apiBaseUrl: activeApiConfig?.apiBaseUrl || defaultApiConfigItem.apiBaseUrl,
      model: activeApiConfig?.model || defaultForm.model,
      requestTimeout: activeApiConfig?.requestTimeout || MAX_REQUEST_TIMEOUT_SECONDS,
    }, (apiConfigForm.apiConfigs || []).length);
    setApiConfigForm((current) => ({
      ...current,
      activeApiConfigId: nextConfig.id,
      apiConfigs: [...(current.apiConfigs || []), nextConfig],
    }));
  };

  const removeApiConfig = (id) => {
    setApiConfigForm((current) => {
      const nextConfigs = (current.apiConfigs || []).filter((item) => String(item.id) !== String(id));
      if (!nextConfigs.length) return current;
      return {
        ...current,
        activeApiConfigId: String(current.activeApiConfigId) === String(id) ? nextConfigs[0].id : current.activeApiConfigId,
        apiConfigs: nextConfigs,
      };
    });
  };

  const mergeDirectApiKey = (settings, apiKey) => {
    const normalized = normalizeServerSettings(settings || {});
    const directApiKey = String(apiKey || '').trim();

    setApiConfigForm((current) => {
      const currentKeys = new Map((current.apiConfigs || []).map((item) => [String(item.id), item.apiKey || '']));
      const apiConfigs = normalized.apiConfigs.map((item) => {
        const isActive = String(item.id) === String(normalized.activeApiConfigId);
        const nextApiKey = isActive && directApiKey ? directApiKey : currentKeys.get(String(item.id)) || item.apiKey || '';
        return { ...item, apiKey: nextApiKey, hasApiKey: item.hasApiKey || Boolean(nextApiKey) };
      });
      return { ...normalized, apiConfigs };
    });
    setStatus((current) => ({
      ...current,
      loading: false,
      configured: Boolean(normalized.hasApiKey || directApiKey),
      apiName: normalized.apiName,
      message: normalized.hasApiKey || directApiKey ? normalized.apiName : '未配置 API Key',
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
    const nextForm = normalizeForm({ ...normalized.form, model: normalized.model, prompt: form.prompt });

    setForm((current) => ({ ...current, ...nextForm, prompt: current.prompt }));
    setApiConfigForm((current) => {
      const currentKeys = new Map((current.apiConfigs || []).map((item) => [String(item.id), item.apiKey || '']));
      return {
        ...normalized,
        apiConfigs: normalized.apiConfigs.map((item) => ({ ...item, apiKey: item.apiKey || currentKeys.get(String(item.id)) || '' })),
      };
    });
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
      setApiConfigForm((current) => {
        const currentKeys = new Map((current.apiConfigs || []).map((item) => [String(item.id), item.apiKey || '']));
        return {
          ...normalized,
          apiConfigs: normalized.apiConfigs.map((item) => ({ ...item, apiKey: item.apiKey || currentKeys.get(String(item.id)) || '' })),
        };
      });
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

  const loadWall = async () => {
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

    requestJson('/api/auth/me')
      .then((data) => {
        const nextUser = data.user || null;
        setUser(nextUser);
        if (nextUser) {
          applyServerSettings(data.settings, nextUser);
          if (data.settings?.hasApiKey) syncDirectApiKey(data.settings).catch(() => {
            setStatus((current) => ({ ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' }));
          });
          syncGeneratedImages();
        } else {
          saveHistory([]);
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
        setImages([]);
        setHistory([]);
        setSelectedImage(null);
        setBoardScope('generate');
        setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
      });
  }, []);

  useEffect(() => {
    if (view === 'wall') loadWall();
  }, [view]);

  useEffect(() => {
    setProfileForm({ displayName: user?.displayName || user?.username || '' });
  }, [user]);

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

  const findWallItem = (image) => {
    if (!image) return null;
    if (image.wallItemId) {
      const matched = wallItems.find((item) => Number(item.id) === Number(image.wallItemId));
      if (matched) return matched;
      if (image.isOnWall) return { id: image.wallItemId };
      return null;
    }

    const src = createImageSrc(image);
    return wallItems.find((item) => {
      const wallSrc = createImageSrc(item);
      return src && wallSrc && src === wallSrc;
    }) || null;
  };

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
    const updateColumnCount = () => setMasonryColumnCount(getResponsiveMasonryColumnCount());
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

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
    if (sentinel && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
      }, { root: board || null, rootMargin: '260px 0px 260px 0px' });
      observer.observe(sentinel);
      return () => observer.disconnect();
    }

    if (!board) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        if (board.scrollTop + board.clientHeight >= board.scrollHeight - 260) loadNextPage();
      });
    };
    board.addEventListener('scroll', onScroll, { passive: true });
    return () => board.removeEventListener('scroll', onScroll);
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

  const generate = async (event) => {
    event.preventDefault();
    const prompt = form.prompt.trim();

    if (!prompt) {
      setError('先写提示词，再开始生成。');
      return;
    }

    setError('');
    setRunningGenerations((count) => count + 1);
    setStatus((current) => ({ ...current, message: hasReferenceImages ? 'Editing' : 'Generating' }));
    setView('generate');
    setBoardScope('generate');

    const requestId = `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    deletedRequestIdsRef.current.delete(requestId);
    const startedAt = new Date().toISOString();
    const requestConfig = activeApiConfig || defaultApiConfigItem;
    const requestApiName = requestConfig.apiName || status.apiName || defaultApiConfigItem.apiName;
    const imageForm = normalizeForm({ ...form, prompt, model: requestConfig.model });
    const pendingItem = {
      id: requestId,
      requestId,
      status: 'pending',
      form: imageForm,
      apiName: requestApiName,
      prompt,
      startedAt,
      createdAt: startedAt,
      source: hasReferenceImages ? 'edit' : 'generation',
      referenceName: referenceNames,
    };
    setImages((items) => [pendingItem, ...items]);

    try {
      if (!status.configured) throw new Error('请先在参数设置里保存 API Key。');
      const requestApiKey = String(requestConfig.apiKey || '').trim();
      if (!requestApiKey) throw new Error('服务器未同步到 API Key，请重新登录或重新保存 Key。');
      const payload = hasReferenceImages
        ? buildEditPayload(imageForm, requestConfig)
        : buildGenerationPayload(imageForm, { ...requestConfig, stream: apiConfigForm.stream });
      const data = hasReferenceImages
        ? await requestDirectImageFormData(requestConfig, requestApiKey, payload)
        : await requestDirectImageJson(requestConfig, requestApiKey, payload);
      const outputFormat = hasReferenceImages
        ? (normalizeResponseFormat(imageForm.response_format) === 'url' ? normalizeOutputFormat(imageForm.output_format) : defaultForm.output_format)
        : payload.output_format || defaultForm.output_format;
      const normalizedData = normalizeDirectImageResponse(data, outputFormat);

      const finishedAt = new Date().toISOString();
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, message: 'Done · 0' }));
        return;
      }
      const nextImages = Array.isArray(normalizedData.data)
        ? normalizedData.data.map((image, index) => normalizeBoardImage({
            ...image,
            upstreamImageId: image.id || '',
            id: `${requestId}-${index}`,
            requestId,
            status: 'completed',
            form: imageForm,
            apiName: requestApiName,
            prompt,
            startedAt,
            finishedAt,
            createdAt: finishedAt,
            source: hasReferenceImages ? 'edit' : 'generation',
            referenceName: referenceNames,
          }))
        : [];

      if (!nextImages.some((image) => Boolean(createImageSrc(image)))) {
        throw new Error('上游接口未返回可展示图片。');
      }

      let storedImages = nextImages;
      if (user) {
        try {
          const savedImages = [];
          for (const image of nextImages) {
            const imagePayload = await imageToSavePayload(image, imageMimeForOutputFormat(imageForm.output_format));
            const saved = await requestJson('/api/generated-images', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId,
                mode: normalizeImageSource(image.source),
                image: imagePayload,
                prompt,
                revised_prompt: normalizeRevisedPrompt(image.revised_prompt),
                form: { ...imageForm, apiName: requestApiName, source: normalizeImageSource(image.source), referenceName: referenceNames },
                params: { ...imageForm, apiName: requestApiName, source: normalizeImageSource(image.source), referenceName: referenceNames },
              }),
            });
            savedImages.push(normalizeBoardImage({
              ...image,
              ...(saved.item || {}),
              upstreamImageId: image.upstreamImageId || image.id || '',
              source: normalizeImageSource(image.source),
              apiName: requestApiName,
              prompt,
              form: imageForm,
              referenceName: referenceNames,
            }));
          }
          if (savedImages.length) storedImages = savedImages;
        } catch {
          setError('图片已生成，但服务器保存失败；刷新后可能无法恢复这次未上墙作品。');
        }
      }

      setImages((items) => [
        ...storedImages,
        ...items.filter((item) => item.requestId !== requestId && item.id !== requestId),
      ]);
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? storedImages[0] || current : current));
      setView('generate');

      const record = {
        id: requestId,
        form: imageForm,
        images: storedImages,
        createdAt: finishedAt,
      };

      try {
        const nextHistory = prependHistoryRecord(record);
        setHistory(nextHistory);
      } catch {
        setHistory((items) => [record, ...items.filter((item) => item.id !== record.id)].slice(0, 30));
        setError('图片已生成，但本地历史记录保存失败。');
      }
      setStatus((current) => ({ ...current, message: `Done · ${storedImages.length}` }));
    } catch (requestError) {
      const failedAt = new Date().toISOString();
      const message = requestError instanceof Error ? requestError.message : '生成失败';
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, message: current.configured ? '已删除' : current.message }));
        return;
      }
      setError(message);
      setImages((items) => items.map((item) => (
        item.requestId === requestId || item.id === requestId
          ? { ...item, status: 'failed', error: message, finishedAt: failedAt }
          : item
      )));
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? { ...current, status: 'failed', error: message, finishedAt: failedAt } : current));
      setStatus((current) => ({ ...current, message: current.configured ? 'Failed' : current.message }));
    } finally {
      setRunningGenerations((count) => Math.max(0, count - 1));
    }
  };

  const clearWallState = (image) => {
    setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)));
    setHistory((items) => {
      const nextHistory = items.map((record) => ({
        ...record,
        images: (record.images || []).map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)),
      }));
      saveHistory(nextHistory);
      return nextHistory;
    });
    setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: null, isOnWall: false } : current));
  };

  const checkWallState = async (image) => {
    const wallItem = findWallItem(image);
    if (!wallItem?.id) {
      clearWallState(image);
      setError('本地上墙状态已清理，可重新上墙。');
      return;
    }

    const busyId = String(image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    try {
      const data = await requestJson(`/api/wall/${wallItem.id}`);
      if (data.item) {
        setWallItems((items) => [data.item, ...items.filter((item) => Number(item.id) !== Number(data.item.id))]);
        setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: data.item.id, isOnWall: true } : current));
        setError('作品仍在墙上。');
      }
    } catch {
      setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
      clearWallState(image);
      setError('服务器未找到该上墙作品，可重新上墙。');
    } finally {
      setWallBusyId('');
    }
  };

  const toggleWall = async (image) => {
    const wallItem = findWallItem(image);
    const busyId = String(image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    setError('');

    try {
      if (!user) throw new Error('请先登录后再操作上墙。');

      if (wallItem?.id) {
        const ownerId = image.userId || image.user_id || wallItem.userId || wallItem.user_id;
        if (!user.isAdmin && ownerId && Number(ownerId) !== Number(user.id)) throw new Error('只能取消自己上墙的作品。');
        await requestJson(`/api/wall/${wallItem.id}`, { method: 'DELETE' });

        setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
        setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)));
        setHistory((items) => {
          const nextHistory = items.map((record) => ({
            ...record,
            images: (record.images || []).map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)),
          }));
          saveHistory(nextHistory);
          return nextHistory;
        });
        setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: null, isOnWall: false } : current));
        return;
      }

      const sourceJobId = getGeneratedImageJobId(image);
      if (!sourceJobId) throw new Error('请等待作品保存到服务器后再上墙。');

      const wallForm = { ...(image.form || form), apiName: image.apiName || activeApiConfig?.apiName || status.apiName || defaultApiConfigItem.apiName, source: normalizeImageSource(image.source), sourceJobId };
      const data = await requestJson('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: image.prompt || image.form?.prompt || form.prompt,
          revised_prompt: normalizeRevisedPrompt(image.revised_prompt),
          durationSeconds: getElapsedSeconds(image),
          sourceJobId,
          form: wallForm,
          params: { ...wallForm, durationSeconds: getElapsedSeconds(image) },
        }),
      });

      const nextWallItem = data.item;
      setWallItems((items) => [nextWallItem, ...items.filter((item) => Number(item.id) !== Number(nextWallItem.id))]);
      setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true, userId: nextWallItem.userId } : item)));
      setHistory((items) => {
        const nextHistory = items.map((record) => ({
          ...record,
          images: (record.images || []).map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true, userId: nextWallItem.userId } : item)),
        }));
        saveHistory(nextHistory);
        return nextHistory;
      });
      setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: nextWallItem.id, isOnWall: true, userId: nextWallItem.userId } : current));
    } catch (wallError) {
      setError(wallError instanceof Error ? wallError.message : '作品墙操作失败');
    } finally {
      setWallBusyId('');
    }
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const data = await requestJson(`/api/auth/${authMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      });

      setUser(data.user || null);
      if (data.user) {
        applyServerSettings(data.settings, data.user);
        if (data.settings?.hasApiKey) await syncDirectApiKey(data.settings);
        await syncGeneratedImages();
      }
      setAuthForm(emptyAuthForm);
      setAuthTab('profile');
      setActiveDialog(data.user ? 'auth' : null);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '账号操作失败');
    }
  };

  const logout = async () => {
    try {
      await requestJson('/api/auth/logout', { method: 'POST' });
    } finally {
      saveHistory([]);
      setUser(null);
      setImages([]);
      setHistory([]);
      setWallItems([]);
      setSelectedImage(null);
      setBoardScope('generate');
      setBoardFilter('all');
      setProfileForm(emptyProfileForm);
      setPasswordForm(emptyPasswordForm);
      setApiConfigForm(defaultApiConfigForm);
      setApiKeySyncing(false);
      setStatus((current) => ({ ...current, configured: false, apiName: '', message: '请先登录' }));
    }
  };

  const saveAccountSettings = async () => {
    if (!user) {
      setError('请先登录后再设置参数。');
      return;
    }

    const nextSettings = normalizeServerSettings({
      ...apiConfigForm,
      apiConfigs: apiConfigForm.apiConfigs,
      activeApiConfigId: apiConfigForm.activeApiConfigId,
      stream: apiConfigForm.stream,
    });
    try {
      const data = await requestJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            activeApiConfigId: nextSettings.activeApiConfigId,
            stream: nextSettings.stream,
          },
          apiConfigs: (apiConfigForm.apiConfigs || []).map((item) => ({
            id: item.id,
            apiName: item.apiName,
            apiBaseUrl: item.apiBaseUrl,
            model: item.model,
            requestTimeout: item.requestTimeout,
            apiKey: item.apiKey,
            confirmApiKeySave: Boolean(item.apiKey),
          })),
        }),
      });
      applyServerSettings(data.settings, user);
      if (data.settings?.hasApiKey) await syncDirectApiKey(data.settings);
      setForm((current) => ({ ...current, model: data.settings?.model || activeApiConfig?.model || current.model }));
      setError('');
      setAuthTab('settings');
    } catch (settingsError) {
      setStatus((current) => (apiKeySyncing ? { ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' } : current));
      setError(settingsError instanceof Error ? settingsError.message : '保存参数失败');
    }
  };

  const resetDirectSettings = () => {
    setApiConfigForm((current) => ({
      ...defaultApiConfigForm,
      stream: current.stream,
      apiConfigs: current.apiConfigs?.length ? current.apiConfigs.map((item, index) => ({
        ...normalizeApiConfigItem(index === 0 ? defaultApiConfigItem : item, index),
        id: item.id,
        hasApiKey: item.hasApiKey,
        apiKeyHint: item.apiKeyHint,
        apiKey: '',
      })) : [defaultApiConfigItem],
      activeApiConfigId: current.apiConfigs?.[0]?.id || defaultApiConfigItem.id,
    }));
    setForm(defaultForm);
  };

  const saveProfile = async () => {
    if (!user) return;

    try {
      const data = await requestJson('/api/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: profileForm.displayName }),
      });
      setUser(data.user || user);
      setError('');
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : '保存账号信息失败');
    }
  };

  const changePassword = async () => {
    if (!user) return;

    try {
      await requestJson('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm(emptyPasswordForm);
      setError('');
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : '修改密码失败');
    }
  };

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
        switchActiveApiConfig={switchActiveApiConfig}
        renderSelect={renderSelect}
        openAccount={() => {
          setAuthTab('profile');
          setActiveDialog('auth');
        }}
      />

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
      />

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