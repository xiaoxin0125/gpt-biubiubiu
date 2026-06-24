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
    const nextConfig = normalizeApiConfigItem({
      id: createLocalApiConfigId(),
      apiName: `API 配置 ${(apiConfigForm.apiConfigs || []).length + 1}`,
      apiBaseUrl: activeApiConfig?.apiBaseUrl || defaultApiConfigItem.apiBaseUrl,
      model: activeApiConfig?.model || defaultForm.model,
      promptModel: activeApiConfig?.promptModel || '',
      visionModel: activeApiConfig?.visionModel || '',
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

  return { updateApiConfig, addApiConfig, removeApiConfig, resetDirectSettings };
};