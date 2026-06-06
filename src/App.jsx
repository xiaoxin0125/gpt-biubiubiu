import { useEffect, useMemo, useRef, useState } from 'react';

const HISTORY_KEY = 'gpt-biubiubiu:image-history';
const DIRECT_API_KEY_CACHE_KEY = 'gpt-biubiubiu:direct-api-keys';
const DEFAULT_DIRECT_API_BASE_URL = 'https://api.apiyi.com';
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
const responseFormatOptions = [
  { label: 'URL', value: 'url' },
  { label: 'Base64', value: 'b64_json' },
];
const MAX_OUTPUT_IMAGES = 10;
const backgroundOptions = ['auto', 'opaque'];
const moderationOptions = ['auto', 'low'];
const boardScopeOptions = [
  { label: '全部作品', value: 'all' },
  { label: '本次生成', value: 'generate' },
  { label: '历史记录', value: 'history' },
];
const boardFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已上墙', value: 'on-wall' },
  { label: '未上墙', value: 'off-wall' },
  { label: '文生图', value: 'generation' },
  { label: '图生图', value: 'edit' },
];
const wallFilterOptions = [
  { label: '全部状态', value: 'all' },
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
  response_format: 'url',
  output_format: 'png',
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

const defaultApiConfigItem = {
  id: 'default-api-config',
  apiName: 'API易 gpt-image-2',
  apiBaseUrl: DEFAULT_DIRECT_API_BASE_URL,
  model: defaultForm.model,
  apiKey: '',
  hasApiKey: false,
  apiKeyHint: '',
  requestTimeout: MAX_REQUEST_TIMEOUT_SECONDS,
};

const defaultApiConfigForm = {
  ...defaultApiConfigItem,
  stream: false,
  activeApiConfigId: defaultApiConfigItem.id,
  apiConfigs: [defaultApiConfigItem],
};

const normalizeQuality = (value) => (qualityOptions.some((item) => item.value === value) ? value : 'auto');
const normalizeBackground = (value) => (backgroundOptions.includes(value) ? value : 'auto');
const normalizeResponseFormat = (value) => (responseFormatOptions.some((item) => item.value === value) ? value : 'b64_json');
const normalizeOutputFormat = (value) => (outputFormatOptions.includes(value) ? value : 'png');
const normalizeModeration = (value) => (moderationOptions.includes(value) ? value : 'auto');
const normalizeOutputCount = (value) => clampNumber(Math.round(Number(value) || defaultForm.n), 1, MAX_OUTPUT_IMAGES);
const getQualityLabel = (value) => qualityOptions.find((item) => item.value === value)?.label || '自动';
const getResponseFormatLabel = (value) => responseFormatOptions.find((item) => item.value === value)?.label || 'Base64';
const normalizeRevisedPrompt = (...values) => values.map((value) => String(value || '').trim()).find(Boolean) || '';
const normalizeForm = (value = {}) => {
  const nextForm = { ...defaultForm, ...value };

  return {
    model: String(nextForm.model || defaultForm.model).trim() || defaultForm.model,
    prompt: String(nextForm.prompt || ''),
    size: String(nextForm.size || ''),
    n: normalizeOutputCount(nextForm.n),
    quality: normalizeQuality(nextForm.quality),
    background: normalizeBackground(nextForm.background),
    response_format: normalizeResponseFormat(nextForm.response_format),
    output_format: normalizeOutputFormat(nextForm.output_format),
    moderation: normalizeModeration(nextForm.moderation),
  };
};

const DATA_IMAGE_URL_PATTERN = /^data[:：](image\/[a-z0-9.+-]+);base64,/i;
const objectImageUrlCache = new Map();

const getDataImageMime = (value) => String(value || '').match(DATA_IMAGE_URL_PATTERN)?.[1] || '';

const isDataImageValue = (value) => DATA_IMAGE_URL_PATTERN.test(String(value || ''));

const stripDataImagePrefix = (value) => String(value || '').replace(DATA_IMAGE_URL_PATTERN, '');

const toCompactBase64 = (value) => stripDataImagePrefix(value).replace(/\s+/g, '');

const createObjectImageUrl = (value, fallbackMime = 'image/png') => {
  const compactBase64 = toCompactBase64(value);
  if (!compactBase64) return '';

  const mime = getDataImageMime(value) || fallbackMime || 'image/png';
  const cacheKey = `${mime}:${compactBase64}`;
  const cachedUrl = objectImageUrlCache.get(cacheKey);
  if (cachedUrl) return cachedUrl;

  if (typeof window === 'undefined' || typeof window.atob !== 'function' || !window.URL?.createObjectURL) {
    return `data:${mime};base64,${compactBase64}`;
  }

  try {
    const binary = window.atob(compactBase64);
    const chunkSize = 8192;
    const chunks = [];

    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const chunk = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(chunk.length);
      for (let index = 0; index < chunk.length; index += 1) bytes[index] = chunk.charCodeAt(index);
      chunks.push(bytes);
    }

    const objectUrl = window.URL.createObjectURL(new Blob(chunks, { type: mime }));
    objectImageUrlCache.set(cacheKey, objectUrl);
    return objectUrl;
  } catch {
    return `data:${mime};base64,${compactBase64}`;
  }
};

const revokeObjectImageUrls = () => {
  if (typeof window === 'undefined' || !window.URL?.revokeObjectURL) return;
  objectImageUrlCache.forEach((objectUrl) => window.URL.revokeObjectURL(objectUrl));
  objectImageUrlCache.clear();
};

if (typeof window !== 'undefined') window.addEventListener('beforeunload', revokeObjectImageUrls);

const createImageSrc = (image) => {
  const url = String(image?.url || image?.image_url || '');
  if (url) return isDataImageValue(url) ? createObjectImageUrl(url, getDataImageMime(url) || image?.imageMime || 'image/png') : url;

  const b64Json = String(image?.b64_json || image?.image_b64 || '');
  if (!b64Json) return '';

  return createObjectImageUrl(b64Json, getDataImageMime(b64Json) || image?.imageMime || image?.image_mime || 'image/png');
};

const createImageDownloadSrc = (image) => {
  const url = String(image?.downloadUrl || image?.originalUrl || image?.original_url || image?.url || image?.image_url || '');
  if (url) return isDataImageValue(url) ? createObjectImageUrl(url, getDataImageMime(url) || image?.imageMime || 'image/png') : url;
  return createImageSrc(image);
};

const normalizeImageSource = (source) => {
  if (source === 'edit') return 'edit';
  if (source === 'wall') return 'wall';
  return 'generation';
};

const getImageIdentity = (image) => String(image?.wallItemId || image?.id || createImageSrc(image) || '');

const getEmptyBoardText = (scope, view = 'generate') => {
  if (view === 'wall') return '暂无上墙作品';
  if (scope === 'history') return '暂无历史记录';
  if (scope === 'all') return '暂无作品记录';
  return '输入提示词开始生成图片';
};

const normalizeBoardImage = (image, fallback = {}) => {
  const hasRenderableImage = Boolean(createImageSrc(image));
  return {
    ...image,
    id: image?.id || fallback.id || `image-${Date.now()}`,
    status: hasRenderableImage ? 'completed' : image?.status || 'completed',
    form: normalizeForm(image?.form || fallback.form || {}),
    prompt: image?.prompt || fallback.prompt || image?.form?.prompt || fallback.form?.prompt || '',
    createdAt: image?.createdAt || fallback.createdAt || new Date().toISOString(),
    source: normalizeImageSource(image?.source || fallback.source),
  };
};

const flattenHistoryImages = (items) => items.flatMap((record) => {
  const form = normalizeForm(record.form || {});
  return (record.images || []).map((image) => normalizeBoardImage(image, {
    form,
    prompt: form.prompt || '',
    createdAt: record.createdAt,
    source: image.source || 'generation',
    historyId: record.id,
  })).map((image) => ({ ...image, historyId: record.id, source: normalizeImageSource(image.source) }));
});

const removeImageFromHistory = (items, target) => items
  .map((record) => {
    const nextImages = (record.images || []).filter((image) => {
      const normalized = normalizeBoardImage(image, {
        form: record.form,
        createdAt: record.createdAt,
        source: image.source || 'generation',
      });
      return !isSameImageIdentity(normalized, target);
    });
    return { ...record, images: nextImages };
  })
  .filter((record) => (record.images || []).length > 0);

const isSameImageIdentity = (left, right) => {
  if (!left || !right) return false;
  if (left.wallItemId && right.wallItemId && Number(left.wallItemId) === Number(right.wallItemId)) return true;
  if (left.id && right.id && String(left.id) === String(right.id)) return true;
  const leftSrc = createImageSrc(left);
  const rightSrc = createImageSrc(right);
  return Boolean(leftSrc && rightSrc && leftSrc === rightSrc);
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

const readDirectApiKeyCache = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIRECT_API_KEY_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const directApiConfigFingerprint = (config = {}) => [
  normalizeApiBaseUrl(config.apiBaseUrl || config.api_base_url || defaultApiConfigItem.apiBaseUrl),
  String(config.model || defaultApiConfigItem.model).trim(),
  String(config.apiName || config.api_name || defaultApiConfigItem.apiName).trim(),
].join('|');

const getCachedDirectApiKey = (config = {}) => {
  const cache = readDirectApiKeyCache();
  return String(cache[String(config.id)] || cache[directApiConfigFingerprint(config)] || '').trim();
};

const rememberDirectApiKeys = (configs = []) => {
  const cache = readDirectApiKeyCache();
  let changed = false;

  configs.forEach((config) => {
    const apiKey = String(config?.apiKey || config?.api_key || '').trim();
    if (!apiKey) return;
    cache[String(config.id)] = apiKey;
    cache[directApiConfigFingerprint(config)] = apiKey;
    changed = true;
  });

  if (changed) localStorage.setItem(DIRECT_API_KEY_CACHE_KEY, JSON.stringify(cache));
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

const normalizeApiBaseUrl = (value) => String(value || DEFAULT_DIRECT_API_BASE_URL).replace(/\s+/g, '').replace(/\/+$/, '') || DEFAULT_DIRECT_API_BASE_URL;

const createLocalApiConfigId = () => `api-config-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeApiConfigItem = (value = {}, index = 0) => {
  const base = {
    id: value.id ?? value.configId ?? value.config_id ?? createLocalApiConfigId(),
    apiName: String(value.apiName || value.api_name || (index === 0 ? defaultApiConfigItem.apiName : `API 配置 ${index + 1}`)).trim() || defaultApiConfigItem.apiName,
    apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl || value.api_base_url || defaultApiConfigItem.apiBaseUrl),
    model: String(value.model || defaultApiConfigItem.model).trim() || defaultApiConfigItem.model,
    apiKey: String(value.apiKey || value.api_key || '').trim(),
    hasApiKey: Boolean(value.hasApiKey || value.has_api_key || value.apiKey || value.api_key),
    apiKeyHint: String(value.apiKeyHint || value.api_key_hint || ''),
    requestTimeout: clampNumber(Number(value.requestTimeout || value.request_timeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS),
  };
  const cachedApiKey = getCachedDirectApiKey(base);
  return cachedApiKey ? { ...base, apiKey: cachedApiKey, hasApiKey: true } : base;
};

const normalizeServerSettings = (value = {}) => {
  const rawConfigs = Array.isArray(value.apiConfigs || value.api_configs)
    ? (value.apiConfigs || value.api_configs)
    : [value.activeConfig || value.active_config || value];
  const apiConfigs = rawConfigs.map(normalizeApiConfigItem).filter(Boolean);
  const safeConfigs = apiConfigs.length ? apiConfigs : [normalizeApiConfigItem(defaultApiConfigItem)];
  const activeApiConfigId = value.activeApiConfigId ?? value.active_api_config_id ?? value.activeConfig?.id ?? value.active_config?.id ?? safeConfigs[0].id;
  const activeConfig = safeConfigs.find((item) => String(item.id) === String(activeApiConfigId)) || safeConfigs[0];

  return {
    ...activeConfig,
    stream: Boolean(value.stream),
    activeApiConfigId: activeConfig.id,
    apiConfigs: safeConfigs,
    form: normalizeForm({ model: activeConfig.model || defaultForm.model }),
  };
};

const imageMimeForOutputFormat = (format) => {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
};

const normalizeDirectImageItem = (image, index, outputFormat) => {
  const rawSourceValue = typeof image === 'string'
    ? image
    : image?.b64_json || image?.url || image?.data_url || image?.data || image?.image || image?.content || '';
  const sourceValue = String(rawSourceValue || '');
  const dataImageMime = getDataImageMime(sourceValue);
  const imageMime = image?.imageMime || image?.mime || dataImageMime || imageMimeForOutputFormat(outputFormat);
  const revisedPrompt = normalizeRevisedPrompt(image?.revised_prompt, image?.revisedPrompt, image?.prompt_revised);
  const nextImage = {
    ...(image && typeof image === 'object' ? image : {}),
    id: image?.id || `${Date.now()}-${index}`,
    imageMime,
  };

  if (revisedPrompt && !nextImage.revised_prompt) nextImage.revised_prompt = revisedPrompt;

  if (sourceValue) {
    if (isDataImageValue(sourceValue)) {
      nextImage.b64_json = stripDataImagePrefix(sourceValue);
      nextImage.imageMime = dataImageMime || imageMime;
      delete nextImage.url;
    } else if (/^https?:\/\//.test(sourceValue)) {
      nextImage.url = sourceValue;
    } else if (!nextImage.b64_json) {
      nextImage.b64_json = sourceValue;
    }
  }

  return nextImage;
};

const normalizeDirectImageResponse = (data, outputFormat) => {
  const rawItems = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.images)
      ? data.images
      : data?.b64_json || data?.url || data?.image || data?.data_url || (typeof data?.data === 'string' && data.data)
        ? [data]
        : [];

  return {
    created: data?.created || Math.floor(Date.now() / 1000),
    usage: data?.usage || null,
    raw: data,
    data: rawItems.map((image, index) => {
      const normalized = normalizeDirectImageItem(image, index, outputFormat);
      const topLevelRevisedPrompt = normalizeRevisedPrompt(data?.revised_prompt, data?.revisedPrompt, data?.prompt_revised);
      return normalized.revised_prompt || !topLevelRevisedPrompt ? normalized : { ...normalized, revised_prompt: topLevelRevisedPrompt };
    }),
  };
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

  if (!response.ok) throw new Error(data.error || data.message || data.detail || '请求失败');
  return data;
};

const buildDirectImageApiUrl = (config = {}, path) => {
  const baseUrl = normalizeApiBaseUrl(config.apiBaseUrl || config.api_base_url || defaultApiConfigItem.apiBaseUrl);
  const base = new URL(baseUrl);
  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`;
  const basePath = base.pathname.replace(/\/+$/, '');
  base.pathname = basePath && normalizedPath.startsWith(`${basePath}/`) ? normalizedPath : `${basePath}${normalizedPath}`;
  base.search = '';
  base.hash = '';
  return base.toString();
};

const parseDirectImageResponseText = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  if (/^data:(image\/[a-z0-9.+-]+);base64,/i.test(trimmed)) return { data: trimmed };

  const payloads = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload && payload !== '[DONE]');

  if (payloads.length) {
    const events = [];
    let imagePayload = '';
    payloads.forEach((payload) => {
      if (/^data:(image\/[a-z0-9.+-]+);base64,/i.test(payload)) {
        imagePayload = payload;
        return;
      }
      try {
        const decoded = JSON.parse(payload);
        if (decoded && typeof decoded === 'object') events.push(decoded);
      } catch {
        // 忽略非 JSON 事件片段
      }
    });

    if (imagePayload) return { data: imagePayload };

    let imageEvent = events.find((event) => normalizeDirectImageResponse(event, 'png').data.length) || events.at(-1) || {};
    const revisedPrompt = events.map((event) => normalizeRevisedPrompt(event?.revised_prompt, event?.revisedPrompt, event?.prompt_revised)).filter(Boolean).at(-1) || '';
    if (revisedPrompt && imageEvent && typeof imageEvent === 'object') imageEvent = { ...imageEvent, revised_prompt: revisedPrompt };
    return imageEvent;
  }

  return JSON.parse(trimmed);
};

const readDirectImageResponse = async (response) => {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let data = {};

  if (text && (contentType.includes('application/json') || contentType.includes('text/event-stream') || /^[\s\r\n]*(data:|[\[{])/.test(text))) {
    try {
      data = parseDirectImageResponseText(text);
    } catch {
      throw new Error('上游接口返回了无法解析的数据。');
    }
  } else if (text && /^[\s\r\n]*</.test(text)) {
    throw new Error('上游接口返回了页面内容，请检查 API 地址是否正确。');
  } else if (text) {
    throw new Error(text.slice(0, 180) || '上游接口返回异常内容。');
  }

  if (!response.ok) {
    const error = data?.error;
    if (error && typeof error === 'object') throw new Error(error.message || '上游接口请求失败');
    throw new Error(String(error || data?.message || data?.detail || '上游接口请求失败'));
  }

  return data;
};

const requestDirectImageJson = async (config, apiKey, payload) => {
  const response = await fetch(buildDirectImageApiUrl(config, '/v1/images/generations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return readDirectImageResponse(response);
};

const requestDirectImageFormData = async (config, apiKey, payload) => {
  const response = await fetch(buildDirectImageApiUrl(config, '/v1/images/edits'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload,
  });
  return readDirectImageResponse(response);
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
  const [authMode, setAuthMode] = useState('login');
  const [authTab, setAuthTab] = useState('profile');
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [apiConfigForm, setApiConfigForm] = useState(defaultApiConfigForm);
  const [selectedImage, setSelectedImage] = useState(null);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '检查接口中' });
  const [error, setError] = useState('');
  const [activeDialog, setActiveDialog] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(defaultSizeDraft);
  const [wallBusyId, setWallBusyId] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');
  const [boardScope, setBoardScope] = useState('all');
  const [openSelect, setOpenSelect] = useState('');
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const deletedRequestIdsRef = useRef(new Set());

  const hasReferenceImages = referenceImages.length > 0;
  const responseFormat = normalizeResponseFormat(form.response_format);
  const canUseOutputFormat = responseFormat === 'url';
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

  const buildGenerationPayload = (prompt, apiConfig = activeApiConfig) => {
    const normalized = normalizeForm({ ...form, prompt, model: apiConfig?.model || form.model });
    const useStream = Boolean(apiConfig?.stream ?? apiConfigForm.stream);
    const responseFormat = useStream ? 'url' : normalizeResponseFormat(normalized.response_format);
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const canUseOutputFormat = responseFormat === 'url';
    const payload = {
      model: normalized.model || defaultForm.model,
      prompt,
      n: normalizeOutputCount(normalized.n),
      response_format: responseFormat,
      moderation: normalizeModeration(normalized.moderation),
    };

    if (canUseOutputFormat) payload.output_format = outputFormat;
    if (normalized.size) payload.size = normalized.size;
    if (useStream && responseFormat === 'url') payload.stream = true;
    if (normalizeQuality(normalized.quality) !== 'auto') payload.quality = normalizeQuality(normalized.quality);
    if (normalizeBackground(normalized.background) !== 'auto') payload.background = normalizeBackground(normalized.background);

    return payload;
  };

  const buildEditPayload = (prompt, apiConfig = activeApiConfig) => {
    const normalized = normalizeForm({ ...form, prompt, model: apiConfig?.model || form.model });
    const outputFormat = normalizeOutputFormat(normalized.output_format);
    const canUseOutputFormat = responseFormat === 'url';
    const payload = new FormData();

    payload.append('model', normalized.model || defaultForm.model);
    payload.append('prompt', prompt);
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
      apiBaseUrl: activeApiConfig?.apiBaseUrl || DEFAULT_DIRECT_API_BASE_URL,
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

  const applyServerSettings = (settings, nextUser = user) => {
    const normalized = normalizeServerSettings(settings || {});
    const nextForm = normalizeForm({ ...normalized.form, model: normalized.model, prompt: form.prompt });

    setForm((current) => ({ ...current, ...nextForm, prompt: current.prompt }));
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
      setApiConfigForm((current) => {
        const currentKeys = new Map((current.apiConfigs || []).map((item) => [String(item.id), item.apiKey || '']));
        return {
          ...normalized,
          apiConfigs: normalized.apiConfigs.map((item) => ({ ...item, apiKey: item.apiKey || currentKeys.get(String(item.id)) || getCachedDirectApiKey(item) })),
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
      setOpenSelect('');
      setError('');
    } catch (switchError) {
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

  useEffect(() => {
    setHistory(readHistory());

    requestJson('/api/auth/me')
      .then((data) => {
        const nextUser = data.user || null;
        setUser(nextUser);
        if (nextUser) {
          applyServerSettings(data.settings, nextUser);
        } else {
          setApiConfigForm(defaultApiConfigForm);
          setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
        }
      })
      .catch(() => {
        setStatus((current) => ({ ...current, loading: false, configured: false, message: '请先登录' }));
      });

    loadWall();
  }, []);

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
    if (image.wallItemId) return wallItems.find((item) => Number(item.id) === Number(image.wallItemId)) || { id: image.wallItemId };

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

  const isSameImage = isSameImageIdentity;

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

  const clearHistory = () => {
    if (!history.length || !window.confirm('确认清空历史记录？')) return;
    setHistory([]);
    saveHistory([]);
    if (boardScope === 'history') setSelectedImage(null);
  };

  const deleteImage = (image) => {
    if (!image || !window.confirm('确认删除这张图片记录？')) return;

    const requestId = image.requestId || image.id;
    if (requestId) deletedRequestIdsRef.current.add(requestId);
    setImages((items) => items.filter((item) => !isSameImage(item, image)));
    const nextHistory = removeImageFromHistory(history, image);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    setSelectedImage((current) => (current && isSameImage(current, image) ? null : current));
    if (selectedImage && isSameImage(selectedImage, image)) setActiveDialog(null);
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
    setStatus((current) => ({ ...current, loading: true, message: hasReferenceImages ? 'Editing' : 'Generating' }));
    setView('generate');
    setBoardScope('generate');

    const requestId = `request-${Date.now()}`;
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
      const requestApiKey = String(requestConfig.apiKey || getCachedDirectApiKey(requestConfig)).trim();
      if (!requestApiKey) throw new Error('前端直连需要在当前浏览器重新填写并保存 API Key。');
      const payload = hasReferenceImages
        ? buildEditPayload(prompt, requestConfig)
        : buildGenerationPayload(prompt, { ...requestConfig, stream: apiConfigForm.stream });
      const data = hasReferenceImages
        ? await requestDirectImageFormData(requestConfig, requestApiKey, payload)
        : await requestDirectImageJson(requestConfig, requestApiKey, payload);
      const outputFormat = hasReferenceImages
        ? (responseFormat === 'url' ? normalizeOutputFormat(form.output_format) : defaultForm.output_format)
        : payload.output_format || defaultForm.output_format;
      const normalizedData = normalizeDirectImageResponse(data, outputFormat);

      const finishedAt = new Date().toISOString();
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, loading: false, message: 'Done · 0' }));
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
      try {
        setHistory(nextHistory);
        saveHistory(nextHistory);
      } catch {
        setHistory(nextHistory);
        setError('图片已生成，但本地历史记录保存失败。');
      }
      setStatus((current) => ({ ...current, loading: false, message: `Done · ${nextImages.length}` }));
    } catch (requestError) {
      const failedAt = new Date().toISOString();
      const message = requestError instanceof Error ? requestError.message : '生成失败';
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, loading: false, message: current.configured ? '已删除' : current.message }));
        return;
      }
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
      if (wallItem?.id) {
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

      const imageMime = getDataImageMime(image.b64_json) || image.imageMime || 'image/png';
      const imageB64 = isDataImageValue(image.b64_json) ? stripDataImagePrefix(image.b64_json) : image.b64_json || '';
      const data = await requestJson('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: {
            url: createImageDownloadSrc(image) || image.url || '',
            b64_json: imageB64,
            mime: imageMime,
          },
          prompt: image.prompt || image.form?.prompt || form.prompt,
          revised_prompt: normalizeRevisedPrompt(image.revised_prompt),
          durationSeconds: getElapsedSeconds(image),
          sourceJobId: image.sourceJobId || image.jobId || null,
          form: { ...(image.form || form), source: normalizeImageSource(image.source), sourceJobId: image.sourceJobId || image.jobId || null },
          params: { ...(image.form || form), source: normalizeImageSource(image.source), durationSeconds: getElapsedSeconds(image), sourceJobId: image.sourceJobId || image.jobId || null },
        }),
      });

      const nextWallItem = data.item;
      setWallItems((items) => [nextWallItem, ...items.filter((item) => Number(item.id) !== Number(nextWallItem.id))]);
      setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true } : item)));
      setHistory((items) => {
        const nextHistory = items.map((record) => ({
          ...record,
          images: (record.images || []).map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true } : item)),
        }));
        saveHistory(nextHistory);
        return nextHistory;
      });
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
      if (data.user) applyServerSettings(data.settings, data.user);
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
    setProfileForm(emptyProfileForm);
    setPasswordForm(emptyPasswordForm);
    setApiConfigForm(defaultApiConfigForm);
    setStatus((current) => ({ ...current, configured: false, apiName: '', message: '请先登录' }));
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
    rememberDirectApiKeys(apiConfigForm.apiConfigs || []);
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
      setForm((current) => ({ ...current, model: data.settings?.model || activeApiConfig?.model || current.model }));
      setError('');
      setAuthTab('settings');
    } catch (settingsError) {
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
  const busySelected = selectedImage && wallBusyId === String(selectedImage.wallItemId || selectedImage.id || detailSrc);

  const renderImageCard = (image) => {
    const src = createImageSrc(image);
    const isPending = image.status === 'pending';
    const isFailed = image.status === 'failed';
    const title = normalizeRevisedPrompt(image.revised_prompt) || image.prompt || image.form?.prompt || 'Generated image';
    const apiName = image.apiName || status.apiName || activeApiConfig?.apiName || defaultApiConfigItem.apiName;
    const canDelete = view !== 'wall';

    return (
      <figure className={`result-card ${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''}`.trim()} key={`${image.source || 'image'}-${image.id || image.wallItemId || src}`} onClick={() => openDetail(image)}>
        {canDelete ? (
          <button
            type="button"
            className="result-delete-button"
            onClick={(event) => {
              event.stopPropagation();
              deleteImage(image);
            }}
            aria-label="删除图片"
          >
            ×
          </button>
        ) : null}
        <div className="result-image-wrap">
          {src ? (
            <img src={src} alt={title || '生成图片'} />
          ) : (
            <div className="pending-preview">
              <span className="loading-ring" aria-hidden="true" />
              <strong>{isFailed ? '生成失败' : '生成中...'}</strong>
            </div>
          )}
        </div>
        <figcaption className="result-api-name">{apiName}</figcaption>
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
          <button
            type="button"
            className={view === 'generate' ? 'is-active' : ''}
            onClick={() => {
              setView('generate');
            }}
          >
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
          {status.configured && user ? renderSelect({
            id: 'topbar-api-switch',
            label: '',
            value: activeApiConfig?.id || apiConfigForm.activeApiConfigId,
            options: (apiConfigForm.apiConfigs || []).filter((item) => item.hasApiKey).map((item) => ({ label: item.apiName || defaultApiConfigItem.apiName, value: item.id })),
            onChange: switchActiveApiConfig,
            className: 'status-api-select',
            menuDirection: 'down',
          }) : (
            <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{statusText}</span>
          )}
          <button type="button" className="round-tool account-tool" onClick={() => { setAuthTab('profile'); setActiveDialog('auth'); }} aria-label="账号设置">
            {user ? userDisplayName : '登录'}
          </button>
        </div>
      </header>

      <section className={view === 'wall' ? 'canvas-stage is-wall-view' : 'canvas-stage'}>
        <div className="canvas-toolbar">
          <button type="button" className="toolbar-icon-button" onClick={view === 'wall' ? loadWall : () => setHistory(readHistory())} aria-label={view === 'wall' ? '刷新作品墙' : '刷新作品'}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.34 5.66" />
              <path d="M20 5v6h-6" />
            </svg>
          </button>
          {view === 'generate' ? renderSelect({
            id: 'board-scope',
            label: '',
            value: boardScope,
            options: boardScopeOptions,
            onChange: setBoardScope,
            className: 'toolbar-scope',
            menuDirection: 'down',
          }) : null}
          {renderSelect({
            id: 'board-filter',
            label: '',
            value: activeBoardFilter,
            options: activeFilterOptions,
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
          {view === 'generate' && boardScope === 'history' ? (
            <button type="button" className="toolbar-text-button" onClick={clearHistory} disabled={!history.length}>清空历史</button>
          ) : null}
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
              <p>{getEmptyBoardText(boardScope, view)}</p>
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
              placeholder="描述你想生成的图片..."
              rows={2}
            />

            <div className={workbenchExpanded ? 'workbench-actions is-expanded' : 'workbench-actions'}>
              <button type="button" className="workbench-toggle-button" onClick={() => setWorkbenchExpanded((current) => !current)} aria-expanded={workbenchExpanded} aria-label={workbenchExpanded ? '收起参数' : '展开参数'}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16" />
                  <path d="M7 12h10" />
                  <path d="M10 17h4" />
                </svg>
              </button>
              <div className="control-field size-control workbench-extra-control">
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
                className: 'control-field workbench-extra-control',
              })}

              {renderSelect({
                id: 'workbench-background',
                label: '背景',
                value: form.background,
                options: backgroundOptions,
                onChange: (value) => updateForm('background', value),
                className: 'control-field workbench-extra-control',
              })}

              {renderSelect({
                id: 'workbench-response-format',
                label: '返回格式',
                value: responseFormat,
                options: responseFormatOptions,
                onChange: (value) => updateForm('response_format', value),
                className: 'control-field response-format-control workbench-extra-control',
              })}

              {renderSelect({
                id: 'workbench-output-format',
                label: '格式',
                value: form.output_format,
                options: outputFormatOptions.map((format) => ({ label: format.toUpperCase(), value: format })),
                onChange: (value) => updateForm('output_format', value),
                disabled: !canUseOutputFormat,
                className: 'control-field workbench-extra-control',
              })}

              {renderSelect({
                id: 'workbench-moderation',
                label: '审核',
                value: form.moderation,
                options: moderationOptions,
                onChange: (value) => updateForm('moderation', value),
                disabled: hasReferenceImages,
                className: 'control-field workbench-extra-control',
              })}

              <label className="control-field count-field workbench-extra-control">
                <span>数量</span>
                <input min="1" max={MAX_OUTPUT_IMAGES} type="number" value={form.n} onChange={(event) => updateForm('n', normalizeOutputCount(event.target.value))} />
              </label>

              <label className={hasReferenceImages ? 'control-field file-control has-file icon-file-control' : 'control-field file-control icon-file-control'} title={referenceNames || '上传参考图'} aria-label="上传参考图">
                <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={handleReferenceChange} />
                <strong>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="14" rx="3" />
                    <path d="m7 15 3.2-3.2 2.6 2.6 1.7-1.7L18 16" />
                    <circle cx="15.5" cy="9.5" r="1.5" />
                    <path d="M18 4v4" />
                    <path d="M16 6h4" />
                  </svg>
                  <em>{hasReferenceImages ? referenceImages.length : ''}</em>
                </strong>
              </label>

              <label className={hasReferenceImages ? 'control-field file-control mask-control icon-file-control' : 'control-field file-control mask-control icon-file-control is-disabled'} title={maskImage?.name || '上传 mask'} aria-label="上传 mask">
                <input type="file" accept="image/png" disabled={!hasReferenceImages} onChange={handleMaskChange} />
                <strong>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 5h14v7c0 4.2-2.8 6.9-7 8-4.2-1.1-7-3.8-7-8V5Z" />
                    <path d="M8 10h3" />
                    <path d="M13 10h3" />
                    <path d="M9 15c1.8 1.2 4.2 1.2 6 0" />
                    <path d="M19 5 5 19" />
                  </svg>
                  <em>{maskImage ? '1' : ''}</em>
                </strong>
              </label>

              <button type="submit" className="send-button" disabled={status.loading} aria-label="生成图片">
                {status.loading ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="loading-dots-icon">
                    <circle cx="6" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="18" cy="12" r="1.8" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 12 20 5l-5.4 14-3.1-6.5L4 12Z" />
                    <path d="m11.5 12.5 4.2-4.2" />
                  </svg>
                )}
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
                  {detailElapsed ? <span>◷ {detailElapsed}</span> : null}
                  <span>{detailParams.size || '自动'}</span>
                  <span>{detailParams.response_format === 'url' ? detailParams.output_format || 'png' : getResponseFormatLabel(detailParams.response_format)}</span>
                </div>
                {detailSrc ? (
                  <img src={detailSrc} alt={detailRevisedPrompt || selectedImage.prompt || '图片详情'} />
                ) : (
                  <div className="pending-preview detail-pending-preview">
                    <span className="loading-ring" aria-hidden="true" />
                    <strong>{detailIsFailed ? '生成失败' : '生成中...'}</strong>
                    {selectedImage.error ? <p>{selectedImage.error}</p> : null}
                  </div>
                )}
              </div>

              <div className="detail-panel">
                <div className="modal-head">
                  <div>
                    <h2>{detailIsPending ? '请求详情' : detailIsFailed ? '失败详情' : '图片详情'}</h2>
                    <p>{detailIsPending ? '生成中' : detailIsFailed ? '请求失败' : selectedImage.authorName || (selectedOnWall ? '已上墙' : '本地生成')}</p>
                  </div>
                  <button type="button" className="close-button" onClick={closeDialog}>×</button>
                </div>

                <div className="prompt-detail prompt-detail-stack">
                  <div>
                    <span>输入提示词</span>
                    <p>{detailInputPrompt || '无提示词'}</p>
                  </div>
                  {detailRevisedPrompt ? (
                    <div>
                      <span>优化提示词</span>
                      <p>{detailRevisedPrompt}</p>
                    </div>
                  ) : null}
                </div>

                <div className="detail-meta-grid">
                  <div><span>来源</span><strong>{getSourceLabel(selectedImage)}</strong></div>
                  <div><span>尺寸</span><strong>{detailParams.size || '自动'}</strong></div>
                  <div><span>质量</span><strong>{getQualityLabel(detailParams.quality)}</strong></div>
                  <div><span>返回格式</span><strong>{getResponseFormatLabel(detailParams.response_format)}</strong></div>
                  <div><span>格式</span><strong>{detailParams.response_format === 'url' ? detailParams.output_format || 'png' : '禁用'}</strong></div>
                  <div><span>背景</span><strong>{detailParams.background || 'auto'}</strong></div>
                  {selectedImage.source === 'edit' ? null : <div><span>审核</span><strong>{detailParams.moderation || 'auto'}</strong></div>}
                  <div><span>数量</span><strong>{detailParams.n || 1}</strong></div>
                </div>

                <p className="created-line">创建于 {formatDate(selectedImage.createdAt)}{detailElapsed ? ` · 耗时 ${detailElapsed}` : ''}</p>

                <div className="detail-actions">
                  {detailDownloadSrc ? <a className="secondary-action" href={detailDownloadSrc} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">下载</a> : null}
                  <button type="button" className="secondary-action" onClick={() => reuseConfig(selectedImage)}>复用配置</button>
                  {view !== 'wall' && selectedOnWall ? (
                    <button type="button" className="secondary-action" onClick={() => checkWallState(selectedImage)} disabled={busySelected}>检测上墙</button>
                  ) : null}
                  {view !== 'wall' ? (
                    <button type="button" className="secondary-action danger-action" onClick={() => deleteImage(selectedImage)}>删除</button>
                  ) : null}
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
                    <div className="settings-grid account-settings-grid direct-settings-grid">
                      <div className="settings-section-title full-field">
                        <strong>API 配置</strong>
                        <span>可以保存多套 API。生成时使用当前启用的配置；API Key 加密存储，不会回显明文。</span>
                      </div>

                      {(apiConfigForm.apiConfigs || []).map((config, index) => {
                        const isActiveConfig = String(config.id) === String(apiConfigForm.activeApiConfigId);
                        return (
                          <section className={isActiveConfig ? 'api-config-card full-field is-active' : 'api-config-card full-field'} key={config.id}>
                            <div className="api-config-card-head">
                              <div>
                                <strong>{config.apiName || `API 配置 ${index + 1}`}</strong>
                                <span>{isActiveConfig ? '当前启用' : '备用配置'}</span>
                              </div>
                              <div className="api-config-actions">
                                <button type="button" className="secondary-action" onClick={() => setApiConfigForm((current) => ({ ...current, activeApiConfigId: config.id }))}>启用</button>
                                <button type="button" className="secondary-action danger-action" onClick={() => removeApiConfig(config.id)} disabled={(apiConfigForm.apiConfigs || []).length <= 1}>删除</button>
                              </div>
                            </div>
                            <div className="api-config-fields">
                              <label>
                                <span>API 名称</span>
                                <input value={config.apiName} onChange={(event) => updateApiConfig(config.id, 'apiName', event.target.value)} placeholder="API易 gpt-image-2" />
                              </label>
                              <label>
                                <span>API 地址</span>
                                <input value={config.apiBaseUrl} onChange={(event) => updateApiConfig(config.id, 'apiBaseUrl', event.target.value)} placeholder="https://api.apiyi.com" />
                              </label>
                              <label>
                                <span>模型 ID</span>
                                <input value={config.model} onChange={(event) => updateApiConfig(config.id, 'model', event.target.value)} placeholder="gpt-image-2" />
                              </label>
                              <label>
                                <span>请求超时（秒）</span>
                                <input min="10" max={MAX_REQUEST_TIMEOUT_SECONDS} type="number" value={config.requestTimeout} onChange={(event) => updateApiConfig(config.id, 'requestTimeout', event.target.value)} placeholder="999" />
                              </label>
                              <label className="full-field">
                                <span>密钥设置</span>
                                <input type="password" value={config.apiKey || ''} onChange={(event) => updateApiConfig(config.id, 'apiKey', event.target.value)} placeholder={config.hasApiKey ? `已保存：${config.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
                              </label>
                            </div>
                          </section>
                        );
                      })}

                      <label className="toggle-row full-field">
                        <input type="checkbox" checked={apiConfigForm.stream} onChange={(event) => setApiConfigForm((current) => ({ ...current, stream: event.target.checked }))} />
                        <span>启用流式传输功能</span>
                        <small>这是账号级通用设置，切换 API 配置时不会变化。开启后文生图强制使用 URL 返回；图生图始终不使用 stream。</small>
                      </label>

                      <div className="modal-actions three-actions full-field">
                        <button type="button" className="secondary-action" onClick={addApiConfig}>新增配置</button>
                        <button type="button" className="secondary-action" onClick={resetDirectSettings}>重置</button>
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

        </div>
      ) : null}
    </main>
  );
}

export default App;