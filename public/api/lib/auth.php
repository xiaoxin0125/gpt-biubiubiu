<?php

declare(strict_types=1);

function cookie_options(int $maxAge): array
{
    return [
        'expires' => time() + $maxAge,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function sign_value(string $value): string
{
    $signature = rtrim(base64_encode(hash_hmac('sha256', $value, (string) cfg('session_secret', ''), true)), '=');
    return 's:' . $value . '.' . $signature;
}

function unsign_value(?string $signed): string
{
    if (!$signed) return '';
    if (strpos($signed, 's:') !== 0) return $signed;

    $raw = substr($signed, 2);
    $dot = strrpos($raw, '.');
    if ($dot === false) return '';

    $value = substr($raw, 0, $dot);
    return hash_equals(sign_value($value), $signed) ? $value : '';
}

function set_signed_cookie(string $name, string $value, int $maxAge): void
{
    setcookie($name, sign_value($value), cookie_options($maxAge));
    $_COOKIE[$name] = sign_value($value);
}

function clear_cookie_value(string $name): void
{
    setcookie($name, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    unset($_COOKIE[$name]);
}

function session_user_id(): ?int
{
    $value = unsign_value($_COOKIE['session_user'] ?? '');
    $id = (int) $value;
    return $id > 0 ? $id : null;
}

function visitor_id(): string
{
    $existing = unsign_value($_COOKIE['visitor_id'] ?? '');
    if ($existing !== '') return $existing;

    $id = bin2hex(random_bytes(16));
    set_signed_cookie('visitor_id', $id, 365 * 24 * 60 * 60);
    return $id;
}

function current_user(): ?array
{
    $id = session_user_id();
    if (!$id) return null;

    $stmt = pdo()->prepare('SELECT id, username, display_name, is_admin, created_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user) return null;

    $displayName = trim((string) ($user['display_name'] ?? '')) ?: $user['username'];
    return ['id' => (int) $user['id'], 'username' => $user['username'], 'displayName' => $displayName, 'isAdmin' => !empty($user['is_admin']), 'createdAt' => $user['created_at']];
}

function require_user(): array
{
    require_database();
    $user = current_user();
    if (!$user) json_response(['error' => '请先登录'], 401);
    return $user;
}

function handle_auth_me(): array
{
    try {
        ensure_schema();
        $user = current_user();
        return ['user' => $user, 'settings' => $user ? settings_for_user((int) $user['id']) : null, 'mysqlConfigured' => true];
    } catch (Throwable $error) {
        return ['user' => null, 'settings' => null, 'mysqlConfigured' => false, 'detail' => $error->getMessage()];
    }
}

function handle_auth_register(array $body): array
{
    require_database();
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if (!preg_match('/^[\w\x{4e00}-\x{9fa5}.-]{2,20}$/u', $username)) json_response(['error' => '用户名需为 2-20 位中文、字母、数字、下划线、点或短横线'], 400);
    if (strlen($password) < 6) json_response(['error' => '密码至少 6 位'], 400);
    $displayName = normalize_display_name((string) ($body['displayName'] ?? ($body['display_name'] ?? '')), $username);

    try {
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $stmt = pdo()->prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)');
        $stmt->execute([$username, $displayName, $hash]);
        $id = (int) pdo()->lastInsertId();
        set_signed_cookie('session_user', (string) $id, 30 * 24 * 60 * 60);
        return ['user' => ['id' => $id, 'username' => $username, 'displayName' => $displayName, 'isAdmin' => false], 'settings' => settings_for_user($id)];
    } catch (Throwable $error) {
        json_response(['error' => '用户名已存在'], 400);
    }
}

function handle_auth_login(array $body): array
{
    require_database();
    $stmt = pdo()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([trim((string) ($body['username'] ?? ''))]);
    $user = $stmt->fetch();
    if (!$user || !password_verify((string) ($body['password'] ?? ''), $user['password_hash'])) json_response(['error' => '用户名或密码错误'], 401);

    set_signed_cookie('session_user', (string) $user['id'], 30 * 24 * 60 * 60);
    $displayName = trim((string) ($user['display_name'] ?? '')) ?: $user['username'];
    return ['user' => ['id' => (int) $user['id'], 'username' => $user['username'], 'displayName' => $displayName, 'isAdmin' => !empty($user['is_admin']), 'createdAt' => $user['created_at']], 'settings' => settings_for_user((int) $user['id'])];
}

function handle_auth_profile(array $body): array
{
    $user = require_user();
    $displayName = normalize_display_name((string) ($body['displayName'] ?? ($body['display_name'] ?? '')), $user['username']);
    $stmt = pdo()->prepare('UPDATE users SET display_name = ? WHERE id = ?');
    $stmt->execute([$displayName, $user['id']]);
    return ['user' => ['id' => (int) $user['id'], 'username' => $user['username'], 'displayName' => $displayName, 'isAdmin' => !empty($user['isAdmin']), 'createdAt' => $user['createdAt'] ?? null]];
}

function handle_auth_password(array $body): array
{
    $user = require_user();
    $currentPassword = (string) ($body['currentPassword'] ?? ($body['current_password'] ?? ''));
    $newPassword = (string) ($body['newPassword'] ?? ($body['new_password'] ?? ''));
    if (strlen($newPassword) < 6) json_response(['error' => '新密码至少 6 位'], 400);

    $stmt = pdo()->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($currentPassword, $row['password_hash'])) json_response(['error' => '旧密码错误'], 401);

    $hash = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = pdo()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->execute([$hash, $user['id']]);
    return ['ok' => true];
}

function handle_auth_logout(): array
{
    clear_cookie_value('session_user');
    return ['ok' => true];
}