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
define('DEFAULT_PROMPT_API_NAME', '提示词助手 API');
define('DEFAULT_AGNES_API_NAME', 'Agnes API');
define('DEFAULT_API_BASE_URL', 'https://api.openai.com');
define('DEFAULT_AGNES_API_BASE_URL', 'https://apihub.agnes-ai.com');
define('DEFAULT_IMAGE_MODEL', 'gpt-image-2');
define('DEFAULT_AGNES_IMAGE_MODEL', 'agnes-image-2.1-flash');
define('MAX_IMAGE_UPLOAD_BYTES', 20 * 1024 * 1024);
define('MAX_PROXY_UPLOAD_BYTES', 80 * 1024 * 1024);
define('MAX_PROXY_RESPONSE_BYTES', 120 * 1024 * 1024);
define('REFERENCE_IMAGE_MAX_AGE_SECONDS', 6 * 60 * 60);
define('MAX_OUTPUT_IMAGES', 10);
define('OUTBOUND_MAX_RESPONSE_BYTES', 25 * 1024 * 1024);
define('MIN_SECRET_LENGTH', 32);
define('SCHEMA_VERSION', '2026-07-01a');
define('SHARED_API_CONFIG_ID', 'shared');

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
$configLoadError = '';
try {
    $loadedConfig = $configPath ? require $configPath : [];
    if (!is_array($loadedConfig)) throw new RuntimeException('PHP API 配置必须返回数组');
    $config = $loadedConfig;
} catch (Throwable $error) {
    $config = [];
    $configLoadError = $error->getMessage() ?: 'PHP API 配置加载失败';
    error_log('[gpt_biubiubiu] config: ' . $configLoadError);
}

$state = [
    'schemaReady' => false,
    'pdo' => null,
    'configLoadError' => $configLoadError,
];

function cfg(string $key, $fallback = null)
{
    global $config, $state;
    if (!empty($state['configLoadError'])) throw new RuntimeException('服务端配置错误：' . $state['configLoadError']);
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
    if (!is_array($decoded) || json_last_error() !== JSON_ERROR_NONE) json_response(['error' => '请求 JSON 无法解析'], 400);
    return $decoded;
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
    $host = (string) ($parts['host'] ?? '');
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') return false;
    $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    return in_array($port, cfg('allowed_outbound_ports', [80, 443]), true);
}

function normalize_api_base_url(string $value): string
{
    return rtrim(preg_replace('/\s+/', '', $value), '/');
}

function outbound_resolved_ips(string $host): array
{
    $records = @dns_get_record($host, DNS_A + DNS_AAAA);
    if (!$records) {
        $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : '';
        $records = $ip ? [['ip' => $ip]] : [];
    }

    $ips = [];
    foreach ($records as $record) {
        $ip = (string) ($record['ip'] ?? ($record['ipv6'] ?? ''));
        if ($ip === '') continue;
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return [];
        $ips[] = $ip;
    }

    return array_values(array_unique($ips));
}

function outbound_url_parts(string $url): array
{
    $parts = parse_url($url);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = (string) ($parts['host'] ?? '');
    $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') json_response(['error' => '外部请求地址不允许访问'], 400);
    if (!in_array($port, cfg('allowed_outbound_ports', [80, 443]), true)) json_response(['error' => '外部请求端口不允许访问'], 400);

    $ips = outbound_resolved_ips($host);
    if (!$ips) json_response(['error' => '外部请求目标不允许访问'], 400);

    return [$parts, $scheme, $host, $port, $ips[0]];
}

function outbound_url_via_resolved_ip(string $url): array
{
    [$parts, $scheme, $host, $port, $ip] = outbound_url_parts($url);
    $path = (string) ($parts['path'] ?? '/');
    $query = isset($parts['query']) ? '?' . (string) $parts['query'] : '';
    $targetHost = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) ? '[' . $ip . ']' : $ip;
    return [
        'url' => $scheme . '://' . $targetHost . ':' . $port . ($path === '' ? '/' : $path) . $query,
        'host' => $host,
        'scheme' => $scheme,
    ];
}

function read_limited_stream(string $url, $context, int $maxBytes, ?array &$responseHeaders = null)
{
    $stream = @fopen($url, 'rb', false, $context);
    if (!$stream) {
        $responseHeaders = $http_response_header ?? [];
        return false;
    }

    $meta = stream_get_meta_data($stream);
    $responseHeaders = is_array($meta['wrapper_data'] ?? null) ? $meta['wrapper_data'] : ($http_response_header ?? []);

    $data = '';
    while (!feof($stream) && strlen($data) <= $maxBytes) {
        $chunk = fread($stream, min(8192, $maxBytes + 1 - strlen($data)));
        if ($chunk === false) {
            fclose($stream);
            return false;
        }
        $data .= $chunk;
    }

    $meta = stream_get_meta_data($stream);
    if (is_array($meta['wrapper_data'] ?? null)) $responseHeaders = $meta['wrapper_data'];
    fclose($stream);

    if (strlen($data) > $maxBytes) json_response(['error' => '外部响应内容过大'], 413);
    return $data;
}

function outbound_context_headers(array $headers, string $host): string
{
    $safeHeaders = [];
    foreach ($headers as $header) {
        $header = trim(str_replace(["\r", "\n"], '', (string) $header));
        if ($header !== '') $safeHeaders[] = $header;
    }
    array_unshift($safeHeaders, 'Host: ' . str_replace(["\r", "\n"], '', $host));
    return implode("\r\n", $safeHeaders) . "\r\n";
}

function outbound_http_request(string $method, string $url, array $headers = [], string $content = '', int $timeout = DEFAULT_REQUEST_TIMEOUT, int $maxBytes = OUTBOUND_MAX_RESPONSE_BYTES): array
{
    $target = outbound_url_via_resolved_ip($url);
    $options = [
        'http' => [
            'method' => strtoupper($method),
            'timeout' => normalize_request_timeout($timeout),
            'follow_location' => 0,
            'max_redirects' => 0,
            'ignore_errors' => true,
            'header' => outbound_context_headers($headers, $target['host']),
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => $target['host'],
            'SNI_enabled' => true,
            'SNI_server_name' => $target['host'],
        ],
    ];
    if ($content !== '') $options['http']['content'] = $content;

    $context = stream_context_create($options);
    $responseHeaders = [];
    $responseText = read_limited_stream($target['url'], $context, $maxBytes, $responseHeaders);
    $status = 0;
    foreach ($responseHeaders as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $matches)) {
            $status = (int) $matches[1];
            break;
        }
    }

    if ($status >= 300 && $status < 400) json_response(['error' => '外部请求重定向已被拒绝'], 400);
    return ['body' => $responseText === false ? '' : $responseText, 'status' => $status, 'headers' => $responseHeaders];
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