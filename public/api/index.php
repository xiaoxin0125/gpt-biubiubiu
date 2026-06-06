<?php

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();

define('DEFAULT_REQUEST_TIMEOUT', 999);
define('MAX_REQUEST_TIMEOUT', 999);
define('REQUEST_TIMEOUT_BUFFER', 60);
define('MAX_EDIT_IMAGES', 16);
define('MAX_MASK_SIZE_BYTES', 4 * 1024 * 1024);

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

function upstream_url(string $path): string
{
    $baseUrl = rtrim(effective_api_base_url(), '/');
    $basePath = rtrim((string) (parse_url($baseUrl, PHP_URL_PATH) ?: ''), '/');
    $path = '/' . ltrim($path, '/');

    if ($basePath !== '' && strpos($path, $basePath . '/') === 0) {
        $path = substr($path, strlen($basePath));
    }

    return $baseUrl . $path;
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
      stream_enabled TINYINT(1) NOT NULL DEFAULT 0,
      size VARCHAR(64) DEFAULT NULL,
      quality VARCHAR(64) DEFAULT NULL,
      style VARCHAR(64) DEFAULT NULL,
      response_format VARCHAR(64) DEFAULT NULL,
      background VARCHAR(64) DEFAULT NULL,
      output_format VARCHAR(64) DEFAULT NULL,
      output_compression VARCHAR(16) DEFAULT NULL,
      moderation VARCHAR(64) DEFAULT NULL,
      n INT UNSIGNED DEFAULT 1,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      params_json JSON DEFAULT NULL,
      source_job_id BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wall_items_created (created_at),
      INDEX idx_wall_items_user (user_id),
      INDEX idx_wall_items_client (client_id),
      CONSTRAINT fk_wall_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_wall_items_job FOREIGN KEY (source_job_id) REFERENCES image_jobs(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    ensure_column($db, 'users', 'display_name', 'display_name VARCHAR(96) DEFAULT NULL AFTER username');
    ensure_column($db, 'users', 'is_admin', 'is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
    ensure_column($db, 'user_settings', 'api_name', 'api_name VARCHAR(128) DEFAULT NULL AFTER model');
    ensure_column($db, 'user_settings', 'api_base_url', 'api_base_url VARCHAR(255) DEFAULT NULL AFTER api_name');
    ensure_column($db, 'user_settings', 'request_timeout', 'request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER api_base_url');
    ensure_column($db, 'user_settings', 'stream_enabled', 'stream_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER request_timeout');
    ensure_column($db, 'user_settings', 'background', 'background VARCHAR(64) DEFAULT NULL AFTER response_format');
    ensure_column($db, 'user_settings', 'output_compression', 'output_compression VARCHAR(16) DEFAULT NULL AFTER output_format');
    ensure_column($db, 'image_jobs', 'request_id', 'request_id VARCHAR(80) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'image_jobs', 'status', "status VARCHAR(32) NOT NULL DEFAULT 'completed' AFTER mode");
    ensure_column($db, 'image_jobs', 'error_message', 'error_message TEXT DEFAULT NULL AFTER revised_prompt');
    ensure_column($db, 'image_jobs', 'result_json', 'result_json JSON DEFAULT NULL AFTER params_json');
    ensure_column($db, 'image_jobs', 'completed_at', 'completed_at TIMESTAMP NULL DEFAULT NULL AFTER created_at');
    $db->exec('UPDATE user_settings SET request_timeout = 999 WHERE request_timeout IN (180, 600)');
    $db->exec("UPDATE user_settings SET model = 'gpt-image-2' WHERE model = 'gpt-image-1'");
    $db->exec("UPDATE user_settings SET size = '768x768' WHERE size = '1024x1024'");

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
        'streamEnabled' => !empty($settings['stream_enabled']),
        'size' => $settings['size'] ?: '',
        'quality' => $settings['quality'] ?: '',
        'background' => $settings['background'] ?: '',
        'output_format' => $settings['output_format'] ?: '',
        'output_compression' => $settings['output_compression'] ?: '',
        'moderation' => $settings['moderation'] ?: '',
        'n' => (int) ($settings['n'] ?: 1),
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

function effective_api_base_url(): string
{
    try {
        $settings = stored_user_settings();
        $baseUrl = preg_replace('/\s+/', '', (string) ($settings['api_base_url'] ?? ''));
    } catch (Throwable $error) {
        $baseUrl = '';
    }
    return rtrim($baseUrl ?: (string) cfg('openai_base_url', 'https://api.openai.com'), '/');
}

function effective_request_timeout(): int
{
    try {
        $settings = stored_user_settings();
        $timeout = (int) ($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT);
    } catch (Throwable $error) {
        $timeout = DEFAULT_REQUEST_TIMEOUT;
    }
    return max(10, min(MAX_REQUEST_TIMEOUT, $timeout ?: DEFAULT_REQUEST_TIMEOUT));
}

function effective_api_key(): string
{
    try {
        $stored = stored_user_api_key();
    } catch (Throwable $error) {
        $stored = '';
    }
    return $stored ?: (string) cfg('openai_api_key', '');
}

function allowed_quality($value): bool
{
    return in_array($value, ['low', 'medium', 'high'], true);
}

function allowed_settings_quality($value): bool
{
    return in_array($value, ['auto', 'low', 'medium', 'high'], true);
}

function allowed_output_format($value): bool
{
    return in_array($value, ['png', 'jpeg', 'webp'], true);
}

function allowed_background($value): bool
{
    return in_array($value, ['opaque', 'auto'], true);
}

function allowed_moderation($value): bool
{
    return in_array($value, ['auto', 'low'], true);
}

function clamp_int($value, int $min, int $max): int
{
    return max($min, min($max, (int) $value));
}

function generation_payload(array $body): array
{
    $outputFormat = allowed_output_format($body['output_format'] ?? null) ? $body['output_format'] : 'png';
    $payload = [
        'model' => $body['model'] ?? cfg('openai_image_model', 'gpt-image-2'),
        'prompt' => $body['prompt'] ?? '',
        'n' => 1,
        'output_format' => $outputFormat,
    ];

    if (!empty($body['size'])) $payload['size'] = (string) $body['size'];
    if (allowed_quality($body['quality'] ?? null)) $payload['quality'] = $body['quality'];
    if (allowed_background($body['background'] ?? null) && $body['background'] !== 'auto') $payload['background'] = $body['background'];
    if (allowed_moderation($body['moderation'] ?? null)) $payload['moderation'] = $body['moderation'];
    if (in_array($outputFormat, ['jpeg', 'webp'], true) && isset($body['output_compression']) && $body['output_compression'] !== '') {
        $payload['output_compression'] = clamp_int($body['output_compression'], 0, 100);
    }
    if (!empty($body['user'])) $payload['user'] = (string) $body['user'];

    return $payload;
}

function edit_payload(array $body): array
{
    $outputFormat = allowed_output_format($body['output_format'] ?? null) ? $body['output_format'] : 'png';
    $payload = [
        'model' => $body['model'] ?? cfg('openai_image_model', 'gpt-image-2'),
        'prompt' => $body['prompt'] ?? '',
        'output_format' => $outputFormat,
    ];

    if (!empty($body['size'])) $payload['size'] = (string) $body['size'];
    if (allowed_quality($body['quality'] ?? null)) $payload['quality'] = $body['quality'];
    if (allowed_background($body['background'] ?? null) && $body['background'] !== 'auto') $payload['background'] = $body['background'];
    if (in_array($outputFormat, ['jpeg', 'webp'], true) && isset($body['output_compression']) && $body['output_compression'] !== '') {
        $payload['output_compression'] = clamp_int($body['output_compression'], 0, 100);
    }
    if (!empty($body['user'])) $payload['user'] = (string) $body['user'];

    return $payload;
}

function parse_json_text(string $text): array
{
    if ($text === '') return [];

    $trimmed = trim($text);
    if (array_filter(preg_split('/\r?\n/', $trimmed) ?: [], static fn($line) => strpos(trim((string) $line), 'data:') === 0)) {
        $lastJson = null;
        foreach (preg_split('/\r?\n/', $trimmed) ?: [] as $line) {
            $value = trim($line);
            if (strpos($value, 'data:') !== 0) continue;
            $payload = trim(substr($value, 5));
            if ($payload === '' || $payload === '[DONE]') continue;
            $decoded = json_decode($payload, true);
            if (is_array($decoded) && isset($decoded['data']) && is_array($decoded['data'])) return $decoded;
            if (is_array($decoded)) $lastJson = $decoded;
        }
        if (is_array($lastJson)) return $lastJson;
    }

    $decoded = json_decode($text, true);
    if (is_array($decoded)) return $decoded;

    $snippet = trim(preg_replace('/\s+/', ' ', strip_tags($text)) ?: $text);
    if ($snippet === '') $snippet = '上游接口返回了非 JSON 内容';
    return [
        'message' => '上游接口返回了非 JSON 内容，请检查 API 地址是否应填写到 /v1 或只填写域名。',
        'snippet' => substr($snippet, 0, 220),
    ];
}

function image_request_log_path(): string
{
    return dirname(__DIR__, 2) . '/dist/image-requests.jsonl';
}

function append_image_request_log(array $entry): void
{
    $payload = array_merge([
        'timestamp' => gmdate('c'),
        'type' => '',
        'endpoint' => '',
        'jobId' => null,
        'request' => [],
        'files' => [],
        'responseStatus' => null,
        'response' => null,
        'error' => '',
    ], $entry);

    try {
        $path = image_request_log_path();
        $dir = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json !== false) @file_put_contents($path, $json . PHP_EOL, FILE_APPEND | LOCK_EX);
    } catch (Throwable $error) {
        error_log('图片请求日志写入失败：' . $error->getMessage());
    }
}

function image_request_log_files(array $files): array
{
    return array_map(static fn($file) => [
        'fieldname' => $file['fieldname'] ?? '',
        'originalname' => $file['name'] ?? ($file['filename'] ?? ''),
        'mimetype' => $file['type'] ?? '',
        'size' => (int) ($file['size'] ?? 0),
    ], $files);
}

function upstream_error_message(array $data, string $fallback): string
{
    return $data['error']['message'] ?? $data['message'] ?? $fallback;
}

function upstream_error_payload(array $data, string $fallback, int $status): array
{
    $message = upstream_error_message($data, $fallback);
    if ($status === 504 && stripos($message, 'stream disconnected before completion') !== false) {
        return [
            'error' => '上游 API 中转 504：生图流在完成前断开。应用层超时已支持最高 999 秒；仍失败时请把宝塔/Nginx 的 request timeout、read timeout、proxy_read_timeout 或 fastcgi_read_timeout 调到 999 秒以上，或降低尺寸/质量后重试。',
            'detail' => $data,
        ];
    }

    return ['error' => $message, 'detail' => $data];
}

function assert_image_response(array $data, string $fallback): void
{
    if (isset($data['data']) && is_array($data['data'])) return;
    json_response(['error' => upstream_error_message($data, $fallback), 'detail' => $data], 502);
}

function image_mime_for_output_format($format): string
{
    $value = strtolower((string) $format);
    if ($value === 'jpeg') return 'image/jpeg';
    if ($value === 'webp') return 'image/webp';
    return 'image/png';
}

function normalize_image_data(array $data, $outputFormat = 'png'): array
{
    $items = [];
    $mime = image_mime_for_output_format($outputFormat);
    foreach (($data['data'] ?? []) as $index => $item) {
        $items[] = [
            'id' => (int) (microtime(true) * 1000) . '-' . $index,
            'url' => $item['url'] ?? '',
            'b64_json' => $item['b64_json'] ?? '',
            'imageMime' => $mime,
            'revised_prompt' => $item['revised_prompt'] ?? '',
        ];
    }

    return ['created' => $data['created'] ?? time(), 'data' => $items, 'raw' => $data];
}

function respond_json_and_continue(array $payload, int $status = 202): void
{
    while (ob_get_level() > 0) ob_end_clean();
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) $json = '{"error":"JSON 编码失败"}';

    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($json));
    header('Connection: close');
    echo $json;

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }

    flush();
}

function image_job_owner_values(): array
{
    $userId = session_user_id();
    if ($userId) return [$userId, null];
    return [null, visitor_id()];
}

function create_pending_image_job(array $params, string $mode): int
{
    [$userId, $requestId] = image_job_owner_values();
    $stmt = pdo()->prepare('INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, params_json) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $userId,
        $requestId,
        $mode,
        'running',
        $params['prompt'] ?? '',
        json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    return (int) pdo()->lastInsertId();
}

function client_image_job(array $row): array
{
    $params = [];
    if (!empty($row['params_json'])) {
        $decoded = is_string($row['params_json']) ? json_decode($row['params_json'], true) : $row['params_json'];
        $params = is_array($decoded) ? $decoded : [];
    }

    $status = $row['status'] ?: ((($row['image_url'] ?? '') || ($row['image_b64'] ?? '')) ? 'completed' : 'running');
    return [
        'id' => (int) $row['id'],
        'jobId' => (int) $row['id'],
        'status' => $status,
        'mode' => $row['mode'] ?: 'generation',
        'prompt' => $row['prompt'] ?: ($params['prompt'] ?? ''),
        'revised_prompt' => $row['revised_prompt'] ?: '',
        'error' => $row['error_message'] ?: '',
        'form' => $params,
        'createdAt' => $row['created_at'] ?? null,
        'finishedAt' => $row['completed_at'] ?? null,
    ];
}

function completed_job_payload(array $row): array
{
    $job = client_image_job($row);
    $images = [];
    $mime = image_mime_for_output_format($job['form']['output_format'] ?? 'png');
    if (!empty($row['result_json'])) {
        $decoded = is_string($row['result_json']) ? json_decode($row['result_json'], true) : $row['result_json'];
        if (is_array($decoded) && isset($decoded['data']) && is_array($decoded['data'])) {
            $images = array_map(static fn($image) => is_array($image) ? $image : [], $decoded['data']);
        }
    }

    if (!$images) {
        $images = [[
            'id' => (int) $row['id'],
            'jobId' => (int) $row['id'],
            'url' => $row['image_url'] ?: '',
            'b64_json' => $row['image_b64'] ?: '',
            'imageMime' => $mime,
            'revised_prompt' => $row['revised_prompt'] ?: '',
        ]];
    }
    $images[0]['id'] = $images[0]['id'] ?? (int) $row['id'];
    $images[0]['jobId'] = $images[0]['jobId'] ?? (int) $row['id'];
    foreach ($images as &$image) {
        $image['imageMime'] = $image['imageMime'] ?? $mime;
    }
    unset($image);

    return [
        'created' => $row['completed_at'] ? strtotime((string) $row['completed_at']) : time(),
        'data' => $images,
        'job' => $job,
    ];
}

function image_job_response(array $row): array
{
    $job = client_image_job($row);
    if ($job['status'] === 'completed' && (($row['image_url'] ?? '') || ($row['image_b64'] ?? ''))) {
        return completed_job_payload($row);
    }

    return ['job' => $job];
}

function fetch_owned_image_job(int $jobId): ?array
{
    $userId = session_user_id();
    $visitor = unsign_value($_COOKIE['visitor_id'] ?? '');
    $stmt = pdo()->prepare('SELECT * FROM image_jobs WHERE id = ? LIMIT 1');
    $stmt->execute([$jobId]);
    $row = $stmt->fetch();
    if (!$row) return null;

    if (!empty($row['user_id'])) {
        return ((int) $row['user_id'] === (int) $userId) ? $row : null;
    }

    if (!empty($row['request_id'])) {
        return ($visitor !== '' && hash_equals((string) $row['request_id'], $visitor)) ? $row : null;
    }

    return $userId ? $row : null;
}

function update_image_job_failed(int $jobId, string $message): void
{
    try {
        $stmt = pdo()->prepare('UPDATE image_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?');
        $stmt->execute(['failed', $message, $jobId]);
    } catch (Throwable $error) {
        error_log('image job failed update error: ' . $error->getMessage());
    }
}

function complete_image_job(int $jobId, array $normalized, array $params, string $mode): array
{
    $images = is_array($normalized['data'] ?? null) ? $normalized['data'] : [];
    if (!$images) throw new RuntimeException('生图接口没有返回图片数据');

    $first = $images[0];
    $stmt = pdo()->prepare('UPDATE image_jobs SET status = ?, revised_prompt = ?, image_url = ?, image_b64 = ?, params_json = ?, result_json = ?, completed_at = NOW() WHERE id = ?');
    $stmt->execute([
        'completed',
        $first['revised_prompt'] ?? '',
        ($first['url'] ?? '') ?: null,
        ($first['b64_json'] ?? '') ?: null,
        json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        json_encode($normalized['raw'] ?? $normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $jobId,
    ]);
    $images[0]['jobId'] = $jobId;
    $resultImages = $images;

    if (count($images) > 1) {
        $extraImages = array_slice($images, 1);
        $saved = persist_image_jobs($extraImages, $params, $mode);
        array_splice($images, 1, count($extraImages), $saved);
        $resultImages = $images;
        $stmt = pdo()->prepare('UPDATE image_jobs SET result_json = ? WHERE id = ?');
        $stmt->execute([json_encode(['data' => $resultImages], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $jobId]);
    }

    $normalized['data'] = $images;
    return $normalized;
}

function persist_image_jobs(array $images, array $params, string $mode): array
{
    if (!$images) return $images;

    try {
        $stmt = pdo()->prepare('INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, revised_prompt, image_url, image_b64, params_json, result_json, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        $result = [];
        foreach ($images as $image) {
            [$userId, $requestId] = image_job_owner_values();
            $stmt->execute([
                $userId,
                $requestId,
                $mode,
                'completed',
                $params['prompt'] ?? '',
                $image['revised_prompt'] ?? '',
                $image['url'] ?: null,
                $image['b64_json'] ?: null,
                json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode(['data' => [$image]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
            $image['jobId'] = (int) pdo()->lastInsertId();
            $result[] = $image;
        }
        return $result;
    } catch (Throwable $error) {
        return $images;
    }
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
        'sourceJobId' => $item['source_job_id'] ? (int) $item['source_job_id'] : null,
        'createdAt' => $item['created_at'],
        'isOnWall' => true,
        'source' => 'wall',
    ];
}

function curl_json(string $url, array $headers, string $body): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('PHP 未启用 cURL 扩展');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_TIMEOUT => effective_request_timeout(),
        CURLOPT_LOW_SPEED_LIMIT => 1,
        CURLOPT_LOW_SPEED_TIME => effective_request_timeout(),
    ]);
    $text = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($text === false) throw new RuntimeException('代理请求异常：' . $error);
    return [$status, (string) $text];
}

function uploaded_file_items(string $field): array
{
    if (empty($_FILES[$field])) return [];
    $files = $_FILES[$field];
    $items = [];

    if (is_array($files['tmp_name'] ?? null)) {
        foreach ($files['tmp_name'] as $index => $tmpName) {
            if (!$tmpName || (($files['error'][$index] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK)) continue;
            $items[] = [
                'fieldname' => $field,
                'tmp_name' => $tmpName,
                'type' => $files['type'][$index] ?? 'image/png',
                'name' => $files['name'][$index] ?? ('image-' . ($index + 1) . '.png'),
                'size' => (int) ($files['size'][$index] ?? 0),
            ];
        }
        return $items;
    }

    if (($files['tmp_name'] ?? '') && (($files['error'] ?? UPLOAD_ERR_OK) === UPLOAD_ERR_OK)) {
        $items[] = [
            'fieldname' => $field,
            'tmp_name' => $files['tmp_name'],
            'type' => $files['type'] ?? 'image/png',
            'name' => $files['name'] ?? 'image.png',
            'size' => (int) ($files['size'] ?? 0),
        ];
    }

    return $items;
}

function uploaded_edit_images(): array
{
    $items = array_merge(uploaded_file_items('image'), uploaded_file_items('image[]'));
    $items = array_slice($items, 0, MAX_EDIT_IMAGES);
    foreach ($items as $item) {
        $mime = strtolower((string) ($item['type'] ?? ''));
        if (!in_array($mime, ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'], true)) {
            json_response(['error' => '参考图仅支持 png / jpg / webp'], 400);
        }
    }
    return $items;
}

function uploaded_mask_file(): ?array
{
    $items = uploaded_file_items('mask');
    if (!$items) return null;
    $mask = $items[0];
    $mime = strtolower((string) ($mask['type'] ?? ''));
    if ($mime !== 'image/png') json_response(['error' => 'mask 必须是 PNG 图片'], 400);
    if (($mask['size'] ?? 0) > MAX_MASK_SIZE_BYTES) json_response(['error' => 'mask 文件必须小于 4MB'], 400);
    return $mask;
}

function multipart_header_value(string $value): string
{
    return str_replace(["\r", "\n", '"'], ['', '', '\\"'], $value);
}

function build_multipart_body(array $parts): array
{
    $boundary = '----gpt-biubiubiu-' . bin2hex(random_bytes(12));
    $body = '';

    foreach ($parts as $part) {
        $name = multipart_header_value((string) ($part['name'] ?? ''));
        if ($name === '') continue;

        $body .= "--{$boundary}\r\n";
        if (!empty($part['file'])) {
            $filename = multipart_header_value((string) ($part['filename'] ?? 'file'));
            $mime = multipart_header_value((string) ($part['type'] ?? 'application/octet-stream'));
            $contents = file_get_contents((string) $part['file']);
            if ($contents === false) throw new RuntimeException('读取上传文件失败：' . $filename);
            $body .= "Content-Disposition: form-data; name=\"{$name}\"; filename=\"{$filename}\"\r\n";
            $body .= "Content-Type: {$mime}\r\n\r\n";
            $body .= $contents . "\r\n";
            continue;
        }

        $body .= "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n";
        $body .= (string) ($part['value'] ?? '') . "\r\n";
    }

    $body .= "--{$boundary}--\r\n";
    return [$body, 'Content-Type: multipart/form-data; boundary=' . $boundary];
}

function curl_multipart(string $url, array $headers, $fields): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('PHP 未启用 cURL 扩展');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $fields,
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_TIMEOUT => effective_request_timeout(),
        CURLOPT_LOW_SPEED_LIMIT => 1,
        CURLOPT_LOW_SPEED_TIME => effective_request_timeout(),
    ]);
    $text = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($text === false) throw new RuntimeException('图生图代理请求异常：' . $error);
    return [$status, (string) $text];
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
        if (isset($_GET['job'])) {
            require_database();
            $jobId = (int) $_GET['job'];
            if ($jobId <= 0) json_response(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'failed', 'error' => '任务不存在或无权访问']]);
            $row = fetch_owned_image_job($jobId);
            if (!$row) json_response(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'failed', 'error' => '任务不存在或无权访问']]);
            json_response(image_job_response($row));
        }

        $configured = false;
        $apiName = 'OpenAI Compatible';
        try {
            ensure_schema();
            $settings = stored_user_settings();
            $apiName = trim((string) ($settings['api_name'] ?? '')) ?: $apiName;
            $configured = effective_api_key() !== '';
        } catch (Throwable $error) {
            $configured = cfg('openai_api_key', '') !== '';
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

        $stmt = pdo()->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream_enabled, size, quality, style, response_format, background, output_format, output_compression, moderation, n, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE model = VALUES(model), api_name = VALUES(api_name), api_base_url = VALUES(api_base_url), request_timeout = VALUES(request_timeout), stream_enabled = VALUES(stream_enabled), size = VALUES(size), quality = VALUES(quality), style = VALUES(style), response_format = VALUES(response_format), background = VALUES(background), output_format = VALUES(output_format), output_compression = VALUES(output_compression), moderation = VALUES(moderation), n = VALUES(n), api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), api_key_hint = VALUES(api_key_hint)');
        $apiBaseUrl = preg_replace('/\s+/', '', (string) ($settings['apiBaseUrl'] ?? ($settings['api_base_url'] ?? '')));
        $requestTimeout = max(10, min(MAX_REQUEST_TIMEOUT, (int) ($settings['requestTimeout'] ?? ($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT))));
        $moderationValue = $settings['moderation'] ?? 'auto';
        $backgroundValue = $settings['background'] ?? 'auto';
        $outputFormatValue = $settings['output_format'] ?? 'png';
        $moderation = allowed_moderation($moderationValue) ? $moderationValue : 'auto';
        $background = allowed_background($backgroundValue) ? $backgroundValue : 'auto';
        $outputFormat = allowed_output_format($outputFormatValue) ? $outputFormatValue : 'png';
        $outputCompression = clamp_int($settings['output_compression'] ?? 100, 0, 100);
        if (!valid_api_base_url($apiBaseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);
        $stmt->execute([
            $user['id'],
            $settings['model'] ?? cfg('openai_image_model', 'gpt-image-2'),
            trim((string) ($settings['apiName'] ?? ($settings['api_name'] ?? 'OpenAI Compatible'))),
            $apiBaseUrl,
            $requestTimeout,
            !empty($settings['streamEnabled']) || !empty($settings['stream_enabled']) ? 1 : 0,
            $settings['size'] ?? '',
            allowed_settings_quality($settings['quality'] ?? null) ? $settings['quality'] : 'auto',
            $settings['style'] ?? 'auto',
            $settings['response_format'] ?? '',
            $background,
            $outputFormat,
            (string) $outputCompression,
            $moderation,
            1,
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
        $stmt = pdo()->prepare('INSERT INTO wall_items (user_id, client_id, author_name, prompt, revised_prompt, image_url, image_b64, image_mime, params_json, source_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
            $body['jobId'] ?? null,
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

    if ($method === 'GET' && ($route === '/image-job' || $route === '/image-jobs')) {
        require_database();
        $jobId = (int) ($_GET['id'] ?? 0);
        if ($jobId <= 0) json_response(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'failed', 'error' => '任务不存在或无权访问']]);
        $row = fetch_owned_image_job($jobId);
        if (!$row) json_response(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'failed', 'error' => '任务不存在或无权访问']]);
        json_response(image_job_response($row));
    }

    if ($method === 'GET' && preg_match('#^/image-jobs/(\d+)$#', $route, $matches)) {
        require_database();
        $jobId = (int) $matches[1];
        $row = fetch_owned_image_job($jobId);
        if (!$row) json_response(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'failed', 'error' => '任务不存在或无权访问']]);
        json_response(image_job_response($row));
    }

    if ($method === 'POST' && $route === '/images/generations') {
        require_database();
        $apiKey = effective_api_key();
        if ($apiKey === '') json_response(['error' => '服务端未配置 OPENAI_API_KEY，且当前用户未保存 API Key'], 500);
        if (trim((string) ($body['prompt'] ?? '')) === '') json_response(['error' => '提示词不能为空'], 400);

        $payload = generation_payload($body);
        $jobId = create_pending_image_job($payload, 'generation');
        respond_json_and_continue(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'running', 'mode' => 'generation']], 202);

        try {
            $endpoint = upstream_url('/v1/images/generations');
            [$status, $text] = curl_json($endpoint, [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
            ], json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $data = parse_json_text($text);
            append_image_request_log([
                'type' => 'generation',
                'endpoint' => $endpoint,
                'jobId' => $jobId,
                'request' => $payload,
                'responseStatus' => $status,
                'response' => $data,
                'error' => ($status >= 200 && $status < 300) ? '' : upstream_error_message($data, '生图接口请求失败'),
            ]);
            if ($status < 200 || $status >= 300) {
                $errorPayload = upstream_error_payload($data, '生图接口请求失败', $status);
                update_image_job_failed($jobId, (string) ($errorPayload['error'] ?? '生图接口请求失败'));
                exit;
            }
            if (!isset($data['data']) || !is_array($data['data'])) {
                update_image_job_failed($jobId, upstream_error_message($data, '生图接口没有返回图片数据'));
                exit;
            }
            $normalized = normalize_image_data($data, $payload['output_format'] ?? 'png');
            complete_image_job($jobId, $normalized, $payload, 'generation');
        } catch (Throwable $error) {
            update_image_job_failed($jobId, $error->getMessage());
        }
        exit;
    }

    if ($method === 'POST' && $route === '/images/edits') {
        require_database();
        $apiKey = effective_api_key();
        if ($apiKey === '') json_response(['error' => '服务端未配置 OPENAI_API_KEY，且当前用户未保存 API Key'], 500);
        $postBody = $_POST;
        if (trim((string) ($postBody['prompt'] ?? '')) === '') json_response(['error' => '提示词不能为空'], 400);
        $editImages = uploaded_edit_images();
        if (!$editImages) json_response(['error' => '请上传参考图'], 400);
        $maskFile = uploaded_mask_file();

        $payload = edit_payload($postBody);
        $jobId = create_pending_image_job($payload, 'edit');
        respond_json_and_continue(['job' => ['id' => $jobId, 'jobId' => $jobId, 'status' => 'running', 'mode' => 'edit']], 202);

        try {
            $parts = [];
            foreach ($payload as $key => $value) {
                if ($value !== null && $value !== '') $parts[] = ['name' => $key, 'value' => (string) $value];
            }
            foreach ($editImages as $imageFile) {
                $parts[] = [
                    'name' => 'image[]',
                    'file' => $imageFile['tmp_name'],
                    'type' => $imageFile['type'] ?: 'image/png',
                    'filename' => $imageFile['name'] ?: 'image.png',
                ];
            }
            if ($maskFile) {
                $parts[] = [
                    'name' => 'mask',
                    'file' => $maskFile['tmp_name'],
                    'type' => $maskFile['type'] ?: 'image/png',
                    'filename' => $maskFile['name'] ?: 'mask.png',
                ];
            }
            [$multipartBody, $multipartHeader] = build_multipart_body($parts);
            $endpoint = upstream_url('/v1/images/edits');
            [$status, $text] = curl_multipart($endpoint, ['Authorization: Bearer ' . $apiKey, $multipartHeader], $multipartBody);
            $data = parse_json_text($text);
            append_image_request_log([
                'type' => 'edit',
                'endpoint' => $endpoint,
                'jobId' => $jobId,
                'request' => $payload,
                'files' => image_request_log_files(array_merge($editImages, $maskFile ? [$maskFile] : [])),
                'responseStatus' => $status,
                'response' => $data,
                'error' => ($status >= 200 && $status < 300) ? '' : upstream_error_message($data, '图生图接口请求失败'),
            ]);
            if ($status < 200 || $status >= 300) {
                $errorPayload = upstream_error_payload($data, '图生图接口请求失败', $status);
                update_image_job_failed($jobId, (string) ($errorPayload['error'] ?? '图生图接口请求失败'));
                exit;
            }
            if (!isset($data['data']) || !is_array($data['data'])) {
                update_image_job_failed($jobId, upstream_error_message($data, '图生图接口没有返回图片数据'));
                exit;
            }
            $normalized = normalize_image_data($data, $payload['output_format'] ?? 'png');
            complete_image_job($jobId, $normalized, $payload, 'edit');
        } catch (Throwable $error) {
            update_image_job_failed($jobId, $error->getMessage());
        }
        exit;
    }

    json_response(['error' => '接口不存在', 'route' => $route], 404);
} catch (Throwable $error) {
    json_response(['error' => '服务端异常', 'detail' => $error->getMessage()], 500);
}