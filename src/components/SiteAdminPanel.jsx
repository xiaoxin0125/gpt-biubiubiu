const sharedApiSections = [
  {
    key: 'imageApi',
    title: '共享生图 API 参数',
    description: '提供给文生图、图生图和编辑生成。',
    modelLabel: '生图模型 ID',
    modelPlaceholder: 'gpt-image-2',
    namePlaceholder: '共享生图 API',
  },
  {
    key: 'promptApi',
    title: '共享提示词优化 API 参数',
    description: '提供给提示词润色、扩写和翻译。',
    modelLabel: '提示词优化模型 ID',
    modelPlaceholder: '例如 gpt-4o-mini',
    namePlaceholder: '共享提示词 API',
  },
  {
    key: 'visionApi',
    title: '共享图片反推/视觉 API 参数',
    description: '提供给图片描述和反推提示词。',
    modelLabel: '视觉模型 ID',
    modelPlaceholder: '例如 gpt-4o',
    namePlaceholder: '共享视觉 API',
  },
];

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

  const updateFlag = (key, value) => setSiteSettings((current) => ({ ...current, [key]: value }));
  const updateSharedCategory = (categoryKey, field, value) => setSiteSettings((current) => {
    const currentShared = current.sharedApi || {};
    const nextCategory = { ...(currentShared[categoryKey] || {}), [field]: value };
    const nextShared = { ...currentShared, [categoryKey]: nextCategory };
    if (categoryKey === 'imageApi') {
      nextShared.apiName = nextCategory.apiName;
      nextShared.apiBaseUrl = nextCategory.apiBaseUrl;
      nextShared.model = nextCategory.model;
      nextShared.apiKey = nextCategory.apiKey;
      nextShared.hasApiKey = nextCategory.hasApiKey;
      nextShared.apiKeyHint = nextCategory.apiKeyHint;
      nextShared.requestTimeout = nextCategory.requestTimeout;
    } else if (categoryKey === 'promptApi') {
      nextShared.promptModel = nextCategory.model;
    } else if (categoryKey === 'visionApi') {
      nextShared.visionModel = nextCategory.model;
    }
    return { ...current, sharedApi: nextShared };
  });
  const modelOptionsFor = (categoryKey, currentModel) => {
    const key = `shared:${categoryKey}`;
    const options = apiModelOptionsByConfigId[key] || [];
    return options.length ? options : [{ label: currentModel || '暂无模型', value: currentModel || '' }];
  };
  const isModelLoading = (categoryKey) => Boolean(apiModelLoadingByConfigId[`shared:${categoryKey}`]);

  return (
    <div className="settings-grid account-settings-grid direct-settings-grid profile-stack">
      <section className="api-config-card full-field">
        <div className="api-config-card-head">
          <div>
            <strong>站点开关</strong>
            <span>仅管理员可见。控制全站注册、作品墙访问与提示词助手。</span>
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
            <input type="checkbox" checked={siteSettings.promptToolsEnabled !== false} onChange={(event) => updateFlag('promptToolsEnabled', event.target.checked)} />
            <span>启用提示词助手</span>
            <small>控制图片反推提示词和提示词优化两个入口。</small>
          </label>
          <label className="toggle-row full-field">
            <input type="checkbox" checked={siteSettings.sharedApiEnabled !== false} onChange={(event) => updateFlag('sharedApiEnabled', event.target.checked)} />
            <span>启用共享 API 参数设置</span>
            <small>关闭后用户不会使用管理员提供的共享 API 配置。</small>
          </label>
        </div>
      </section>

      <section className="api-config-card full-field">
        <div className="api-config-card-head">
          <div>
            <strong>共享 API 参数</strong>
            <span>三类共享配置互相独立，按功能分别使用。</span>
          </div>
        </div>
        <div className="api-category-stack">
          {sharedApiSections.map((section) => {
            const category = shared[section.key] || {};
            const options = modelOptionsFor(section.key, category.model || '');
            const loading = isModelLoading(section.key);
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
                    <input value={category.apiName || ''} onChange={(event) => updateSharedCategory(section.key, 'apiName', event.target.value)} placeholder={section.namePlaceholder} />
                  </label>
                  <label>
                    <span>{section.modelLabel}</span>
                    <input value={category.model || ''} onChange={(event) => updateSharedCategory(section.key, 'model', event.target.value)} placeholder={section.modelPlaceholder} />
                  </label>
                  <div className="model-picker-field full-field">
                    <span>模型列表</span>
                    <div className="model-picker-row single-model-picker-row">
                      {renderSelect({
                        id: `shared-${section.key}-model-select`,
                        label: '',
                        value: category.model || '',
                        options,
                        onChange: (value) => updateSharedCategory(section.key, 'model', value),
                        disabled: !options.length || !options[0]?.value,
                        className: 'settings-select-field model-select-field',
                        menuDirection: 'down',
                      })}
                    </div>
                  </div>
                  <label>
                    <span>API 地址</span>
                    <input value={category.apiBaseUrl || ''} onChange={(event) => updateSharedCategory(section.key, 'apiBaseUrl', event.target.value)} placeholder="https://api.openai.com" />
                  </label>
                  <div className="model-fetch-field">
                    <button type="button" className="secondary-action model-fetch-button" onClick={() => fetchApiModels(shared.id || 'shared', section.key)} disabled={loading}>
                      {loading ? '获取中' : '获取模型'}
                    </button>
                  </div>
                  <label className="full-field">
                    <span>密钥设置</span>
                    <input type="password" value={category.apiKey || ''} onChange={(event) => updateSharedCategory(section.key, 'apiKey', event.target.value)} placeholder={category.hasApiKey ? `已保存：${category.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
                  </label>
                  {category.hasApiKey ? (
                    <label className="toggle-row full-field compact-toggle-row">
                      <input type="checkbox" checked={Boolean(category.clearApiKey)} onChange={(event) => updateSharedCategory(section.key, 'clearApiKey', event.target.checked)} />
                      <span>清除已保存的共享 Key</span>
                    </label>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <div className="account-footer full-field">
        <button type="button" className="primary-action" onClick={saveSiteSettings}>保存网站设置</button>
      </div>
    </div>
  );
}