import { MAX_REQUEST_TIMEOUT_SECONDS } from '../constants/options';
import SiteAdminPanel from './SiteAdminPanel';

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
  siteFlags,
  siteSettings,
  setSiteSettings,
  saveSiteSettings,
}) {
  const isAdmin = Boolean(user?.isAdmin);
  const registrationEnabled = siteFlags?.registrationEnabled !== false;
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
            <div className="account-section-grid">
              <div className="summary-box full-field">
                <span>当前账号</span>
                <strong>{userDisplayName}</strong>
                <small>@{user.username}</small>
              </div>
              <label>
                <span>展示名称</span>
                <input value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="留空则使用用户名" />
              </label>
              <button type="button" className="secondary-action align-end" onClick={saveProfile}>保存名称</button>
              <label>
                <span>旧密码</span>
                <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} placeholder="当前密码" />
              </label>
              <label>
                <span>新密码</span>
                <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} placeholder="至少 6 位" />
              </label>
              <button type="button" className="secondary-action" onClick={changePassword}>修改密码</button>
              <button type="button" className="secondary-action" onClick={logout}>退出登录</button>
            </div>
          ) : null}

          {authTab === 'settings' ? (
            <div className="settings-grid account-settings-grid direct-settings-grid">
              <div className="settings-section-title full-field">
                <strong>API 配置</strong>
                <span>可以保存多套 API。生成时使用当前启用的配置；API Key 加密存储，不会回显明文。</span>
              </div>

              {(apiConfigForm.apiConfigs || []).map((config, index) => {
                const isActiveConfig = String(config.id) === String(apiConfigForm.activeApiConfigId);
                const isShared = Boolean(config.isShared);
                return (
                  <section className={isActiveConfig ? 'api-config-card full-field is-active' : 'api-config-card full-field'} key={config.id}>
                    <div className="api-config-card-head">
                      <div>
                        <strong>{config.apiName || `API 配置 ${index + 1}`}</strong>
                        <span>{isShared ? '站点共享，不可编辑' : isActiveConfig ? '当前启用' : '备用配置'}</span>
                      </div>
                      <div className="api-config-actions">
                        <button type="button" className="secondary-action" onClick={() => setApiConfigForm((current) => ({ ...current, activeApiConfigId: config.id }))}>启用</button>
                        {isShared ? null : (
                          <button type="button" className="secondary-action danger-action" onClick={() => removeApiConfig(config.id)} disabled={(apiConfigForm.apiConfigs || []).filter((item) => !item.isShared).length <= 1}>删除</button>
                        )}
                      </div>
                    </div>
                    <div className="api-config-fields">
                      <label>
                        <span>API 名称</span>
                        <input value={config.apiName} onChange={(event) => updateApiConfig(config.id, 'apiName', event.target.value)} placeholder="OpenAI gpt-image-2" disabled={isShared} />
                      </label>
                      <label>
                        <span>API 地址</span>
                        <input value={config.apiBaseUrl} onChange={(event) => updateApiConfig(config.id, 'apiBaseUrl', event.target.value)} placeholder="https://api.openai.com" disabled={isShared} />
                      </label>
                      <label>
                        <span>模型 ID</span>
                        <input value={config.model} onChange={(event) => updateApiConfig(config.id, 'model', event.target.value)} placeholder="gpt-image-2" disabled={isShared} />
                      </label>
                      <label>
                        <span>请求超时（秒）</span>
                        <input min="10" max={MAX_REQUEST_TIMEOUT_SECONDS} type="number" value={config.requestTimeout} onChange={(event) => updateApiConfig(config.id, 'requestTimeout', event.target.value)} placeholder="999" disabled={isShared} />
                      </label>
                      {isShared ? null : (
                        <label className="full-field">
                          <span>密钥设置</span>
                          <input type="password" value={config.apiKey || ''} onChange={(event) => updateApiConfig(config.id, 'apiKey', event.target.value)} placeholder={config.hasApiKey ? `已保存：${config.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
                        </label>
                      )}
                    </div>
                  </section>
                );
              })}

              <label className="toggle-row full-field">
                <input type="checkbox" checked={apiConfigForm.stream} onChange={(event) => setApiConfigForm((current) => ({ ...current, stream: event.target.checked }))} />
                <span>启用流式传输功能</span>
                <small>这是账号级通用设置，切换 API 配置时不会变化。开启后文生图强制使用 URL 返回；图生图始终不使用 stream。</small>
              </label>

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