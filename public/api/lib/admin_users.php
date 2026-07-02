<?php

declare(strict_types=1);

function admin_user_client(array $row): array
{
    $displayName = trim((string) ($row['display_name'] ?? '')) ?: (string) ($row['username'] ?? '');
    return [
        'id' => (int) $row['id'],
        'username' => (string) $row['username'],
        'displayName' => $displayName,
        'isAdmin' => !empty($row['is_admin']),
        'isDisabled' => !empty($row['is_disabled']),
        'createdAt' => $row['created_at'] ?? null,
        'imageCount' => (int) ($row['image_count'] ?? 0),
        'wallCount' => (int) ($row['wall_count'] ?? 0),
        'apiConfigCount' => (int) ($row['api_config_count'] ?? 0),
    ];
}

function handle_admin_users(): array
{
    require_admin();

    $stmt = pdo()->query("SELECT
      u.id,
      u.username,
      u.display_name,
      u.is_admin,
      u.is_disabled,
      u.created_at,
      COUNT(DISTINCT ij.id) AS image_count,
      COUNT(DISTINCT wi.id) AS wall_count,
      COUNT(DISTINCT uac.id) AS api_config_count
    FROM users u
    LEFT JOIN image_jobs ij ON ij.user_id = u.id
    LEFT JOIN wall_items wi ON wi.user_id = u.id
    LEFT JOIN user_api_configs uac ON uac.user_id = u.id
    GROUP BY u.id, u.username, u.display_name, u.is_admin, u.is_disabled, u.created_at
    ORDER BY u.is_admin DESC, u.is_disabled ASC, u.created_at DESC, u.id DESC");

    $users = array_map('admin_user_client', $stmt->fetchAll() ?: []);
    return ['users' => $users];
}

function handle_admin_user_password(int $targetUserId, array $body): array
{
    $admin = require_admin();
    $newPassword = (string) ($body['newPassword'] ?? ($body['new_password'] ?? ''));
    if ($targetUserId <= 0) json_response(['error' => '用户不存在'], 404);
    if (strlen($newPassword) < 6) json_response(['error' => '新密码至少 6 位'], 400);

    $stmt = pdo()->prepare('SELECT id, username FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetUserId]);
    $target = $stmt->fetch();
    if (!$target) json_response(['error' => '用户不存在'], 404);

    enforce_rate_limit('admin_password', (string) $admin['id'], 12, 900);

    $hash = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = pdo()->prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?');
    $stmt->execute([$hash, $targetUserId]);
    reset_rate_limit('admin_password', (string) $admin['id']);

    return ['ok' => true];
}

function handle_admin_user_disabled(int $targetUserId, array $body): array
{
    $admin = require_admin();
    if ($targetUserId <= 0) json_response(['error' => '用户不存在'], 404);
    if ($targetUserId === (int) $admin['id']) json_response(['error' => '不能禁用当前登录账号'], 400);

    $disabled = !empty($body['disabled']) ? 1 : 0;
    $db = pdo();
    $stmt = $db->prepare('SELECT id, is_admin, is_disabled FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetUserId]);
    $target = $stmt->fetch();
    if (!$target) json_response(['error' => '用户不存在'], 404);

    if ($disabled && !empty($target['is_admin'])) {
        $stmt = $db->prepare('SELECT COUNT(*) FROM users WHERE is_admin = 1 AND is_disabled = 0 AND id <> ?');
        $stmt->execute([$targetUserId]);
        if ((int) $stmt->fetchColumn() <= 0) json_response(['error' => '不能禁用最后一个可用管理员账号'], 400);
    }

    $stmt = $db->prepare('UPDATE users SET is_disabled = ?, token_version = token_version + 1 WHERE id = ?');
    $stmt->execute([$disabled, $targetUserId]);

    return ['ok' => true, 'user' => ['id' => $targetUserId, 'isDisabled' => (bool) $disabled]];
}

function handle_admin_user_delete(int $targetUserId): array
{
    $admin = require_admin();
    if ($targetUserId <= 0) json_response(['error' => '用户不存在'], 404);
    if ($targetUserId === (int) $admin['id']) json_response(['error' => '不能删除当前登录的管理员账号'], 400);

    $db = pdo();
    $stmt = $db->prepare('SELECT id, is_admin FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetUserId]);
    $target = $stmt->fetch();
    if (!$target) json_response(['error' => '用户不存在'], 404);

    if (!empty($target['is_admin'])) {
        $stmt = $db->prepare('SELECT COUNT(*) FROM users WHERE is_admin = 1 AND is_disabled = 0 AND id <> ?');
        $stmt->execute([$targetUserId]);
        if ((int) $stmt->fetchColumn() <= 0) json_response(['error' => '不能删除最后一个可用管理员账号'], 400);
    }

    $db->beginTransaction();
    try {
        $db->prepare('UPDATE image_jobs SET user_id = NULL WHERE user_id = ?')->execute([$targetUserId]);
        $db->prepare('UPDATE wall_items SET user_id = NULL WHERE user_id = ?')->execute([$targetUserId]);
        $db->prepare('DELETE FROM user_settings WHERE user_id = ?')->execute([$targetUserId]);
        $db->prepare('DELETE FROM user_api_configs WHERE user_id = ?')->execute([$targetUserId]);
        $db->prepare('DELETE FROM users WHERE id = ?')->execute([$targetUserId]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }

    return ['ok' => true];
}