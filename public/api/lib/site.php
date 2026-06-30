<?php

declare(strict_types=1);

function site_settings_row(): array
{
    $db = pdo();
    $stmt = $db->query('SELECT * FROM site_settings WHERE id = 1 LIMIT 1');
    $row = $stmt->fetch();
    if (!$row) {
        $db->exec('INSERT IGNORE INTO site_settings (id) VALUES (1)');
        $stmt = $db->query('SELECT * FROM site_settings WHERE id = 1 LIMIT 1');
        $row = $stmt->fetch();
    }

    return $row ?: [
        'wall_require_login' => 0,
        'registration_enabled' => 1,
        'shared_api_enabled' => 1,
        'shared_api_name' => DEFAULT_API_NAME,
        'shared_api_base_url' => DEFAULT_API_BASE_URL,
        'shared_model' => DEFAULT_IMAGE_MODEL,
        'shared_request_timeout' => DEFAULT_REQUEST_TIMEOUT,
        'shared_api_key_hint' => '',
        'prompt_tools_enabled' => 1,
        'shared_prompt_api_name' => DEFAULT_PROMPT_API_NAME,
        'shared_prompt_api_base_url' => DEFAULT_API_BASE_URL,
        'shared_prompt_model' => '',
        'shared_prompt_request_timeout' => DEFAULT_REQUEST_TIMEOUT,
        'shared_prompt_api_key_hint' => '',
    ];
}

function require_admin(): array
{
    $user = require_user();
    if (empty($user['isAdmin'])) json_response(['error' => '需要管理员权限'], 403);
    return $user;
}

function wall_requires_login(): bool
{
    try {
        return !empty(site_settings_row()['wall_require_login']);
    } catch (Throwable $error) {
        return false;
    }
}

function registration_enabled(): bool
{
    try {
        return !empty(site_settings_row()['registration_enabled']);
    } catch (Throwable $error) {
        return true;
    }
}

function shared_api_enabled(): bool
{
    try {
        return !empty(site_settings_row()['shared_api_enabled']);
    } catch (Throwable $error) {
        return false;
    }
}

function prompt_tools_enabled(): bool
{
    try {
        return !empty(site_settings_row()['prompt_tools_enabled']);
    } catch (Throwable $error) {
        return true;
    }
}

function public_site_flags(): array
{
    $row = site_settings_row();
    return [
        'wallRequireLogin' => !empty($row['wall_require_login']),
        'registrationEnabled' => !empty($row['registration_enabled']),
        'sharedApiEnabled' => !empty($row['shared_api_enabled']),
        'promptToolsEnabled' => !empty($row['prompt_tools_enabled']),
    ];
}

function shared_api_category_client(array $row, string $category): array
{
    if ($category === 'prompt') {
        return [
            'apiName' => trim((string) ($row['shared_prompt_api_name'] ?? '')) ?: DEFAULT_PROMPT_API_NAME,
            'apiBaseUrl' => trim((string) ($row['shared_prompt_api_base_url'] ?? '')) ?: (trim((string) ($row['shared_api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL),
            'model' => trim((string) ($row['shared_prompt_model'] ?? '')),
            'requestTimeout' => normalize_request_timeout($row['shared_prompt_request_timeout'] ?? ($row['shared_request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT)),
            'hasApiKey' => !empty($row['shared_prompt_api_key_ciphertext']),
            'apiKeyHint' => (string) ($row['shared_prompt_api_key_hint'] ?? ''),
        ];
    }

    return [
        'apiName' => trim((string) ($row['shared_api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($row['shared_api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($row['shared_model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => normalize_request_timeout($row['shared_request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'hasApiKey' => !empty($row['shared_api_key_ciphertext']),
        'apiKeyHint' => (string) ($row['shared_api_key_hint'] ?? ''),
    ];
}

function shared_api_config_client(?array $row = null): array
{
    $row = $row ?? site_settings_row();
    $imageApi = shared_api_category_client($row, 'image');
    $promptApi = shared_api_category_client($row, 'prompt');

    return [
        'id' => SHARED_API_CONFIG_ID,
        'apiScope' => 'all',
        'apiName' => $imageApi['apiName'],
        'apiBaseUrl' => $imageApi['apiBaseUrl'],
        'model' => $imageApi['model'],
        'requestTimeout' => $imageApi['requestTimeout'],
        'hasApiKey' => $imageApi['hasApiKey'],
        'apiKeyHint' => $imageApi['apiKeyHint'],
        'promptModel' => $promptApi['model'],
        'imageApi' => $imageApi,
        'promptApi' => $promptApi,
        'hasAnyApiKey' => $imageApi['hasApiKey'] || $promptApi['hasApiKey'],
        'sortOrder' => -1,
        'isShared' => true,
    ];
}

function shared_api_key_fields(?array $row = null, string $category = 'image'): array
{
    $row = $row ?? site_settings_row();
    $prefix = $category === 'prompt' ? 'shared_prompt_' : 'shared_';
    return [
        'api_key_ciphertext' => $row[$prefix . 'api_key_ciphertext'] ?? null,
        'api_key_iv' => $row[$prefix . 'api_key_iv'] ?? null,
        'api_key_tag' => $row[$prefix . 'api_key_tag'] ?? null,
    ];
}

function decrypt_shared_api_key(?array $row = null, string $category = 'image'): string
{
    $fields = shared_api_key_fields($row, $category);
    $plain = decrypt_api_key_with_secret($fields, api_key_secret());
    if ($plain !== '') return $plain;

    foreach (legacy_api_key_secrets() as $legacySecret) {
        $plain = decrypt_api_key_with_secret($fields, $legacySecret);
        if ($plain !== '') return $plain;
    }

    return '';
}

function admin_site_settings_view(): array
{
    $row = site_settings_row();
    return [
        'wallRequireLogin' => !empty($row['wall_require_login']),
        'registrationEnabled' => !empty($row['registration_enabled']),
        'sharedApiEnabled' => !empty($row['shared_api_enabled']),
        'promptToolsEnabled' => !empty($row['prompt_tools_enabled']),
        'sharedApi' => shared_api_config_client($row),
    ];
}

function shared_api_category_input(array $shared, string $category, array $current): array
{
    return api_category_input_from_spec(
        $shared,
        $category,
        $current,
        normalize_request_timeout($current['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        false
    );
}

function shared_api_key_storage_fields(array $input, array $row, string $category): array
{
    $apiKey = trim((string) ($input['apiKey'] ?? ''));
    if ($apiKey !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);
    $prefix = $category === 'prompt' ? 'shared_prompt_' : 'shared_';
    if (!empty($input['clearApiKey'])) return [null, null, null, null];

    $encrypted = $apiKey !== '' ? encrypt_api_key($apiKey) : [];
    return [
        $encrypted['api_key_ciphertext'] ?? ($row[$prefix . 'api_key_ciphertext'] ?? null),
        $encrypted['api_key_iv'] ?? ($row[$prefix . 'api_key_iv'] ?? null),
        $encrypted['api_key_tag'] ?? ($row[$prefix . 'api_key_tag'] ?? null),
        $encrypted['api_key_hint'] ?? ($row[$prefix . 'api_key_hint'] ?? null),
    ];
}

function save_site_settings(array $body): array
{
    $db = pdo();
    $row = site_settings_row();
    $current = shared_api_config_client($row);

    $wallRequireLogin = !empty($body['wallRequireLogin']) ? 1 : 0;
    $registrationEnabled = !empty($body['registrationEnabled']) ? 1 : 0;
    $sharedApiEnabled = !empty($body['sharedApiEnabled']) ? 1 : 0;
    $promptToolsEnabled = array_key_exists('promptToolsEnabled', $body) ? (!empty($body['promptToolsEnabled']) ? 1 : 0) : 1;

    $shared = is_array($body['sharedApi'] ?? null) ? $body['sharedApi'] : [];
    $imageInput = shared_api_category_input($shared, 'image', $current['imageApi']);
    $promptInput = shared_api_category_input($shared, 'prompt', $current['promptApi']);

    if (!valid_api_base_url($imageInput['apiBaseUrl'])) json_response(['error' => '生图 API 地址必须是 http 或 https 地址'], 400);
    if (!valid_api_base_url($promptInput['apiBaseUrl'])) json_response(['error' => '提示词助手 API 地址必须是 http 或 https 地址'], 400);

    $imageApiFields = shared_api_key_storage_fields($imageInput, $row, 'image');
    $promptApiFields = shared_api_key_storage_fields($promptInput, $row, 'prompt');

    $stmt = $db->prepare('UPDATE site_settings SET wall_require_login = ?, registration_enabled = ?, shared_api_enabled = ?, prompt_tools_enabled = ?, shared_api_name = ?, shared_api_base_url = ?, shared_model = ?, shared_request_timeout = ?, shared_api_key_ciphertext = ?, shared_api_key_iv = ?, shared_api_key_tag = ?, shared_api_key_hint = ?, shared_prompt_api_name = ?, shared_prompt_api_base_url = ?, shared_prompt_model = ?, shared_prompt_request_timeout = ?, shared_prompt_api_key_ciphertext = ?, shared_prompt_api_key_iv = ?, shared_prompt_api_key_tag = ?, shared_prompt_api_key_hint = ? WHERE id = 1');
    $stmt->execute([
        $wallRequireLogin,
        $registrationEnabled,
        $sharedApiEnabled,
        $promptToolsEnabled,
        $imageInput['apiName'],
        $imageInput['apiBaseUrl'],
        $imageInput['model'],
        $imageInput['requestTimeout'],
        $imageApiFields[0],
        $imageApiFields[1],
        $imageApiFields[2],
        $imageApiFields[3],
        $promptInput['apiName'],
        $promptInput['apiBaseUrl'],
        $promptInput['model'],
        $promptInput['requestTimeout'],
        $promptApiFields[0],
        $promptApiFields[1],
        $promptApiFields[2],
        $promptApiFields[3],
    ]);

    return admin_site_settings_view();
}