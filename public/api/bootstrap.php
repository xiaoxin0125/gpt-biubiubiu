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