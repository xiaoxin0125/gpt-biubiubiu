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
        'shared_api_enabled' => 0,
        'shared_api_name' => DEFAULT_API_NAME,
        'shared_api_base_url' => DEFAULT_API_BASE_URL,
        'shared_model' => DEFAULT_IMAGE_MODEL,
        'shared_request_timeout' => DEFAULT_REQUEST_TIMEOUT,
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

function public_site_flags(): array
{
    $row = site_settings_row();
    return [
        'wallRequireLogin' => !empty($row['wall_require_login']),
        'registrationEnabled' => !empty($row['registration_enabled']),
        'sharedApiEnabled' => !empty($row['shared_api_enabled']),
    ];
}

function shared_api_config_client(?array $row = null): array
{
    $row = $row ?? site_settings_row();
    return [
        'id' => SHARED_API_CONFIG_ID,
        'apiName' => trim((string) ($row['shared_api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($row['shared_api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($row['shared_model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => (int) ($row['shared_request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'hasApiKey' => !empty($row['shared_api_key_ciphertext']),
        'apiKeyHint' => (string) ($row['shared_api_key_hint'] ?? ''),
        'sortOrder' => -1,
        'isShared' => true,
    ];
}

function shared_api_key_fields(?array $row = null): array
{
    $row = $row ?? site_settings_row();
    return [
        'api_key_ciphertext' => $row['shared_api_key_ciphertext'] ?? null,
        'api_key_iv' => $row['shared_api_key_iv'] ?? null,
        'api_key_tag' => $row['shared_api_key_tag'] ?? null,
    ];
}

function decrypt_shared_api_key(?array $row = null): string
{
    $fields = shared_api_key_fields($row);
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
        'sharedApi' => shared_api_config_client($row),
    ];
}

function save_site_settings(array $body): array
{
    $db = pdo();
    site_settings_row();

    $wallRequireLogin = !empty($body['wallRequireLogin']) ? 1 : 0;
    $registrationEnabled = !empty($body['registrationEnabled']) ? 1 : 0;
    $sharedApiEnabled = !empty($body['sharedApiEnabled']) ? 1 : 0;

    $shared = is_array($body['sharedApi'] ?? null) ? $body['sharedApi'] : [];
    $apiName = trim((string) ($shared['apiName'] ?? '')) ?: DEFAULT_API_NAME;
    $apiBaseUrl = normalize_api_base_url((string) ($shared['apiBaseUrl'] ?? ''));
    if ($apiBaseUrl === '') $apiBaseUrl = DEFAULT_API_BASE_URL;
    if (!valid_api_base_url($apiBaseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);
    $model = trim((string) ($shared['model'] ?? '')) ?: DEFAULT_IMAGE_MODEL;
    $requestTimeout = normalize_request_timeout($shared['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT);

    $apiKey = trim((string) ($shared['apiKey'] ?? ''));
    $clearApiKey = !empty($shared['clearApiKey']);
    if ($apiKey !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);

    if ($clearApiKey) {
        $keyClause = ', shared_api_key_ciphertext = NULL, shared_api_key_iv = NULL, shared_api_key_tag = NULL, shared_api_key_hint = NULL';
        $keyParams = [];
    } elseif ($apiKey !== '') {
        $encrypted = encrypt_api_key($apiKey);
        $keyClause = ', shared_api_key_ciphertext = ?, shared_api_key_iv = ?, shared_api_key_tag = ?, shared_api_key_hint = ?';
        $keyParams = [
            $encrypted['api_key_ciphertext'],
            $encrypted['api_key_iv'],
            $encrypted['api_key_tag'],
            $encrypted['api_key_hint'],
        ];
    } else {
        $keyClause = '';
        $keyParams = [];
    }

    $sql = 'UPDATE site_settings SET wall_require_login = ?, registration_enabled = ?, shared_api_enabled = ?, shared_api_name = ?, shared_api_base_url = ?, shared_model = ?, shared_request_timeout = ?' . $keyClause . ' WHERE id = 1';
    $params = array_merge([$wallRequireLogin, $registrationEnabled, $sharedApiEnabled, $apiName, $apiBaseUrl, $model, $requestTimeout], $keyParams);
    $db->prepare($sql)->execute($params);

    return admin_site_settings_view();
}