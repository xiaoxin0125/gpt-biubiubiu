import { useState } from 'react';
import { requestJson } from '../lib/api';

const randomSecret = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(48);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

export default function InstallPanel({ installStatus, onInstalled }) {
  const [form, setForm] = useState(() => ({
    mysqlHost: '127.0.0.1',
    mysqlPort: '3306',
    mysqlUser: '',
    mysqlPassword: '',
    mysqlDatabase: '',
    sessionSecret: randomSecret(),
    userApiKeySecret: randomSecret(),
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(installStatus?.message || '');
  const [error, setError] = useState('');

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submitInstall = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('正在测试 MySQL 连接，不会修改数据库内容。');

    try {
      const data = await requestJson('/api/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const tables = Array.isArray(data.existingTables) && data.existingTables.length ? `检测到已有表：${data.existingTables.join('、')}` : '未检测到已有业务表。';
      setMessage(`${data.message || '配置已保存。'}${tables}`);
      onInstalled?.(data);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : '安装配置保存失败');
      setMessage('');
    } finally {
      setSaving(false);
    }
  };

  const missing = Array.isArray(installStatus?.missing) ? installStatus.missing : [];

  return (
    <section className="modal-card install-card" role="dialog" aria-label="站点安装">
      <div className="modal-head install-head">
        <div>
          <h2>站点安装配置</h2>
          <p>补齐运行配置，只写入 `.env`，不会清空或覆盖已有数据库内容。</p>
        </div>
      </div>

      <div className="install-notice">
        <strong>怎么填 `MYSQL_USER`？</strong>
        <span>填数据库账号用户名，不是 Linux/root 登录名。宝塔面板通常在「数据库」列表里显示数据库名、用户名和密码。</span>
      </div>

      {missing.length ? <div className="install-missing">当前缺少：{missing.join('、')}</div> : null}
      {installStatus?.configError ? <div className="install-missing">配置状态：{installStatus.configError}</div> : null}

      <form className="install-form" onSubmit={submitInstall}>
        <div className="install-section">
          <div>
            <strong>MySQL 连接</strong>
            <small>请填写已存在的数据库。安装过程只测试连接，不执行删库、清表或重建。</small>
          </div>
          <div className="install-grid">
            <label>
              <span>数据库地址</span>
              <input value={form.mysqlHost} onChange={(event) => update('mysqlHost', event.target.value)} placeholder="127.0.0.1" />
            </label>
            <label>
              <span>端口</span>
              <input type="number" min="1" max="65535" value={form.mysqlPort} onChange={(event) => update('mysqlPort', event.target.value)} placeholder="3306" />
            </label>
            <label>
              <span>数据库用户名</span>
              <input value={form.mysqlUser} onChange={(event) => update('mysqlUser', event.target.value)} placeholder="宝塔数据库用户" autoComplete="username" />
            </label>
            <label>
              <span>数据库密码</span>
              <input type="password" value={form.mysqlPassword} onChange={(event) => update('mysqlPassword', event.target.value)} placeholder="宝塔数据库密码" autoComplete="current-password" />
            </label>
            <label className="full-field">
              <span>数据库名</span>
              <input value={form.mysqlDatabase} onChange={(event) => update('mysqlDatabase', event.target.value)} placeholder="已有数据库名" />
            </label>
          </div>
        </div>

        <div className="install-section">
          <div>
            <strong>站点密钥</strong>
            <small>老站点必须填回原来的 `USER_API_KEY_SECRET`，否则不会丢数据，但旧 API Key 密文无法解密。</small>
          </div>
          <div className="install-grid">
            <label className="full-field">
              <span>SESSION_SECRET</span>
              <input value={form.sessionSecret} onChange={(event) => update('sessionSecret', event.target.value)} placeholder="至少 32 位随机字符串" />
            </label>
            <label className="full-field">
              <span>USER_API_KEY_SECRET</span>
              <input value={form.userApiKeySecret} onChange={(event) => update('userApiKeySecret', event.target.value)} placeholder="至少 32 位随机字符串" />
            </label>
          </div>
        </div>

        {message ? <div className="install-message">{message}</div> : null}
        {error ? <div className="install-error">{error}</div> : null}

        <div className="modal-actions install-actions">
          <button type="submit" className="primary-action" disabled={saving}>{saving ? '保存中' : '测试连接并保存配置'}</button>
        </div>
      </form>
    </section>
  );
}