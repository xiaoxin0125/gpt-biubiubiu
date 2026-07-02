import {
  API_CONFIG_SCOPE_AGNES,
  API_CONFIG_SCOPE_ALL,
  API_CONFIG_SCOPE_IMAGE,
  API_CONFIG_SCOPE_PROMPT,
  DEFAULT_DIRECT_API_BASE_URL,
  defaultAgnesApiCategory,
  defaultApiConfigItem,
  defaultPromptApiCategory,
  MAX_REQUEST_TIMEOUT_SECONDS,
} from '../constants/options';
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

  if (!response.ok) {
    const error = new Error(data.error || data.message || data.detail || '请求失败');
    error.code = data.code || '';
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

export const requestPromptOptimize = (payload) => requestJson('/api/prompt-tools/optimize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const requestImageCaption = (formData) => requestJson('/api/prompt-tools/caption', {
  method: 'POST',
  body: formData,
});

export const requestSharedImageJson = (payload) => requestJson('/api/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload }),
});

export const requestSharedImageFormData = async (payload) => {
  const response = await fetch(toApiUrl('/api/images/edits'), {
    method: 'POST',
    body: payload,
  });
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.error || data.message || data.detail || '请求失败');
  return data;
};

export const normalizeApiBaseUrl = (value) => String(value || DEFAULT_DIRECT_API_BASE_URL).replace(/\s+/g, '').replace(/\/+$/, '') || DEFAULT_DIRECT_API_BASE_URL;

const normalizeApiCategory = (value = {}, fallback = {}) => ({
  apiName: String(value.apiName || value.api_name || fallback.apiName || defaultApiConfigItem.apiName).trim() || defaultApiConfigItem.apiName,
  apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl || value.api_base_url || fallback.apiBaseUrl || defaultApiConfigItem.apiBaseUrl),
  model: String(value.model || fallback.model || '').trim(),
  apiKey: String(value.apiKey || value.api_key || '').trim(),
  hasApiKey: Boolean(value.hasApiKey || value.has_api_key || value.apiKey || value.api_key),
  apiKeyHint: String(value.apiKeyHint || value.api_key_hint || fallback.apiKeyHint || ''),
  requestTimeout: clampNumber(Number(value.requestTimeout || value.request_timeout || fallback.requestTimeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS),
});

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

export const normalizeApiConfigScope = (value = API_CONFIG_SCOPE_ALL) => {
  const scope = String(value || API_CONFIG_SCOPE_ALL).trim();
  return [API_CONFIG_SCOPE_ALL, API_CONFIG_SCOPE_IMAGE, API_CONFIG_SCOPE_PROMPT, API_CONFIG_SCOPE_AGNES].includes(scope) ? scope : API_CONFIG_SCOPE_ALL;
};

export const apiConfigSupportsScope = (config = {}, scope = API_CONFIG_SCOPE_IMAGE) => {
  const apiScope = normalizeApiConfigScope(config.apiScope || config.api_scope);
  if (apiScope === API_CONFIG_SCOPE_ALL) return true;
  return apiScope === scope;
};

export const apiCategoryForScope = (config = {}, scope = API_CONFIG_SCOPE_IMAGE) => {
  if (scope === API_CONFIG_SCOPE_PROMPT) return config.promptApi || {};
  if (scope === API_CONFIG_SCOPE_AGNES) return config.agnesApi || {};
  return config.imageApi || config;
};

export const apiConfigHasKeyForScope = (config = {}, scope = API_CONFIG_SCOPE_IMAGE) => {
  const category = apiCategoryForScope(config, scope);
  if (config.isShared) return Boolean(category.hasApiKey);
  if (!apiConfigSupportsScope(config, scope)) return false;
  return Boolean(category.hasApiKey || (scope === API_CONFIG_SCOPE_IMAGE ? config.hasApiKey : false));
};

export const apiConfigLabelForScope = (config = {}, scope = API_CONFIG_SCOPE_IMAGE, fallback = defaultApiConfigItem.apiName) => {
  const category = apiCategoryForScope(config, scope);
  return category.apiName || config.apiName || fallback;
};

export const normalizeApiConfigItem = (value = {}) => {
  const fallbackImageApi = {
    apiName: defaultApiConfigItem.apiName,
    apiBaseUrl: defaultApiConfigItem.apiBaseUrl,
    model: defaultApiConfigItem.model,
    requestTimeout: defaultApiConfigItem.requestTimeout,
  };
  const imageApi = normalizeApiCategory(value.imageApi || value.image_api || value, fallbackImageApi);
  const promptApi = normalizeApiCategory(value.promptApi || value.prompt_api || {}, {
    apiName: value.promptApiName || value.prompt_api_name || defaultPromptApiCategory.apiName,
    apiBaseUrl: value.promptApiBaseUrl || value.prompt_api_base_url || imageApi.apiBaseUrl,
    model: value.promptModel || value.prompt_model || '',
    requestTimeout: value.promptRequestTimeout || value.prompt_request_timeout || imageApi.requestTimeout,
    apiKeyHint: value.promptApiKeyHint || value.prompt_api_key_hint || '',
  });
  const agnesApi = normalizeApiCategory(value.agnesApi || value.agnes_api || {}, {
    apiName: value.agnesApiName || value.agnes_api_name || defaultAgnesApiCategory.apiName,
    apiBaseUrl: value.agnesApiBaseUrl || value.agnes_api_base_url || defaultAgnesApiCategory.apiBaseUrl,
    model: value.agnesModel || value.agnes_model || defaultAgnesApiCategory.model,
    requestTimeout: value.agnesRequestTimeout || value.agnes_request_timeout || imageApi.requestTimeout,
    apiKeyHint: value.agnesApiKeyHint || value.agnes_api_key_hint || '',
  });
  const apiScope = normalizeApiConfigScope(value.apiScope || value.api_scope);

  return {
    id: value.id ?? value.configId ?? value.config_id ?? createLocalApiConfigId(),
    apiScope,
    apiName: imageApi.apiName,
    apiBaseUrl: imageApi.apiBaseUrl,
    model: imageApi.model || defaultApiConfigItem.model,
    promptModel: promptApi.model,
    agnesModel: agnesApi.model,
    apiKey: imageApi.apiKey,
    hasApiKey: imageApi.hasApiKey,
    apiKeyHint: imageApi.apiKeyHint,
    requestTimeout: imageApi.requestTimeout,
    imageApi: { ...imageApi, model: imageApi.model || defaultApiConfigItem.model },
    promptApi,
    agnesApi,
    hasAnyApiKey: Boolean(value.hasAnyApiKey || value.has_any_api_key || imageApi.hasApiKey || promptApi.hasApiKey || agnesApi.hasApiKey),
    isShared: Boolean(value.isShared || value.is_shared),
  };
};

export const normalizeServerSettings = (value = {}) => {
  const rawConfigs = Array.isArray(value.apiConfigs || value.api_configs)
    ? (value.apiConfigs || value.api_configs)
    : [value.activeConfig || value.active_config || value];
  const apiConfigs = rawConfigs.map(normalizeApiConfigItem).filter(Boolean);
  const safeConfigs = apiConfigs.length ? apiConfigs : [normalizeApiConfigItem(defaultApiConfigItem)];
  const activeApiConfigId = value.activeApiConfigId ?? value.active_api_config_id ?? value.activeConfig?.id ?? value.active_config?.id ?? safeConfigs[0].id;
  const activePromptApiConfigId = value.activePromptApiConfigId ?? value.active_prompt_api_config_id ?? value.activePromptConfig?.id ?? value.active_prompt_config?.id ?? activeApiConfigId;
  const activeAgnesApiConfigId = value.activeAgnesApiConfigId ?? value.active_agnes_api_config_id ?? value.activeAgnesConfig?.id ?? value.active_agnes_config?.id ?? activeApiConfigId;
  const activeConfig = safeConfigs.find((item) => String(item.id) === String(activeApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_IMAGE)) || safeConfigs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_IMAGE)) || safeConfigs[0];
  const activePromptConfig = safeConfigs.find((item) => String(item.id) === String(activePromptApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_PROMPT)) || safeConfigs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_PROMPT)) || activeConfig;
  const activeAgnesConfig = safeConfigs.find((item) => String(item.id) === String(activeAgnesApiConfigId) && apiConfigSupportsScope(item, API_CONFIG_SCOPE_AGNES)) || safeConfigs.find((item) => apiConfigSupportsScope(item, API_CONFIG_SCOPE_AGNES)) || activeConfig;

  const requestTimeout = clampNumber(Number(value.requestTimeout || value.request_timeout || activeConfig.requestTimeout || defaultApiConfigItem.requestTimeout), 10, MAX_REQUEST_TIMEOUT_SECONDS);

  return {
    ...activeConfig,
    requestTimeout,
    stream: Boolean(value.stream),
    activeApiConfigId: activeConfig.id,
    activePromptApiConfigId: activePromptConfig.id,
    activeAgnesApiConfigId: activeAgnesConfig.id,
    activePromptConfig,
    activeAgnesConfig,
    apiConfigs: safeConfigs,
    form: { model: activeConfig.model || defaultApiConfigItem.model },
  };
};

const normalizeDirectImageItem = (image, index, outputFormat) => {
  const rawSourceValue = typeof image === 'string'
    ? image
    : image?.b64_json || image?.image_b64 || image?.partial_image_b64 || image?.base64 || image?.url || image?.image_url || image?.data_url || image?.data || image?.image || image?.content || image?.result || '';
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
  if (!data) return [];
  if (typeof data === 'string') return data ? [data] : [];

  if (Array.isArray(data)) return data.flatMap((item) => directImageItems(item));

  for (const key of ['data', 'images', 'output']) {
    if (Array.isArray(data?.[key])) return data[key].flatMap((item) => directImageItems(item));
  }

  for (const key of ['data', 'image', 'content', 'result', 'output']) {
    const value = data?.[key];
    if (value && typeof value === 'object') {
      const items = directImageItems(value);
      if (items.length) return items;
    }
  }

  const hasInlineImage = data?.b64_json || data?.image_b64 || data?.partial_image_b64 || data?.base64 || data?.url || data?.image_url || data?.data_url || (typeof data?.data === 'string' && data.data) || (typeof data?.image === 'string' && data.image) || (typeof data?.content === 'string' && data.content) || (typeof data?.result === 'string' && data.result) || (typeof data?.output === 'string' && data.output);
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
  const pathUrl = new URL(String(path || '/'), base);
  const normalizedPath = `/${pathUrl.pathname.replace(/^\/+/, '')}`;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (basePath.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    base.pathname = `${basePath}${normalizedPath.slice(3)}`;
  } else if (basePath.endsWith('/v1') && !normalizedPath.startsWith('/v1/')) {
    base.pathname = `${basePath.slice(0, -3)}${normalizedPath}`;
  } else {
    base.pathname = basePath && normalizedPath.startsWith(`${basePath}/`) ? normalizedPath : `${basePath}${normalizedPath}`;
  }
  base.search = pathUrl.search;
  base.hash = '';
  return base.toString();
};

const parseServerSentEventFrames = (text) => {
  const frames = [];
  let eventName = '';
  let dataLines = [];

  const pushFrame = () => {
    const payload = dataLines.join('\n').trim();
    if (payload && payload !== '[DONE]') frames.push({ eventName, payload });
    eventName = '';
    dataLines = [];
  };

  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      pushFrame();
      return;
    }
    if (trimmedLine.startsWith('event:')) eventName = trimmedLine.slice(6).trim();
    if (trimmedLine.startsWith('data:')) dataLines.push(trimmedLine.slice(5).trim());
  });

  pushFrame();
  return frames;
};

const parseDirectImageResponseText = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  if (/^data:(image\/[a-z0-9.+-]+);base64,/i.test(trimmed)) return { data: trimmed };

  const sseFrames = parseServerSentEventFrames(trimmed);

  if (sseFrames.length) {
    const events = [];
    const imagePayloads = [];
    sseFrames.forEach(({ eventName, payload }) => {
      if (/^data:(image\/[a-z0-9.+-]+);base64,/i.test(payload)) {
        imagePayloads.push(payload);
        return;
      }
      try {
        const decoded = JSON.parse(payload);
        if (decoded && typeof decoded === 'object') events.push({ event: eventName, ...decoded });
      } catch {
        // 忽略非 JSON 事件片段
      }
    });

    if (imagePayloads.length) return { data: imagePayloads };

    const imageEvents = events.filter((event) => directImageItems(event).length);
    const completedImageEvents = imageEvents.filter((event) => !/partial/i.test(String(event?.type || event?.event || '')));
    const fallbackImageEvents = Array.from(imageEvents.reduce((itemsByIndex, event, index) => {
      const key = event?.index ?? event?.output_index ?? event?.image_index ?? event?.imageIndex ?? event?.partial_image_index ?? event?.partialImageIndex ?? index;
      itemsByIndex.set(String(key), event);
      return itemsByIndex;
    }, new Map()).values());
    const imageItems = (completedImageEvents.length ? completedImageEvents : fallbackImageEvents).flatMap((event) => directImageItems(event));
    const revisedPrompt = events.map((event) => normalizeRevisedPrompt(event?.revised_prompt, event?.revisedPrompt, event?.prompt_revised)).filter(Boolean).at(-1) || '';
    const imageEvent = imageItems.length ? { data: imageItems } : events.at(-1) || {};
    return revisedPrompt && imageEvent && typeof imageEvent === 'object' ? { ...imageEvent, revised_prompt: revisedPrompt } : imageEvent;
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

export const requestAgnesJson = async (config, apiKey, path, payload, method = 'POST') => {
  const response = await fetchWithTimeout(buildDirectImageApiUrl(config, path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  }, config);
  return readDirectImageResponse(response);
};

export const requestAgnesResult = async (config, apiKey, videoId) => {
  const query = new URLSearchParams({ video_id: videoId, model_name: 'agnes-video-v2.0' });
  const response = await fetchWithTimeout(buildDirectImageApiUrl(config, `/agnesapi?${query.toString()}`), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }, config);
  return readDirectImageResponse(response);
};

export const requestReferenceImageUpload = async (formData) => {
  const response = await fetch(toApiUrl('/api/images/reference-upload'), {
    method: 'POST',
    body: formData,
  });
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.error || data.message || data.detail || '参考图上传失败');
  return data;
};

export const requestReferenceImageDelete = async (url) => {
  const value = String(url || '').trim();
  if (!value) return { deleted: false };
  const routeUrl = value.startsWith('/api/') ? value : `/api/images/reference/${encodeURIComponent(value.split('/').pop() || '')}`;
  const response = await fetch(toApiUrl(routeUrl), { method: 'DELETE' });
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.error || data.message || data.detail || '参考图删除失败');
  return data;
};

export const requestSharedAgnesJson = (path, payload) => requestJson('/api/agnes/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path, payload }),
});

export const requestSharedAgnesResult = (videoId) => requestJson(`/api/agnes/result?video_id=${encodeURIComponent(videoId)}&model_name=agnes-video-v2.0`);