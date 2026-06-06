<?php

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();

define('DEFAULT_REQUEST_TIMEOUT', 999);
define('MAX_REQUEST_TIMEOUT', 999);
define('REQUEST_TIMEOUT_BUFFER', 60);

@ini_set('max_execution_time', (string) (MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER));
@ini_set('default_socket_timeout', (string) (MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER));
@set_time_limit(MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER);
@ignore_user_abort(true);

$configCandidates = [
    __DIR__ . '/.php-api-config.php',
    dirname(__DIR__) . '/.php-api-config.php',
    dirname(__DIR__, 2) . '/.php-api-config.php',
    dirname(__DIR__, 3) . '/.php-api-config.php',
];
$configPath = '';
foreach ($configCandidates as $candidate) {
    if (@is_file($candidate)) {
        $configPath = $candidate;
        break;
    }
}
$config = $configPath ? require $configPath : [];

$state = [
    'schemaReady' => false,
    'pdo' => null,
];

function cfg(string $key, $fallback = null)
{
    global $config;
    return $config[$key] ?? $fallback;
}

function json_response(array $payload, int $status = 200): void
{
    if (ob_get_level() > 0) ob_clean();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function pdo(): PDO
{
    global $state;
    if ($state['pdo'] instanceof PDO) return $state['pdo'];

    $host = cfg('mysql_host', '127.0.0.1');
    $port = (int) cfg('mysql_port', 3306);
    $db = cfg('mysql_database', 'gpt-biubiubiu');
    $user = cfg('mysql_user', 'GPT-biubiubiu');
    $password = cfg('mysql_password', '');
    $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";

    $state['pdo'] = new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $state['pdo'];
}

function ensure_column(PDO $db, string $table, string $column, string $definition): void
{
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $column)) return;

    $stmt = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $stmt->execute([$table, $column]);
    if ((int) $stmt->fetchColumn() > 0) return;

    try {
        $db->exec("ALTER TABLE `{$table}` ADD COLUMN {$definition}");
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) !== 1060) throw $error;
    }
}

function normalize_display_name(string $value, string $fallback): string
{
    $displayName = trim($value);
    if ($displayName === '') return $fallback;
    if (!preg_match('/^[\p{L}\p{N}_ .-]{1,30}$/u', $displayName)) json_response(['error' => '展示名称需为 1-30 位中文、字母、数字、空格、下划线、点或短横线'], 400);
    return $displayName;
}

function valid_api_base_url(string $value): bool
{
    if ($value === '') return true;
    $parts = parse_url($value);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    return in_array($scheme, ['http', 'https'], true) && !empty($parts['host']);
}

function ensure_schema(): void
{
    global $state;
    if ($state['schemaReady']) return;

    $db = pdo();
    $db->exec("CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(96) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      model VARCHAR(128) DEFAULT NULL,
      api_name VARCHAR(128) DEFAULT NULL,
      api_base_url VARCHAR(255) DEFAULT NULL,
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      stream TINYINT(1) NOT NULL DEFAULT 0,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS wall_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      client_id VARCHAR(80) DEFAULT NULL,
      author_name VARCHAR(96) NOT NULL DEFAULT '未知艺术家',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      image_mime VARCHAR(80) DEFAULT 'image/png',
      params_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wall_items_created (created_at),
      INDEX idx_wall_items_user (user_id),
      INDEX idx_wall_items_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    ensure_column($db, 'users', 'display_name', 'display_name VARCHAR(96) DEFAULT NULL AFTER username');
    ensure_column($db, 'users', 'is_admin', 'is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
    ensure_column($db, 'user_settings', 'api_name', 'api_name VARCHAR(128) DEFAULT NULL AFTER model');
    ensure_column($db, 'user_settings', 'api_base_url', 'api_base_url VARCHAR(255) DEFAULT NULL AFTER api_name');
    ensure_column($db, 'user_settings', 'request_timeout', 'request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER api_base_url');
    ensure_column($db, 'user_settings', 'stream', 'stream TINYINT(1) NOT NULL DEFAULT 0 AFTER request_timeout');

    $adminHash = password_hash('1427145484', PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = $db->prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE is_admin = 1');
    $stmt->execute(['admin', 'admin', $adminHash]);
    $stmt = $db->prepare('UPDATE users SET is_admin = 1 WHERE username = ? OR display_name = ?');
    $stmt->execute(['筱信', '筱信']);

    $db->exec('UPDATE user_settings SET request_timeout = 999 WHERE request_timeout IN (180, 600)');
    $db->exec("UPDATE user_settings SET model = 'gpt-image-2' WHERE model = 'gpt-image-1'");

    $state['schemaReady'] = true;
}

function require_database(): void
{
    try {
        ensure_schema();
    } catch (Throwable $error) {
        json_response(['error' => '服务端未配置 MySQL', 'detail' => $error->getMessage()], 503);
    }
}

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

function settings_for_user(int $userId): ?array
{
    $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $settings = $stmt->fetch();
    if (!$settings) return null;

    return [
        'model' => $settings['model'] ?: '',
        'apiName' => $settings['api_name'] ?: 'OpenAI Compatible',
        'apiBaseUrl' => $settings['api_base_url'] ?: '',
        'requestTimeout' => (int) ($settings['request_timeout'] ?: DEFAULT_REQUEST_TIMEOUT),
        'stream' => !empty($settings['stream']),
        'hasApiKey' => !empty($settings['api_key_ciphertext']),
        'apiKeyHint' => $settings['api_key_hint'] ?: '',
    ];
}

function api_key_secret(): string
{
    return (string) (cfg('user_api_key_secret') ?: cfg('session_secret') ?: '');
}

function encryption_key(): string
{
    return hash('sha256', api_key_secret(), true);
}

function encrypt_api_key(string $value): array
{
    if (api_key_secret() === '') throw new RuntimeException('服务端未配置 USER_API_KEY_SECRET');
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($value, 'aes-256-gcm', encryption_key(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ciphertext === false) throw new RuntimeException('API Key 加密失败');

    return [
        'api_key_ciphertext' => base64_encode($ciphertext),
        'api_key_iv' => base64_encode($iv),
        'api_key_tag' => base64_encode($tag),
        'api_key_hint' => strlen($value) > 8 ? substr($value, 0, 3) . '...' . substr($value, -4) : '已保存',
    ];
}

function decrypt_api_key(?array $settings): string
{
    if (!$settings || api_key_secret() === '' || empty($settings['api_key_ciphertext']) || empty($settings['api_key_iv']) || empty($settings['api_key_tag'])) return '';

    $plain = openssl_decrypt(
        base64_decode((string) $settings['api_key_ciphertext']),
        'aes-256-gcm',
        encryption_key(),
        OPENSSL_RAW_DATA,
        base64_decode((string) $settings['api_key_iv']),
        base64_decode((string) $settings['api_key_tag'])
    );

    return $plain === false ? '' : $plain;
}

function stored_user_settings(): ?array
{
    $userId = session_user_id();
    if (!$userId) return null;

    $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $settings = $stmt->fetch();
    return $settings ?: null;
}

function stored_user_api_key(): string
{
    $settings = stored_user_settings();
    return decrypt_api_key($settings);
}

function client_wall_item(array $item): array
{
    $params = [];
    if (!empty($item['params_json'])) {
        $decoded = is_string($item['params_json']) ? json_decode($item['params_json'], true) : $item['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    return [
        'id' => (int) $item['id'],
        'wallItemId' => (int) $item['id'],
        'url' => $item['image_url'] ?: '',
        'b64_json' => $item['image_b64'] ?: '',
        'imageMime' => $item['image_mime'] ?: 'image/png',
        'prompt' => $item['prompt'] ?: '',
        'revised_prompt' => $item['revised_prompt'] ?: '',
        'form' => $params,
        'authorName' => $item['author_name'] ?: '未知艺术家',
        'createdAt' => $item['created_at'],
        'isOnWall' => true,
        'source' => $params['source'] ?? (($params['referenceName'] ?? '') !== '' ? 'edit' : 'generation'),
    ];
}

function route_path(): string
{
    $route = $_GET['route'] ?? '';
    if ($route !== '') return '/' . ltrim((string) $route, '/');

    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $pos = strpos($uri, '/api');
    return $pos === false ? '/' : '/' . ltrim(substr($uri, $pos + 4), '/');
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $route = route_path();
    $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];

    if ($method === 'GET' && $route === '/health') {
        $configured = false;
        $apiName = 'OpenAI Compatible';
        try {
            ensure_schema();
            $settings = stored_user_settings();
            $apiName = trim((string) ($settings['api_name'] ?? '')) ?: $apiName;
            $configured = stored_user_api_key() !== '';
        } catch (Throwable $error) {
            $configured = false;
        }

        json_response([
            'ok' => true,
            'configured' => $configured,
            'mysqlConfigured' => true,
            'apiName' => $apiName,
            'baseUrl' => rtrim((string) cfg('openai_base_url', 'https://api.openai.com'), '/'),
            'defaultImageModel' => cfg('openai_image_model', 'gpt-image-2'),
        ]);
    }

    if ($method === 'GET' && $route === '/auth/me') {
        try {
            ensure_schema();
            $user = current_user();
            json_response(['user' => $user, 'settings' => $user ? settings_for_user((int) $user['id']) : null, 'mysqlConfigured' => true]);
        } catch (Throwable $error) {
            json_response(['user' => null, 'settings' => null, 'mysqlConfigured' => false, 'detail' => $error->getMessage()]);
        }
    }

    if ($method === 'POST' && $route === '/auth/register') {
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
            json_response(['user' => ['id' => $id, 'username' => $username, 'displayName' => $displayName, 'isAdmin' => false], 'settings' => null]);
        } catch (Throwable $error) {
            json_response(['error' => '用户名已存在'], 400);
        }
    }

    if ($method === 'POST' && $route === '/auth/login') {
        require_database();
        $stmt = pdo()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
        $stmt->execute([trim((string) ($body['username'] ?? ''))]);
        $user = $stmt->fetch();
        if (!$user || !password_verify((string) ($body['password'] ?? ''), $user['password_hash'])) json_response(['error' => '用户名或密码错误'], 401);

        set_signed_cookie('session_user', (string) $user['id'], 30 * 24 * 60 * 60);
        $displayName = trim((string) ($user['display_name'] ?? '')) ?: $user['username'];
        json_response(['user' => ['id' => (int) $user['id'], 'username' => $user['username'], 'displayName' => $displayName, 'isAdmin' => !empty($user['is_admin']), 'createdAt' => $user['created_at']], 'settings' => settings_for_user((int) $user['id'])]);
    }

    if ($method === 'POST' && $route === '/auth/profile') {
        $user = require_user();
        $displayName = normalize_display_name((string) ($body['displayName'] ?? ($body['display_name'] ?? '')), $user['username']);
        $stmt = pdo()->prepare('UPDATE users SET display_name = ? WHERE id = ?');
        $stmt->execute([$displayName, $user['id']]);
        json_response(['user' => ['id' => (int) $user['id'], 'username' => $user['username'], 'displayName' => $displayName, 'isAdmin' => !empty($user['isAdmin']), 'createdAt' => $user['createdAt'] ?? null]]);
    }

    if ($method === 'POST' && $route === '/auth/password') {
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
        json_response(['ok' => true]);
    }

    if ($method === 'POST' && $route === '/auth/logout') {
        clear_cookie_value('session_user');
        json_response(['ok' => true]);
    }

    if ($method === 'GET' && $route === '/settings') {
        $user = require_user();
        json_response(['settings' => settings_for_user((int) $user['id'])]);
    }

    if ($method === 'GET' && $route === '/settings/direct') {
        $user = require_user();
        $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
        $stmt->execute([$user['id']]);
        $settings = $stmt->fetch() ?: null;
        json_response([
            'settings' => settings_for_user((int) $user['id']),
            'apiKey' => decrypt_api_key($settings),
        ]);
    }

    if ($method === 'POST' && $route === '/settings') {
        $user = require_user();
        $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
        $apiKeyToSave = trim((string) ($body['apiKey'] ?? ''));
        $clearApiKey = !empty($body['clearApiKey']);
        if ($apiKeyToSave !== '' && empty($body['confirmApiKeySave'])) json_response(['error' => '保存 API Key 前需要确认'], 400);
        if ($apiKeyToSave !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);

        $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
        $stmt->execute([$user['id']]);
        $existing = $stmt->fetch() ?: [];
        $encrypted = $apiKeyToSave !== '' ? encrypt_api_key($apiKeyToSave) : [];
        $apiFields = $clearApiKey ? [null, null, null, null] : [
            $encrypted['api_key_ciphertext'] ?? ($existing['api_key_ciphertext'] ?? null),
            $encrypted['api_key_iv'] ?? ($existing['api_key_iv'] ?? null),
            $encrypted['api_key_tag'] ?? ($existing['api_key_tag'] ?? null),
            $encrypted['api_key_hint'] ?? ($existing['api_key_hint'] ?? null),
        ];

        $stmt = pdo()->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE model = VALUES(model), api_name = VALUES(api_name), api_base_url = VALUES(api_base_url), request_timeout = VALUES(request_timeout), stream = VALUES(stream), api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), api_key_hint = VALUES(api_key_hint)');
        $apiBaseUrl = preg_replace('/\s+/', '', (string) ($settings['apiBaseUrl'] ?? ($settings['api_base_url'] ?? '')));
        $requestTimeout = max(10, min(MAX_REQUEST_TIMEOUT, (int) ($settings['requestTimeout'] ?? ($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT))));
        if (!valid_api_base_url($apiBaseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);
        $stmt->execute([
            $user['id'],
            trim((string) ($settings['model'] ?? cfg('openai_image_model', 'gpt-image-2'))),
            trim((string) ($settings['apiName'] ?? ($settings['api_name'] ?? 'OpenAI Compatible'))),
            $apiBaseUrl,
            $requestTimeout,
            !empty($settings['stream']) ? 1 : 0,
            $apiFields[0], $apiFields[1], $apiFields[2], $apiFields[3],
        ]);
        json_response(['settings' => settings_for_user((int) $user['id'])]);
    }

    if ($method === 'GET' && $route === '/wall') {
        require_database();
        $rows = pdo()->query('SELECT * FROM wall_items ORDER BY created_at DESC LIMIT 80')->fetchAll();
        json_response(['items' => array_map('client_wall_item', $rows)]);
    }

    if ($method === 'POST' && $route === '/wall') {
        require_database();
        $image = is_array($body['image'] ?? null) ? $body['image'] : [];
        $imageUrl = trim((string) ($image['url'] ?? ''));
        $imageB64 = trim((string) ($image['b64_json'] ?? ''));
        if ($imageUrl === '' && $imageB64 === '') json_response(['error' => '缺少可上墙的图片'], 400);

        $user = current_user();
        $visitorId = $user ? null : visitor_id();
        $form = is_array($body['form'] ?? null) ? $body['form'] : [];
        $params = is_array($body['params'] ?? null) ? $body['params'] : $form;
        $prompt = trim((string) ($body['prompt'] ?? ($form['prompt'] ?? '未命名作品')));
        $stmt = pdo()->prepare('INSERT INTO wall_items (user_id, client_id, author_name, prompt, revised_prompt, image_url, image_b64, image_mime, params_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $user['id'] ?? null,
            $visitorId,
            $user['displayName'] ?? ($user['username'] ?? '未知艺术家'),
            $prompt,
            $body['revised_prompt'] ?? '',
            $imageUrl ?: null,
            $imageB64 ?: null,
            $image['mime'] ?? 'image/png',
            json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
        $stmt->execute([(int) pdo()->lastInsertId()]);
        json_response(['item' => client_wall_item($stmt->fetch())]);
    }

    if ($method === 'DELETE' && preg_match('#^/wall/(\d+)$#', $route, $matches)) {
        require_database();
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
        $stmt->execute([(int) $matches[1]]);
        $item = $stmt->fetch();
        if (!$item) json_response(['error' => '作品不存在'], 404);
        $user = current_user();
        $currentVisitor = unsign_value($_COOKIE['visitor_id'] ?? '');
        $isOwner = $item['user_id'] ? ((int) $item['user_id'] === (int) ($user['id'] ?? 0)) : (!empty($item['client_id']) && $item['client_id'] === $currentVisitor);
        $canDelete = $isOwner || !empty($user['isAdmin']);
        if (!$canDelete) json_response(['error' => '只能取消自己上墙的作品'], 403);
        $stmt = pdo()->prepare('DELETE FROM wall_items WHERE id = ?');
        $stmt->execute([(int) $matches[1]]);
        json_response(['ok' => true]);
    }

    json_response(['error' => '接口不存在', 'route' => $route], 404);
} catch (Throwable $error) {
    json_response(['error' => '服务端异常', 'detail' => $error->getMessage()], 500);
}