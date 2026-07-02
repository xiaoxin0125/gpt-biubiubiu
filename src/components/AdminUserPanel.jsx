export default function AdminUserPanel({
  adminUsers,
  userManagementLoading,
  userManagementBusyId,
  userPasswordDrafts,
  setUserPasswordDrafts,
  currentUserId,
  loadAdminUsers,
  updateAdminUserPassword,
  toggleAdminUserDisabled,
  deleteAdminUser,
}) {
  const formatCreatedAt = (value) => {
    if (!value) return '未知时间';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  return (
    <div className="settings-grid account-settings-grid direct-settings-grid profile-stack user-management-panel">
      <section className="api-config-card full-field is-intro">
        <div className="api-config-card-head">
          <div>
            <strong>用户管理</strong>
            <span>管理员可重置密码、禁用账号、删除用户；删除用户会保留历史作品并移除账号归属。</span>
          </div>
          <button type="button" className="secondary-action" onClick={loadAdminUsers} disabled={userManagementLoading}>刷新</button>
        </div>
      </section>

      {userManagementLoading && !adminUsers.length ? (
        <section className="api-config-card full-field user-management-empty">
          <strong>正在加载用户列表</strong>
          <span>请稍候。</span>
        </section>
      ) : null}

      {!userManagementLoading && !adminUsers.length ? (
        <section className="api-config-card full-field user-management-empty">
          <strong>暂无用户</strong>
          <span>当前没有可管理的账号。</span>
        </section>
      ) : null}

      {adminUsers.map((managedUser) => {
        const isSelf = String(managedUser.id) === String(currentUserId);
        const busy = String(userManagementBusyId) === String(managedUser.id);
        const passwordDraft = userPasswordDrafts[String(managedUser.id)] || '';

        return (
          <section className={managedUser.isDisabled ? 'api-config-card full-field user-card is-disabled-user' : 'api-config-card full-field user-card'} key={managedUser.id}>
            <div className="api-config-card-head user-card-head">
              <div>
                <strong>{managedUser.displayName || managedUser.username}</strong>
                <span>@{managedUser.username} · {managedUser.isAdmin ? '管理员' : '普通用户'} · {managedUser.isDisabled ? '已禁用' : '可登录'} · 注册于 {formatCreatedAt(managedUser.createdAt)}</span>
              </div>
              <div className="user-card-stats" aria-label="用户数据统计">
                <span>{managedUser.imageCount || 0} 张图</span>
                <span>{managedUser.wallCount || 0} 个上墙</span>
                <span>{managedUser.apiConfigCount || 0} 套 API</span>
              </div>
            </div>

            <div className="api-config-fields user-card-fields">
              <label>
                <span>新密码</span>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(event) => setUserPasswordDrafts((current) => ({ ...current, [managedUser.id]: event.target.value }))}
                  placeholder="至少 6 位"
                  disabled={busy}
                />
              </label>
              <div className="user-card-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => updateAdminUserPassword(managedUser.id)}
                  disabled={busy || passwordDraft.length < 6}
                >
                  {busy ? '处理中' : '修改密码'}
                </button>
                <button
                  type="button"
                  className={managedUser.isDisabled ? 'secondary-action' : 'secondary-action danger-action'}
                  onClick={() => toggleAdminUserDisabled(managedUser)}
                  disabled={busy || isSelf}
                  title={isSelf ? '不能禁用当前登录账号' : ''}
                >
                  {managedUser.isDisabled ? '启用账号' : '禁用账号'}
                </button>
                <button
                  type="button"
                  className="secondary-action danger-action"
                  onClick={() => deleteAdminUser(managedUser)}
                  disabled={busy || isSelf}
                  title={isSelf ? '不能删除当前登录账号' : ''}
                >
                  删除用户
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}