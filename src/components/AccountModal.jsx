import { MAX_REQUEST_TIMEOUT_SECONDS } from '../constants/options';
import SiteAdminPanel from './SiteAdminPanel';

const apiCategorySections = [
  {
    key: 'imageApi',
    title: '生图 API 参数',
    description: '用于文生图、图生图和编辑生成。',
    modelLabel: '生图模型 ID',
    modelPlaceholder: 'gpt-image-2',
    namePlaceholder: 'OpenAI gpt-image-2',
  },
  {
    key: 'promptApi',
    title: '提示词优化 API 参数',
    description: '用于提示词润色、扩写和翻译。',
    modelLabel: '提示词优化模型 ID',
    modelPlaceholder: '例如 gpt-4o-mini',
    namePlaceholder: '提示词优化 API',
  },
  {
    key: 'visionApi',
    title: '图片反推/视觉 API 参数',
    description: '用于图片描述和反推提示词。',
    modelLabel: '视觉模型 ID',
    modelPlaceholder: '例如 gpt-4o',
    namePlaceholder: '图片反推 API',
  },
];

export default function AccountModal({
  user,
  authMode,
  setAuthMode,
  authTab,
  setAuthTab,
  authForm,
  setAuthForm,
  profileForm,
  setProfileForm,
  passwordForm,
  setPasswordForm,
  apiConfigForm,
  setApiConfigForm,
  userDisplayName,
  closeDialog,
  submitAuth,
  saveProfile,
  changePassword,
  logout,
  updateApiConfig,
  removeApiConfig,
  addApiConfig,
  resetDirectSettings,
  saveAccountSettings,
  fetchApiModels,
  apiModelOptionsByConfigId,
  apiModelLoadingByConfigId,
  renderSelect,
  siteFlags,
  siteSettings,
  setSiteSettings,
  saveSiteSettings,
}) {
  const isAdmin = Boolean(user?.isAdmin);
  const registrationEnabled = siteFlags?.registrationEnabled !== false;
  const apiConfigs = apiConfigForm.apiConfigs || [];
  const sharedApiConfig = apiConfigs.find((config) => config.isShared);
  const editableApiConfigs = apiConfigs.filter((config) => !config.isShared);
  const hasSharedApiConfig = Boolean(sharedApiConfig);
  const isSharedActive = hasSharedApiConfig && String(sharedApiConfig.id) === String(apiConfigForm.activeApiConfigId);
  const updateApiConfigCategory = (configId, categoryKey, field, value) => {
    setApiConfigForm((current) => ({
      ...current,
      apiConfigs: (current.apiConfigs || []).map((item) => {
        if (String(item.id) !== String(configId) || item.isShared) return item;
        const nextCategory = { ...(item[categoryKey] || {}), [field]: value };
        const nextItem = { ...item, [categoryKey]: nextCategory };
        if (categoryKey === 'imageApi') {
          nextItem.apiName = nextCategory.apiName;
          nextItem.apiBaseUrl = nextCategory.apiBaseUrl;
          nextItem.model = nextCategory.model;
          nextItem.apiKey = nextCategory.apiKey;
          nextItem.hasApiKey = nextCategory.hasApiKey;
          nextItem.apiKeyHint = nextCategory.apiKeyHint;
          nextItem.requestTimeout = nextCategory.requestTimeout;
        } else if (categoryKey === 'promptApi') {
          nextItem.promptModel = nextCategory.model;
        } else if (categoryKey === 'visionApi') {
          nextItem.visionModel = nextCategory.model;
        }
        return nextItem;
      }),
    }));
  };
  const modelOptionsFor = (configId, categoryKey, currentModel) => {
    const key = `${configId}:${categoryKey}`;
    const options = apiModelOptionsByConfigId[key] || [];
    return options.length ? options : [{ label: currentModel || '暂无模型', value: currentModel || '' }];
  };
  const isModelLoading = (configId, categoryKey) => Boolean(apiModelLoadingByConfigId[`${configId}:${categoryKey}`]);
  return (
    <section className="modal-card account-modal" role="dialog" aria-modal="true" aria-label="账号设置">
      <div className="modal-head">
        <div>
          <h2>{user ? '账号设置' : (registrationEnabled && authMode === 'register') ? '注册' : '登录'}</h2>
          <p>{user ? '账号信息、密码和参数设置' : '登录后可保存配置，上墙作品显示展示名称'}</p>
        </div>
        <button type="button" className="close-button" onClick={closeDialog}>×</button>
      </div>

      {user ? (
        <div className="account-panel">
          <div className={isAdmin ? 'segmented-control account-tabs' : 'segmented-control two-tabs account-tabs'}>
            <button type="button" className={authTab === 'profile' ? 'is-active' : ''} onClick={() => setAuthTab('profile')}>账号信息</button>
            <button type="button" className={authTab === 'settings' ? 'is-active' : ''} onClick={() => setAuthTab('settings')}>参数设置</button>
            {isAdmin ? (
              <button type="button" className={authTab === 'site' ? 'is-active' : ''} onClick={() => setAuthTab('site')}>网站管理</button>
            ) : null}
          </div>

          {authTab === 'profile' ? (
            <div className="account-section-grid profile-stack">
              <section className="api-config-card full-field profile-info-card">
                <div className="api-config-card-head">
                  <div>
                    <strong>账号信息</strong>
                    <span>当前登录身份、展示名称与修改入口</span>
                  </div>
                </div>
                <div className="profile-inline-fields">
                  <label className="profile-readonly-label">
                    <span>当前登录身份</span>
                    <div className="profile-identity-line">
                      <strong>{userDisplayName}</strong>
                      <small>@{user.username}</small>
                    </div>
                  </label>
                  <label className="profile-readonly-label profile-edit-label">
                    <span>展示名称</span>
                    <input className="profile-plain-input" value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="留空则使用用户名" />
                  </label>
                </div>
                <div className="profile-save-row">
                  <button type="button" className="secondary-action profile-save-button" onClick={saveProfile}>保存名称</button>
                </div>
              </section>

              <section className="api-config-card full-field">
                <div className="api-config-card-head">
                  <div>
                    <strong>修改密码</strong>
                    <span>输入旧密码后设置新密码</span>
                  </div>
                </div>
                <div className="api-config-fields">
                  <label>
                    <span>旧密码</span>
                    <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} placeholder="当前密码" />
                  </label>
                  <label>
                    <span>新密码</span>
                    <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} placeholder="至少 6 位" />
                  </label>
                </div>
                <div className="card-actions full-field">
                  <button type="button" className="secondary-action" onClick={changePassword}>修改密码</button>
                </div>
              </section>

              <div className="account-footer full-field">
                <button type="button" className="secondary-action danger-action" onClick={logout}>退出登录</button>
              </div>
            </div>
          ) : null}

          {authTab === 'settings' ? (
            <div className="settings-grid account-settings-grid direct-settings-grid profile-stack">
              {hasSharedApiConfig ? (
                <section className={isSharedActive ? 'api-config-card full-field shared-api-top-tip is-active' : 'api-config-card full-field shared-api-top-tip'}>
                  <div className="api-config-card-head">
                    <div>
                      <strong>共享 API 配置</strong>
                      <span>管理员提供的默认配置，未保存自己的 API 时可直接使用。</span>
                    </div>
                  </div>
                  <div className="shared-api-summary">
                    <strong>{sharedApiConfig.configName || sharedApiConfig.apiName || '管理员共享配置'}</strong>
                    <small>管理员共享配置。你保存自己的 API 后，将优先使用自己的配置。</small>
                  </div>
                </section>
              ) : null}

              <section className="api-config-card full-field is-intro">
                <div className="api-config-card-head">
                  <div>
                    <strong>API 配置</strong>
                    <span>可以保存多套 API。生成时使用当前启用的配置；API Key 加密存储，不会回显明文。</span>
                  </div>
                </div>
              </section>

              {editableApiConfigs.map((config, index) => {
                const isActiveConfig = String(config.id) === String(apiConfigForm.activeApiConfigId);
                return (
                  <section className={isActiveConfig ? 'api-config-card full-field is-active' : 'api-config-card full-field'} key={config.id}>
                    <div className="api-config-card-head">
                      <div>
                        <strong>{config.configName || `API 配置 ${index + 1}`}</strong>
                        <span>{isActiveConfig ? '当前启用' : '备用配置'}</span>
                      </div>
                      <div className="api-config-actions">
                        <button type="button" className="secondary-action" onClick={() => setApiConfigForm((current) => ({ ...current, activeApiConfigId: config.id }))}>启用</button>
                        <button type="button" className="secondary-action danger-action" onClick={() => removeApiConfig(config.id)} disabled={editableApiConfigs.length <= 1}>删除</button>
                      </div>
                    </div>
                    <div className="api-config-fields api-config-name-fields">
                      <label className="full-field">
                        <span>设置名称</span>
                        <input maxLength={128} value={config.configName || ''} onChange={(event) => updateApiConfig(config.id, 'configName', event.target.value)} placeholder={`API 配置 ${index + 1}`} />
                      </label>
                    </div>
                    <div className="api-category-stack">
                      {apiCategorySections.map((section) => {
                        const category = config[section.key] || {};
                        const optionsKey = `${config.id}:${section.key}`;
                        const options = modelOptionsFor(config.id, section.key, category.model || '');
                        const loading = isModelLoading(config.id, section.key);
                        return (
                          <section className="api-category-card" key={section.key}>
                            <div className="api-category-head">
                              <div>
                                <strong>{section.title}</strong>
                                <span>{section.description}</span>
                              </div>
                            </div>
                            <div className="api-config-fields api-config-fields-ordered">
                              <label>
                                <span>API 名称</span>
                                <input value={category.apiName || ''} onChange={(event) => updateApiConfigCategory(config.id, section.key, 'apiName', event.target.value)} placeholder={section.namePlaceholder} />
                              </label>
                              <label>
                                <span>{section.modelLabel}</span>
                                <input value={category.model || ''} onChange={(event) => updateApiConfigCategory(config.id, section.key, 'model', event.target.value)} placeholder={section.modelPlaceholder} />
                              </label>
                              <div className="model-picker-field full-field">
                                <span>模型列表</span>
                                <div className="model-picker-row single-model-picker-row">
                                  {renderSelect({
                                    id: `${optionsKey}-model-select`,
                                    label: '',
                                    value: category.model || '',
                                    options,
                                    onChange: (value) => updateApiConfigCategory(config.id, section.key, 'model', value),
                                    disabled: !options.length || !options[0]?.value,
                                    className: 'settings-select-field model-select-field',
                                    menuDirection: 'down',
                                  })}
                                </div>
                              </div>
                              <label>
                                <span>API 地址</span>
                                <input value={category.apiBaseUrl || ''} onChange={(event) => updateApiConfigCategory(config.id, section.key, 'apiBaseUrl', event.target.value)} placeholder="https://api.openai.com" />
                              </label>
                              <div className="model-fetch-field">
                                <button type="button" className="secondary-action model-fetch-button" onClick={() => fetchApiModels(config.id, section.key)} disabled={loading}>
                                  {loading ? '获取中' : '获取模型'}
                                </button>
                              </div>
                              <label className="full-field">
                                <span>密钥设置</span>
                                <input type="password" value={category.apiKey || ''} onChange={(event) => updateApiConfigCategory(config.id, section.key, 'apiKey', event.target.value)} placeholder={category.hasApiKey ? `已保存：${category.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
                              </label>
                              {category.hasApiKey ? (
                                <label className="toggle-row full-field compact-toggle-row">
                                  <input type="checkbox" checked={Boolean(category.clearApiKey)} onChange={(event) => updateApiConfigCategory(config.id, section.key, 'clearApiKey', event.target.checked)} />
                                  <span>清除已保存的 Key</span>
                                </label>
                              ) : null}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <section className="api-config-card full-field">
                <div className="api-config-card-head">
                  <div>
                    <strong>生成选项</strong>
                    <span>账号级通用设置，切换 API 配置时不会变化</span>
                  </div>
                </div>
                <div className="api-config-fields generation-options-fields">
                  <label className="full-field">
                    <span>请求超时（秒）</span>
                    <input min="10" max={MAX_REQUEST_TIMEOUT_SECONDS} type="number" value={apiConfigForm.requestTimeout} onChange={(event) => setApiConfigForm((current) => ({ ...current, requestTimeout: event.target.value }))} placeholder="999" />
                  </label>
                  <label className="toggle-row full-field">
                    <input type="checkbox" checked={apiConfigForm.stream} onChange={(event) => setApiConfigForm((current) => ({ ...current, stream: event.target.checked }))} />
                    <span>启用流式传输功能</span>
                    <small>开启后文生图强制使用 URL 返回；图生图始终不使用 stream。</small>
                  </label>
                </div>
              </section>

              <div className="modal-actions three-actions full-field">
                <button type="button" className="secondary-action" onClick={addApiConfig}>新增配置</button>
                <button type="button" className="secondary-action" onClick={resetDirectSettings}>重置</button>
                <button type="button" className="primary-action" onClick={saveAccountSettings}>保存配置</button>
              </div>
            </div>
          ) : null}

          {authTab === 'site' && isAdmin ? (
            <SiteAdminPanel
              siteSettings={siteSettings}
              setSiteSettings={setSiteSettings}
              saveSiteSettings={saveSiteSettings}
              fetchApiModels={fetchApiModels}
              apiModelOptionsByConfigId={apiModelOptionsByConfigId}
              apiModelLoadingByConfigId={apiModelLoadingByConfigId}
              renderSelect={renderSelect}
            />
          ) : null}
        </div>
      ) : (
        <form className="auth-form" onSubmit={submitAuth}>
          {registrationEnabled ? (
            <div className="segmented-control two-tabs">
              <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>登录</button>
              <button type="button" className={authMode === 'register' ? 'is-active' : ''} onClick={() => setAuthMode('register')}>注册</button>
            </div>
          ) : null}
          <label>
            <span>用户名</span>
            <input value={authForm.username} onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))} placeholder="2-20 位" />
          </label>
          {registrationEnabled && authMode === 'register' ? (
            <label>
              <span>展示名称</span>
              <input value={authForm.displayName} onChange={(event) => setAuthForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="可选，默认同用户名" />
            </label>
          ) : null}
          <label>
            <span>密码</span>
            <input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" />
          </label>
          <button type="submit" className="primary-action">{registrationEnabled && authMode === 'register' ? '注册' : '登录'}</button>
        </form>
      )}
    </section>
  );
}