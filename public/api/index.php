<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib/database.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/settings.php';
require_once __DIR__ . '/lib/site.php';
require_once __DIR__ . '/lib/files.php';
require_once __DIR__ . '/lib/image_proxy.php';
require_once __DIR__ . '/lib/prompt_tools.php';
require_once __DIR__ . '/lib/generated_images.php';
require_once __DIR__ . '/lib/wall.php';
require_once __DIR__ . '/lib/install.php';
require_once __DIR__ . '/routes.php';

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    enforce_write_request_origin($method);
    $route = route_path();
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ($_SERVER['HTTP_CONTENT_TYPE'] ?? '')));
    $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) && (strpos($contentType, 'application/json') !== false || $contentType === '') ? read_json_body() : [];

    json_response(dispatch_route($method, $route, $body));
} catch (Throwable $error) {
    $status = $error instanceof RuntimeException ? 502 : 500;
    error_log('[gpt_biubiubiu] ' . $error->getMessage());
    json_response([
        'error' => $error instanceof RuntimeException ? ($error->getMessage() ?: '上游服务异常') : '服务端异常',
    ], $status);
}