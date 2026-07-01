<?php

declare(strict_types=1);

function shared_agnes_proxy_config(): array
{
    if (!shared_agnes_api_enabled()) json_response(['error' => '共享 Agnes API 配置未启用'], 403);

    $row = site_settings_row();
    $client = shared_api_category_client($row, 'agnes');
    $apiKey = decrypt_shared_api_key($row, 'agnes');
    if ($apiKey === '') json_response(['error' => '共享 Agnes API 缺少 API Key'], 400);
    if (trim((string) ($client['model'] ?? '')) === '') json_response(['error' => '共享 Agnes API 缺少模型'], 400);

    return $client + ['apiKey' => $apiKey];
}

function agnes_proxy_endpoint_url(string $apiBaseUrl, string $endpointPath, array $query = []): string
{
    $baseUrl = normalize_api_base_url($apiBaseUrl ?: DEFAULT_AGNES_API_BASE_URL);
    if (!valid_api_base_url($baseUrl)) json_response(['error' => 'Agnes API 地址必须是 http 或 https 地址'], 400);

    $parts = parse_url($baseUrl);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) json_response(['error' => 'Agnes API 地址必须是 http 或 https 地址'], 400);

    $endpointPath = '/' . ltrim($endpointPath, '/');
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    if ($path === '') {
        $path = $endpointPath;
    } elseif (substr($path, -3) === '/v1' && substr($endpointPath, 0, 4) === '/v1') {
        $path .= substr($endpointPath, 3);
    } elseif (substr($path, -3) === '/v1' && substr($endpointPath, 0, 4) !== '/v1') {
        $path = substr($path, 0, -3) . $endpointPath;
    } elseif (substr($path, -strlen($endpointPath)) !== $endpointPath) {
        $path .= $endpointPath;
    }

    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $queryString = $query ? '?' . http_build_query($query) : '';
    return strtolower((string) $parts['scheme']) . '://' . strtolower((string) $parts['host']) . $port . $path . $queryString;
}

function agnes_proxy_parse_json_response(array $response): array
{
    $responseText = (string) ($response['body'] ?? '');
    if ($responseText === '') throw new RuntimeException('Agnes 上游接口请求失败，请检查共享 API 地址、密钥或模型。');

    $data = json_decode($responseText, true);
    if (!is_array($data)) throw new RuntimeException('Agnes 上游接口返回了无法解析的数据。');

    $status = (int) ($response['status'] ?? 0);
    if ($status >= 400) {
        $message = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? 'Agnes 上游接口请求失败。';
        throw new RuntimeException(is_string($message) ? $message : 'Agnes 上游接口请求失败。');
    }

    return $data;
}

function normalize_agnes_proxy_path(string $path): string
{
    $path = '/' . ltrim(trim($path), '/');
    return in_array($path, ['/v1/images/generations', '/v1/videos'], true) ? $path : '';
}

function handle_shared_agnes_proxy(array $user, array $body): array
{
    $config = shared_agnes_proxy_config();
    $path = normalize_agnes_proxy_path((string) ($body['path'] ?? ''));
    if ($path === '') json_response(['error' => 'Agnes 代理路径不允许访问'], 400);

    $payload = is_array($body['payload'] ?? null) ? $body['payload'] : [];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('Agnes 请求参数序列化失败');

    $response = outbound_http_request('POST', agnes_proxy_endpoint_url((string) $config['apiBaseUrl'], $path), [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $config['apiKey'],
    ], $json, (int) $config['requestTimeout'], MAX_PROXY_RESPONSE_BYTES);

    return agnes_proxy_parse_json_response($response);
}

function handle_shared_agnes_result(array $user): array
{
    $config = shared_agnes_proxy_config();
    $videoId = trim((string) ($_GET['video_id'] ?? ''));
    if ($videoId === '' || !preg_match('/^[a-zA-Z0-9_.:-]{1,160}$/', $videoId)) json_response(['error' => '缺少有效 video_id'], 400);

    $modelName = trim((string) ($_GET['model_name'] ?? 'agnes-video-v2.0'));
    if ($modelName === '') $modelName = 'agnes-video-v2.0';

    $response = outbound_http_request('GET', agnes_proxy_endpoint_url((string) $config['apiBaseUrl'], '/agnesapi', [
        'video_id' => $videoId,
        'model_name' => $modelName,
    ]), [
        'Accept: application/json',
        'Authorization: Bearer ' . $config['apiKey'],
    ], '', (int) $config['requestTimeout'], MAX_PROXY_RESPONSE_BYTES);

    return agnes_proxy_parse_json_response($response);
}