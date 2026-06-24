export default function SiteAdminPanel({
  siteSettings,
  setSiteSettings,
  saveSiteSettings,
  fetchApiModels,
  apiModelOptionsByConfigId,
  apiModelLoadingByConfigId,
  renderSelect,
}) {
  const shared = siteSettings.sharedApi || {};
  const sharedModelKey = String(shared.id || 'shared');
  const sharedModelOptions = apiModelOptionsByConfigId[sharedModelKey] || [];
  const sharedModelLoading = Boolean(apiModelLoadingByConfigId[sharedModelKey]);

  const updateFlag = (key, value) => setSiteSettings((current) => ({ ...current, [key]: value }));
  const updateShared = (key, value) => setSiteSettings((current) => ({
    ...current,
    sharedApi: { ...(current.sharedApi || {}), [key]: value },
  }));

  return (
    <div className="settings-grid account-settings-grid direct-settings-grid profile-stack">
      <section className="api-config-card full-field">
        <div className="api-config-card-head">
          <div>
            <strong>站点开关</strong>
            <span>仅管理员可见。控制全站注册、作品墙访问与共享 API。</span>
          </div>
        </div>
        <div className="api-config-fields">
          <label className="toggle-row full-field">
            <input type="checkbox" checked={Boolean(siteSettings.registrationEnabled)} onChange={(event) => updateFlag('registrationEnabled', event.target.checked)} />
            <span>开放注册</span>
            <small>关闭后访客只能登录，注册入口与接口都会停用。</small>
          </label>
          <label className="toggle-row full-field">
            <input type="checkbox" checked={Boolean(siteSettings.wallRequireLogin)} onChange={(event) => updateFlag('wallRequireLogin', event.target.checked)} />
            <span>作品墙需登录</span>
            <small>开启后未登录访客无法查看作品墙。</small>
          </label>
          <label className="toggle-row full-field">
            <input type="checkbox" checked={Boolean(siteSettings.sharedApiEnabled)} onChange={(event) => updateFlag('sharedApiEnabled', event.target.checked)} />
            <span>启用共享 API</span>
            <small>开启后所有登录用户会自动获得一条只读的「共享」配置，可直接启用生成。</small>
          </label>
          <label className="toggle-row full-field">
            <input type="checkbox" checked={siteSettings.promptToolsEnabled !== false} onChange={(event) => updateFlag('promptToolsEnabled', event.target.checked)} />
            <span>启用提示词助手</span>
            <small>控制图片反推提示词和提示词优化两个入口。</small>
          </label>
        </div>
      </section>

      <section className="api-config-card full-field">
        <div className="api-config-card-head">
          <div>
            <strong>共享 API 参数</strong>
            <span>提供给全站登录用户使用</span>
          </div>
        </div>
        <div className="api-config-fields api-config-fields-ordered">
          <label>
            <span>API 名称</span>
            <input value={shared.apiName || ''} onChange={(event) => updateShared('apiName', event.target.value)} placeholder="站点共享 API" />
          </label>
          <label>
            <span>模型 ID</span>
            <input value={shared.model || ''} onChange={(event) => updateShared('model', event.target.value)} placeholder="gpt-image-2" />
          </label>
          <label>
            <span>提示词优化模型</span>
            <input value={shared.promptModel || ''} onChange={(event) => updateShared('promptModel', event.target.value)} placeholder="例如 gpt-4o-mini" />
          </label>
          <label>
            <span>图片反推模型</span>
            <input value={shared.visionModel || ''} onChange={(event) => updateShared('visionModel', event.target.value)} placeholder="例如 gpt-4o" />
          </label>
          <div className="model-picker-field full-field">
            <span>模型列表</span>
            <div className="model-picker-row">
              {renderSelect({
                id: 'shared-api-model-select',
                label: '',
                value: shared.model || '',
                options: sharedModelOptions.length ? sharedModelOptions : [{ label: shared.model || '暂无模型', value: shared.model || '' }],
                onChange: (value) => updateShared('model', value),
                disabled: !sharedModelOptions.length,
                className: 'settings-select-field model-select-field',
                menuDirection: 'down',
              })}
              {renderSelect({
                id: 'shared-api-prompt-model-select',
                label: '',
                value: shared.promptModel || shared.model || '',
                options: sharedModelOptions.length ? sharedModelOptions : [{ label: shared.promptModel || '提示词模型', value: shared.promptModel || '' }],
                onChange: (value) => updateShared('promptModel', value),
                disabled: !sharedModelOptions.length,
                className: 'settings-select-field model-select-field',
                menuDirection: 'down',
              })}
              {renderSelect({
                id: 'shared-api-vision-model-select',
                label: '',
                value: shared.visionModel || shared.model || '',
                options: sharedModelOptions.length ? sharedModelOptions : [{ label: shared.visionModel || '视觉模型', value: shared.visionModel || '' }],
                onChange: (value) => updateShared('visionModel', value),
                disabled: !sharedModelOptions.length,
                className: 'settings-select-field model-select-field',
                menuDirection: 'down',
              })}
              <button type="button" className="secondary-action model-fetch-button" onClick={() => fetchApiModels(shared.id || 'shared')} disabled={sharedModelLoading}>
                {sharedModelLoading ? '获取中' : '获取模型'}
              </button>
            </div>
          </div>
          <label className="full-field">
            <span>API 地址</span>
            <input value={shared.apiBaseUrl || ''} onChange={(event) => updateShared('apiBaseUrl', event.target.value)} placeholder="https://api.openai.com" />
          </label>
          <label className="full-field">
            <span>密钥设置</span>
            <input type="password" value={shared.apiKey || ''} onChange={(event) => updateShared('apiKey', event.target.value)} placeholder={shared.hasApiKey ? `已保存：${shared.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
          </label>
          {shared.hasApiKey ? (
            <label className="toggle-row full-field">
              <input type="checkbox" checked={Boolean(shared.clearApiKey)} onChange={(event) => updateShared('clearApiKey', event.target.checked)} />
              <span>清除已保存的共享 Key</span>
            </label>
          ) : null}
        </div>
      </section>

      <div className="account-footer full-field">
        <button type="button" className="primary-action" onClick={saveSiteSettings}>保存网站设置</button>
      </div>
    </div>
  );
}