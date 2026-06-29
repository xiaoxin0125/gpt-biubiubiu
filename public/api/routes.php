<?php

declare(strict_types=1);

function handle_health(): array
{
    $configured = false;
    $mysqlConfigured = false;
    $apiName = DEFAULT_API_NAME;

    try {
        ensure_schema();
        $mysqlConfigured = true;
        $siteFlags = public_site_flags();
        $userId = session_user_id();
        $settings = $userId ? stored_user_settings_row((int) $userId) : null;
        $active = $userId ? active_api_config_row((int) $userId) : null;
        $apiName = trim((string) ($active['api_name'] ?? ($settings['api_name'] ?? ''))) ?: $apiName;
        $configured = $userId ? stored_user_api_key() !== '' : false;
    } catch (Throwable $error) {
        $configured = false;
        $mysqlConfigured = false;
    }

    return [
        'ok' => true,
        'configured' => $configured,
        'mysqlConfigured' => $mysqlConfigured,
        'apiName' => $apiName,
        'baseUrl' => rtrim((string) cfg('openai_base_url', DEFAULT_API_BASE_URL), '/'),
        'defaultImageModel' => cfg('openai_image_model', DEFAULT_IMAGE_MODEL),
        'site' => $siteFlags ?? null,
    ];
}

function api_exact_routes(): array
{
    return [
        ['GET', '/health', function (): array {
            return handle_health();
        }],
        ['GET', '/install/status', function (): array {
            return handle_install_status();
        }],
        ['POST', '/install', function (array $body): array {
            return handle_install_save($body);
        }],
        ['GET', '/auth/captcha', function (): array {
            return handle_auth_captcha();
        }],
        ['GET', '/auth/me', function (): array {
            return handle_auth_me();
        }],
        ['POST', '/auth/register', function (array $body): array {
            return handle_auth_register($body);
        }],
        ['POST', '/auth/login', function (array $body): array {
            return handle_auth_login($body);
        }],
        ['POST', '/auth/profile', function (array $body): array {
            return handle_auth_profile($body);
        }],
        ['POST', '/auth/password', function (array $body): array {
            return handle_auth_password($body);
        }],
        ['POST', '/auth/logout', function (): array {
            return handle_auth_logout();
        }],
        ['GET', '/settings', function (): array {
            $user = require_user();
            return ['settings' => settings_for_user((int) $user['id'])];
        }],
        ['GET', '/settings/direct', function (): array {
            $user = require_user();
            return [
                'settings' => settings_for_user((int) $user['id']),
                'apiKey' => stored_user_own_api_key(),
            ];
        }],
        ['POST', '/settings', function (array $body): array {
            $user = require_user();
            return ['settings' => save_user_settings($user, $body)];
        }],
        ['POST', '/settings/active-api', function (array $body): array {
            $user = require_user();
            return ['settings' => switch_active_api_config($user, $body)];
        }],
        ['POST', '/settings/models', function (array $body): array {
            $user = require_user();
            return fetch_api_models_for_user($user, $body);
        }],
        ['POST', '/images/generations', function (array $body): array {
            return handle_shared_image_generation(require_user(), $body);
        }],
        ['POST', '/images/edits', function (): array {
            return handle_shared_image_edit(require_user());
        }],
        ['POST', '/prompt-tools/optimize', function (array $body): array {
            return handle_prompt_optimize($body);
        }],
        ['POST', '/prompt-tools/caption', function (array $body): array {
            return handle_prompt_caption($body);
        }],
        ['GET', '/admin/site-settings', function (): array {
            require_admin();
            return ['site' => admin_site_settings_view()];
        }],
        ['POST', '/admin/site-settings', function (array $body): array {
            require_admin();
            return ['site' => save_site_settings($body)];
        }],
        ['GET', '/generated-images', function (): array {
            return handle_generated_images(require_user());
        }],
        ['POST', '/generated-images', function (array $body): array {
            return handle_save_generated_image(require_user(), $body);
        }],
        ['DELETE', '/generated-images', function (): array {
            return handle_clear_generated_images(require_user());
        }],
        ['GET', '/wall/mine', function (): array {
            return handle_wall_mine(require_user());
        }],
        ['GET', '/wall', function (): array {
            return handle_wall_list();
        }],
        ['POST', '/wall', function (array $body): array {
            return handle_create_wall_item(require_user(), $body);
        }],
    ];
}

function api_pattern_routes(): array
{
    return [
        ['DELETE', '#^/generated-images/(\d+)$#', function (array $body, array $matches): array {
            return handle_delete_generated_image(require_user(), (int) $matches[1]);
        }],
        ['GET', '#^/wall/(\d+)$#', function (array $body, array $matches): array {
            return handle_wall_detail((int) $matches[1]);
        }],
        ['DELETE', '#^/wall/(\d+)$#', function (array $body, array $matches): array {
            return handle_delete_wall_item(require_user(), (int) $matches[1]);
        }],
    ];
}

function dispatch_route(string $method, string $route, array $body): array
{
    foreach (api_exact_routes() as [$routeMethod, $routePath, $handler]) {
        if ($method === $routeMethod && $route === $routePath) {
            return $handler($body, []);
        }
    }

    foreach (api_pattern_routes() as [$routeMethod, $pattern, $handler]) {
        if ($method === $routeMethod && preg_match($pattern, $route, $matches)) {
            return $handler($body, $matches);
        }
    }

    json_response(['error' => '接口不存在', 'route' => $route], 404);
    return [];
}