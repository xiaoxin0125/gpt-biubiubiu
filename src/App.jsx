import { useEffect, useMemo, useState } from 'react';

const HISTORY_KEY = 'gpt-biubiubiu:image-history';
const MAX_REFERENCE_IMAGES = 16;
const MAX_REQUEST_TIMEOUT_SECONDS = 999;
const MAX_MASK_SIZE_BYTES = 4 * 1024 * 1024;

const qualityOptions = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
];
const outputFormatOptions = ['png', 'jpeg', 'webp'];
const backgroundOptions = ['auto', 'opaque'];
const moderationOptions = ['auto', 'low'];
const boardFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已上墙', value: 'on-wall' },
  { label: '未上墙', value: 'off-wall' },
  { label: '文生图', value: 'generation' },
  { label: '图生图', value: 'edit' },
];

const resolutionGroups = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

const ratioOptions = [
  { label: '1:1', value: '1:1', icon: 'square' },
  { label: '3:2', value: '3:2', icon: 'landscape' },
  { label: '2:3', value: '2:3', icon: 'portrait' },
  { label: '16:9', value: '16:9', icon: 'wide' },
  { label: '9:16', value: '9:16', icon: 'tall' },
  { label: '4:3', value: '4:3', icon: 'landscape' },
  { label: '3:4', value: '3:4', icon: 'portrait' },
  { label: '21:9', value: '21:9', icon: 'ultra' },
  { label: '自定义', value: 'custom-ratio', icon: 'custom' },
];

const ratioToSize = {
  '1k': {
    '1:1': '768x768',
    '3:2': '960x640',
    '2:3': '640x960',
    '16:9': '1024x576',
    '9:16': '576x1024',
    '4:3': '960x720',
    '3:4': '720x960',
    '21:9': '1008x432',
  },
  '2k': {
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '1920x1440',
    '3:4': '1440x1920',
    '21:9': '2560x1088',
  },
  '4k': {
    '1:1': '2880x2880',
    '3:2': '3232x2160',
    '2:3': '2160x3232',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '2880x2160',
    '3:4': '2160x2880',
    '21:9': '3840x1600',
  },
};

const sizeLimits = {
  step: 16,
  maxEdge: 3840,
  maxRatio: 3,
  minPixels: 655360,
  maxPixels: 8294400,
};

const resolutionMaxEdges = {
  '1k': 1280,
  '2k': 2560,
  '4k': 3840,
};

const defaultForm = {
  model: 'gpt-image-2',
  prompt: '',
  size: '',
  n: 1,
  quality: 'auto',
  background: 'auto',
  output_format: 'png',
  output_compression: 85,
  moderation: 'auto',
};

const defaultSizeDraft = {
  mode: 'auto',
  resolution: '1k',
  ratio: '1:1',
  customRatioWidth: 1,
  customRatioHeight: 1,
  customWidth: 1024,
  customHeight: 1024,
};

const emptyAuthForm = {
  username: '',
  displayName: '',
  password: '',
};

const emptyProfileForm = {
  displayName: '',
};

const emptyPasswordForm = {
  currentPassword: '',
  newPassword: '',
};

const defaultApiConfigForm = {
  apiName: 'OpenAI Compatible',
  apiBaseUrl: '',
  requestTimeout: MAX_REQUEST_TIMEOUT_SECONDS,
  streamEnabled: false,
};

const normalizeQuality = (value) => (qualityOptions.some((item) => item.value === value) ? value : 'auto');
const normalizeBackground = (value) => (backgroundOptions.includes(value) ? value : 'auto');
const normalizeOutputFormat = (value) => (outputFormatOptions.includes(value) ? value : 'png');
const normalizeModeration = (value) => (moderationOptions.includes(value) ? value : 'auto');
const normalizeCompression = (value) => clampNumber(Number(value) || 0, 0, 100);
const getQualityLabel = (value) => qualityOptions.find((item) => item.value === value)?.label || '自动';
const normalizeForm = (value = {}) => {
  const nextForm = { ...defaultForm, ...value };
  delete nextForm.negative_prompt;
  delete nextForm.style;
  delete nextForm.response_format;
  delete nextForm.input_fidelity;

  return {
    ...nextForm,
    model: nextForm.model || defaultForm.model,
    quality: normalizeQuality(nextForm.quality),
    background: normalizeBackground(nextForm.background),
    output_format: normalizeOutputFormat(nextForm.output_format),
    output_compression: normalizeCompression(nextForm.output_compression ?? defaultForm.output_compression),
    moderation: normalizeModeration(nextForm.moderation),
    n: 1,
  };
};

const createImageSrc = (image) => {
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:${image.imageMime || 'image/png'};base64,${image.b64_json}`;
  return '';
};

const readHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
};

const saveHistory = (items) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
};

const parseSize = (size) => {
  const [width, height] = String(size || '').split('x').map(Number);
  return { width: width || 1024, height: height || 1024 };
};

const formatDate = (value) => {
  if (!value) return '刚刚';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const canRenderBoardItem = (image) => image?.status === 'pending' || image?.status === 'failed' || Boolean(createImageSrc(image));

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

const getSourceLabel = (image) => {
  if (image?.source === 'edit') return '图生图';
  if (image?.source === 'wall') return '作品墙';
  return '文生图';
};

const getAvailableRatios = (resolution) => ratioOptions.filter((item) => item.value === 'custom-ratio' || Boolean(ratioToSize[resolution]?.[item.value]));

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const ceilToStep = (value) => Math.ceil(value / sizeLimits.step) * sizeLimits.step;
const floorToStep = (value) => Math.floor(value / sizeLimits.step) * sizeLimits.step;

const isLegalSize = (width, height) => {
  const pixels = width * height;
  const ratio = Math.max(width / height, height / width);

  return (
    width % sizeLimits.step === 0 &&
    height % sizeLimits.step === 0 &&
    width <= sizeLimits.maxEdge &&
    height <= sizeLimits.maxEdge &&
    ratio <= sizeLimits.maxRatio &&
    pixels >= sizeLimits.minPixels &&
    pixels <= sizeLimits.maxPixels
  );
};

const clampSizeToLegalRange = (width, height) => {
  const targetWidth = Math.max(sizeLimits.step, Number(width) || 1024);
  const targetHeight = Math.max(sizeLimits.step, Number(height) || 1024);
  const targetRatio = clampNumber(targetWidth / targetHeight, 1 / sizeLimits.maxRatio, sizeLimits.maxRatio);
  const targetPixels = clampNumber(targetWidth * targetHeight, sizeLimits.minPixels, sizeLimits.maxPixels);

  let best = { width: 1024, height: 1024 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (let candidateWidth = sizeLimits.step; candidateWidth <= sizeLimits.maxEdge; candidateWidth += sizeLimits.step) {
    const minHeight = ceilToStep(Math.max(sizeLimits.step, candidateWidth / sizeLimits.maxRatio, sizeLimits.minPixels / candidateWidth));
    const maxHeight = floorToStep(Math.min(sizeLimits.maxEdge, candidateWidth * sizeLimits.maxRatio, sizeLimits.maxPixels / candidateWidth));

    for (let candidateHeight = minHeight; candidateHeight <= maxHeight; candidateHeight += sizeLimits.step) {
      if (!isLegalSize(candidateWidth, candidateHeight)) continue;

      const ratioScore = Math.abs(Math.log((candidateWidth / candidateHeight) / targetRatio));
      const pixelScore = Math.abs(Math.log((candidateWidth * candidateHeight) / targetPixels));
      const score = ratioScore * 4 + pixelScore;

      if (score < bestScore) {
        best = { width: candidateWidth, height: candidateHeight };
        bestScore = score;
      }
    }
  }

  return best;
};

const getCustomRatioSize = (draft) => {
  const ratioWidth = Math.max(1, Number(draft.customRatioWidth) || 1);
  const ratioHeight = Math.max(1, Number(draft.customRatioHeight) || 1);
  const maxEdge = resolutionMaxEdges[draft.resolution] || sizeLimits.maxEdge;
  const landscape = ratioWidth >= ratioHeight;
  const rawWidth = landscape ? maxEdge : (maxEdge * ratioWidth) / ratioHeight;
  const rawHeight = landscape ? (maxEdge * ratioHeight) / ratioWidth : maxEdge;
  return clampSizeToLegalRange(rawWidth, rawHeight);
};

const getDraftSize = (draft) => {
  if (draft.mode === 'auto') return '';

  if (draft.mode === 'custom') {
    const size = clampSizeToLegalRange(draft.customWidth, draft.customHeight);
    return `${size.width}x${size.height}`;
  }

  if (draft.ratio === 'custom-ratio') {
    const size = getCustomRatioSize(draft);
    return `${size.width}x${size.height}`;
  }

  const parsed = parseSize(ratioToSize[draft.resolution]?.[draft.ratio] || ratioToSize[draft.resolution]?.['1:1'] || '1024x1024');
  const size = clampSizeToLegalRange(parsed.width, parsed.height);
  return `${size.width}x${size.height}`;
};

const readApiResponse = async (response) => {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!text) return {};

  if (contentType.includes('application/json') || /^[\s\r\n]*[\[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('接口返回了无法解析的数据，请检查后端服务。');
    }
  }

  if (/^[\s\r\n]*</.test(text)) {
    throw new Error('接口返回了页面内容，请检查后端服务或 /api 反向代理。');
  }

  throw new Error(text.slice(0, 160) || '接口返回异常内容。');
};

const toApiUrl = (input) => {
  const value = String(input || '');
  if (!value.startsWith('/api/')) return value;
  const [path, query = ''] = value.slice(4).split('?');
  const route = `/api/index.php?route=${encodeURIComponent(path)}`;
  return query ? `${route}&${query}` : route;
};

const requestJson = async (input, init) => {
  const response = await fetch(toApiUrl(input), init);
  const data = await readApiResponse(response);

  if (!response.ok) throw new Error(data.error || data.message || '请求失败');
  return data;
};

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isPendingJob = (data) => {
  const status = data?.job?.status;
  return Boolean(data?.job?.id && !Array.isArray(data?.data) && ['pending', 'running'].includes(status));
};

const pollImageJob = async (jobId, timeoutSeconds = defaultApiConfigForm.requestTimeout + 30) => {
  const deadline = Date.now() + Math.max(30, Number(timeoutSeconds) || defaultApiConfigForm.requestTimeout) * 1000;

  while (Date.now() < deadline) {
    await sleep(2500);
    const data = await requestJson(`/api/health?job=${encodeURIComponent(jobId)}`);
    const status = data?.job?.status;

    if (Array.isArray(data?.data)) return data;
    if (status === 'failed') throw new Error(data.job.error || '生成失败');
    if (status && !['pending', 'running'].includes(status)) throw new Error(data.job.error || '生成状态异常');
  }

  throw new Error('生成仍在处理中，请稍后刷新或重试。');
};

function App() {
  const [view, setView] = useState('generate');
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [images, setImages] = useState([]);
  const [wallItems, setWallItems] = useState([]);
  const [referenceImages, setReferenceImages] = useState([]);
  const [maskImage, setMaskImage] = useState(null);
  const [user, setUser] = useState(null);
  const [settingsMeta, setSettingsMeta] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authTab, setAuthTab] = useState('profile');
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [apiConfigForm, setApiConfigForm] = useState(defaultApiConfigForm);
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '检查接口中' });
  const [error, setError] = useState('');
  const [activeDialog, setActiveDialog] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(defaultSizeDraft);
  const [wallBusyId, setWallBusyId] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');
  const [openSelect, setOpenSelect] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());

  const hasReferenceImages = referenceImages.length > 0;
  const canCompressOutput = ['jpeg', 'webp'].includes(normalizeOutputFormat(form.output_format));
  const referenceNames = referenceImages.map((image, index) => `图${index + 1}:${image.name}`).join('，');
  const availableRatios = getAvailableRatios(sizeDraft.resolution);
  const activeSize = getDraftSize(sizeDraft);
  const displaySize = activeSize || '自动';
  const userDisplayName = user?.displayName || user?.username || '';
  const visibleImages = useMemo(() => images.filter(canRenderBoardItem), [images]);
  const sourceBoardItems = view === 'wall' ? wallItems : visibleImages;
  const statusText = status.configured ? (status.apiName || status.message || defaultApiConfigForm.apiName) : status.message;

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const renderSelect = ({ id, label, value, options, onChange, disabled = false, className = '', menuDirection = 'up' }) => {
    const normalizedOptions = options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option));
    const selected = normalizedOptions.find((option) => option.value === value) || normalizedOptions[0];
    const isOpen = openSelect === id && !disabled;

    return (
      <div className={`${className} custom-select-field ${menuDirection === 'up' ? 'is-menu-up' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}>
        {label ? <span>{label}</span> : null}
        <button
          type="button"
          className={isOpen ? 'custom-select-trigger is-open' : 'custom-select-trigger'}
          onClick={() => setOpenSelect((current) => (current === id ? '' : id))}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <strong>{selected?.label || value}</strong>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {isOpen ? (
          <div className="custom-select-menu" role="listbox">
            {normalizedOptions.map((option) => (
              <button
                type="button"
                className={option.value === value ? 'custom-select-option is-active' : 'custom-select-option'}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpenSelect('');
                }}
                role="option"
                aria-selected={option.value === value}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const buildGenerationPayload = (prompt) => {
    const normalized = normalizeForm({ ...form, prompt, n: 1 });
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const payload = {
      model: normalized.model || defaultForm.model,
      prompt,
      n: 1,
      output_format: outputFormat,
      moderation: normalizeModeration(normalized.moderation),
    };

    if (normalized.size) payload.size = normalized.size;
    if (normalizeQuality(normalized.quality) !== 'auto') payload.quality = normalizeQuality(normalized.quality);
    if (normalizeBackground(normalized.background) !== 'auto') payload.background = normalizeBackground(normalized.background);
    if (['jpeg', 'webp'].includes(outputFormat)) payload.output_compression = normalizeCompression(normalized.output_compression);
    if (apiConfigForm.streamEnabled) payload.stream = true;

    return payload;
  };

  const buildEditPayload = (prompt) => {
    const normalized = normalizeForm({ ...form, prompt, n: 1 });
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const payload = {
      model: normalized.model || defaultForm.model,
      prompt,
      output_format: outputFormat,
    };

    if (normalized.size) payload.size = normalized.size;
    if (normalizeQuality(normalized.quality) !== 'auto') payload.quality = normalizeQuality(normalized.quality);
    if (normalizeBackground(normalized.background) !== 'auto') payload.background = normalizeBackground(normalized.background);
    if (['jpeg', 'webp'].includes(outputFormat)) payload.output_compression = normalizeCompression(normalized.output_compression);
    if (apiConfigForm.streamEnabled) payload.stream = true;

    return payload;
  };

  const applySettings = (settings) => {
    if (!settings) return;

    const apiName = settings.apiName || defaultApiConfigForm.apiName;
    setSettingsMeta(settings);
    setStatus((current) => ({
      ...current,
      configured: Boolean(settings.hasApiKey || current.configured),
      apiName,
      message: apiName,
    }));
    setApiConfigForm({
      apiName,
      apiBaseUrl: settings.apiBaseUrl || '',
      requestTimeout: settings.requestTimeout || defaultApiConfigForm.requestTimeout,
      streamEnabled: Boolean(settings.streamEnabled),
    });
    setForm((current) => ({
      ...normalizeForm(current),
      model: settings.model || current.model,
      size: settings.size !== undefined ? settings.size : current.size,
      quality: normalizeQuality(settings.quality || current.quality),
      background: normalizeBackground(settings.background || current.background),
      output_format: normalizeOutputFormat(settings.output_format || current.output_format),
      output_compression: normalizeCompression(settings.output_compression ?? current.output_compression),
      moderation: normalizeModeration(settings.moderation || current.moderation),
      n: settings.n || current.n,
    }));
  };

  const loadWall = async () => {
    try {
      const data = await requestJson('/api/wall');
      setWallItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '作品墙加载失败');
    }
  };

  useEffect(() => {
    setHistory(readHistory());

    requestJson('/api/health')
      .then((data) => {
        const apiName = data.apiName || defaultApiConfigForm.apiName;
        setStatus({
          loading: false,
          configured: Boolean(data.configured),
          apiName,
          message: data.configured ? apiName : '未配置 API Key',
        });
      })
      .catch(() => {
        setStatus({ loading: false, configured: false, message: '代理未启动' });
      });

    requestJson('/api/auth/me')
      .then((data) => {
        setUser(data.user || null);
        applySettings(data.settings || null);
      })
      .catch(() => null);

    loadWall();
  }, []);

  useEffect(() => {
    setProfileForm({ displayName: user?.displayName || user?.username || '' });
  }, [user]);

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
    if (image.wallItemId) return wallItems.find((item) => Number(item.id) === Number(image.wallItemId)) || { id: image.wallItemId };

    const src = createImageSrc(image);
    return wallItems.find((item) => {
      if (image.jobId && item.sourceJobId && Number(image.jobId) === Number(item.sourceJobId)) return true;
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
    if (boardFilter === 'on-wall') return Boolean(wallItem);
    if (boardFilter === 'off-wall') return !wallItem;
    if (boardFilter === 'generation') return image.source === 'generated' || (!image.source || image.source === 'image');
    if (boardFilter === 'edit') return image.source === 'edit';
    return true;
  });

  const isSameImage = (left, right) => {
    if (!left || !right) return false;
    if (left.jobId && right.jobId && Number(left.jobId) === Number(right.jobId)) return true;
    if (left.wallItemId && right.wallItemId && Number(left.wallItemId) === Number(right.wallItemId)) return true;
    if (left.id && right.id && left.id === right.id) return true;
    const leftSrc = createImageSrc(left);
    const rightSrc = createImageSrc(right);
    return Boolean(leftSrc && rightSrc && leftSrc === rightSrc);
  };

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

  const selectHistory = (item) => {
    const nextForm = normalizeForm(item.form);

    setForm(nextForm);
    setImages((item.images || []).map((image) => ({
      ...image,
      form: nextForm,
      prompt: item.form?.prompt || '',
      createdAt: item.createdAt,
      source: image.source || 'generated',
    })));
    setView('generate');
    setError('');
    setActiveDialog(null);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
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

  const getElapsedSeconds = (item) => Math.max(0, Math.floor(((item?.finishedAt ? new Date(item.finishedAt).getTime() : nowTick) - new Date(item?.startedAt || item?.createdAt || Date.now()).getTime()) / 1000));

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
    setStatus((current) => ({ ...current, loading: true, message: hasReferenceImages ? 'Editing' : 'Generating' }));
    setView('generate');

    const requestId = `request-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const imageForm = normalizeForm({ ...form, prompt, n: 1 });
    const pendingItem = {
      id: requestId,
      requestId,
      status: 'pending',
      form: imageForm,
      prompt,
      startedAt,
      createdAt: startedAt,
      source: hasReferenceImages ? 'edit' : 'generated',
      referenceName: referenceNames,
    };
    setImages((items) => [pendingItem, ...items]);

    try {
      const payload = hasReferenceImages ? buildEditPayload(prompt) : buildGenerationPayload(prompt);
      const initialData = hasReferenceImages
        ? await submitImageEdit(payload)
        : await requestJson('/api/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = isPendingJob(initialData)
        ? await pollImageJob(initialData.job.id, Number(apiConfigForm.requestTimeout || defaultApiConfigForm.requestTimeout) + 30)
        : initialData;

      const finishedAt = new Date().toISOString();
      const nextImages = Array.isArray(data.data)
        ? data.data.map((image, index) => ({
            ...image,
            id: image.id || `${requestId}-${index}`,
            requestId,
            status: 'completed',
            form: imageForm,
            prompt,
            startedAt,
            finishedAt,
            createdAt: finishedAt,
            source: hasReferenceImages ? 'edit' : 'generated',
            referenceName: referenceNames,
          }))
        : [];

      setImages((items) => [
        ...nextImages,
        ...items.filter((item) => item.requestId !== requestId && item.id !== requestId),
      ]);
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? nextImages[0] || current : current));
      setView('generate');

      const record = {
        id: requestId,
        form: imageForm,
        images: nextImages,
        createdAt: finishedAt,
      };

      const nextHistory = [record, ...history].slice(0, 30);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setStatus((current) => ({ ...current, loading: false, message: `Done · ${nextImages.length}` }));
    } catch (requestError) {
      const failedAt = new Date().toISOString();
      const message = requestError instanceof Error ? requestError.message : '生成失败';
      setError(message);
      setImages((items) => items.map((item) => (
        item.requestId === requestId || item.id === requestId
          ? { ...item, status: 'failed', error: message, finishedAt: failedAt }
          : item
      )));
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? { ...current, status: 'failed', error: message, finishedAt: failedAt } : current));
      setStatus((current) => ({ ...current, loading: false, message: current.configured ? 'Failed' : current.message }));
    }
  };

  const submitImageEdit = (payload) => {
    const formData = new FormData();
    referenceImages.forEach((image) => {
      formData.append('image[]', image.file, image.name);
    });
    if (maskImage?.file) formData.append('mask', maskImage.file, maskImage.name);
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
    });

    return requestJson('/api/images/edits', {
      method: 'POST',
      body: formData,
    });
  };

  const toggleWall = async (image) => {
    const wallItem = findWallItem(image);
    const busyId = String(image.jobId || image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    setError('');

    try {
      if (wallItem?.id) {
        await requestJson(`/api/wall/${wallItem.id}`, { method: 'DELETE' });

        setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
        setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)));
        setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: null, isOnWall: false } : current));
        return;
      }

      const data = await requestJson('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: {
            url: image.url || '',
            b64_json: image.b64_json || '',
            mime: image.imageMime || 'image/png',
          },
          prompt: image.prompt || image.form?.prompt || form.prompt,
          revised_prompt: image.revised_prompt || '',
          form: image.form || form,
          params: image.form || form,
          jobId: image.jobId || null,
        }),
      });

      const nextWallItem = data.item;
      setWallItems((items) => [nextWallItem, ...items.filter((item) => Number(item.id) !== Number(nextWallItem.id))]);
      setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true } : item)));
      setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: nextWallItem.id, isOnWall: true } : current));
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
      applySettings(data.settings || null);
      setAuthForm(emptyAuthForm);
      setAuthTab('profile');
      setActiveDialog(data.user ? 'auth' : null);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '账号操作失败');
    }
  };

  const logout = async () => {
    await requestJson('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setSettingsMeta(null);
    setSettingsApiKey('');
    setProfileForm(emptyProfileForm);
    setPasswordForm(emptyPasswordForm);
  };

  const saveAccountSettings = async () => {
    if (!user) {
      setAuthMode('login');
      setActiveDialog('auth');
      setError('登录后才能保存个人配置。');
      return;
    }

    const apiKey = settingsApiKey.trim();
    if (apiKey && !window.confirm('API Key 会加密保存到服务端数据库。确认保存？')) return;

    try {
      const data = await requestJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            ...normalizeForm(form),
            apiName: apiConfigForm.apiName,
            apiBaseUrl: apiConfigForm.apiBaseUrl.replace(/\s+/g, ''),
            requestTimeout: clampNumber(Number(apiConfigForm.requestTimeout || defaultApiConfigForm.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS),
            streamEnabled: apiConfigForm.streamEnabled,
          },
          apiKey,
          confirmApiKeySave: Boolean(apiKey),
        }),
      });

      setSettingsApiKey('');
      applySettings(data.settings || null);
      setError('');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : '保存配置失败');
    }
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
    closeDialog();
  };

  const detailParams = selectedImage?.form || form;
  const detailSrc = createImageSrc(selectedImage);
  const detailElapsed = selectedImage ? formatDuration(getElapsedSeconds(selectedImage)) : '00:00';
  const selectedWallItem = detailSrc ? findWallItem(selectedImage) : null;
  const selectedOnWall = Boolean(selectedWallItem);
  const busySelected = selectedImage && wallBusyId === String(selectedImage.jobId || selectedImage.wallItemId || selectedImage.id || detailSrc);

  const renderImageCard = (image) => {
    const src = createImageSrc(image);
    const isPending = image.status === 'pending';
    const isFailed = image.status === 'failed';
    const wallItem = src ? findWallItem(image) : null;
    const onWall = Boolean(wallItem);
    const busyId = String(image.jobId || image.wallItemId || image.id || src);
    const elapsed = formatDuration(getElapsedSeconds(image));
    const title = image.revised_prompt || image.prompt || image.form?.prompt || 'Generated image';

    return (
      <figure className={`${onWall ? 'result-card is-on-wall' : 'result-card'} ${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''}`.trim()} key={`${image.source || 'image'}-${image.id || image.wallItemId || image.jobId || src}`} onClick={() => openDetail(image)}>
        <div className="result-image-wrap">
          <span className="timer-badge">◷ {elapsed}</span>
          {src ? (
            <img src={src} alt={title || '生成图片'} />
          ) : (
            <div className="pending-preview">
              <span className="loading-ring" aria-hidden="true" />
              <strong>{isFailed ? '生成失败' : '生成中...'}</strong>
            </div>
          )}
          {src ? (
            <button
              type="button"
              className={onWall ? 'wall-icon is-active' : 'wall-icon'}
              onClick={(event) => {
                event.stopPropagation();
                toggleWall(image);
              }}
              disabled={wallBusyId === busyId}
              aria-label={onWall ? '取消上墙' : '上墙'}
            >
              {onWall ? '★' : '☆'}
            </button>
          ) : null}
        </div>
        <figcaption>
          <span>{title}</span>
          {src ? (
            <a href={src} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              下载
            </a>
          ) : (
            <small>{image.form?.size || '自动'} · {getQualityLabel(image.form?.quality)}</small>
          )}
        </figcaption>
        {image.error ? <small className="author-line error-line">{image.error}</small> : image.authorName ? <small className="author-line">{image.authorName}</small> : null}
      </figure>
    );
  };

  return (
    <main className="playground-shell">
      {error ? <div className="error-toast" role="alert">{error}</div> : null}

      <header className="topbar">
        <a className="brand" href="/" aria-label="GPT Biubiubiu">
          <span className="brand-orb" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M6 21.5 21.5 6l4.5 4.5L10.5 26H6v-4.5Z" />
              <path d="M18.5 9 23 13.5" />
              <path d="M7 7h7" />
              <path d="M5 12h4" />
              <path d="M20 25h7" />
            </svg>
          </span>
          <span>GPT Biubiubiu</span>
        </a>

        <nav className="mode-tabs" aria-label="工作台模式">
          <button type="button" className={view === 'generate' ? 'is-active' : ''} onClick={() => setView('generate')}>
            生图
          </button>
          <button
            type="button"
            className={view === 'wall' ? 'is-active' : ''}
            onClick={() => {
              setView('wall');
              loadWall();
            }}
          >
            作品墙
          </button>
        </nav>

        <div className="topbar-actions">
          <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{statusText}</span>
          <button type="button" className="round-tool account-tool" onClick={() => { setAuthTab('profile'); setActiveDialog('auth'); }} aria-label="账号设置">
            {user ? userDisplayName : '登录'}
          </button>
          <button type="button" className="round-tool" onClick={() => setActiveDialog('history')} aria-label="历史记录">
            H
          </button>
        </div>
      </header>

      <section className="canvas-stage">
        <div className="canvas-toolbar">
          <button type="button" className="toolbar-icon-button" onClick={() => { setView('wall'); loadWall(); }} aria-label="刷新作品墙">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.34 5.66" />
              <path d="M20 5v6h-6" />
            </svg>
          </button>
          {renderSelect({
            id: 'board-filter',
            label: '',
            value: boardFilter,
            options: boardFilterOptions,
            onChange: setBoardFilter,
            className: 'toolbar-filter',
            menuDirection: 'down',
          })}
          <label className="toolbar-search" aria-label="搜索作品">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m21 21-4.3-4.3" />
              <circle cx="11" cy="11" r="7" />
            </svg>
            <input value={boardSearch} onChange={(event) => setBoardSearch(event.target.value)} placeholder="搜索提示词、参数、作者..." />
          </label>
        </div>

        <div className={boardItems.length ? 'image-board has-images' : 'image-board'}>
          {boardItems.length ? (
            boardItems.filter(canRenderBoardItem).map(renderImageCard)
          ) : (
            <div className="empty-canvas">
              <span className="empty-mark" aria-hidden="true">
                <svg viewBox="0 0 48 48">
                  <rect x="8" y="10" width="32" height="28" rx="3" />
                  <path d="M14 31l7-7 5 5 4-4 6 6" />
                  <circle cx="31" cy="18" r="3" />
                  <path d="M24 4v6" />
                  <path d="M18 7h12" />
                </svg>
              </span>
              <p>输入提示词开始生成图片</p>
            </div>
          )}
        </div>
      </section>

      {view === 'generate' ? (
        <form className="bottom-workbench" onSubmit={generate}>
          <div className="prompt-console">
            <textarea
              value={form.prompt}
              onChange={(event) => updateForm('prompt', event.target.value)}
              placeholder="描述你想生成的图片，可输入 @ 来指定参考图..."
              rows={2}
            />

            <div className="workbench-actions">
              <div className="control-field size-control">
                <span>尺寸</span>
                <button type="button" className="tool-pill" onClick={openSizeDialog}>
                  {form.size || '自动'}
                </button>
              </div>

              {renderSelect({
                id: 'workbench-quality',
                label: '质量',
                value: form.quality,
                options: qualityOptions,
                onChange: (value) => updateForm('quality', value),
                className: 'control-field',
              })}

              {renderSelect({
                id: 'workbench-background',
                label: '背景',
                value: form.background,
                options: backgroundOptions,
                onChange: (value) => updateForm('background', value),
                className: 'control-field',
              })}

              {renderSelect({
                id: 'workbench-output-format',
                label: '格式',
                value: form.output_format,
                options: outputFormatOptions.map((format) => ({ label: format.toUpperCase(), value: format })),
                onChange: (value) => updateForm('output_format', value),
                className: 'control-field',
              })}

              <label className={canCompressOutput ? 'control-field count-field' : 'control-field count-field is-disabled'}>
                <span>压缩</span>
                <input min="0" max="100" type="number" value={form.output_compression} disabled={!canCompressOutput} onChange={(event) => updateForm('output_compression', event.target.value)} />
              </label>

              {renderSelect({
                id: 'workbench-moderation',
                label: '审核',
                value: form.moderation,
                options: moderationOptions,
                onChange: (value) => updateForm('moderation', value),
                disabled: hasReferenceImages,
                className: 'control-field',
              })}

              <label className="control-field count-field is-disabled">
                <span>数量</span>
                <input min="1" max="1" type="number" value="1" disabled readOnly />
              </label>

              <label className={hasReferenceImages ? 'control-field file-control has-file' : 'control-field file-control'} title={referenceNames || '上传参考图'} aria-label="上传参考图">
                <span>参考图</span>
                <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={handleReferenceChange} />
                <strong>{hasReferenceImages ? `${referenceImages.length} 张` : '上传'}</strong>
              </label>

              <label className={hasReferenceImages ? 'control-field file-control mask-control' : 'control-field file-control mask-control is-disabled'} title={maskImage?.name || '上传 mask'} aria-label="上传 mask">
                <span>Mask</span>
                <input type="file" accept="image/png" disabled={!hasReferenceImages} onChange={handleMaskChange} />
                <strong>{maskImage ? '已选择' : hasReferenceImages ? '可选' : '先传图'}</strong>
              </label>

              <button type="submit" className="send-button" disabled={status.loading} aria-label="生成图片">
                {status.loading ? '...' : '→'}
              </button>
            </div>

            {hasReferenceImages ? (
              <div className="reference-preview">
                <div className="reference-preview-list">
                  {referenceImages.map((image, index) => (
                    <figure key={image.id}>
                      <img src={image.previewUrl} alt={`参考图 ${index + 1}`} />
                      <figcaption>图{index + 1}</figcaption>
                      <button type="button" className="mini-remove" onClick={() => removeReference(image.id)} aria-label={`移除参考图 ${index + 1}`}>×</button>
                    </figure>
                  ))}
                  {maskImage ? (
                    <figure className="mask-preview-card">
                      <img src={maskImage.previewUrl} alt="mask" />
                      <figcaption>Mask</figcaption>
                      <button type="button" className="mini-remove" onClick={clearMask} aria-label="移除 mask">×</button>
                    </figure>
                  ) : null}
                </div>
                <span>{referenceNames}</span>
                <button type="button" className="text-button" onClick={clearReference}>移除全部</button>
              </div>
            ) : null}
          </div>

        </form>
      ) : null}

      {activeDialog ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={closeDialog} />

          {activeDialog === 'detail' && selectedImage ? (
            <section className="modal-card image-detail-modal" role="dialog" aria-modal="true" aria-label="图片详情">
              <div className="detail-preview">
                <div className="detail-badges">
                  <span>◷ {detailElapsed}</span>
                  <span>{detailParams.size || '自动'}</span>
                  <span>{detailParams.output_format || 'png'}</span>
                </div>
                {detailSrc ? (
                  <img src={detailSrc} alt={selectedImage.revised_prompt || selectedImage.prompt || '图片详情'} />
                ) : (
                  <div className="pending-preview detail-pending-preview">
                    <span className="loading-ring" aria-hidden="true" />
                    <strong>{selectedImage.status === 'failed' ? '生成失败' : '生成中...'}</strong>
                    {selectedImage.error ? <p>{selectedImage.error}</p> : null}
                  </div>
                )}
              </div>

              <div className="detail-panel">
                <div className="modal-head">
                  <div>
                    <h2>{selectedImage.status === 'pending' ? '请求详情' : selectedImage.status === 'failed' ? '失败详情' : '图片详情'}</h2>
                    <p>{selectedImage.status === 'pending' ? '生成中' : selectedImage.status === 'failed' ? '请求失败' : selectedImage.authorName || (selectedOnWall ? '已上墙' : '本地生成')}</p>
                  </div>
                  <button type="button" className="close-button" onClick={closeDialog}>×</button>
                </div>

                <div className="prompt-detail">
                  <span>输入内容</span>
                  <p>{selectedImage.revised_prompt || selectedImage.prompt || detailParams.prompt || '无提示词'}</p>
                </div>

                <div className="detail-meta-grid">
                  <div><span>来源</span><strong>{getSourceLabel(selectedImage)}</strong></div>
                  <div><span>尺寸</span><strong>{detailParams.size || '自动'}</strong></div>
                  <div><span>质量</span><strong>{getQualityLabel(detailParams.quality)}</strong></div>
                  <div><span>格式</span><strong>{detailParams.output_format || 'png'}</strong></div>
                  <div><span>背景</span><strong>{detailParams.background || 'auto'}</strong></div>
                  {selectedImage.source === 'edit' ? null : <div><span>审核</span><strong>{detailParams.moderation || 'auto'}</strong></div>}
                  <div><span>数量</span><strong>1</strong></div>
                </div>

                <p className="created-line">创建于 {formatDate(selectedImage.createdAt)} · 耗时 {detailElapsed}</p>

                <div className="detail-actions">
                  {detailSrc ? <a className="secondary-action" href={detailSrc} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">下载</a> : null}
                  <button type="button" className="secondary-action" onClick={() => reuseConfig(selectedImage)}>复用配置</button>
                  {detailSrc ? (
                    <button type="button" className={selectedOnWall ? 'primary-action wall-button is-active' : 'primary-action wall-button'} onClick={() => toggleWall(selectedImage)} disabled={busySelected}>
                      {selectedOnWall ? '★ 取消上墙' : '☆ 上墙'}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeDialog === 'auth' ? (
            <section className="modal-card account-modal" role="dialog" aria-modal="true" aria-label="账号设置">
              <div className="modal-head">
                <div>
                  <h2>{user ? '账号设置' : authMode === 'login' ? '登录' : '注册'}</h2>
                  <p>{user ? '账号信息、密码和参数设置' : '登录后可保存配置，上墙作品显示展示名称'}</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
              </div>

              {user ? (
                <div className="account-panel">
                  <div className="segmented-control two-tabs account-tabs">
                    <button type="button" className={authTab === 'profile' ? 'is-active' : ''} onClick={() => setAuthTab('profile')}>账号信息</button>
                    <button type="button" className={authTab === 'settings' ? 'is-active' : ''} onClick={() => setAuthTab('settings')}>参数设置</button>
                  </div>

                  {authTab === 'profile' ? (
                    <div className="account-section-grid">
                      <div className="summary-box full-field">
                        <span>当前账号</span>
                        <strong>{userDisplayName}</strong>
                        <small>@{user.username}</small>
                      </div>
                      <label>
                        <span>展示名称</span>
                        <input value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="留空则使用用户名" />
                      </label>
                      <button type="button" className="secondary-action align-end" onClick={saveProfile}>保存名称</button>
                      <label>
                        <span>旧密码</span>
                        <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} placeholder="当前密码" />
                      </label>
                      <label>
                        <span>新密码</span>
                        <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} placeholder="至少 6 位" />
                      </label>
                      <button type="button" className="secondary-action" onClick={changePassword}>修改密码</button>
                      <button type="button" className="secondary-action" onClick={logout}>退出登录</button>
                    </div>
                  ) : null}

                  {authTab === 'settings' ? (
                    <div className="settings-grid account-settings-grid">
                      <label>
                        <span>API 名称</span>
                        <input value={apiConfigForm.apiName} onChange={(event) => setApiConfigForm((current) => ({ ...current, apiName: event.target.value }))} placeholder="OpenAI Compatible" />
                      </label>
                      <label>
                        <span>API 地址</span>
                        <input value={apiConfigForm.apiBaseUrl} onChange={(event) => setApiConfigForm((current) => ({ ...current, apiBaseUrl: event.target.value }))} placeholder="由服务端配置" />
                      </label>
                      <label>
                        <span>模型 ID</span>
                        <input value={form.model} onChange={(event) => updateForm('model', event.target.value)} placeholder="gpt-image-2" />
                      </label>
                      <label>
                        <span>请求超时（秒）</span>
                        <input min="10" max={MAX_REQUEST_TIMEOUT_SECONDS} type="number" value={apiConfigForm.requestTimeout} onChange={(event) => setApiConfigForm((current) => ({ ...current, requestTimeout: event.target.value }))} placeholder="999" />
                      </label>
                      <label>
                        <span>流式传输</span>
                        <button
                          type="button"
                          className={apiConfigForm.streamEnabled ? 'toggle-select-like is-active' : 'toggle-select-like'}
                          onClick={() => setApiConfigForm((current) => ({ ...current, streamEnabled: !current.streamEnabled }))}
                        >
                          {apiConfigForm.streamEnabled ? '已启用' : '未启用'}
                        </button>
                      </label>
                      <label className="full-field">
                        <span>密钥</span>
                        <input value={settingsApiKey} onChange={(event) => setSettingsApiKey(event.target.value)} placeholder={settingsMeta?.hasApiKey ? `已保存：${settingsMeta.apiKeyHint}` : '可选，保存前会再次确认'} />
                      </label>
                      <div className="modal-actions full-field">
                        <button type="button" className="secondary-action" onClick={() => setForm(defaultForm)}>重置</button>
                        <button type="button" className="primary-action" onClick={saveAccountSettings}>保存配置</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <form className="auth-form" onSubmit={submitAuth}>
                  <div className="segmented-control two-tabs">
                    <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>登录</button>
                    <button type="button" className={authMode === 'register' ? 'is-active' : ''} onClick={() => setAuthMode('register')}>注册</button>
                  </div>
                  <label>
                    <span>用户名</span>
                    <input value={authForm.username} onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))} placeholder="2-20 位" />
                  </label>
                  {authMode === 'register' ? (
                    <label>
                      <span>展示名称</span>
                      <input value={authForm.displayName} onChange={(event) => setAuthForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="可选，默认同用户名" />
                    </label>
                  ) : null}
                  <label>
                    <span>密码</span>
                    <input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" />
                  </label>
                  <button type="submit" className="primary-action">{authMode === 'login' ? '登录' : '注册'}</button>
                </form>
              )}
            </section>
          ) : null}

          {activeDialog === 'size' ? (
            <section className="modal-card size-modal" role="dialog" aria-modal="true" aria-label="设置图像尺寸">
              <div className="modal-head">
                <div>
                  <h2>设置图像尺寸</h2>
                  <p>当前：{displaySize}</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
              </div>

              <div className="segmented-control">
                <button type="button" className={sizeDraft.mode === 'auto' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'auto' }))}>自动</button>
                <button type="button" className={sizeDraft.mode === 'ratio' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'ratio' }))}>按比例</button>
                <button type="button" className={sizeDraft.mode === 'custom' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'custom' }))}>自定义宽高</button>
              </div>

              {sizeDraft.mode === 'auto' ? (
                <div className="size-tab-panel auto-size-panel">
                  <div className="auto-card">
                    <span className="auto-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 3l1.45 4.05L17.5 8.5l-4.05 1.45L12 14l-1.45-4.05L6.5 8.5l4.05-1.45L12 3Z" />
                        <path d="M18 14l.82 2.18L21 17l-2.18.82L18 20l-.82-2.18L15 17l2.18-.82L18 14Z" />
                        <path d="M6 15l.55 1.45L8 17l-1.45.55L6 19l-.55-1.45L4 17l1.45-.55L6 15Z" />
                      </svg>
                    </span>
                    <div>
                      <strong>自动尺寸</strong>
                      <p>不向模型传递具体的分辨率参数，由模型或上游接口自行决定生成尺寸。</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {sizeDraft.mode === 'ratio' ? (
                <div className="size-tab-panel ratio-size-panel">
                  <div className="modal-section">
                    <span className="section-label">基准分辨率</span>
                    <div className="resolution-row">
                      {resolutionGroups.map((item) => (
                        <button
                          type="button"
                          className={sizeDraft.resolution === item.value ? 'select-card is-active' : 'select-card'}
                          key={item.value}
                          onClick={() => setSizeDraft((draft) => {
                            const nextRatios = getAvailableRatios(item.value);
                            const nextRatio = draft.ratio === 'custom-ratio' || ratioToSize[item.value]?.[draft.ratio] ? draft.ratio : nextRatios[0]?.value || '1:1';
                            return { ...draft, resolution: item.value, ratio: nextRatio };
                          })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="modal-section">
                    <span className="section-label">图像比例</span>
                    <div className="ratio-grid">
                      {availableRatios.filter((item) => item.value !== 'custom-ratio').map((item) => (
                        <button
                          type="button"
                          className={sizeDraft.ratio === item.value ? 'ratio-card is-active' : 'ratio-card'}
                          key={item.value}
                          onClick={() => setSizeDraft((draft) => ({ ...draft, ratio: item.value }))}
                        >
                          <span className={`ratio-icon ${item.icon}`} />
                          <strong>{item.label}</strong>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={sizeDraft.ratio === 'custom-ratio' ? 'custom-ratio-button is-active' : 'custom-ratio-button'}
                      onClick={() => setSizeDraft((draft) => ({ ...draft, ratio: 'custom-ratio' }))}
                    >
                      自定义比例
                    </button>
                  </div>

                  {sizeDraft.ratio === 'custom-ratio' ? (
                    <div className="custom-ratio-row">
                      <label>
                        <span>宽比例</span>
                        <input type="number" min="1" max="300" value={sizeDraft.customRatioWidth} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customRatioWidth: Number(event.target.value) }))} />
                      </label>
                      <label>
                        <span>高比例</span>
                        <input type="number" min="1" max="300" value={sizeDraft.customRatioHeight} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customRatioHeight: Number(event.target.value) }))} />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sizeDraft.mode === 'custom' ? (
                <div className="size-tab-panel custom-size-panel">
                  <div className="custom-size-row">
                    <label>
                      <span>宽度</span>
                      <input type="number" min="256" value={sizeDraft.customWidth} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customWidth: Number(event.target.value) }))} />
                    </label>
                    <label>
                      <span>高度</span>
                      <input type="number" min="256" value={sizeDraft.customHeight} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customHeight: Number(event.target.value) }))} />
                    </label>
                  </div>
                  <div className="size-limit-note">
                    <span className="auto-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <rect x="4" y="5" width="16" height="14" rx="2" />
                        <path d="M8 9h8" />
                        <path d="M8 15h8" />
                        <path d="M9 3v4" />
                        <path d="M15 17v4" />
                      </svg>
                    </span>
                    <strong>由于模型限制，最终输出会自动规整到合法尺寸</strong>
                    <span>宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。</span>
                  </div>
                </div>
              ) : null}

              <div className="summary-box">
                <span>评估图</span>
                <strong>{displaySize}</strong>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={closeDialog}>取消</button>
                <button type="button" className="primary-action" onClick={applySize}>确定</button>
              </div>
            </section>
          ) : null}

          {activeDialog === 'history' ? (
            <section className="modal-card history-modal" role="dialog" aria-modal="true" aria-label="生成历史">
              <div className="modal-head">
                <div>
                  <h2>生成历史</h2>
                  <p>最近 30 条记录保存在当前浏览器</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
              </div>

              <div className="history-list modal-history-list">
                {history.length ? (
                  history.map((item) => (
                    <button type="button" className="history-item" key={item.id} onClick={() => selectHistory(item)}>
                      <span>{item.form.prompt}</span>
                      <small>{item.form.size || '自动'} · {formatDate(item.createdAt)}</small>
                    </button>
                  ))
                ) : (
                  <div className="empty-history">暂无生成记录</div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={clearHistory} disabled={!history.length}>清空</button>
                <button type="button" className="primary-action" onClick={closeDialog}>完成</button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export default App;