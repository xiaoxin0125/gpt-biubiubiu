<?php

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();

define('DEFAULT_REQUEST_TIMEOUT', 999);
define('MAX_REQUEST_TIMEOUT', 999);
define('REQUEST_TIMEOUT_BUFFER', 60);
define('WALL_DISPLAY_MAX_BYTES', 1048576);
define('IMAGE_REQUEST_LOG_LIMIT', 5);
define('DEFAULT_API_NAME', 'OpenAI gpt-image-2');
define('DEFAULT_API_BASE_URL', 'https://api.openai.com');
define('DEFAULT_IMAGE_MODEL', 'gpt-image-2');

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

function ensure_index(PDO $db, string $table, string $index, string $definition): void
{
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $index)) return;

    $stmt = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $stmt->execute([$table, $index]);
    if ((int) $stmt->fetchColumn() > 0) return;

    try {
        $db->exec("ALTER TABLE `{$table}` ADD {$definition}");
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) !== 1061) throw $error;
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

function normalize_api_base_url(string $value): string
{
    return rtrim(preg_replace('/\s+/', '', $value), '/');
}

function normalize_request_timeout($value): int
{
    return max(10, min(MAX_REQUEST_TIMEOUT, (int) ($value ?: DEFAULT_REQUEST_TIMEOUT)));
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
      active_api_config_id BIGINT UNSIGNED DEFAULT NULL,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS user_api_configs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
      api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
      model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_api_configs_user_sort (user_id, sort_order, id),
      CONSTRAINT fk_user_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS image_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      request_id VARCHAR(80) DEFAULT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'generation',
      status VARCHAR(32) NOT NULL DEFAULT 'completed',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      original_url TEXT DEFAULT NULL,
      display_url TEXT DEFAULT NULL,
      image_mime VARCHAR(80) DEFAULT 'image/png',
      original_bytes BIGINT UNSIGNED DEFAULT NULL,
      display_bytes BIGINT UNSIGNED DEFAULT NULL,
      wall_item_id BIGINT UNSIGNED DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      result_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_image_jobs_user_created (user_id, created_at),
      CONSTRAINT fk_image_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
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
      original_url TEXT DEFAULT NULL,
      display_url TEXT DEFAULT NULL,
      original_path TEXT DEFAULT NULL,
      display_path TEXT DEFAULT NULL,
      original_bytes BIGINT UNSIGNED DEFAULT NULL,
      display_bytes BIGINT UNSIGNED DEFAULT NULL,
      duration_seconds INT UNSIGNED DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      source_job_id BIGINT UNSIGNED DEFAULT NULL,
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
    ensure_column($db, 'user_settings', 'active_api_config_id', 'active_api_config_id BIGINT UNSIGNED DEFAULT NULL AFTER stream');
    ensure_column($db, 'user_settings', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER active_api_config_id');
    ensure_column($db, 'user_settings', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_settings', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_settings', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'user_api_configs', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER request_timeout');
    ensure_column($db, 'user_api_configs', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_api_configs', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_api_configs', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'wall_items', 'user_id', 'user_id BIGINT UNSIGNED DEFAULT NULL AFTER id');
    ensure_column($db, 'wall_items', 'client_id', 'client_id VARCHAR(80) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'wall_items', 'author_name', 'author_name VARCHAR(96) NOT NULL DEFAULT ' . $db->quote('未知艺术家') . ' AFTER client_id');
    ensure_column($db, 'wall_items', 'prompt', 'prompt TEXT DEFAULT NULL AFTER author_name');
    ensure_column($db, 'wall_items', 'revised_prompt', 'revised_prompt TEXT DEFAULT NULL AFTER prompt');
    ensure_column($db, 'wall_items', 'image_url', 'image_url TEXT DEFAULT NULL AFTER revised_prompt');
    ensure_column($db, 'wall_items', 'image_b64', 'image_b64 LONGTEXT DEFAULT NULL AFTER image_url');
    ensure_column($db, 'wall_items', 'image_mime', 'image_mime VARCHAR(80) DEFAULT ' . $db->quote('image/png') . ' AFTER image_b64');
    ensure_column($db, 'wall_items', 'original_url', 'original_url TEXT DEFAULT NULL AFTER image_mime');
    ensure_column($db, 'wall_items', 'display_url', 'display_url TEXT DEFAULT NULL AFTER original_url');
    ensure_column($db, 'wall_items', 'original_path', 'original_path TEXT DEFAULT NULL AFTER display_url');
    ensure_column($db, 'wall_items', 'display_path', 'display_path TEXT DEFAULT NULL AFTER original_path');
    ensure_column($db, 'wall_items', 'original_bytes', 'original_bytes BIGINT UNSIGNED DEFAULT NULL AFTER display_path');
    ensure_column($db, 'wall_items', 'display_bytes', 'display_bytes BIGINT UNSIGNED DEFAULT NULL AFTER original_bytes');
    ensure_column($db, 'wall_items', 'duration_seconds', 'duration_seconds INT UNSIGNED DEFAULT NULL AFTER display_bytes');
    ensure_column($db, 'wall_items', 'params_json', 'params_json JSON DEFAULT NULL AFTER duration_seconds');
    ensure_column($db, 'wall_items', 'source_job_id', 'source_job_id BIGINT UNSIGNED DEFAULT NULL AFTER params_json');
    ensure_column($db, 'wall_items', 'created_at', 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER source_job_id');
    ensure_column($db, 'image_jobs', 'user_id', 'user_id BIGINT UNSIGNED DEFAULT NULL AFTER id');
    ensure_column($db, 'image_jobs', 'request_id', 'request_id VARCHAR(80) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'image_jobs', 'mode', 'mode VARCHAR(32) NOT NULL DEFAULT ' . $db->quote('generation') . ' AFTER request_id');
    ensure_column($db, 'image_jobs', 'status', 'status VARCHAR(32) NOT NULL DEFAULT ' . $db->quote('completed') . ' AFTER mode');
    ensure_column($db, 'image_jobs', 'prompt', 'prompt TEXT DEFAULT NULL AFTER status');
    ensure_column($db, 'image_jobs', 'revised_prompt', 'revised_prompt TEXT DEFAULT NULL AFTER prompt');
    ensure_column($db, 'image_jobs', 'error_message', 'error_message TEXT DEFAULT NULL AFTER revised_prompt');
    ensure_column($db, 'image_jobs', 'image_url', 'image_url TEXT DEFAULT NULL AFTER error_message');
    ensure_column($db, 'image_jobs', 'original_url', 'original_url TEXT DEFAULT NULL AFTER image_url');
    ensure_column($db, 'image_jobs', 'display_url', 'display_url TEXT DEFAULT NULL AFTER original_url');
    ensure_column($db, 'image_jobs', 'image_mime', 'image_mime VARCHAR(80) DEFAULT ' . $db->quote('image/png') . ' AFTER display_url');
    ensure_column($db, 'image_jobs', 'original_bytes', 'original_bytes BIGINT UNSIGNED DEFAULT NULL AFTER image_mime');
    ensure_column($db, 'image_jobs', 'display_bytes', 'display_bytes BIGINT UNSIGNED DEFAULT NULL AFTER original_bytes');
    ensure_column($db, 'image_jobs', 'wall_item_id', 'wall_item_id BIGINT UNSIGNED DEFAULT NULL AFTER display_bytes');
    ensure_column($db, 'image_jobs', 'image_b64', 'image_b64 LONGTEXT DEFAULT NULL AFTER wall_item_id');
    ensure_column($db, 'image_jobs', 'params_json', 'params_json JSON DEFAULT NULL AFTER image_b64');
    ensure_column($db, 'image_jobs', 'result_json', 'result_json JSON DEFAULT NULL AFTER params_json');
    ensure_column($db, 'image_jobs', 'created_at', 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER result_json');
    ensure_column($db, 'image_jobs', 'completed_at', 'completed_at TIMESTAMP NULL DEFAULT NULL AFTER created_at');
    ensure_index($db, 'user_api_configs', 'idx_user_api_configs_user_sort', 'INDEX idx_user_api_configs_user_sort (user_id, sort_order, id)');
    ensure_index($db, 'image_jobs', 'idx_image_jobs_user_created', 'INDEX idx_image_jobs_user_created (user_id, created_at)');

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

function stored_user_settings_row(int $userId): ?array
{
    $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $settings = $stmt->fetch();
    return $settings ?: null;
}

function stored_user_settings(): ?array
{
    $userId = session_user_id();
    return $userId ? stored_user_settings_row($userId) : null;
}

function config_from_row(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'apiName' => $row['api_name'] ?: DEFAULT_API_NAME,
        'apiBaseUrl' => $row['api_base_url'] ?: DEFAULT_API_BASE_URL,
        'model' => $row['model'] ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => (int) ($row['request_timeout'] ?: DEFAULT_REQUEST_TIMEOUT),
        'hasApiKey' => !empty($row['api_key_ciphertext']),
        'apiKeyHint' => $row['api_key_hint'] ?: '',
        'sortOrder' => (int) ($row['sort_order'] ?? 0),
    ];
}

function legacy_settings_config(array $settings): array
{
    return [
        'apiName' => trim((string) ($settings['api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($settings['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($settings['model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => normalize_request_timeout($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'api_key_ciphertext' => $settings['api_key_ciphertext'] ?? null,
        'api_key_iv' => $settings['api_key_iv'] ?? null,
        'api_key_tag' => $settings['api_key_tag'] ?? null,
        'api_key_hint' => $settings['api_key_hint'] ?? null,
    ];
}

function ensure_user_api_config(int $userId): ?array
{
    $db = pdo();
    $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();
    if ($existing) return $existing;

    $settings = stored_user_settings_row($userId) ?: [];
    $legacy = legacy_settings_config($settings);
    $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_name, api_base_url, model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
    $stmt->execute([
        $userId,
        $legacy['apiName'],
        $legacy['apiBaseUrl'],
        $legacy['model'],
        $legacy['requestTimeout'],
        $legacy['api_key_ciphertext'],
        $legacy['api_key_iv'],
        $legacy['api_key_tag'],
        $legacy['api_key_hint'],
    ]);
    $configId = (int) $db->lastInsertId();
    $stmt = $db->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, active_api_config_id, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE active_api_config_id = COALESCE(active_api_config_id, VALUES(active_api_config_id))');
    $stmt->execute([
        $userId,
        $legacy['model'],
        $legacy['apiName'],
        $legacy['apiBaseUrl'],
        $legacy['requestTimeout'],
        $configId,
        $legacy['api_key_ciphertext'],
        $legacy['api_key_iv'],
        $legacy['api_key_tag'],
        $legacy['api_key_hint'],
    ]);

    $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? LIMIT 1');
    $stmt->execute([$configId]);
    return $stmt->fetch() ?: null;
}

function user_api_config_rows(int $userId): array
{
    ensure_user_api_config($userId);
    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC');
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function active_api_config_row(int $userId): ?array
{
    $settings = stored_user_settings_row($userId);
    ensure_user_api_config($userId);
    $activeId = (int) ($settings['active_api_config_id'] ?? 0);
    if ($activeId > 0) {
        $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $userId]);
        $row = $stmt->fetch();
        if ($row) return $row;
    }

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch() ?: null;
    if ($row) {
        $stmt = pdo()->prepare('UPDATE user_settings SET active_api_config_id = ? WHERE user_id = ?');
        $stmt->execute([(int) $row['id'], $userId]);
    }
    return $row;
}

function settings_for_user(int $userId): ?array
{
    $settings = stored_user_settings_row($userId);
    $configs = user_api_config_rows($userId);
    $active = active_api_config_row($userId);
    $activeClient = $active ? config_from_row($active) : null;

    return [
        'stream' => !empty($settings['stream']),
        'activeApiConfigId' => $activeClient['id'] ?? null,
        'apiConfigs' => array_map('config_from_row', $configs),
        'activeConfig' => $activeClient,
        'model' => $activeClient['model'] ?? DEFAULT_IMAGE_MODEL,
        'apiName' => $activeClient['apiName'] ?? DEFAULT_API_NAME,
        'apiBaseUrl' => $activeClient['apiBaseUrl'] ?? DEFAULT_API_BASE_URL,
        'requestTimeout' => $activeClient['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT,
        'hasApiKey' => $activeClient['hasApiKey'] ?? false,
        'apiKeyHint' => $activeClient['apiKeyHint'] ?? '',
    ];
}

function stored_user_api_key(): string
{
    $userId = session_user_id();
    if (!$userId) return '';
    return decrypt_api_key(active_api_config_row($userId));
}

function save_user_settings(array $user, array $body): array
{
    $db = pdo();
    $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
    $configs = array_values(array_filter(is_array($body['apiConfigs'] ?? null) ? $body['apiConfigs'] : [], 'is_array'));
    if (!$configs && isset($settings['apiName'], $settings['apiBaseUrl'])) $configs = [$settings];
    if (!$configs) json_response(['error' => '至少保留一套 API 配置'], 400);

    $activeRawId = (string) ($settings['activeApiConfigId'] ?? ($settings['active_api_config_id'] ?? ''));
    $activeId = (int) $activeRawId;
    $stream = !empty($settings['stream']);
    $seenIds = [];
    $savedRows = [];

    $db->beginTransaction();
    try {
        foreach ($configs as $index => $config) {
            $configId = (int) ($config['id'] ?? 0);
            $apiName = trim((string) ($config['apiName'] ?? ($config['api_name'] ?? 'OpenAI Compatible'))) ?: 'OpenAI Compatible';
            $apiBaseUrl = normalize_api_base_url((string) ($config['apiBaseUrl'] ?? ($config['api_base_url'] ?? '')));
            $model = trim((string) ($config['model'] ?? cfg('openai_image_model', 'gpt-image-2'))) ?: 'gpt-image-2';
            $requestTimeout = normalize_request_timeout($config['requestTimeout'] ?? ($config['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT));
            $apiKey = trim((string) ($config['apiKey'] ?? ''));
            $clearApiKey = !empty($config['clearApiKey']);
            if (!valid_api_base_url($apiBaseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);
            if ($apiKey !== '' && empty($config['confirmApiKeySave'])) json_response(['error' => '保存 API Key 前需要确认'], 400);
            if ($apiKey !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);

            $existing = [];
            if ($configId > 0) {
                $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
                $stmt->execute([$configId, $user['id']]);
                $existing = $stmt->fetch() ?: [];
                if (!$existing) $configId = 0;
            }

            $encrypted = $apiKey !== '' ? encrypt_api_key($apiKey) : [];
            $apiFields = $clearApiKey ? [null, null, null, null] : [
                $encrypted['api_key_ciphertext'] ?? ($existing['api_key_ciphertext'] ?? null),
                $encrypted['api_key_iv'] ?? ($existing['api_key_iv'] ?? null),
                $encrypted['api_key_tag'] ?? ($existing['api_key_tag'] ?? null),
                $encrypted['api_key_hint'] ?? ($existing['api_key_hint'] ?? null),
            ];

            if ($configId > 0) {
                $stmt = $db->prepare('UPDATE user_api_configs SET api_name = ?, api_base_url = ?, model = ?, request_timeout = ?, api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, api_key_hint = ?, sort_order = ? WHERE id = ? AND user_id = ?');
                $stmt->execute([$apiName, $apiBaseUrl, $model, $requestTimeout, $apiFields[0], $apiFields[1], $apiFields[2], $apiFields[3], $index, $configId, $user['id']]);
            } else {
                $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_name, api_base_url, model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$user['id'], $apiName, $apiBaseUrl, $model, $requestTimeout, $apiFields[0], $apiFields[1], $apiFields[2], $apiFields[3], $index]);
                $configId = (int) $db->lastInsertId();
            }

            $seenIds[] = $configId;
            if (!$activeId || (isset($config['id']) && (string) $config['id'] === $activeRawId)) $activeId = $configId;
        }

        $placeholders = implode(',', array_fill(0, count($seenIds), '?'));
        $params = array_merge([$user['id']], $seenIds);
        $db->prepare("DELETE FROM user_api_configs WHERE user_id = ? AND id NOT IN ({$placeholders})")->execute($params);
        if (!in_array($activeId, $seenIds, true)) $activeId = $seenIds[0];

        $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $user['id']]);
        $active = $stmt->fetch();
        if (!$active) throw new RuntimeException('当前 API 配置不存在');

        $stmt = $db->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, active_api_config_id, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model = VALUES(model), api_name = VALUES(api_name), api_base_url = VALUES(api_base_url), request_timeout = VALUES(request_timeout), stream = VALUES(stream), active_api_config_id = VALUES(active_api_config_id), api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), api_key_hint = VALUES(api_key_hint)');
        $stmt->execute([
            $user['id'],
            $active['model'],
            $active['api_name'],
            $active['api_base_url'],
            $active['request_timeout'],
            $stream ? 1 : 0,
            $activeId,
            $active['api_key_ciphertext'],
            $active['api_key_iv'],
            $active['api_key_tag'],
            $active['api_key_hint'],
        ]);

        $db->commit();
        return settings_for_user((int) $user['id']);
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function switch_active_api_config(array $user, array $body): array
{
    $configId = (int) ($body['activeApiConfigId'] ?? ($body['active_api_config_id'] ?? 0));
    if ($configId <= 0) json_response(['error' => '缺少 API 配置 ID'], 400);

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$configId, $user['id']]);
    $active = $stmt->fetch();
    if (!$active) json_response(['error' => 'API 配置不存在'], 404);

    $settings = stored_user_settings_row((int) $user['id']);
    $stream = !empty($settings['stream']) ? 1 : 0;
    $stmt = pdo()->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, active_api_config_id, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model = VALUES(model), api_name = VALUES(api_name), api_base_url = VALUES(api_base_url), request_timeout = VALUES(request_timeout), active_api_config_id = VALUES(active_api_config_id), api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), api_key_hint = VALUES(api_key_hint)');
    $stmt->execute([
        $user['id'],
        $active['model'],
        $active['api_name'],
        $active['api_base_url'],
        $active['request_timeout'],
        $stream,
        $configId,
        $active['api_key_ciphertext'],
        $active['api_key_iv'],
        $active['api_key_tag'],
        $active['api_key_hint'],
    ]);

    return settings_for_user((int) $user['id']);
}

function public_base_dir(): string
{
    return dirname(__DIR__);
}

function public_url_for_path(string $path): string
{
    $relative = str_replace('\\', '/', $path);
    $root = str_replace('\\', '/', public_base_dir());
    if (strpos($relative, $root) === 0) $relative = substr($relative, strlen($root));
    return '/' . ltrim($relative, '/');
}

function ensure_dir(string $path): void
{
    clearstatcache(true, $path);
    if (is_dir($path)) {
        if (!is_writable($path)) throw new RuntimeException('目录不可写：' . $path);
        return;
    }

    $nearestParent = dirname($path);
    while ($nearestParent !== '' && $nearestParent !== '.' && !is_dir($nearestParent)) {
        $next = dirname($nearestParent);
        if ($next === $nearestParent) break;
        $nearestParent = $next;
    }

    if (!@mkdir($path, 0775, true)) {
        clearstatcache(true, $path);
        if (!is_dir($path)) {
            $detail = '';
            if ($nearestParent !== '' && is_dir($nearestParent)) {
                $detail = '；最近存在父目录：' . $nearestParent . '；父目录可写：' . (is_writable($nearestParent) ? '是' : '否');
            }
            throw new RuntimeException('无法创建目录：' . $path . $detail);
        }
    }

    clearstatcache(true, $path);
    if (!is_writable($path)) throw new RuntimeException('目录不可写：' . $path);
}

function extension_for_mime(string $mime): string
{
    $mime = strtolower($mime);
    if ($mime === 'image/jpeg' || $mime === 'image/jpg') return 'jpg';
    if ($mime === 'image/webp') return 'webp';
    if ($mime === 'image/gif') return 'gif';
    return 'png';
}

function mime_from_binary(string $binary, string $fallback = 'image/png'): string
{
    $info = @getimagesizefromstring($binary);
    if (is_array($info) && !empty($info['mime'])) return (string) $info['mime'];
    return $fallback ?: 'image/png';
}

function decode_image_payload(array $image): array
{
    $imageUrl = trim((string) ($image['url'] ?? ''));
    $imageB64 = trim((string) ($image['b64_json'] ?? ''));
    $mime = trim((string) ($image['mime'] ?? 'image/png')) ?: 'image/png';

    if ($imageB64 !== '') {
        $imageB64 = preg_replace('#^data:(image/[a-z0-9.+-]+);base64,#i', '', $imageB64);
        $binary = base64_decode($imageB64, true);
        if ($binary === false || $binary === '') json_response(['error' => '图片 base64 无法解析'], 400);
        return ['binary' => $binary, 'mime' => mime_from_binary($binary, $mime), 'sourceUrl' => ''];
    }

    if ($imageUrl !== '') {
        if (!preg_match('#^https?://#i', $imageUrl) && strpos($imageUrl, '/') !== 0) json_response(['error' => '图片 URL 不合法'], 400);
        $sourcePath = preg_match('#^https?://#i', $imageUrl) ? $imageUrl : public_base_dir() . '/' . ltrim(parse_url($imageUrl, PHP_URL_PATH) ?: $imageUrl, '/');
        $binary = @file_get_contents($sourcePath);
        if ($binary === false || $binary === '') json_response(['error' => '无法读取上墙图片'], 400);
        return ['binary' => $binary, 'mime' => mime_from_binary($binary, $mime), 'sourceUrl' => $imageUrl];
    }

    json_response(['error' => '缺少可上墙的图片'], 400);
}

function create_image_resource(string $binary, string $mime)
{
    if (!function_exists('imagecreatefromstring')) return null;
    $image = @imagecreatefromstring($binary);
    if (!$image) return null;
    if (function_exists('imagepalettetotruecolor')) @imagepalettetotruecolor($image);
    if (in_array(strtolower($mime), ['image/png', 'image/webp'], true)) {
        imagealphablending($image, true);
        imagesavealpha($image, true);
    }
    return $image;
}

function encode_image_candidate($resource, string $path, string $mime, int $quality): bool
{
    $mime = strtolower($mime);
    if (($mime === 'image/webp') && function_exists('imagewebp')) return imagewebp($resource, $path, $quality);
    if (($mime === 'image/jpeg' || $mime === 'image/jpg') && function_exists('imagejpeg')) return imagejpeg($resource, $path, $quality);
    if ($mime === 'image/png' && function_exists('imagepng')) {
        $level = max(0, min(9, (int) round((100 - $quality) / 11)));
        return imagepng($resource, $path, $level);
    }
    return false;
}

function compress_display_image(string $binary, string $originalMime, string $targetPath): array
{
    if (strlen($binary) <= WALL_DISPLAY_MAX_BYTES) {
        file_put_contents($targetPath, $binary);
        return ['path' => $targetPath, 'mime' => $originalMime, 'bytes' => filesize($targetPath) ?: strlen($binary)];
    }

    $image = create_image_resource($binary, $originalMime);
    if (!$image) throw new RuntimeException('无法压缩展示图，请检查服务器 GD 图片扩展。');

    $targetMime = function_exists('imagewebp') ? 'image/webp' : 'image/jpeg';
    $targetPath = preg_replace('/\.[a-z0-9]+$/i', '.' . extension_for_mime($targetMime), $targetPath) ?: $targetPath;
    $width = imagesx($image);
    $height = imagesy($image);
    $qualities = [88, 80, 72, 64, 56, 48, 40, 32, 24, 18, 12];
    $scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.36, 0.3, 0.24, 0.18, 0.12];
    $bestPath = '';
    $bestBytes = PHP_INT_MAX;

    foreach ($scales as $scale) {
        $work = $image;
        if ($scale < 1) {
            $nextWidth = max(1, (int) floor($width * $scale));
            $nextHeight = max(1, (int) floor($height * $scale));
            $work = imagescale($image, $nextWidth, $nextHeight);
            if (!$work) continue;
        }

        foreach ($qualities as $quality) {
            $candidatePath = preg_replace('/\.[a-z0-9]+$/i', '-' . (int) round($scale * 100) . '-' . $quality . '.' . extension_for_mime($targetMime), $targetPath) ?: $targetPath;
            if (!encode_image_candidate($work, $candidatePath, $targetMime, $quality)) continue;
            $bytes = filesize($candidatePath) ?: PHP_INT_MAX;
            if ($bytes < $bestBytes) {
                if ($bestPath && $bestPath !== $candidatePath && is_file($bestPath)) @unlink($bestPath);
                $bestPath = $candidatePath;
                $bestBytes = $bytes;
            } elseif (is_file($candidatePath)) {
                @unlink($candidatePath);
            }
            if ($bytes <= WALL_DISPLAY_MAX_BYTES) break 2;
        }

        if ($work !== $image) imagedestroy($work);
    }

    imagedestroy($image);
    if ($bestPath === '') throw new RuntimeException('展示图压缩失败。');
    if ($bestBytes > WALL_DISPLAY_MAX_BYTES) {
        if (is_file($bestPath)) @unlink($bestPath);
        throw new RuntimeException('展示图无法压缩到 1M 以下。');
    }

    return ['path' => $bestPath, 'mime' => $targetMime, 'bytes' => $bestBytes];
}

function save_wall_image(array $image): array
{
    $payload = decode_image_payload($image);
    $mime = $payload['mime'];
    $id = bin2hex(random_bytes(12));
    $originalDir = public_base_dir() . '/wall-images/original';
    $displayDir = public_base_dir() . '/wall-images/display';
    ensure_dir($originalDir);
    ensure_dir($displayDir);

    $originalPath = $originalDir . '/' . $id . '.' . extension_for_mime($mime);
    file_put_contents($originalPath, $payload['binary']);
    $displayBasePath = $displayDir . '/' . $id . '.' . extension_for_mime($mime);
    $display = compress_display_image($payload['binary'], $mime, $displayBasePath);

    return [
        'imageMime' => $mime,
        'originalPath' => $originalPath,
        'displayPath' => $display['path'],
        'originalUrl' => public_url_for_path($originalPath),
        'displayUrl' => public_url_for_path($display['path']),
        'originalBytes' => filesize($originalPath) ?: strlen($payload['binary']),
        'displayBytes' => $display['bytes'],
    ];
}

function stored_generated_image(array $image, string $fallbackMime = 'image/png'): array
{
    $payload = [];
    $url = trim((string) ($image['url'] ?? ($image['image_url'] ?? '')));
    $b64 = trim((string) ($image['b64_json'] ?? ($image['image_b64'] ?? '')));
    $mime = trim((string) ($image['imageMime'] ?? ($image['mime'] ?? $fallbackMime))) ?: $fallbackMime;

    if ($url !== '') {
        $payload = ['url' => $url, 'mime' => $mime];
    } elseif ($b64 !== '') {
        $payload = ['b64_json' => $b64, 'mime' => $mime];
    } else {
        return [];
    }

    return save_wall_image($payload);
}

function proxy_upload_dir(): string
{
    $dir = sys_get_temp_dir() . '/gpt-biubiubiu-proxy';
    ensure_dir($dir);
    return $dir;
}

function direct_api_url(array $config, string $path): string
{
    $baseUrl = normalize_api_base_url((string) ($config['api_base_url'] ?? ''));
    $basePath = rtrim((string) (parse_url($baseUrl, PHP_URL_PATH) ?: ''), '/');
    $normalizedPath = '/' . ltrim($path, '/');
    $finalPath = $basePath !== '' && strpos($normalizedPath, $basePath . '/') === 0 ? substr($normalizedPath, strlen($basePath)) : $normalizedPath;
    return $baseUrl . $finalPath;
}

function parse_upstream_response(string $text): array
{
    $trimmed = trim($text);
    if ($trimmed === '') return [];
    if (preg_match('#^data:(image/[a-z0-9.+-]+);base64,#i', $trimmed)) return ['data' => $trimmed];

    $lines = preg_split('/\r?\n/', $trimmed) ?: [];
    $payloads = [];
    foreach ($lines as $line) {
        $line = trim($line);
        if (strpos($line, 'data:') !== 0) continue;
        $payload = trim(substr($line, 5));
        if ($payload === '' || $payload === '[DONE]') continue;
        $payloads[] = $payload;
    }

    if ($payloads) {
        $events = [];
        $imagePayload = '';
        foreach ($payloads as $payload) {
            if (preg_match('#^data:(image/[a-z0-9.+-]+);base64,#i', $payload)) {
                $imagePayload = $payload;
                continue;
            }
            $decoded = json_decode($payload, true);
            if (is_array($decoded)) $events[] = $decoded;
        }
        if ($imagePayload !== '') return ['data' => $imagePayload];

        $imageEvent = [];
        $revisedPrompt = '';
        foreach ($events as $event) {
            $candidatePrompt = extract_revised_prompt($event);
            if ($candidatePrompt !== '') $revisedPrompt = $candidatePrompt;
            if (!$imageEvent && has_image_payload($event)) $imageEvent = $event;
        }
        if (!$imageEvent) $imageEvent = end($events) ?: [];
        if ($revisedPrompt !== '' && is_array($imageEvent)) $imageEvent['revised_prompt'] = $revisedPrompt;
        return is_array($imageEvent) ? $imageEvent : [];
    }

    $decoded = json_decode($trimmed, true);
    if (is_array($decoded)) return $decoded;
    throw new RuntimeException(substr($trimmed, 0, 180) ?: '上游接口返回异常内容');
}

function has_image_payload(array $value): bool
{
    if (!empty($value['url']) || !empty($value['b64_json']) || !empty($value['image']) || !empty($value['data_url'])) return true;
    if (isset($value['data']) && is_string($value['data'])) return true;
    if (isset($value['data']) && is_array($value['data'])) {
        foreach ($value['data'] as $item) {
            if (is_array($item) && has_image_payload($item)) return true;
        }
    }
    if (isset($value['images']) && is_array($value['images'])) return count($value['images']) > 0;
    return false;
}

function extract_revised_prompt($value): string
{
    if (!is_array($value)) return '';
    foreach (['revised_prompt', 'revisedPrompt', 'prompt_revised'] as $key) {
        $prompt = trim((string) ($value[$key] ?? ''));
        if ($prompt !== '') return $prompt;
    }
    foreach (['data', 'images'] as $key) {
        if (!isset($value[$key]) || !is_array($value[$key])) continue;
        foreach ($value[$key] as $item) {
            $prompt = extract_revised_prompt($item);
            if ($prompt !== '') return $prompt;
        }
    }
    return '';
}

function normalize_proxy_image_item($image, int $index, string $outputFormat, string $topRevisedPrompt = ''): array
{
    $raw = '';
    $item = is_array($image) ? $image : [];
    if (is_string($image)) $raw = $image;
    else $raw = (string) ($item['b64_json'] ?? ($item['url'] ?? ($item['data_url'] ?? ($item['data'] ?? ($item['image'] ?? ($item['content'] ?? ''))))));

    $mime = image_mime_for_output_format($outputFormat);
    if (preg_match('#^data:(image/[a-z0-9.+-]+);base64,#i', $raw, $matches)) $mime = $matches[1];
    if (!empty($item['mime'])) $mime = (string) $item['mime'];
    if (!empty($item['imageMime'])) $mime = (string) $item['imageMime'];

    $next = is_array($image) ? $item : [];
    $next['id'] = $next['id'] ?? ('image-' . $index);
    $next['imageMime'] = $mime;
    $revisedPrompt = extract_revised_prompt($item) ?: $topRevisedPrompt;
    if ($revisedPrompt !== '') $next['revised_prompt'] = $revisedPrompt;

    if ($raw !== '') {
        if (preg_match('#^data:image/[a-z0-9.+-]+;base64,#i', $raw)) {
            $next['b64_json'] = preg_replace('#^data:image/[a-z0-9.+-]+;base64,#i', '', $raw);
            unset($next['url']);
        } elseif (preg_match('#^https?://#i', $raw)) {
            $next['url'] = $raw;
        } elseif (empty($next['b64_json'])) {
            $next['b64_json'] = $raw;
        }
    }

    return $next;
}

function image_mime_for_output_format(string $format): string
{
    if ($format === 'jpeg') return 'image/jpeg';
    if ($format === 'webp') return 'image/webp';
    return 'image/png';
}

function normalize_proxy_image_response(array $data, string $outputFormat): array
{
    if (isset($data['data']) && is_array($data['data'])) $rawItems = $data['data'];
    elseif (isset($data['images']) && is_array($data['images'])) $rawItems = $data['images'];
    elseif (!empty($data['b64_json']) || !empty($data['url']) || !empty($data['image']) || !empty($data['data_url']) || (isset($data['data']) && is_string($data['data']))) $rawItems = [$data];
    else $rawItems = [];

    $revisedPrompt = extract_revised_prompt($data);
    return [
        'created' => $data['created'] ?? time(),
        'usage' => $data['usage'] ?? null,
        'data' => array_map(fn($item, $index) => normalize_proxy_image_item($item, $index, $outputFormat, $revisedPrompt), $rawItems, array_keys($rawItems)),
        'raw' => $data,
    ];
}

function call_upstream_json(array $config, string $apiKey, string $path, array $payload): array
{
    $timeout = normalize_request_timeout($config['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT);
    $ch = curl_init(direct_api_url($config, $path));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout + REQUEST_TIMEOUT_BUFFER,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $text = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($text === false) throw new RuntimeException($error ?: '上游接口请求失败');
    $data = parse_upstream_response((string) $text);
    if ($status < 200 || $status >= 300) throw new RuntimeException(upstream_error_message($data));
    return $data;
}

function multipart_escape(string $value): string
{
    return str_replace(["\\", "\"", "\r", "\n"], ["\\\\", "\\\"", '', ''], $value);
}

function append_multipart_field(string &$body, string $boundary, string $name, $value): void
{
    if (is_array($value)) {
        foreach ($value as $key => $item) append_multipart_field($body, $boundary, $name . '[' . $key . ']', $item);
        return;
    }

    $body .= '--' . $boundary . "\r\n";
    $body .= 'Content-Disposition: form-data; name="' . multipart_escape($name) . "\"\r\n\r\n";
    $body .= (string) $value . "\r\n";
}

function build_multipart_body(array $fields, array $files, string &$contentType, array &$fileMeta): string
{
    $boundary = '----gpt-biubiubiu-' . bin2hex(random_bytes(12));
    $body = '';
    $fileMeta = [];

    foreach ($fields as $name => $value) append_multipart_field($body, $boundary, (string) $name, $value);

    foreach ($files as $file) {
        $tmp = $file['tmp_name'] ?? '';
        if ($tmp === '' || !is_uploaded_file($tmp)) continue;
        $name = (string) ($file['name'] ?? 'image.png');
        $type = (string) ($file['type'] ?? 'application/octet-stream');
        $field = (string) ($file['field'] ?? 'image[]');
        $content = file_get_contents($tmp);
        if ($content === false) continue;

        $body .= '--' . $boundary . "\r\n";
        $body .= 'Content-Disposition: form-data; name="' . multipart_escape($field) . '"; filename="' . multipart_escape($name) . "\"\r\n";
        $body .= 'Content-Type: ' . ($type ?: 'application/octet-stream') . "\r\n\r\n";
        $body .= $content . "\r\n";
        $fileMeta[] = ['name' => $name, 'type' => $type, 'size' => (int) ($file['size'] ?? strlen($content)), 'field' => $field];
    }

    $body .= '--' . $boundary . "--\r\n";
    $contentType = 'multipart/form-data; boundary=' . $boundary;
    return $body;
}

function call_upstream_multipart(array $config, string $apiKey, string $path, array $fields, array $files): array
{
    $timeout = normalize_request_timeout($config['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT);
    $contentType = '';
    $fileMeta = [];
    $body = build_multipart_body($fields, $files, $contentType, $fileMeta);

    $ch = curl_init(direct_api_url($config, $path));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout + REQUEST_TIMEOUT_BUFFER,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey, 'Content-Type: ' . $contentType],
        CURLOPT_POSTFIELDS => $body,
    ]);
    $text = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($text === false) throw new RuntimeException($error ?: '上游接口请求失败');
    $data = parse_upstream_response((string) $text);
    if ($status < 200 || $status >= 300) throw new RuntimeException(upstream_error_message($data));
    return $data;
}

function upstream_error_message(array $data): string
{
    $error = $data['error'] ?? null;
    if (is_array($error)) return (string) ($error['message'] ?? '生图接口请求失败');
    if (is_string($error) && $error !== '') return $error;
    if (!empty($data['message'])) return (string) $data['message'];
    return '生图接口请求失败';
}

function proxy_result_images(array $normalized, string $outputFormat): array
{
    $images = [];
    foreach ($normalized['data'] ?? [] as $index => $image) {
        $stored = stored_generated_image($image, image_mime_for_output_format($outputFormat));
        if (!$stored) continue;
        $next = [
            'id' => $image['id'] ?? ('image-' . $index),
            'url' => $stored['displayUrl'],
            'image_url' => $stored['displayUrl'],
            'downloadUrl' => $stored['originalUrl'],
            'originalUrl' => $stored['originalUrl'],
            'imageMime' => $stored['imageMime'],
            'originalBytes' => $stored['originalBytes'],
            'displayBytes' => $stored['displayBytes'],
        ];
        $revisedPrompt = extract_revised_prompt($image);
        if ($revisedPrompt !== '') $next['revised_prompt'] = $revisedPrompt;
        $images[] = $next;
    }
    return $images;
}

function save_image_job(array $user, string $requestId, string $mode, string $prompt, array $params, array $result, ?string $error = null): int
{
    $firstImage = $result['data'][0] ?? [];
    $revisedPrompt = extract_revised_prompt($firstImage) ?: extract_revised_prompt($result);
    $displayUrl = (string) ($firstImage['url'] ?? ($firstImage['image_url'] ?? ''));
    $originalUrl = (string) ($firstImage['downloadUrl'] ?? ($firstImage['originalUrl'] ?? ($firstImage['original_url'] ?? $displayUrl)));
    $stmt = pdo()->prepare('INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, revised_prompt, error_message, image_url, original_url, display_url, image_mime, original_bytes, display_bytes, image_b64, params_json, result_json, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
    $stmt->execute([
        $user['id'],
        $requestId,
        $mode,
        $error ? 'failed' : 'completed',
        $prompt,
        $revisedPrompt,
        $error,
        $displayUrl,
        $originalUrl,
        $displayUrl,
        $firstImage['imageMime'] ?? ($firstImage['image_mime'] ?? 'image/png'),
        isset($firstImage['originalBytes']) ? (int) $firstImage['originalBytes'] : null,
        isset($firstImage['displayBytes']) ? (int) $firstImage['displayBytes'] : null,
        '',
        json_encode(sanitize_log_payload($params), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        json_encode(sanitize_log_payload($result), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    return (int) pdo()->lastInsertId();
}

function client_generated_image(array $item): array
{
    $params = [];
    if (!empty($item['params_json'])) {
        $decoded = is_string($item['params_json']) ? json_decode($item['params_json'], true) : $item['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    $result = [];
    if (!empty($item['result_json'])) {
        $decoded = is_string($item['result_json']) ? json_decode($item['result_json'], true) : $item['result_json'];
        $result = is_array($decoded) ? $decoded : [];
    }

    $id = (int) ($item['id'] ?? 0);
    $firstImage = $result['data'][0] ?? [];
    $directImageUrl = (string) (($item['display_url'] ?? '') ?: (($item['image_url'] ?? '') ?: ''));
    $displayUrl = (string) ($directImageUrl ?: ($firstImage['url'] ?? ($firstImage['image_url'] ?? '')));
    $originalUrl = (string) (($item['original_url'] ?? '') ?: ($firstImage['downloadUrl'] ?? ($firstImage['originalUrl'] ?? ($firstImage['original_url'] ?? $displayUrl))));
    $imageParams = is_array($params['form'] ?? null) ? $params['form'] : (is_array($params['payload'] ?? null) ? $params['payload'] : (is_array($params['fields'] ?? null) ? $params['fields'] : $params));
    $completedAt = (string) (($item['completed_at'] ?? '') ?: '');
    $createdAt = $completedAt ?: (string) (($item['created_at'] ?? '') ?: date(DATE_ATOM));

    return [
        'id' => 'job-' . $id,
        'jobId' => $id,
        'sourceJobId' => $id,
        'wallItemId' => !empty($item['wall_item_id']) ? (int) $item['wall_item_id'] : null,
        'requestId' => (string) (($item['request_id'] ?? '') ?: ('job-' . $id)),
        'status' => (string) (($item['status'] ?? '') ?: 'completed'),
        'url' => $displayUrl,
        'image_url' => $displayUrl,
        'downloadUrl' => $originalUrl,
        'originalUrl' => $originalUrl,
        'b64_json' => '',
        'imageMime' => (string) (($item['image_mime'] ?? '') ?: ($firstImage['imageMime'] ?? 'image/png')),
        'originalBytes' => isset($item['original_bytes']) ? (int) $item['original_bytes'] : ($firstImage['originalBytes'] ?? null),
        'displayBytes' => isset($item['display_bytes']) ? (int) $item['display_bytes'] : ($firstImage['displayBytes'] ?? null),
        'prompt' => (string) (($item['prompt'] ?? '') ?: ($imageParams['prompt'] ?? '')),
        'revised_prompt' => (string) (($item['revised_prompt'] ?? '') ?: ($firstImage['revised_prompt'] ?? '')),
        'form' => $imageParams,
        'apiName' => (string) ($imageParams['apiName'] ?? ($imageParams['api_name'] ?? '')),
        'authorName' => '',
        'createdAt' => $createdAt,
        'finishedAt' => $completedAt ?: null,
        'isOnWall' => !empty($item['wall_item_id']),
        'source' => ($item['mode'] ?? '') === 'edit' ? 'edit' : 'generation',
    ];
}

function handle_generated_images(array $user): array
{
    $stmt = pdo()->prepare("SELECT id, user_id, request_id, mode, status, prompt, revised_prompt, image_url, original_url, display_url, image_mime, original_bytes, display_bytes, wall_item_id, params_json, created_at, completed_at FROM image_jobs WHERE user_id = ? AND status = ? AND CONCAT(COALESCE(display_url, ''), COALESCE(image_url, ''), COALESCE(original_url, '')) <> '' ORDER BY completed_at DESC, created_at DESC LIMIT 80");
    $stmt->execute([(int) $user['id'], 'completed']);
    return ['items' => array_map('client_generated_image', $stmt->fetchAll())];
}

function local_public_file_from_url(string $url): string
{
    $path = parse_url($url, PHP_URL_PATH) ?: $url;
    if ($path === '') return '';
    $candidate = realpath(public_base_dir() . '/' . ltrim($path, '/'));
    $root = realpath(public_base_dir());
    if (!$candidate || !$root || strpos(str_replace('\\', '/', $candidate), rtrim(str_replace('\\', '/', $root), '/') . '/') !== 0) return '';
    return is_file($candidate) ? $candidate : '';
}

function delete_generated_image_files(array $row): void
{
    $seen = [];
    foreach (['display_url', 'original_url', 'image_url'] as $key) {
        $url = trim((string) ($row[$key] ?? ''));
        if ($url === '' || preg_match('#^https?://#i', $url)) continue;
        $path = local_public_file_from_url($url);
        if ($path === '' || isset($seen[$path])) continue;
        $seen[$path] = true;
        @unlink($path);
    }
}

function handle_delete_generated_image(array $user, int $id): array
{
    if (!empty($user['isAdmin'])) {
        $stmt = pdo()->prepare('SELECT id, user_id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
    } else {
        $stmt = pdo()->prepare('SELECT id, user_id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$id, (int) $user['id']]);
    }
    $row = $stmt->fetch();
    if (!$row) return ['ok' => true, 'deleted' => false];

    if (!empty($row['wall_item_id'])) {
        $stmt = pdo()->prepare('DELETE FROM wall_items WHERE id = ?');
        $stmt->execute([(int) $row['wall_item_id']]);
    }
    $stmt = pdo()->prepare('DELETE FROM wall_items WHERE source_job_id = ?');
    $stmt->execute([$id]);

    delete_generated_image_files($row);
    $stmt = pdo()->prepare(!empty($user['isAdmin']) ? 'DELETE FROM image_jobs WHERE id = ?' : 'DELETE FROM image_jobs WHERE id = ? AND user_id = ?');
    $stmt->execute(!empty($user['isAdmin']) ? [$id] : [$id, (int) $user['id']]);
    return ['ok' => true, 'deleted' => $stmt->rowCount() > 0];
}

function handle_clear_generated_images(array $user): array
{
    $stmt = pdo()->prepare('SELECT id, image_url, original_url, display_url, wall_item_id FROM image_jobs WHERE user_id = ? AND status = ?');
    $stmt->execute([(int) $user['id'], 'completed']);
    $rows = $stmt->fetchAll();
    foreach ($rows as $row) {
        if (!empty($row['wall_item_id'])) {
            $deleteWall = pdo()->prepare('DELETE FROM wall_items WHERE id = ?');
            $deleteWall->execute([(int) $row['wall_item_id']]);
        }
        $deleteWall = pdo()->prepare('DELETE FROM wall_items WHERE source_job_id = ?');
        $deleteWall->execute([(int) $row['id']]);
        delete_generated_image_files($row);
    }

    $stmt = pdo()->prepare('DELETE FROM image_jobs WHERE user_id = ? AND status = ?');
    $stmt->execute([(int) $user['id'], 'completed']);
    return ['ok' => true, 'deleted' => $stmt->rowCount()];
}

function handle_save_generated_image(array $user, array $body): array
{
    $image = is_array($body['image'] ?? null) ? $body['image'] : [];
    $form = is_array($body['form'] ?? null) ? $body['form'] : [];
    $params = is_array($body['params'] ?? null) ? $body['params'] : $form;
    $stored = save_wall_image($image);
    $requestId = preg_replace('/[^a-zA-Z0-9_.-]/', '-', (string) ($body['requestId'] ?? ($body['request_id'] ?? ('request-' . time()))));
    $mode = normalize_job_mode((string) ($body['mode'] ?? ($params['source'] ?? 'generation')));
    $prompt = trim((string) ($body['prompt'] ?? ($form['prompt'] ?? ($params['prompt'] ?? ''))));
    $revisedPrompt = normalize_revised_prompt($body);
    $resultImage = [
        'url' => $stored['displayUrl'],
        'image_url' => $stored['displayUrl'],
        'downloadUrl' => $stored['originalUrl'],
        'originalUrl' => $stored['originalUrl'],
        'imageMime' => $stored['imageMime'],
        'originalBytes' => $stored['originalBytes'],
        'displayBytes' => $stored['displayBytes'],
    ];
    if ($revisedPrompt !== '') $resultImage['revised_prompt'] = $revisedPrompt;

    $result = ['data' => [$resultImage]];
    $jobId = save_image_job($user, $requestId, $mode, $prompt ?: '未命名作品', ['form' => $form, 'params' => $params], $result);
    $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$jobId, (int) $user['id']]);
    return ['item' => client_generated_image($stmt->fetch())];
}

function image_job_params(array $job): array
{
    if (empty($job['params_json'])) return [];
    $decoded = is_string($job['params_json']) ? json_decode($job['params_json'], true) : $job['params_json'];
    if (!is_array($decoded)) return [];
    if (is_array($decoded['form'] ?? null)) return $decoded['form'];
    if (is_array($decoded['params'] ?? null)) return $decoded['params'];
    if (is_array($decoded['payload'] ?? null)) return $decoded['payload'];
    if (is_array($decoded['fields'] ?? null)) return $decoded['fields'];
    return $decoded;
}

function wall_image_from_job(array $job): array
{
    $displayUrl = trim((string) (($job['display_url'] ?? '') ?: ($job['image_url'] ?? '')));
    $originalUrl = trim((string) (($job['original_url'] ?? '') ?: $displayUrl));
    if ($displayUrl === '' || $originalUrl === '') json_response(['error' => '作品没有可上墙的服务器图片'], 400);

    $displayPath = local_public_file_from_url($displayUrl);
    $originalPath = local_public_file_from_url($originalUrl);
    $displayBytes = isset($job['display_bytes']) ? (int) $job['display_bytes'] : null;
    $originalBytes = isset($job['original_bytes']) ? (int) $job['original_bytes'] : null;
    if (!$displayBytes && $displayPath !== '' && is_file($displayPath)) $displayBytes = filesize($displayPath) ?: null;
    if (!$originalBytes && $originalPath !== '' && is_file($originalPath)) $originalBytes = filesize($originalPath) ?: null;

    return [
        'imageMime' => (string) (($job['image_mime'] ?? '') ?: 'image/png'),
        'originalPath' => $originalPath,
        'displayPath' => $displayPath,
        'originalUrl' => $originalUrl,
        'displayUrl' => $displayUrl,
        'originalBytes' => $originalBytes,
        'displayBytes' => $displayBytes,
    ];
}

function image_job_for_wall(array $user, int $sourceJobId): array
{
    if ($sourceJobId <= 0) json_response(['error' => '请先生成并保存作品后再上墙'], 400);

    if (!empty($user['isAdmin'])) {
        $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND status = ? LIMIT 1');
        $stmt->execute([$sourceJobId, 'completed']);
    } else {
        $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ? AND status = ? LIMIT 1');
        $stmt->execute([$sourceJobId, (int) $user['id'], 'completed']);
    }

    $job = $stmt->fetch();
    if (!$job) json_response(['error' => '只能上墙自己的已保存作品'], 403);
    return $job;
}

function image_job_author_name(array $job, array $fallbackUser): string
{
    $userId = (int) ($job['user_id'] ?? 0);
    if ($userId > 0) {
        $stmt = pdo()->prepare('SELECT username, display_name FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if ($row) return trim((string) ($row['display_name'] ?? '')) ?: (string) $row['username'];
    }

    return (string) ($fallbackUser['displayName'] ?? ($fallbackUser['username'] ?? '未知艺术家'));
}

function handle_create_wall_item(array $user, array $body): array
{
    $sourceJobId = max(0, (int) ($body['sourceJobId'] ?? ($body['jobId'] ?? (($body['params']['sourceJobId'] ?? 0) ?: 0))));
    $job = image_job_for_wall($user, $sourceJobId);

    if (!empty($job['wall_item_id'])) {
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
        $stmt->execute([(int) $job['wall_item_id']]);
        $existing = $stmt->fetch();
        if ($existing) return ['item' => client_wall_item($existing)];
    }

    $storedImage = wall_image_from_job($job);
    $form = is_array($body['form'] ?? null) ? $body['form'] : [];
    $bodyParams = is_array($body['params'] ?? null) ? $body['params'] : $form;
    $params = $bodyParams ?: image_job_params($job);
    $duration = isset($body['durationSeconds']) ? max(0, (int) $body['durationSeconds']) : (isset($params['durationSeconds']) ? max(0, (int) $params['durationSeconds']) : null);
    if ($duration !== null) $params['durationSeconds'] = $duration;
    $params['sourceJobId'] = $sourceJobId;
    $params['source'] = normalize_job_mode((string) ($job['mode'] ?? ($params['source'] ?? 'generation')));

    $prompt = trim((string) ($body['prompt'] ?? ($form['prompt'] ?? ($job['prompt'] ?? '未命名作品'))));
    $revisedPrompt = extract_revised_prompt($body) ?: trim((string) ($job['revised_prompt'] ?? ''));
    $ownerId = (int) ($job['user_id'] ?? $user['id']);
    $authorName = image_job_author_name($job, $user);

    $stmt = pdo()->prepare('INSERT INTO wall_items (user_id, client_id, author_name, prompt, revised_prompt, image_url, image_b64, image_mime, original_url, display_url, original_path, display_path, original_bytes, display_bytes, duration_seconds, params_json, source_job_id) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $ownerId ?: null,
        $authorName,
        $prompt ?: '未命名作品',
        $revisedPrompt !== '' ? $revisedPrompt : null,
        $storedImage['displayUrl'],
        $storedImage['imageMime'],
        $storedImage['originalUrl'],
        $storedImage['displayUrl'],
        $storedImage['originalPath'] ?: null,
        $storedImage['displayPath'] ?: null,
        $storedImage['originalBytes'],
        $storedImage['displayBytes'],
        $duration,
        json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $sourceJobId,
    ]);

    $wallItemId = (int) pdo()->lastInsertId();
    $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = ? WHERE id = ?');
    $stmt->execute([$wallItemId, $sourceJobId]);

    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
    $stmt->execute([$wallItemId]);
    return ['item' => client_wall_item($stmt->fetch())];
}

function handle_delete_wall_item(array $user, int $id): array
{
    $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    if (!$item) json_response(['error' => '作品不存在'], 404);

    $isOwner = !empty($item['user_id']) && (int) $item['user_id'] === (int) $user['id'];
    if (!$isOwner && empty($user['isAdmin'])) json_response(['error' => '只能取消自己上墙的作品'], 403);

    if (!empty($item['source_job_id'])) {
        $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = NULL WHERE id = ?');
        $stmt->execute([(int) $item['source_job_id']]);
    }
    $stmt = pdo()->prepare('UPDATE image_jobs SET wall_item_id = NULL WHERE wall_item_id = ?');
    $stmt->execute([$id]);

    $stmt = pdo()->prepare('DELETE FROM wall_items WHERE id = ?');
    $stmt->execute([$id]);
    return ['ok' => true];
}

function normalize_job_mode(string $mode): string
{
    return $mode === 'edit' ? 'edit' : 'generation';
}

function normalize_revised_prompt(array $body): string
{
    return extract_revised_prompt($body);
}

function handle_proxy_generation(array $user, array $body): array
{
    $config = active_api_config_row((int) $user['id']);
    $apiKey = decrypt_api_key($config);
    if (!$config || $apiKey === '') json_response(['error' => '请先在参数设置里保存 API Key。'], 400);
    $requestId = preg_replace('/[^a-zA-Z0-9_.-]/', '-', (string) ($body['requestId'] ?? ('request-' . time())));
    $payload = is_array($body['payload'] ?? null) ? $body['payload'] : $body;
    $payload['model'] = $config['model'] ?: ($payload['model'] ?? 'gpt-image-2');
    $outputFormat = (string) ($payload['output_format'] ?? 'png');
    $prompt = trim((string) ($payload['prompt'] ?? ''));
    if ($prompt === '') json_response(['error' => '缺少提示词'], 400);

    try {
        $raw = call_upstream_json($config, $apiKey, '/v1/images/generations', $payload);
        $normalized = normalize_proxy_image_response($raw, $outputFormat);
        $images = proxy_result_images($normalized, $outputFormat);
        if (!$images) throw new RuntimeException('上游接口未返回可展示图片。');
        $result = ['created' => $normalized['created'], 'usage' => $normalized['usage'], 'data' => $images, 'raw' => $normalized['raw']];
        $jobId = save_image_job($user, $requestId, 'generation', $prompt, ['payload' => $payload], $result);
        $images = array_map(fn($image) => array_merge($image, ['jobId' => $jobId, 'sourceJobId' => $jobId]), $images);
        $result['data'] = $images;
        save_request_log(['requestId' => $requestId, 'mode' => 'generation', 'request' => $payload, 'response' => $result]);
        return ['jobId' => $jobId, 'data' => $images, 'created' => $normalized['created'], 'usage' => $normalized['usage']];
    } catch (Throwable $error) {
        save_image_job($user, $requestId, 'generation', $prompt, ['payload' => $payload], [], $error->getMessage());
        save_request_log(['requestId' => $requestId, 'mode' => 'generation', 'request' => $payload, 'error' => ['message' => $error->getMessage()]]);
        throw $error;
    }
}

function uploaded_file_list(string $field): array
{
    if (!isset($_FILES[$field])) return [];
    $file = $_FILES[$field];
    if (is_array($file['name'] ?? null)) {
        $items = [];
        foreach ($file['name'] as $index => $name) {
            $items[] = ['field' => $field . '[]', 'name' => $name, 'type' => $file['type'][$index] ?? '', 'tmp_name' => $file['tmp_name'][$index] ?? '', 'error' => $file['error'][$index] ?? 0, 'size' => $file['size'][$index] ?? 0];
        }
        return $items;
    }
    return [['field' => $field, 'name' => $file['name'] ?? '', 'type' => $file['type'] ?? '', 'tmp_name' => $file['tmp_name'] ?? '', 'error' => $file['error'] ?? 0, 'size' => $file['size'] ?? 0]];
}

function handle_proxy_edit(array $user): array
{
    $config = active_api_config_row((int) $user['id']);
    $apiKey = decrypt_api_key($config);
    if (!$config || $apiKey === '') json_response(['error' => '请先在参数设置里保存 API Key。'], 400);
    $requestId = preg_replace('/[^a-zA-Z0-9_.-]/', '-', (string) ($_POST['requestId'] ?? ('request-' . time())));
    $fields = $_POST;
    unset($fields['requestId']);
    $fields['model'] = $config['model'] ?: ($fields['model'] ?? 'gpt-image-2');
    $prompt = trim((string) ($fields['prompt'] ?? ''));
    if ($prompt === '') json_response(['error' => '缺少提示词'], 400);
    $files = array_merge(uploaded_file_list('image'), uploaded_file_list('image[]'));
    $maskFiles = uploaded_file_list('mask');
    if ($maskFiles) $files[] = $maskFiles[0];
    $outputFormat = (string) ($fields['output_format'] ?? 'png');
    $fileMeta = array_map(fn($file) => ['field' => $file['field'], 'name' => $file['name'], 'type' => $file['type'], 'size' => (int) $file['size']], $files);

    try {
        $raw = call_upstream_multipart($config, $apiKey, '/v1/images/edits', $fields, $files);
        $normalized = normalize_proxy_image_response($raw, $outputFormat);
        $images = proxy_result_images($normalized, $outputFormat);
        if (!$images) throw new RuntimeException('上游接口未返回可展示图片。');
        $result = ['created' => $normalized['created'], 'usage' => $normalized['usage'], 'data' => $images, 'raw' => $normalized['raw']];
        $jobId = save_image_job($user, $requestId, 'edit', $prompt, ['fields' => $fields, 'files' => $fileMeta], $result);
        $images = array_map(fn($image) => array_merge($image, ['jobId' => $jobId, 'sourceJobId' => $jobId]), $images);
        $result['data'] = $images;
        save_request_log(['requestId' => $requestId, 'mode' => 'edit', 'request' => ['fields' => $fields, 'files' => $fileMeta], 'response' => $result]);
        return ['jobId' => $jobId, 'data' => $images, 'created' => $normalized['created'], 'usage' => $normalized['usage']];
    } catch (Throwable $error) {
        save_image_job($user, $requestId, 'edit', $prompt, ['fields' => $fields, 'files' => $fileMeta], [], $error->getMessage());
        save_request_log(['requestId' => $requestId, 'mode' => 'edit', 'request' => ['fields' => $fields, 'files' => $fileMeta], 'error' => ['message' => $error->getMessage()]]);
        throw $error;
    }
}

function client_wall_item(array $item): array
{
    $params = [];
    if (!empty($item['params_json'])) {
        $decoded = is_string($item['params_json']) ? json_decode($item['params_json'], true) : $item['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    $displayUrl = (string) (($item['display_url'] ?? '') ?: ($item['image_url'] ?? ''));
    $originalUrl = (string) (($item['original_url'] ?? '') ?: (($item['image_url'] ?? '') ?: $displayUrl));
    $duration = $item['duration_seconds'] ?? ($params['durationSeconds'] ?? null);
    $createdAt = (string) (($item['created_at'] ?? '') ?: date(DATE_ATOM));

    return [
        'id' => (int) ($item['id'] ?? 0),
        'wallItemId' => (int) ($item['id'] ?? 0),
        'userId' => isset($item['user_id']) ? (int) $item['user_id'] : null,
        'sourceJobId' => isset($item['source_job_id']) ? (int) $item['source_job_id'] : null,
        'url' => $displayUrl,
        'image_url' => $displayUrl,
        'downloadUrl' => $originalUrl,
        'originalUrl' => $originalUrl,
        'b64_json' => $displayUrl ? '' : (string) ($item['image_b64'] ?? ''),
        'imageMime' => (string) (($item['image_mime'] ?? '') ?: 'image/png'),
        'originalBytes' => isset($item['original_bytes']) ? (int) $item['original_bytes'] : null,
        'displayBytes' => isset($item['display_bytes']) ? (int) $item['display_bytes'] : null,
        'prompt' => (string) (($item['prompt'] ?? '') ?: ''),
        'revised_prompt' => (string) (($item['revised_prompt'] ?? '') ?: ''),
        'form' => $params,
        'apiName' => (string) ($params['apiName'] ?? ($params['api_name'] ?? '')),
        'authorName' => (string) (($item['author_name'] ?? '') ?: '未知艺术家'),
        'createdAt' => $createdAt,
        'durationSeconds' => $duration !== null && $duration !== '' ? (int) $duration : null,
        'isOnWall' => true,
        'source' => $params['source'] ?? (($params['referenceName'] ?? '') !== '' ? 'edit' : 'generation'),
    ];
}

function request_log_dir(): string
{
    $dist = dirname(__DIR__, 2) . '/dist';
    $base = is_dir($dist) ? $dist : public_base_dir();
    return $base . '/image-requests';
}

function sanitize_log_payload($value)
{
    if (is_array($value)) {
        $next = [];
        foreach ($value as $key => $item) {
            if (preg_match('/authorization|api[_-]?key|token|secret/i', (string) $key)) continue;
            if (is_string($item) && strlen($item) > 4096 && preg_match('/^[a-z0-9+\/=\r\n]+$/i', $item)) {
                $next[$key] = '[base64 omitted]';
            } else {
                $next[$key] = sanitize_log_payload($item);
            }
        }
        return $next;
    }
    return $value;
}

function rotate_request_logs(string $dir): void
{
    $files = glob($dir . '/*.json') ?: [];
    usort($files, fn($a, $b) => filemtime($b) <=> filemtime($a));
    foreach (array_slice($files, IMAGE_REQUEST_LOG_LIMIT) as $file) @unlink($file);
}

function save_request_log(array $body): array
{
    $dir = request_log_dir();
    ensure_dir($dir);
    $id = preg_replace('/[^a-zA-Z0-9_.-]/', '-', (string) ($body['requestId'] ?? ('request-' . time())));
    $path = $dir . '/' . date('Ymd-His') . '-' . $id . '.json';
    $payload = [
        'requestId' => $body['requestId'] ?? null,
        'mode' => $body['mode'] ?? null,
        'createdAt' => date(DATE_ATOM),
        'request' => sanitize_log_payload($body['request'] ?? null),
        'response' => sanitize_log_payload($body['response'] ?? null),
        'error' => sanitize_log_payload($body['error'] ?? null),
    ];
    file_put_contents($path, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    rotate_request_logs($dir);
    return ['ok' => true, 'file' => basename($path)];
}

function route_path(): string
{
    $route = $_GET['route'] ?? '';
    if ($route === '') {
        $query = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_QUERY) ?: '';
        if ($query !== '') {
            parse_str($query, $queryParams);
            $route = $queryParams['route'] ?? '';
        }
    }
    if ($route !== '') return '/' . ltrim((string) $route, '/');

    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $pos = strpos($uri, '/api');
    $path = $pos === false ? $uri : '/' . ltrim(substr($uri, $pos + 4), '/');
    return $path === '/index.php' ? '/' : $path;
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $route = route_path();
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) && (strpos($contentType, 'application/json') !== false || $contentType === '') ? read_json_body() : [];

    if ($method === 'GET' && $route === '/health') {
        $configured = false;
        $apiName = DEFAULT_API_NAME;
        try {
            ensure_schema();
            $settings = stored_user_settings();
            $active = session_user_id() ? active_api_config_row((int) session_user_id()) : null;
            $apiName = trim((string) ($active['api_name'] ?? ($settings['api_name'] ?? ''))) ?: $apiName;
            $configured = stored_user_api_key() !== '';
        } catch (Throwable $error) {
            $configured = false;
        }

        json_response([
            'ok' => true,
            'configured' => $configured,
            'mysqlConfigured' => true,
            'apiName' => $apiName,
            'baseUrl' => rtrim((string) cfg('openai_base_url', DEFAULT_API_BASE_URL), '/'),
            'defaultImageModel' => cfg('openai_image_model', DEFAULT_IMAGE_MODEL),
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
            json_response(['user' => ['id' => $id, 'username' => $username, 'displayName' => $displayName, 'isAdmin' => false], 'settings' => settings_for_user($id)]);
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
        $settings = settings_for_user((int) $user['id']);
        json_response([
            'settings' => $settings,
            'apiKey' => stored_user_api_key(),
        ]);
    }

    if ($method === 'POST' && $route === '/settings') {
        $user = require_user();
        json_response(['settings' => save_user_settings($user, $body)]);
    }

    if ($method === 'POST' && $route === '/settings/active-api') {
        $user = require_user();
        json_response(['settings' => switch_active_api_config($user, $body)]);
    }

    if ($method === 'POST' && $route === '/images/generations') {
        $user = require_user();
        json_response(handle_proxy_generation($user, $body));
    }

    if ($method === 'POST' && $route === '/images/edits') {
        $user = require_user();
        json_response(handle_proxy_edit($user));
    }

    if ($method === 'POST' && $route === '/image-requests') {
        json_response(save_request_log($body));
    }

    if ($method === 'GET' && $route === '/generated-images') {
        $user = require_user();
        json_response(handle_generated_images($user));
    }

    if ($method === 'POST' && $route === '/generated-images') {
        $user = require_user();
        json_response(handle_save_generated_image($user, $body));
    }

    if ($method === 'DELETE' && $route === '/generated-images') {
        $user = require_user();
        json_response(handle_clear_generated_images($user));
    }

    if ($method === 'DELETE' && preg_match('#^/generated-images/(\d+)$#', $route, $matches)) {
        $user = require_user();
        json_response(handle_delete_generated_image($user, (int) $matches[1]));
    }

    if ($method === 'GET' && $route === '/wall/mine') {
        $user = require_user();
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 80');
        $stmt->execute([(int) $user['id']]);
        json_response(['items' => array_map('client_wall_item', $stmt->fetchAll())]);
    }

    if ($method === 'GET' && $route === '/wall') {
        require_database();
        $rows = pdo()->query('SELECT * FROM wall_items ORDER BY created_at DESC LIMIT 80')->fetchAll();
        json_response(['items' => array_map('client_wall_item', $rows)]);
    }

    if ($method === 'GET' && preg_match('#^/wall/(\d+)$#', $route, $matches)) {
        require_database();
        $stmt = pdo()->prepare('SELECT * FROM wall_items WHERE id = ? LIMIT 1');
        $stmt->execute([(int) $matches[1]]);
        $item = $stmt->fetch();
        if (!$item) json_response(['exists' => false], 404);
        json_response(['exists' => true, 'item' => client_wall_item($item)]);
    }

    if ($method === 'POST' && $route === '/wall') {
        $user = require_user();
        json_response(handle_create_wall_item($user, $body));
    }

    if ($method === 'DELETE' && preg_match('#^/wall/(\d+)$#', $route, $matches)) {
        $user = require_user();
        json_response(handle_delete_wall_item($user, (int) $matches[1]));
    }

    json_response(['error' => '接口不存在', 'route' => $route], 404);
} catch (Throwable $error) {
    $status = $error instanceof RuntimeException ? 502 : 500;
    json_response(['error' => $error->getMessage() ?: '服务端异常', 'detail' => $error->getMessage()], $status);
}