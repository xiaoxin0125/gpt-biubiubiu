import {
  defaultApiConfigForm,
  defaultApiConfigItem,
  defaultForm,
} from '../constants/options';
import { createLocalApiConfigId, normalizeApiConfigItem } from '../lib/api';

export const useApiConfig = (deps) => {
  const { apiConfigForm, setApiConfigForm, activeApiConfig, setForm } = deps;

  const updateApiConfig = (id, key, value) => {
    setApiConfigForm((current) => ({
      ...current,
      apiConfigs: (current.apiConfigs || []).map((item) => (String(item.id) === String(id) && !item.isShared ? { ...item, [key]: value } : item)),
    }));
  };

  const addApiConfig = () => {
    const nextIndex = (apiConfigForm.apiConfigs || []).length + 1;
    const imageApi = activeApiConfig?.imageApi || activeApiConfig || defaultApiConfigItem.imageApi;
    const promptApi = activeApiConfig?.promptApi || defaultApiConfigItem.promptApi;
    const visionApi = activeApiConfig?.visionApi || defaultApiConfigItem.visionApi;
    const nextPromptApi = {
      ...promptApi,
      apiName: promptApi.apiName || defaultApiConfigItem.promptApi.apiName,
      apiKey: '',
      hasApiKey: false,
      apiKeyHint: '',
    };
    const nextVisionApi = {
      ...visionApi,
      apiName: visionApi.apiName || defaultApiConfigItem.visionApi.apiName,
      apiKey: '',
      hasApiKey: false,
      apiKeyHint: '',
    };
    const nextConfig = normalizeApiConfigItem({
      id: createLocalApiConfigId(),
      configName: `API 配置 ${nextIndex}`,
      apiName: imageApi.apiName || defaultApiConfigItem.apiName,
      apiBaseUrl: imageApi.apiBaseUrl || defaultApiConfigItem.apiBaseUrl,
      model: imageApi.model || defaultForm.model,
      imageApi: {
        ...imageApi,
        apiName: imageApi.apiName || defaultApiConfigItem.imageApi.apiName,
        apiKey: '',
        hasApiKey: false,
        apiKeyHint: '',
      },
      promptApi: nextPromptApi,
      visionApi: nextVisionApi,
    }, (apiConfigForm.apiConfigs || []).length);
    setApiConfigForm((current) => ({
      ...current,
      activeApiConfigId: nextConfig.id,
      apiConfigs: [...(current.apiConfigs || []), nextConfig],
    }));
  };

  const removeApiConfig = (id) => {
    setApiConfigForm((current) => {
      const target = (current.apiConfigs || []).find((item) => String(item.id) === String(id));
      if (target?.isShared) return current;
      const nextConfigs = (current.apiConfigs || []).filter((item) => String(item.id) !== String(id));
      if (!nextConfigs.length) return current;
      return {
        ...current,
        activeApiConfigId: String(current.activeApiConfigId) === String(id) ? nextConfigs[0].id : current.activeApiConfigId,
        apiConfigs: nextConfigs,
      };
    });
  };

  const resetDirectSettings = () => {
    setApiConfigForm((current) => ({
      ...defaultApiConfigForm,
      stream: current.stream,
      requestTimeout: current.requestTimeout,
      apiConfigs: current.apiConfigs?.length ? current.apiConfigs.map((item, index) => {
        const normalized = normalizeApiConfigItem(index === 0 ? defaultApiConfigItem : item, index);
        return {
          ...normalized,
          id: item.id,
          hasApiKey: item.hasApiKey,
          apiKeyHint: item.apiKeyHint,
          apiKey: '',
          imageApi: { ...normalized.imageApi, hasApiKey: item.imageApi?.hasApiKey || item.hasApiKey, apiKeyHint: item.imageApi?.apiKeyHint || item.apiKeyHint || '', apiKey: '' },
          promptApi: { ...normalized.promptApi, hasApiKey: item.promptApi?.hasApiKey || false, apiKeyHint: item.promptApi?.apiKeyHint || '', apiKey: '' },
          visionApi: { ...normalized.visionApi, hasApiKey: item.visionApi?.hasApiKey || false, apiKeyHint: item.visionApi?.apiKeyHint || '', apiKey: '' },
        };
      }) : [defaultApiConfigItem],
      activeApiConfigId: current.apiConfigs?.[0]?.id || defaultApiConfigItem.id,
    }));
    setForm(defaultForm);
  };

  return { updateApiConfig, addApiConfig, removeApiConfig, resetDirectSettings };
};