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
define('DEFAULT_API_NAME', 'OpenAI gpt-image-2');
define('DEFAULT_API_BASE_URL', 'https://api.openai.com');
define('DEFAULT_IMAGE_MODEL', 'gpt-image-2');
define('MAX_IMAGE_UPLOAD_BYTES', 20 * 1024 * 1024);
define('MIN_SECRET_LENGTH', 32);
define('SCHEMA_VERSION', '2026-06-15b');

define('WEAK_SECRET_VALUES', [
    '',
    'change-this-session-secret',
    'change-this-api-key-secret',
    'replace-with-a-long-random-session-secret',
    'replace-with-a-long-random-api-key-secret',
    'generate-at-least-32-random-characters-before-deploy',
    'generate-another-32-random-characters-before-deploy',
]);

@ini_set('max_execution_time', (string) (MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER));
@ini_set('default_socket_timeout', (string) (MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER));
@set_time_limit(MAX_REQUEST_TIMEOUT + REQUEST_TIMEOUT_BUFFER);
@ignore_user_abort(true);

$configCandidates = [
    dirname(__DIR__, 2) . '/.php-api-config.php',
    dirname(__DIR__, 3) . '/.php-api-config.php',
    dirname(__DIR__) . '/.php-api-config.php',
    __DIR__ . '/.php-api-config.php',
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

function security_secret(string $key): string
{
    $value = trim((string) cfg($key, ''));
    if (strlen($value) < MIN_SECRET_LENGTH || in_array($value, WEAK_SECRET_VALUES, true)) return '';
    return $value;
}

function request_origin_candidates(): array
{
    $hosts = array_filter(array_unique([
        strtolower((string) ($_SERVER['HTTP_HOST'] ?? '')),
        strtolower((string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? '')),
    ]));
    $schemes = [];
    $directScheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $schemes[] = $directScheme;
    $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0] ?? ''));
    if (in_array($forwardedProto, ['http', 'https'], true)) $schemes[] = $forwardedProto;

    $origins = [];
    foreach ($hosts as $host) {
        if ($host === '') continue;
        foreach (array_unique($schemes) as $scheme) {
            $origins[] = $scheme . '://' . $host;
        }
    }

    return array_values(array_unique($origins));
}

function is_same_origin_header(string $header): bool
{
    $value = trim($header);
    if ($value === '') return true;

    $origins = request_origin_candidates();
    if (!$origins) return false;

    $parts = parse_url($value);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) return false;

    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $headerOrigin = strtolower((string) $parts['scheme']) . '://' . strtolower((string) $parts['host']) . $port;
    return in_array($headerOrigin, $origins, true);
}

function enforce_write_request_origin(string $method): void
{
    if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return;

    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $referer = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    if ($origin !== '' && !is_same_origin_header($origin)) json_response(['error' => '跨站请求已被拒绝'], 403);
    if ($origin === '' && $referer !== '' && !is_same_origin_header($referer)) json_response(['error' => '跨站请求已被拒绝'], 403);
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