import { defaultApiConfigItem } from '../constants/options';

export default function Topbar({
  view,
  setView,
  user,
  userDisplayName,
  status,
  statusText,
  activeApiConfig,
  apiConfigForm,
  switchActiveApiConfig,
  renderSelect,
  openAccount,
}) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="GPT Biubiubiu">
        <span className="brand-orb" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M6 21.5 21.5 6l4.5 4.5L10.5 26H6v-4.5Z" />
            <path d="M18.5 9 23 13.5" />
            <path d="M7 7h7" />
            <path d="M5 12h4" />
            <path d="M20 25h7" />
          </svg>
        </span>
        <span>GPT Biubiubiu</span>
      </a>

      <nav className="mode-tabs" aria-label="工作台模式">
        <button
          type="button"
          className={view === 'generate' ? 'is-active' : ''}
          onClick={() => setView('generate')}
        >
          生图
        </button>
        <button
          type="button"
          className={view === 'wall' ? 'is-active' : ''}
          onClick={() => setView('wall')}
        >
          作品墙
        </button>
      </nav>

      <div className="topbar-actions">
        {status.configured && user ? renderSelect({
          id: 'topbar-api-switch',
          label: '',
          value: activeApiConfig?.id || apiConfigForm.activeApiConfigId,
          options: (apiConfigForm.apiConfigs || []).filter((item) => item.hasApiKey || item.isShared).map((item) => ({ label: item.apiName || defaultApiConfigItem.apiName, value: item.id })),
          onChange: switchActiveApiConfig,
          className: 'status-api-select',
          menuDirection: 'down',
        }) : (
          <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{statusText}</span>
        )}
        <button type="button" className="round-tool account-tool" onClick={openAccount} aria-label="账号设置">
          {user ? userDisplayName : '登录'}
        </button>
      </div>
    </header>
  );
}