import {
  API_CONFIG_SCOPE_IMAGE,
  API_CONFIG_SCOPE_PROMPT,
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

  const addApiConfig = (apiScope = API_CONFIG_SCOPE_IMAGE) => {
    const imageApi = activeApiConfig?.imageApi || activeApiConfig || defaultApiConfigItem.imageApi;
    const promptApi = apiConfigForm.activePromptConfig?.promptApi || activeApiConfig?.promptApi || defaultApiConfigItem.promptApi;
    const scopedDefaults = apiScope === API_CONFIG_SCOPE_PROMPT
      ? {
          imageApi: { ...defaultApiConfigItem.imageApi, apiKey: '', hasApiKey: false, apiKeyHint: '' },
          promptApi: {
            ...promptApi,
            apiName: promptApi.apiName || defaultApiConfigItem.promptApi.apiName,
            apiKey: '',
            hasApiKey: false,
            apiKeyHint: '',
          },
        }
      : {
          imageApi: {
            ...imageApi,
            apiName: imageApi.apiName || defaultApiConfigItem.imageApi.apiName,
            apiKey: '',
            hasApiKey: false,
            apiKeyHint: '',
          },
          promptApi: { ...defaultApiConfigItem.promptApi, apiKey: '', hasApiKey: false, apiKeyHint: '' },
        };
    const nextConfig = normalizeApiConfigItem({
      id: createLocalApiConfigId(),
      apiScope,
      apiName: scopedDefaults.imageApi.apiName || defaultApiConfigItem.apiName,
      apiBaseUrl: scopedDefaults.imageApi.apiBaseUrl || defaultApiConfigItem.apiBaseUrl,
      model: scopedDefaults.imageApi.model || defaultForm.model,
      imageApi: scopedDefaults.imageApi,
      promptApi: scopedDefaults.promptApi,
    }, (apiConfigForm.apiConfigs || []).length);
    setApiConfigForm((current) => ({
      ...current,
      ...(apiScope === API_CONFIG_SCOPE_PROMPT ? { activePromptApiConfigId: nextConfig.id } : { activeApiConfigId: nextConfig.id }),
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
        activeApiConfigId: String(current.activeApiConfigId) === String(id) ? nextConfigs.find((item) => item.apiScope !== API_CONFIG_SCOPE_PROMPT)?.id || nextConfigs[0].id : current.activeApiConfigId,
        activePromptApiConfigId: String(current.activePromptApiConfigId) === String(id) ? nextConfigs.find((item) => item.apiScope !== API_CONFIG_SCOPE_IMAGE)?.id || nextConfigs[0].id : current.activePromptApiConfigId,
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
          apiScope: item.apiScope || normalized.apiScope,
          id: item.id,
          hasApiKey: item.hasApiKey,
          apiKeyHint: item.apiKeyHint,
          apiKey: '',
          imageApi: { ...normalized.imageApi, hasApiKey: item.imageApi?.hasApiKey || item.hasApiKey, apiKeyHint: item.imageApi?.apiKeyHint || item.apiKeyHint || '', apiKey: '' },
          promptApi: { ...normalized.promptApi, hasApiKey: item.promptApi?.hasApiKey || false, apiKeyHint: item.promptApi?.apiKeyHint || '', apiKey: '' },
        };
      }) : [defaultApiConfigItem],
      activeApiConfigId: current.apiConfigs?.[0]?.id || defaultApiConfigItem.id,
      activePromptApiConfigId: current.apiConfigs?.find((item) => item.apiScope !== API_CONFIG_SCOPE_IMAGE)?.id || current.apiConfigs?.[0]?.id || defaultApiConfigItem.id,
    }));
    setForm(defaultForm);
  };

  return { updateApiConfig, addApiConfig, removeApiConfig, resetDirectSettings };
};