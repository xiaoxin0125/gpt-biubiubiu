<?php

declare(strict_types=1);

function image_proxy_endpoint_url(string $apiBaseUrl, string $endpointPath): string
{
    $baseUrl = normalize_api_base_url($apiBaseUrl ?: DEFAULT_API_BASE_URL);
    if (!valid_api_base_url($baseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);

    $parts = parse_url($baseUrl);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);

    $endpointPath = '/' . ltrim($endpointPath, '/');
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    if ($path === '') {
        $path = $endpointPath;
    } elseif (substr($path, -3) === '/v1') {
        $path .= substr($endpointPath, 3);
    } elseif (substr($path, -strlen($endpointPath)) !== $endpointPath) {
        $path .= $endpointPath;
    }

    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    return strtolower((string) $parts['scheme']) . '://' . strtolower((string) $parts['host']) . $port . $path;
}

function shared_image_proxy_config(): array
{
    if (!shared_api_enabled()) json_response(['error' => '共享 API 配置未启用'], 403);

    $row = site_settings_row();
    $client = shared_api_category_client($row, 'image');
    $apiKey = decrypt_shared_api_key($row, 'image');
    if ($apiKey === '') json_response(['error' => '共享生图 API 缺少 API Key'], 400);
    if (trim((string) ($client['model'] ?? '')) === '') json_response(['error' => '共享生图 API 缺少模型'], 400);

    return $client + ['apiKey' => $apiKey];
}

function image_proxy_payload_value(array $payload, string $key, $fallback = null)
{
    return array_key_exists($key, $payload) ? $payload[$key] : $fallback;
}

function normalize_proxy_response_format($value): string
{
    return in_array($value, ['url', 'b64_json'], true) ? $value : 'url';
}

function normalize_proxy_output_format($value): string
{
    return in_array($value, ['png', 'jpeg', 'webp'], true) ? $value : 'png';
}

function normalize_proxy_quality($value): string
{
    return in_array($value, ['auto', 'low', 'medium', 'high'], true) ? $value : 'auto';
}

function normalize_proxy_background($value): string
{
    return in_array($value, ['auto', 'opaque'], true) ? $value : 'auto';
}

function normalize_proxy_moderation($value): string
{
    return in_array($value, ['auto', 'low'], true) ? $value : 'auto';
}

function shared_image_generation_payload(array $body, array $config): array
{
    $source = is_array($body['payload'] ?? null) ? $body['payload'] : $body;
    $prompt = trim((string) image_proxy_payload_value($source, 'prompt', ''));
    if ($prompt === '') json_response(['error' => '请输入提示词'], 400);

    $payload = [
        'model' => $config['model'],
        'prompt' => $prompt,
        'n' => max(1, min(MAX_OUTPUT_IMAGES, (int) image_proxy_payload_value($source, 'n', 1))),
        'response_format' => normalize_proxy_response_format(image_proxy_payload_value($source, 'response_format', 'url')),
        'moderation' => normalize_proxy_moderation(image_proxy_payload_value($source, 'moderation', 'auto')),
        'stream' => false,
    ];

    if ($payload['response_format'] === 'url') $payload['output_format'] = normalize_proxy_output_format(image_proxy_payload_value($source, 'output_format', 'png'));

    $size = trim((string) image_proxy_payload_value($source, 'size', ''));
    if ($size !== '') $payload['size'] = $size;

    $quality = normalize_proxy_quality(image_proxy_payload_value($source, 'quality', 'auto'));
    if ($quality !== 'auto') $payload['quality'] = $quality;

    $background = normalize_proxy_background(image_proxy_payload_value($source, 'background', 'auto'));
    if ($background !== 'auto') $payload['background'] = $background;

    return $payload;
}

function shared_image_edit_fields(array $config): array
{
    $prompt = trim((string) ($_POST['prompt'] ?? ''));
    if ($prompt === '') json_response(['error' => '请输入提示词'], 400);

    $fields = [
        'model' => (string) $config['model'],
        'prompt' => $prompt,
        'n' => (string) max(1, min(MAX_OUTPUT_IMAGES, (int) ($_POST['n'] ?? 1))),
        'response_format' => normalize_proxy_response_format((string) ($_POST['response_format'] ?? 'url')),
        'moderation' => normalize_proxy_moderation((string) ($_POST['moderation'] ?? 'auto')),
    ];

    if ($fields['response_format'] === 'url') $fields['output_format'] = normalize_proxy_output_format((string) ($_POST['output_format'] ?? 'png'));

    $size = trim((string) ($_POST['size'] ?? ''));
    if ($size !== '') $fields['size'] = $size;

    $quality = normalize_proxy_quality((string) ($_POST['quality'] ?? 'auto'));
    if ($quality !== 'auto') $fields['quality'] = $quality;

    $background = normalize_proxy_background((string) ($_POST['background'] ?? 'auto'));
    if ($background !== 'auto') $fields['background'] = $background;

    return $fields;
}

function uploaded_file_items(string $key): array
{
    $file = $_FILES[$key] ?? null;
    if (!is_array($file)) return [];

    if (is_array($file['name'] ?? null)) {
        $items = [];
        foreach ($file['name'] as $index => $name) {
            $items[] = [
                'name' => $name,
                'type' => $file['type'][$index] ?? '',
                'tmp_name' => $file['tmp_name'][$index] ?? '',
                'error' => $file['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                'size' => $file['size'][$index] ?? 0,
            ];
        }
        return $items;
    }

    return [$file];
}

function safe_upload_filename(string $name, string $fallback): string
{
    $name = preg_replace('/[^a-zA-Z0-9_.-]/', '-', basename($name));
    return trim((string) $name, '.-') ?: $fallback;
}

function shared_image_edit_files(): array
{
    $uploads = [];
    $totalBytes = 0;

    foreach (uploaded_file_items('image') as $index => $file) {
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
        $bytes = @file_get_contents((string) ($file['tmp_name'] ?? ''));
        if ($bytes === false || $bytes === '') json_response(['error' => '参考图读取失败'], 400);
        $mime = validate_image_binary($bytes, (string) ($file['type'] ?? 'image/png'));
        $totalBytes += strlen($bytes);
        $uploads[] = ['field' => 'image[]', 'name' => safe_upload_filename((string) ($file['name'] ?? ''), 'reference-image'), 'mime' => $mime, 'bytes' => $bytes];
    }

    if (!$uploads) json_response(['error' => '请至少上传一张参考图'], 400);

    foreach (uploaded_file_items('mask') as $file) {
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
        $bytes = @file_get_contents((string) ($file['tmp_name'] ?? ''));
        if ($bytes === false || $bytes === '') json_response(['error' => 'Mask 读取失败'], 400);
        $mime = validate_image_binary($bytes, (string) ($file['type'] ?? 'image/png'));
        if ($mime !== 'image/png') json_response(['error' => 'mask 必须是 PNG 图片'], 400);
        $totalBytes += strlen($bytes);
        $uploads[] = ['field' => 'mask', 'name' => safe_upload_filename((string) ($file['name'] ?? ''), 'mask.png'), 'mime' => $mime, 'bytes' => $bytes];
        break;
    }

    if ($totalBytes > MAX_PROXY_UPLOAD_BYTES) json_response(['error' => '参考图总大小不能超过 80MB'], 413);
    return $uploads;
}

function multipart_body(array $fields, array $files): array
{
    $boundary = '----gptbiubiubiu' . bin2hex(random_bytes(12));
    $body = '';

    foreach ($fields as $name => $value) {
        $body .= "--{$boundary}\r\n";
        $body .= 'Content-Disposition: form-data; name="' . addcslashes((string) $name, "\"\\") . "\"\r\n\r\n";
        $body .= (string) $value . "\r\n";
    }

    foreach ($files as $file) {
        $body .= "--{$boundary}\r\n";
        $body .= 'Content-Disposition: form-data; name="' . addcslashes((string) $file['field'], "\"\\") . '"; filename="' . addcslashes((string) $file['name'], "\"\\") . "\"\r\n";
        $body .= 'Content-Type: ' . (string) $file['mime'] . "\r\n\r\n";
        $body .= $file['bytes'] . "\r\n";
    }

    $body .= "--{$boundary}--\r\n";
    return [$body, $boundary];
}

function image_proxy_parse_json_response(array $response): array
{
    $responseText = (string) ($response['body'] ?? '');
    if ($responseText === '') throw new RuntimeException('上游接口请求失败，请检查共享 API 地址、密钥或模型。');

    $data = json_decode($responseText, true);
    if (!is_array($data)) throw new RuntimeException('上游接口返回了无法解析的数据。');

    $status = (int) ($response['status'] ?? 0);
    if ($status >= 400) {
        $message = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? '上游接口请求失败。';
        throw new RuntimeException(is_string($message) ? $message : '上游接口请求失败。');
    }

    return $data;
}

function handle_shared_image_generation(array $user, array $body): array
{
    $config = shared_image_proxy_config();
    $payload = shared_image_generation_payload($body, $config);
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('请求参数序列化失败');

    $response = outbound_http_request('POST', image_proxy_endpoint_url((string) $config['apiBaseUrl'], '/v1/images/generations'), [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $config['apiKey'],
    ], $json, (int) $config['requestTimeout'], MAX_PROXY_RESPONSE_BYTES);

    return image_proxy_parse_json_response($response);
}

function handle_shared_image_edit(array $user): array
{
    $config = shared_image_proxy_config();
    [$body, $boundary] = multipart_body(shared_image_edit_fields($config), shared_image_edit_files());

    $response = outbound_http_request('POST', image_proxy_endpoint_url((string) $config['apiBaseUrl'], '/v1/images/edits'), [
        'Content-Type: multipart/form-data; boundary=' . $boundary,
        'Accept: application/json',
        'Authorization: Bearer ' . $config['apiKey'],
    ], $body, (int) $config['requestTimeout'], MAX_PROXY_RESPONSE_BYTES);

    return image_proxy_parse_json_response($response);
}