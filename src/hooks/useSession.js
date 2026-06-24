import {
  defaultApiConfigForm,
  emptyAuthForm,
  emptyPasswordForm,
  emptyProfileForm,
} from '../constants/options';
import { normalizeServerSettings, requestJson } from '../lib/api';
import { saveHistory } from '../lib/history';

export const useSession = (deps) => {
  const {
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
  } = deps;

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
        const normalizedSettings = normalizeServerSettings(data.settings || {});
        if (normalizedSettings.hasApiKey) await syncDirectApiKey(normalizedSettings);
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
      apiKeyVaultRef.current.clear();
      setApiConfigForm(defaultApiConfigForm);
      setApiModelOptionsByConfigId({});
      setApiModelLoadingByConfigId({});
      setApiKeySyncing(false);
      setStatus((current) => ({ ...current, configured: false, apiName: '', message: '请先登录' }));
    }
  };

  const saveAccountSettings = async () => {
    if (!user) {
      setError('请先登录后再设置参数。');
      return;
    }

    const pendingApiKeys = new Map();
    (apiConfigForm.apiConfigs || []).forEach((item) => {
      ['imageApi', 'promptApi', 'visionApi'].forEach((key) => {
        const apiKey = String(item[key]?.apiKey || (key === 'imageApi' ? item.apiKey : '') || '').trim();
        if (apiKey) pendingApiKeys.set(`${item.id}:${key}`, apiKey);
      });
    });

    const nextSettings = normalizeServerSettings({
      ...apiConfigForm,
      apiConfigs: apiConfigForm.apiConfigs,
      activeApiConfigId: apiConfigForm.activeApiConfigId,
      stream: apiConfigForm.stream,
      requestTimeout: apiConfigForm.requestTimeout,
    });
    const activeApiConfigId = String(apiConfigForm.activeApiConfigId) === 'shared' ? 'shared' : nextSettings.activeApiConfigId;
    try {
      const data = await requestJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            activeApiConfigId,
            stream: nextSettings.stream,
            requestTimeout: nextSettings.requestTimeout,
          },
          apiConfigs: (apiConfigForm.apiConfigs || []).filter((item) => !item.isShared).map((item) => ({
            id: item.id,
            configName: item.configName,
            apiName: item.imageApi?.apiName || item.apiName,
            apiBaseUrl: item.imageApi?.apiBaseUrl || item.apiBaseUrl,
            model: item.imageApi?.model || item.model,
            requestTimeout: item.imageApi?.requestTimeout || item.requestTimeout,
            apiKey: item.imageApi?.apiKey || item.apiKey,
            confirmApiKeySave: Boolean(item.imageApi?.apiKey || item.apiKey),
            clearApiKey: Boolean(item.imageApi?.clearApiKey),
            imageApi: {
              ...(item.imageApi || {}),
              apiKey: item.imageApi?.apiKey || item.apiKey || '',
              confirmApiKeySave: Boolean(item.imageApi?.apiKey || item.apiKey),
            },
            promptApi: {
              ...(item.promptApi || {}),
              confirmApiKeySave: Boolean(item.promptApi?.apiKey),
            },
            visionApi: {
              ...(item.visionApi || {}),
              confirmApiKeySave: Boolean(item.visionApi?.apiKey),
            },
          })),
        }),
      });
      applyServerSettings(data.settings, user);
      pendingApiKeys.forEach((apiKey, storageKey) => {
        const [configId, category] = String(storageKey).split(':');
        if (category === 'imageApi') apiKeyVaultRef.current.set(configId, apiKey);
      });
      if (data.settings?.hasApiKey) await syncDirectApiKey(data.settings);
      setForm((current) => ({ ...current, model: data.settings?.model || activeApiConfig?.model || current.model }));
      setError('');
      setAuthTab('settings');
    } catch (settingsError) {
      setStatus((current) => (apiKeySyncing ? { ...current, configured: false, message: 'API Key 同步失败，请重新登录或重新保存。' } : current));
      setError(settingsError instanceof Error ? settingsError.message : '保存参数失败');
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

  return { submitAuth, logout, saveAccountSettings, saveProfile, changePassword };
};