import {
  API_CONFIG_SCOPE_IMAGE,
  API_CONFIG_SCOPE_PROMPT,
  defaultApiConfigItem,
} from '../constants/options';
import { apiConfigHasKeyForScope, apiConfigLabelForScope } from '../lib/api';

export default function Topbar({
  view,
  setView,
  user,
  userDisplayName,
  status,
  statusText,
  activeApiConfig,
  activePromptApiConfig,
  apiConfigForm,
  siteFlags,
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
        {siteFlags?.promptToolsEnabled !== false ? (
          <button
            type="button"
            className={view === 'prompt-tools' ? 'is-active' : ''}
            onClick={() => setView('prompt-tools')}
          >
            提示词助手
          </button>
        ) : null}
      </nav>

      <div className="topbar-actions">
        {(() => {
          if (view === 'wall') {
            return renderSelect({
              id: 'topbar-wall-display',
              label: '',
              value: 'wall-display',
              options: [{ label: '作品展示', value: 'wall-display' }],
              onChange: () => {},
              disabled: true,
              className: 'status-api-select',
              menuDirection: 'down',
            });
          }

          const apiScope = view === 'prompt-tools' ? API_CONFIG_SCOPE_PROMPT : view === 'generate' ? API_CONFIG_SCOPE_IMAGE : '';
          if (!apiScope || !user) return <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{statusText}</span>;

          const activeConfig = apiScope === API_CONFIG_SCOPE_PROMPT ? activePromptApiConfig : activeApiConfig;
          const activeId = apiScope === API_CONFIG_SCOPE_PROMPT ? apiConfigForm.activePromptApiConfigId : apiConfigForm.activeApiConfigId;
          const options = (apiConfigForm.apiConfigs || [])
            .filter((item) => apiConfigHasKeyForScope(item, apiScope))
            .map((item) => ({ label: apiConfigLabelForScope(item, apiScope, defaultApiConfigItem.apiName), value: item.id }));

          if (!options.length) return <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{statusText}</span>;

          return renderSelect({
            id: 'topbar-api-switch',
            label: '',
            value: activeConfig?.id || activeId,
            options,
            onChange: (value) => switchActiveApiConfig(value, apiScope),
            className: 'status-api-select',
            menuDirection: 'down',
          });
        })()}
        <button type="button" className="round-tool account-tool" onClick={openAccount} aria-label="账号设置">
          {user ? userDisplayName : '登录'}
        </button>
      </div>
    </header>
  );
}