import ApiCategoryEditor, { applyApiCategoryUpdate, sharedApiCategorySections } from './ApiCategoryEditor';

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
  const updateSharedCategory = (categoryKey, field, value) => setSiteSettings((current) => ({
    ...current,
    sharedApi: applyApiCategoryUpdate(current.sharedApi || {}, categoryKey, field, value),
  }));

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
            <span>共享配置保留原后台结构；前台只维护生图 API 与提示词助手 API。</span>
          </div>
        </div>
        <ApiCategoryEditor
          sections={sharedApiCategorySections}
          configId={shared.id || 'shared'}
          source={shared}
          onUpdateCategory={updateSharedCategory}
          fetchApiModels={fetchApiModels}
          apiModelOptionsByConfigId={apiModelOptionsByConfigId}
          apiModelLoadingByConfigId={apiModelLoadingByConfigId}
          renderSelect={renderSelect}
          clearKeyLabel="清除已保存的共享 Key"
        />
      </section>

      <div className="account-footer full-field">
        <button type="button" className="primary-action" onClick={saveSiteSettings}>保存网站设置</button>
      </div>
    </div>
  );
}