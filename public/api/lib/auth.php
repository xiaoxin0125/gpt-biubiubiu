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
    $secret = security_secret('session_secret');
    if ($secret === '') throw new RuntimeException('服务端未配置安全的 SESSION_SECRET');

    $signature = rtrim(base64_encode(hash_hmac('sha256', $value, $secret, true)), '=');
    return 's:' . $value . '.' . $signature;
}

function unsign_value(?string $signed): string
{
    if (!$signed || strpos($signed, 's:') !== 0) return '';

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

function auth_captcha_code(int $length = 5): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $code = '';
    for ($index = 0; $index < $length; $index++) {
        $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $code;
}

function auth_captcha_svg(string $code): string
{
    $chars = str_split($code);
    $text = '';
    foreach ($chars as $index => $char) {
        $x = 18 + $index * 21 + random_int(-2, 2);
        $y = 35 + random_int(-4, 4);
        $rotate = random_int(-16, 16);
        $text .= '<text x="' . $x . '" y="' . $y . '" transform="rotate(' . $rotate . ' ' . $x . ' ' . $y . ')">' . htmlspecialchars($char, ENT_QUOTES, 'UTF-8') . '</text>';
    }

    $noise = '';
    for ($index = 0; $index < 6; $index++) {
        $noise .= '<line x1="' . random_int(4, 118) . '" y1="' . random_int(8, 40) . '" x2="' . random_int(4, 118) . '" y2="' . random_int(8, 40) . '" />';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="48" viewBox="0 0 130 48" role="img" aria-label="验证码">'
        . '<rect width="130" height="48" rx="10" fill="#f6f6f1"/>'
        . '<g stroke="#111" stroke-width="1.6" stroke-linecap="round" opacity="0.22">' . $noise . '</g>'
        . '<g fill="#111" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="24" font-weight="900" letter-spacing="2">' . $text . '</g>'
        . '</svg>';
}

function handle_auth_captcha(): array
{
    $code = auth_captcha_code();
    set_signed_cookie('auth_captcha', strtolower($code) . '|' . (time() + 600) . '|' . bin2hex(random_bytes(6)), 600);
    return [
        'image' => 'data:image/svg+xml;base64,' . base64_encode(auth_captcha_svg($code)),
        'ttl' => 600,
    ];
}

function require_auth_captcha(array $body): void
{
    $input = strtolower(trim((string) ($body['captcha'] ?? ($body['authCaptcha'] ?? ($body['captchaCode'] ?? '')))));
    if ($input === '') json_response(['error' => '请输入验证码'], 400);

    $value = unsign_value($_COOKIE['auth_captcha'] ?? '');
    clear_cookie_value('auth_captcha');
    if ($value === '') json_response(['error' => '验证码已失效，请刷新后重试'], 400);

    [$answer, $expires] = array_pad(explode('|', $value, 3), 2, '');
    if ((int) $expires < time()) json_response(['error' => '验证码已过期，请刷新后重试'], 400);
    if (!hash_equals((string) $answer, $input)) json_response(['error' => '验证码错误，请刷新后重试'], 400);
}

function session_token(): array
{
    $value = unsign_value($_COOKIE['session_user'] ?? '');
    if ($value === '') return ['id' => 0, 'version' => 0];

    $parts = explode('.', $value, 2);
    $id = (int) ($parts[0] ?? 0);
    $version = isset($parts[1]) ? (int) $parts[1] : 0;
    return ['id' => $id > 0 ? $id : 0, 'version' => $version];
}

function session_user_id(): ?int
{
    $id = session_token()['id'];
    return $id > 0 ? $id : null;
}

function issue_session_cookie(int $userId, int $tokenVersion): void
{
    set_signed_cookie('session_user', $userId . '.' . $tokenVersion, 30 * 24 * 60 * 60);
}

function current_user(): ?array
{
    $token = session_token();
    if ($token['id'] <= 0) return null;

    $stmt = pdo()->prepare('SELECT id, username, display_name, is_admin, token_version, created_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$token['id']]);
    $user = $stmt->fetch();
    if (!$user) return null;
    if ((int) ($user['token_version'] ?? 0) !== $token['version']) return null;

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

function rate_limit_key(string $scope, string $identity = ''): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $safeIdentity = strtolower(trim($identity));
    return hash('sha256', $scope . '|' . $ip . '|' . $safeIdentity);
}

function enforce_rate_limit(string $scope, string $identity = '', int $limit = 8, int $windowSeconds = 900): void
{
    require_database();
    $key = rate_limit_key($scope, $identity);
    $db = pdo();
    $stmt = $db->prepare('SELECT attempts, UNIX_TIMESTAMP(window_started_at) AS window_started_at FROM auth_rate_limits WHERE rate_key = ? LIMIT 1');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    $now = time();

    if (!$row || $now - (int) ($row['window_started_at'] ?? 0) >= $windowSeconds) {
        $stmt = $db->prepare('REPLACE INTO auth_rate_limits (rate_key, attempts, window_started_at, updated_at) VALUES (?, 1, NOW(), NOW())');
        $stmt->execute([$key]);
        return;
    }

    if ((int) $row['attempts'] >= $limit) json_response(['error' => '请求过于频繁，请稍后再试'], 429);

    $stmt = $db->prepare('UPDATE auth_rate_limits SET attempts = attempts + 1, updated_at = NOW() WHERE rate_key = ?');
    $stmt->execute([$key]);
}

function reset_rate_limit(string $scope, string $identity = ''): void
{
    $key = rate_limit_key($scope, $identity);
    $stmt = pdo()->prepare('DELETE FROM auth_rate_limits WHERE rate_key = ?');
    $stmt->execute([$key]);
}

function handle_auth_me(): array
{
    try {
        ensure_schema();
        $user = current_user();
        return ['user' => $user, 'settings' => $user ? settings_for_user((int) $user['id']) : null, 'mysqlConfigured' => true];
    } catch (Throwable $error) {
        error_log('[gpt_biubiubiu] auth_me: ' . $error->getMessage());
        return ['user' => null, 'settings' => null, 'mysqlConfigured' => false];
    }
}

function handle_auth_register(array $body): array
{
    require_database();
    if (!registration_enabled()) json_response(['error' => '注册已关闭'], 403);
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if (!preg_match('/^[\w\x{4e00}-\x{9fa5}.-]{2,20}$/u', $username)) json_response(['error' => '用户名需为 2-20 位中文、字母、数字、下划线、点或短横线'], 400);
    if (strlen($password) < 6) json_response(['error' => '密码至少 6 位'], 400);
    require_auth_captcha($body);
    enforce_rate_limit('register', $username, 5, 900);
    $displayName = normalize_display_name((string) ($body['displayName'] ?? ($body['display_name'] ?? '')), $username);

    try {
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $stmt = pdo()->prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)');
        $stmt->execute([$username, $displayName, $hash]);
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) === 1062) json_response(['error' => '用户名已存在'], 400);
        throw $error;
    }

    $id = (int) pdo()->lastInsertId();
    issue_session_cookie($id, 0);
    return ['user' => ['id' => $id, 'username' => $username, 'displayName' => $displayName, 'isAdmin' => false], 'settings' => settings_for_user($id)];
}

function handle_auth_login(array $body): array
{
    require_database();
    $username = trim((string) ($body['username'] ?? ''));
    require_auth_captcha($body);
    enforce_rate_limit('login', $username, 8, 900);
    $stmt = pdo()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    if (!$user || !password_verify((string) ($body['password'] ?? ''), $user['password_hash'])) json_response(['error' => '用户名或密码错误'], 401);

    reset_rate_limit('login', $username);
    issue_session_cookie((int) $user['id'], (int) ($user['token_version'] ?? 0));
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
    enforce_rate_limit('password', (string) $user['id'], 5, 900);

    $stmt = pdo()->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($currentPassword, $row['password_hash'])) json_response(['error' => '旧密码错误'], 401);

    $hash = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = pdo()->prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?');
    $stmt->execute([$hash, $user['id']]);
    reset_rate_limit('password', (string) $user['id']);

    $stmt = pdo()->prepare('SELECT token_version FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$user['id']]);
    issue_session_cookie((int) $user['id'], (int) $stmt->fetchColumn());
    return ['ok' => true];
}

function handle_auth_logout(): array
{
    clear_cookie_value('session_user');
    return ['ok' => true];
}