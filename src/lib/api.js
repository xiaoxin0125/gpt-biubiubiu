import { DEFAULT_DIRECT_API_BASE_URL, defaultApiConfigItem, MAX_REQUEST_TIMEOUT_SECONDS } from '../constants/options';
import { normalizeRevisedPrompt } from './form';
import { getDataImageMime, imageMimeForOutputFormat, isDataImageValue, stripDataImagePrefix } from './images';
import { clampNumber } from './math';

export const readApiResponse = async (response) => {
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

export const toApiUrl = (input) => {
  const value = String(input || '');
  if (!value.startsWith('/api/')) return value;
  const [path, query = ''] = value.slice(4).split('?');
  const route = `/api/index.php?route=${encodeURIComponent(path)}`;
  return query ? `${route}&${query}` : route;
};

export const requestJson = async (input, init) => {
  const response = await fetch(toApiUrl(input), init);
  const data = await readApiResponse(response);

  if (!response.ok) throw new Error(data.error || data.message || data.detail || '请求失败');
  return data;
};

export const normalizeApiBaseUrl = (value) => String(value || DEFAULT_DIRECT_API_BASE_URL).replace(/\s+/g, '').replace(/\/+$/, '') || DEFAULT_DIRECT_API_BASE_URL;

const requestTimeoutMs = (config = {}) => clampNumber(Number(config.requestTimeout || config.request_timeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS) * 1000;

const createTimeoutSignal = (config = {}) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(requestTimeoutMs(config));
  if (typeof AbortController === 'undefined') return undefined;

  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), requestTimeoutMs(config));
  return controller.signal;
};

const fetchWithTimeout = async (url, init = {}, config = {}) => {
  try {
    return await fetch(url, { ...init, signal: init.signal || createTimeoutSignal(config) });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('上游接口请求超时。');
    throw error;
  }
};

export const createLocalApiConfigId = () => `api-config-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const normalizeApiConfigItem = (value = {}, index = 0) => ({
  id: value.id ?? value.configId ?? value.config_id ?? createLocalApiConfigId(),
  apiName: String(value.apiName || value.api_name || (index === 0 ? defaultApiConfigItem.apiName : `API 配置 ${index + 1}`)).trim() || defaultApiConfigItem.apiName,
  apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl || value.api_base_url || defaultApiConfigItem.apiBaseUrl),
  model: String(value.model || defaultApiConfigItem.model).trim() || defaultApiConfigItem.model,
  apiKey: String(value.apiKey || value.api_key || '').trim(),
  hasApiKey: Boolean(value.hasApiKey || value.has_api_key || value.apiKey || value.api_key),
  apiKeyHint: String(value.apiKeyHint || value.api_key_hint || ''),
  requestTimeout: clampNumber(Number(value.requestTimeout || value.request_timeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS),
  isShared: Boolean(value.isShared || value.is_shared),
});

export const normalizeServerSettings = (value = {}) => {
  const rawConfigs = Array.isArray(value.apiConfigs || value.api_configs)
    ? (value.apiConfigs || value.api_configs)
    : [value.activeConfig || value.active_config || value];
  const apiConfigs = rawConfigs.map(normalizeApiConfigItem).filter(Boolean);
  const safeConfigs = apiConfigs.length ? apiConfigs : [normalizeApiConfigItem(defaultApiConfigItem)];
  const activeApiConfigId = value.activeApiConfigId ?? value.active_api_config_id ?? value.activeConfig?.id ?? value.active_config?.id ?? safeConfigs[0].id;
  const activeConfig = safeConfigs.find((item) => String(item.id) === String(activeApiConfigId)) || safeConfigs[0];

  const requestTimeout = clampNumber(Number(value.requestTimeout || value.request_timeout || activeConfig.requestTimeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS);

  return {
    ...activeConfig,
    requestTimeout,
    stream: Boolean(value.stream),
    activeApiConfigId: activeConfig.id,
    apiConfigs: safeConfigs,
    form: { model: activeConfig.model || defaultApiConfigItem.model },
  };
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

const directImageItems = (data) => {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.images)) return data.images;
  const hasInlineImage = data?.b64_json || data?.url || data?.image || data?.data_url || (typeof data?.data === 'string' && data.data);
  return hasInlineImage ? [data] : [];
};

export const normalizeDirectImageResponse = (data, outputFormat) => {
  const rawItems = directImageItems(data);

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

export const requestDirectImageJson = async (config, apiKey, payload) => {
  const response = await fetchWithTimeout(buildDirectImageApiUrl(config, '/v1/images/generations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  }, config);
  return readDirectImageResponse(response);
};

export const requestDirectImageFormData = async (config, apiKey, payload) => {
  const response = await fetchWithTimeout(buildDirectImageApiUrl(config, '/v1/images/edits'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload,
  }, config);
  return readDirectImageResponse(response);
};