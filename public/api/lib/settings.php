<?php

declare(strict_types=1);

function api_key_secret(): string
{
    return security_secret('user_api_key_secret');
}

function legacy_api_key_secrets(): array
{
    $configured = cfg('legacy_user_api_key_secrets', []);
    if (!is_array($configured)) $configured = [$configured];

    $current = api_key_secret();
    $secrets = [];
    foreach ($configured as $value) {
        $secret = trim((string) $value);
        if ($secret !== '' && $secret !== $current) $secrets[] = $secret;
    }

    return array_values(array_unique($secrets));
}

function encryption_key(?string $secret = null): string
{
    return hash('sha256', $secret ?? api_key_secret(), true);
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

function decrypt_api_key_with_secret(?array $settings, string $secret): string
{
    if (!$settings || $secret === '' || empty($settings['api_key_ciphertext']) || empty($settings['api_key_iv']) || empty($settings['api_key_tag'])) return '';

    $ciphertext = base64_decode((string) $settings['api_key_ciphertext'], true);
    $iv = base64_decode((string) $settings['api_key_iv'], true);
    $tag = base64_decode((string) $settings['api_key_tag'], true);
    if ($ciphertext === false || $iv === false || $tag === false) return '';

    $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', encryption_key($secret), OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? '' : $plain;
}

function migrate_api_key_encryption(array $settings, string $plain): void
{
    $id = (int) ($settings['id'] ?? 0);
    $userId = (int) ($settings['user_id'] ?? 0);
    if ($id <= 0 || $userId <= 0 || $plain === '' || api_key_secret() === '') return;

    $encrypted = encrypt_api_key($plain);
    $db = pdo();
    $stmt = $db->prepare('UPDATE user_api_configs SET api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, api_key_hint = ? WHERE id = ? AND user_id = ?');
    $stmt->execute([
        $encrypted['api_key_ciphertext'],
        $encrypted['api_key_iv'],
        $encrypted['api_key_tag'],
        $encrypted['api_key_hint'],
        $id,
        $userId,
    ]);

    $stmt = $db->prepare('UPDATE user_settings SET api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, api_key_hint = ? WHERE user_id = ? AND active_api_config_id = ?');
    $stmt->execute([
        $encrypted['api_key_ciphertext'],
        $encrypted['api_key_iv'],
        $encrypted['api_key_tag'],
        $encrypted['api_key_hint'],
        $userId,
        $id,
    ]);
}

function decrypt_api_key(?array $settings): string
{
    $plain = decrypt_api_key_with_secret($settings, api_key_secret());
    if ($plain !== '') return $plain;

    foreach (legacy_api_key_secrets() as $legacySecret) {
        $plain = decrypt_api_key_with_secret($settings, $legacySecret);
        if ($plain !== '') {
            migrate_api_key_encryption($settings ?: [], $plain);
            return $plain;
        }
    }

    return '';
}

function prefixed_api_key_fields(array $row, string $prefix = ''): array
{
    return [
        'api_key_ciphertext' => $row[$prefix . 'api_key_ciphertext'] ?? null,
        'api_key_iv' => $row[$prefix . 'api_key_iv'] ?? null,
        'api_key_tag' => $row[$prefix . 'api_key_tag'] ?? null,
    ];
}

function prefixed_api_key_hint(array $row, string $prefix = ''): string
{
    return (string) ($row[$prefix . 'api_key_hint'] ?? '');
}

function has_prefixed_api_key(array $row, string $prefix = ''): bool
{
    return !empty($row[$prefix . 'api_key_ciphertext']);
}

function normalized_api_scope(array $row): string
{
    $scope = trim((string) ($row['api_scope'] ?? 'all'));
    return in_array($scope, ['all', 'image', 'prompt'], true) ? $scope : 'all';
}

function config_scope_allows_category(array $row, string $category): bool
{
    $scope = normalized_api_scope($row);
    if ($scope === 'all') return true;
    if ($category === 'image') return $scope === 'image';
    return $scope === 'prompt';
}

function category_storage_key(string $category): string
{
    return $category === 'prompt' ? 'prompt' : 'image';
}

function category_key_prefix(string $category): string
{
    $storageKey = category_storage_key($category);
    return $storageKey === 'prompt' ? 'prompt_' : '';
}

function config_has_category_api_key(array $row, string $category): bool
{
    if (!config_scope_allows_category($row, $category)) return false;
    return $category === 'prompt' ? has_prefixed_api_key($row, 'prompt_') : has_prefixed_api_key($row);
}

function config_has_any_api_key(array $row): bool
{
    return config_has_category_api_key($row, 'image') || config_has_category_api_key($row, 'prompt');
}

function decrypt_prefixed_api_key(array $row, string $prefix = ''): string
{
    $fields = prefixed_api_key_fields($row, $prefix);
    $plain = decrypt_api_key_with_secret($fields, api_key_secret());
    if ($plain !== '') return $plain;

    foreach (legacy_api_key_secrets() as $legacySecret) {
        $plain = decrypt_api_key_with_secret($fields, $legacySecret);
        if ($plain !== '') return $plain;
    }

    return '';
}

function api_client_category(array $row, string $category): array
{
    if ($category === 'prompt') {
        return [
            'apiName' => trim((string) ($row['prompt_api_name'] ?? '')) ?: DEFAULT_PROMPT_API_NAME,
            'apiBaseUrl' => trim((string) ($row['prompt_api_base_url'] ?? '')) ?: (trim((string) ($row['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL),
            'model' => trim((string) ($row['prompt_model'] ?? '')),
            'requestTimeout' => normalize_request_timeout($row['prompt_request_timeout'] ?? ($row['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT)),
            'hasApiKey' => has_prefixed_api_key($row, 'prompt_'),
            'apiKeyHint' => prefixed_api_key_hint($row, 'prompt_'),
        ];
    }

    return [
        'apiName' => trim((string) ($row['api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($row['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($row['model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => normalize_request_timeout($row['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'hasApiKey' => has_prefixed_api_key($row),
        'apiKeyHint' => prefixed_api_key_hint($row),
    ];
}

function api_client_with_model_fields(array $client): array
{
    return $client + [
        'promptModel' => $client['promptApi']['model'] ?? '',
    ];
}

function stored_user_settings_row(int $userId): ?array
{
    $stmt = pdo()->prepare('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $settings = $stmt->fetch();
    return $settings ?: null;
}

function ensure_user_settings_row(int $userId): array
{
    $settings = stored_user_settings_row($userId);
    if ($settings) return $settings;

    $active = ensure_user_api_config($userId);
    if (!$active) throw new RuntimeException('当前 API 配置不存在');

    upsert_user_settings_from_config(
        $userId,
        $active,
        (int) $active['id'],
        0,
        true,
        normalize_request_timeout($active['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT)
    );

    $settings = stored_user_settings_row($userId);
    if (!$settings) throw new RuntimeException('账号设置初始化失败');
    return $settings;
}

function config_from_row(array $row): array
{
    $imageApi = api_client_category($row, 'image');
    return api_client_with_model_fields([
        'id' => (int) $row['id'],
        'apiScope' => normalized_api_scope($row),
        'apiName' => $imageApi['apiName'],
        'apiBaseUrl' => $imageApi['apiBaseUrl'],
        'model' => $imageApi['model'],
        'requestTimeout' => $imageApi['requestTimeout'],
        'hasApiKey' => $imageApi['hasApiKey'],
        'apiKeyHint' => $imageApi['apiKeyHint'],
        'imageApi' => $imageApi,
        'promptApi' => api_client_category($row, 'prompt'),
        'hasAnyApiKey' => config_has_any_api_key($row),
        'sortOrder' => (int) ($row['sort_order'] ?? 0),
    ]);
}

function legacy_settings_config(array $settings): array
{
    return [
        'apiName' => trim((string) ($settings['api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($settings['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($settings['model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'requestTimeout' => normalize_request_timeout($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'api_key_ciphertext' => $settings['api_key_ciphertext'] ?? null,
        'api_key_iv' => $settings['api_key_iv'] ?? null,
        'api_key_tag' => $settings['api_key_tag'] ?? null,
        'api_key_hint' => $settings['api_key_hint'] ?? null,
    ];
}

function ensure_user_api_config(int $userId): ?array
{
    $db = pdo();
    $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();
    if ($existing) return $existing;

    $settings = stored_user_settings_row($userId) ?: [];
    $legacy = legacy_settings_config($settings);
    $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_scope, api_name, api_base_url, model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, prompt_api_name, prompt_api_base_url, prompt_model, prompt_request_timeout, prompt_api_key_ciphertext, prompt_api_key_iv, prompt_api_key_tag, prompt_api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
    $stmt->execute([
        $userId,
        'all',
        $legacy['apiName'],
        $legacy['apiBaseUrl'],
        $legacy['model'],
        $legacy['requestTimeout'],
        $legacy['api_key_ciphertext'],
        $legacy['api_key_iv'],
        $legacy['api_key_tag'],
        $legacy['api_key_hint'],
        DEFAULT_PROMPT_API_NAME,
        $legacy['apiBaseUrl'],
        '',
        $legacy['requestTimeout'],
        $legacy['api_key_ciphertext'],
        $legacy['api_key_iv'],
        $legacy['api_key_tag'],
        $legacy['api_key_hint'],
    ]);
    $configId = (int) $db->lastInsertId();
    $stmt = $db->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, active_api_config_id, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE active_api_config_id = COALESCE(active_api_config_id, VALUES(active_api_config_id))');
    $stmt->execute([
        $userId,
        $legacy['model'],
        $legacy['apiName'],
        $legacy['apiBaseUrl'],
        $legacy['requestTimeout'],
        $configId,
        $legacy['api_key_ciphertext'],
        $legacy['api_key_iv'],
        $legacy['api_key_tag'],
        $legacy['api_key_hint'],
    ]);

    $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? LIMIT 1');
    $stmt->execute([$configId]);
    return $stmt->fetch() ?: null;
}

function user_api_config_rows(int $userId): array
{
    ensure_user_api_config($userId);
    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC');
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function first_keyed_user_api_config_row(array $configs): ?array
{
    foreach ($configs as $config) {
        if (config_has_any_api_key($config)) return $config;
    }

    return null;
}

function first_keyed_user_api_config_row_for_category(array $configs, string $category): ?array
{
    foreach ($configs as $config) {
        if (config_has_category_api_key($config, $category)) return $config;
    }

    return null;
}

function active_api_config_row(int $userId): ?array
{
    $settings = ensure_user_settings_row($userId);
    $activeId = (int) ($settings['active_api_config_id'] ?? 0);
    if ($activeId > 0) {
        $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $userId]);
        $row = $stmt->fetch();
        if ($row && config_scope_allows_category($row, 'image')) return $row;
    }

    $stmt = pdo()->prepare("SELECT * FROM user_api_configs WHERE user_id = ? AND api_scope IN ('all', 'image') ORDER BY sort_order ASC, id ASC LIMIT 1");
    $stmt->execute([$userId]);
    $row = $stmt->fetch() ?: null;
    if ($row) {
        $stmt = pdo()->prepare('UPDATE user_settings SET active_api_config_id = ? WHERE user_id = ?');
        $stmt->execute([(int) $row['id'], $userId]);
    }
    return $row;
}

function active_prompt_api_config_row(int $userId): ?array
{
    $settings = ensure_user_settings_row($userId);
    $activeId = (int) ($settings['active_prompt_api_config_id'] ?? 0);
    if ($activeId > 0) {
        $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $userId]);
        $row = $stmt->fetch();
        if ($row && config_scope_allows_category($row, 'prompt')) return $row;
    }

    $configs = user_api_config_rows($userId);
    $row = first_keyed_user_api_config_row_for_category($configs, 'prompt');
    if (!$row) {
        foreach ($configs as $config) {
            if (config_scope_allows_category($config, 'prompt')) {
                $row = $config;
                break;
            }
        }
    }
    if ($row) {
        $stmt = pdo()->prepare('UPDATE user_settings SET active_prompt_api_config_id = ? WHERE user_id = ?');
        $stmt->execute([(int) $row['id'], $userId]);
    }
    return $row ?: null;
}

function settings_for_user(int $userId): ?array
{
    $settings = ensure_user_settings_row($userId);
    $configs = user_api_config_rows($userId);
    $active = active_api_config_row($userId);
    $activePrompt = active_prompt_api_config_row($userId);
    $activeClient = $active ? config_from_row($active) : null;
    $activePromptClient = $activePrompt ? config_from_row($activePrompt) : $activeClient;

    $apiConfigs = array_map('config_from_row', $configs);
    if (shared_api_enabled()) {
        $sharedClient = shared_api_config_client();
        $keyedOwnImageConfig = first_keyed_user_api_config_row_for_category($configs, 'image');
        $keyedOwnPromptConfig = first_keyed_user_api_config_row_for_category($configs, 'prompt');
        $wantsSharedImage = !empty($settings['active_shared']);
        $wantsSharedPrompt = !empty($settings['active_prompt_shared']);

        if ($keyedOwnImageConfig || $keyedOwnPromptConfig) {
            $apiConfigs[] = $sharedClient;
            if ($wantsSharedImage || !$keyedOwnImageConfig) $activeClient = $sharedClient;
            elseif (!$activeClient || empty($activeClient['hasApiKey'])) $activeClient = config_from_row($keyedOwnImageConfig);

            if ($wantsSharedPrompt || !$keyedOwnPromptConfig) $activePromptClient = $sharedClient;
            elseif (!$activePromptClient || empty($activePromptClient['promptApi']['hasApiKey'])) $activePromptClient = config_from_row($keyedOwnPromptConfig);
        } else {
            array_unshift($apiConfigs, $sharedClient);
            $activeClient = $sharedClient;
            $activePromptClient = $sharedClient;
        }
    }

    return [
        'stream' => !empty($settings['stream']),
        'activeApiConfigId' => $activeClient['id'] ?? null,
        'activePromptApiConfigId' => $activePromptClient['id'] ?? ($activeClient['id'] ?? null),
        'apiConfigs' => $apiConfigs,
        'activeConfig' => $activeClient,
        'activePromptConfig' => $activePromptClient,
        'model' => $activeClient['model'] ?? DEFAULT_IMAGE_MODEL,
        'promptModel' => $activePromptClient['promptApi']['model'] ?? ($activePromptClient['promptModel'] ?? ''),
        'imageApi' => $activeClient['imageApi'] ?? null,
        'promptApi' => $activePromptClient['promptApi'] ?? null,
        'apiName' => $activeClient['apiName'] ?? DEFAULT_API_NAME,
        'apiBaseUrl' => $activeClient['apiBaseUrl'] ?? DEFAULT_API_BASE_URL,
        'requestTimeout' => normalize_request_timeout($settings['request_timeout'] ?? ($activeClient['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT)),
        'hasApiKey' => $activeClient['hasApiKey'] ?? false,
        'apiKeyHint' => $activeClient['apiKeyHint'] ?? '',
    ];
}

function stored_user_own_api_key(): string
{
    $userId = session_user_id();
    if (!$userId) return '';

    $active = active_api_config_row($userId);
    if ($active && decrypt_prefixed_api_key($active, '') !== '') return decrypt_prefixed_api_key($active, '');

    $configs = user_api_config_rows($userId);
    $keyedOwnConfig = first_keyed_user_api_config_row_for_category($configs, 'image');
    return $keyedOwnConfig ? decrypt_prefixed_api_key($keyedOwnConfig, '') : '';
}

function stored_user_api_key(): string
{
    $userId = session_user_id();
    if (!$userId) return '';
    $settings = ensure_user_settings_row($userId);
    if (shared_api_enabled()) {
        $configs = user_api_config_rows($userId);
        $keyedOwnConfig = first_keyed_user_api_config_row_for_category($configs, 'image');
        if (!$keyedOwnConfig || !empty($settings['active_shared'])) return decrypt_shared_api_key(null, 'image');

        $active = active_api_config_row($userId);
        return decrypt_prefixed_api_key($active ?: [], '') ?: decrypt_prefixed_api_key($keyedOwnConfig, '');
    }
    return decrypt_prefixed_api_key(active_api_config_row($userId) ?: [], '');
}

function upsert_user_settings_from_config(int $userId, array $active, int $activeId, int $stream, bool $updateStream, ?int $requestTimeout = null): void
{
    $streamClause = $updateStream ? 'stream = VALUES(stream), ' : '';
    $effectiveRequestTimeout = normalize_request_timeout($requestTimeout ?? ($active['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT));
    $stmt = pdo()->prepare('INSERT INTO user_settings (user_id, model, api_name, api_base_url, request_timeout, stream, active_api_config_id, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model = VALUES(model), api_name = VALUES(api_name), api_base_url = VALUES(api_base_url), request_timeout = VALUES(request_timeout), ' . $streamClause . 'active_api_config_id = VALUES(active_api_config_id), api_key_ciphertext = VALUES(api_key_ciphertext), api_key_iv = VALUES(api_key_iv), api_key_tag = VALUES(api_key_tag), api_key_hint = VALUES(api_key_hint)');
    $stmt->execute([
        $userId,
        $active['model'],
        $active['api_name'],
        $active['api_base_url'],
        $effectiveRequestTimeout,
        $stream,
        $activeId,
        $active['api_key_ciphertext'],
        $active['api_key_iv'],
        $active['api_key_tag'],
        $active['api_key_hint'],
    ]);
}

function api_category_input_spec(string $category): array
{
    $defaultApiName = $category === 'prompt' ? DEFAULT_PROMPT_API_NAME : DEFAULT_API_NAME;
    $defaultModel = $category === 'image' ? cfg('openai_image_model', DEFAULT_IMAGE_MODEL) : '';
    $modelKey = $category === 'prompt' ? 'promptModel' : 'model';

    return [
        'category' => $category,
        'nestedKey' => $category . 'Api',
        'defaultApiName' => $defaultApiName,
        'defaultModel' => $defaultModel,
        'keys' => [
            'apiName' => $category === 'image' ? ['apiName', 'api_name'] : [$category . 'ApiName', $category . '_api_name'],
            'apiBaseUrl' => $category === 'image' ? ['apiBaseUrl', 'api_base_url'] : [$category . 'ApiBaseUrl', $category . '_api_base_url', 'apiBaseUrl', 'api_base_url'],
            'model' => $category === 'image' ? ['model'] : [$modelKey, $category . '_model'],
            'requestTimeout' => $category === 'image' ? ['requestTimeout', 'request_timeout'] : [$category . 'RequestTimeout', $category . '_request_timeout'],
            'apiKey' => $category === 'image' ? ['apiKey', 'api_key'] : [$category . 'ApiKey', $category . '_api_key', 'apiKey', 'api_key'],
            'clearApiKey' => $category === 'image' ? ['clearApiKey', 'clear_api_key'] : [$category . 'ClearApiKey', $category . '_clear_api_key'],
            'confirmApiKeySave' => $category === 'image' ? ['confirmApiKeySave', 'confirm_api_key_save'] : [$category . 'ConfirmApiKeySave', $category . '_confirm_api_key_save', 'confirmApiKeySave', 'confirm_api_key_save'],
        ],
    ];
}

function api_category_first_value(array $nested, array $root, array $fallback, array $keys, $default = '')
{
    foreach ([$nested, $root, $fallback] as $source) {
        foreach ($keys as $key) {
            if (array_key_exists($key, $source)) return $source[$key];
        }
    }
    return $default;
}

function api_category_any_flag(array $nested, array $root, array $keys): bool
{
    foreach ([$nested, $root] as $source) {
        foreach ($keys as $key) {
            if (!empty($source[$key])) return true;
        }
    }
    return false;
}

function api_category_input_from_spec(array $source, string $category, array $fallback, int $globalRequestTimeout, bool $includeConfirm): array
{
    $spec = api_category_input_spec($category);
    $nested = is_array($source[$spec['nestedKey']] ?? null) ? $source[$spec['nestedKey']] : [];
    $keys = $spec['keys'];
    $commonNameKeys = ['apiName', 'api_name'];
    $commonBaseUrlKeys = ['apiBaseUrl', 'api_base_url'];
    $commonTimeoutKeys = ['requestTimeout', 'request_timeout'];
    $commonApiKeyKeys = ['apiKey', 'api_key'];
    $commonClearKeys = ['clearApiKey', 'clear_api_key'];
    $commonConfirmKeys = ['confirmApiKeySave', 'confirm_api_key_save'];

    $apiNameRootKeys = $category === 'image' ? $commonNameKeys : $keys['apiName'];
    $apiBaseUrlRootKeys = $category === 'image' ? $commonBaseUrlKeys : $keys['apiBaseUrl'];
    $modelRootKeys = $category === 'image' ? ['model'] : $keys['model'];
    $timeoutRootKeys = $category === 'image' ? $commonTimeoutKeys : $keys['requestTimeout'];
    $apiKeyRootKeys = $category === 'image' ? $commonApiKeyKeys : $keys['apiKey'];
    $clearRootKeys = $category === 'image' ? $commonClearKeys : $keys['clearApiKey'];
    $confirmRootKeys = $category === 'image' ? $commonConfirmKeys : $keys['confirmApiKeySave'];

    $apiName = trim((string) api_category_first_value($nested, [], [], $commonNameKeys, api_category_first_value([], $source, $fallback, $apiNameRootKeys, api_category_first_value([], [], $fallback, ['apiName'], $spec['defaultApiName']))));
    $apiBaseUrl = normalize_api_base_url((string) api_category_first_value($nested, [], [], $commonBaseUrlKeys, api_category_first_value([], $source, $fallback, $apiBaseUrlRootKeys, api_category_first_value([], [], $fallback, ['apiBaseUrl'], ''))));
    $model = trim((string) api_category_first_value($nested, [], [], ['model'], api_category_first_value([], $source, $fallback, $modelRootKeys, api_category_first_value([], [], $fallback, ['model'], $spec['defaultModel']))));
    $requestTimeout = api_category_first_value($nested, [], [], $commonTimeoutKeys, api_category_first_value([], $source, $fallback, $timeoutRootKeys, api_category_first_value([], [], $fallback, ['requestTimeout'], $globalRequestTimeout)));

    $input = [
        'apiName' => $apiName !== '' ? $apiName : $spec['defaultApiName'],
        'apiBaseUrl' => $apiBaseUrl,
        'model' => $model !== '' ? $model : (string) $spec['defaultModel'],
        'requestTimeout' => normalize_request_timeout($requestTimeout),
        'apiKey' => trim((string) api_category_first_value($nested, [], [], $commonApiKeyKeys, api_category_first_value([], $source, [], $apiKeyRootKeys, ''))),
        'clearApiKey' => api_category_any_flag($nested, [], $commonClearKeys) || api_category_any_flag([], $source, $clearRootKeys),
    ];

    if ($includeConfirm) {
        $input['confirmApiKeySave'] = api_category_any_flag($nested, [], $commonConfirmKeys) || api_category_any_flag([], $source, $confirmRootKeys);
    }

    return $input;
}

function api_config_category_input(array $config, string $category, int $globalRequestTimeout): array
{
    $fallback = $category === 'image' ? ['apiName' => 'OpenAI Compatible', 'model' => cfg('openai_image_model', DEFAULT_IMAGE_MODEL)] : [];
    return api_category_input_from_spec($config, $category, $fallback, $globalRequestTimeout, true);
}

function api_key_storage_fields_for_category(array $input, array $existing, string $prefix = ''): array
{
    $apiKey = trim((string) ($input['apiKey'] ?? ''));
    if ($apiKey !== '' && empty($input['confirmApiKeySave'])) json_response(['error' => '保存 API Key 前需要确认'], 400);
    if ($apiKey !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);
    if (!empty($input['clearApiKey'])) return [null, null, null, null];

    $encrypted = $apiKey !== '' ? encrypt_api_key($apiKey) : [];
    return [
        $encrypted['api_key_ciphertext'] ?? ($existing[$prefix . 'api_key_ciphertext'] ?? null),
        $encrypted['api_key_iv'] ?? ($existing[$prefix . 'api_key_iv'] ?? null),
        $encrypted['api_key_tag'] ?? ($existing[$prefix . 'api_key_tag'] ?? null),
        $encrypted['api_key_hint'] ?? ($existing[$prefix . 'api_key_hint'] ?? null),
    ];
}

function save_user_settings(array $user, array $body): array
{
    $db = pdo();
    $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
    $configs = array_values(array_filter(is_array($body['apiConfigs'] ?? null) ? $body['apiConfigs'] : [], 'is_array'));
    // 共享配置是注入的虚拟项，不写入 user_api_configs。
    $configs = array_values(array_filter($configs, function ($config) {
        $rawId = (string) ($config['id'] ?? '');
        return $rawId !== SHARED_API_CONFIG_ID && empty($config['isShared']);
    }));
    if (!$configs && isset($settings['apiName'], $settings['apiBaseUrl'])) $configs = [$settings];
    if (!$configs) json_response(['error' => '至少保留一套 API 配置'], 400);

    // activeRawId 可能是本地字符串 id（如 api-config-xxx）、共享虚拟 id 或数据库数字 id。
    // (int) 对字符串 id 取 0，循环里再按 raw id 精确匹配落库后的真实数字 id。
    $activeRawId = (string) ($settings['activeApiConfigId'] ?? ($settings['active_api_config_id'] ?? ''));
    $activePromptRawId = (string) ($settings['activePromptApiConfigId'] ?? ($settings['active_prompt_api_config_id'] ?? $activeRawId));
    $wantShared = shared_api_enabled() && $activeRawId === SHARED_API_CONFIG_ID;
    $wantSharedPrompt = shared_api_enabled() && $activePromptRawId === SHARED_API_CONFIG_ID;
    $activeId = $wantShared ? 0 : (int) $activeRawId;
    $activePromptId = $wantSharedPrompt ? 0 : (int) $activePromptRawId;
    $stream = !empty($settings['stream']);
    $requestTimeout = normalize_request_timeout($settings['requestTimeout'] ?? ($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT));
    $normalizedConfigs = [];
    foreach ($configs as $index => $config) {
        $imageInput = api_config_category_input($config, 'image', $requestTimeout);
        $promptInput = api_config_category_input($config, 'prompt', $requestTimeout);
        $apiScope = trim((string) ($config['apiScope'] ?? ($config['api_scope'] ?? 'all')));
        if (!in_array($apiScope, ['all', 'image', 'prompt'], true)) $apiScope = 'all';
        $hasPendingApiKey = false;

        foreach ([
            ['label' => '生图', 'input' => $imageInput],
            ['label' => '提示词助手', 'input' => $promptInput],
        ] as $item) {
            if (!valid_api_base_url($item['input']['apiBaseUrl'])) json_response(['error' => $item['label'] . ' API 地址必须是 http 或 https 地址'], 400);
            if (trim((string) ($item['input']['apiKey'] ?? '')) !== '') {
                $hasPendingApiKey = true;
                if (empty($item['input']['confirmApiKeySave'])) json_response(['error' => '保存 API Key 前需要确认'], 400);
            }
        }

        if ($hasPendingApiKey && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);

        $normalizedConfigs[] = [
            'config' => $config,
            'index' => $index,
            'configId' => (int) ($config['id'] ?? 0),
            'apiScope' => $apiScope,
            'imageInput' => $imageInput,
            'promptInput' => $promptInput,
        ];
    }
    $seenIds = [];

    $db->beginTransaction();
    try {
        foreach ($normalizedConfigs as $normalizedConfig) {
            $config = $normalizedConfig['config'];
            $index = $normalizedConfig['index'];
            $configId = $normalizedConfig['configId'];
            $apiScope = $normalizedConfig['apiScope'];
            $imageInput = $normalizedConfig['imageInput'];
            $promptInput = $normalizedConfig['promptInput'];

            $existing = [];
            if ($configId > 0) {
                $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
                $stmt->execute([$configId, $user['id']]);
                $existing = $stmt->fetch() ?: [];
                if (!$existing) $configId = 0;
            }

            $imageApiFields = api_key_storage_fields_for_category($imageInput, $existing);
            $promptApiFields = api_key_storage_fields_for_category($promptInput, $existing, 'prompt_');

            if ($configId > 0) {
                $stmt = $db->prepare('UPDATE user_api_configs SET api_scope = ?, api_name = ?, api_base_url = ?, model = ?, request_timeout = ?, api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, api_key_hint = ?, prompt_api_name = ?, prompt_api_base_url = ?, prompt_model = ?, prompt_request_timeout = ?, prompt_api_key_ciphertext = ?, prompt_api_key_iv = ?, prompt_api_key_tag = ?, prompt_api_key_hint = ?, sort_order = ? WHERE id = ? AND user_id = ?');
                $stmt->execute([
                    $apiScope,
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
                    $index,
                    $configId,
                    $user['id'],
                ]);
            } else {
                $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_scope, api_name, api_base_url, model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, prompt_api_name, prompt_api_base_url, prompt_model, prompt_request_timeout, prompt_api_key_ciphertext, prompt_api_key_iv, prompt_api_key_tag, prompt_api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([
                    $user['id'],
                    $apiScope,
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
                    $index,
                ]);
                $configId = (int) $db->lastInsertId();
            }

            $seenIds[] = $configId;
            // 尚未选定 active，或本配置的 raw id 正是请求指定的 active，则锁定为当前真实数字 id。
            if ((!$activeId || (isset($config['id']) && (string) $config['id'] === $activeRawId)) && config_scope_allows_category(['api_scope' => $apiScope], 'image')) $activeId = $configId;
            if ((!$activePromptId || (isset($config['id']) && (string) $config['id'] === $activePromptRawId)) && config_scope_allows_category(['api_scope' => $apiScope], 'prompt')) $activePromptId = $configId;
        }

        $placeholders = implode(',', array_fill(0, count($seenIds), '?'));
        $params = array_merge([$user['id']], $seenIds);
        $db->prepare("DELETE FROM user_api_configs WHERE user_id = ? AND id NOT IN ({$placeholders})")->execute($params);
        if (!in_array($activeId, $seenIds, true)) $activeId = 0;
        if (!in_array($activePromptId, $seenIds, true)) $activePromptId = 0;

        if ($activeId > 0) {
            $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
            $stmt->execute([$activeId, $user['id']]);
            $active = $stmt->fetch() ?: null;
            if (!$active || !config_scope_allows_category($active, 'image')) $activeId = 0;
        }
        if ($activeId <= 0) {
            $stmt = $db->prepare("SELECT * FROM user_api_configs WHERE user_id = ? AND api_scope IN ('all', 'image') ORDER BY sort_order ASC, id ASC LIMIT 1");
            $stmt->execute([$user['id']]);
            $active = $stmt->fetch() ?: null;
            if ($active) $activeId = (int) $active['id'];
        }

        if ($activePromptId > 0) {
            $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
            $stmt->execute([$activePromptId, $user['id']]);
            $activePrompt = $stmt->fetch() ?: null;
            if (!$activePrompt || !config_scope_allows_category($activePrompt, 'prompt')) $activePromptId = 0;
        }
        if ($activePromptId <= 0) {
            $stmt = $db->prepare("SELECT * FROM user_api_configs WHERE user_id = ? AND api_scope IN ('all', 'prompt') ORDER BY sort_order ASC, id ASC LIMIT 1");
            $stmt->execute([$user['id']]);
            $activePrompt = $stmt->fetch() ?: null;
            if ($activePrompt) $activePromptId = (int) $activePrompt['id'];
        }
        if ($activeId <= 0) $activeId = $seenIds[0];
        if ($activePromptId <= 0) $activePromptId = $activeId;

        $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $user['id']]);
        $active = $stmt->fetch();
        if (!$active) throw new RuntimeException('当前 API 配置不存在');

        upsert_user_settings_from_config((int) $user['id'], $active, $activeId, $stream ? 1 : 0, true, $requestTimeout);
        $db->prepare('UPDATE user_settings SET active_shared = ?, active_prompt_api_config_id = ?, active_prompt_shared = ? WHERE user_id = ?')->execute([$wantShared ? 1 : 0, $activePromptId, $wantSharedPrompt ? 1 : 0, $user['id']]);

        $db->commit();
        return settings_for_user((int) $user['id']);
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function fetch_url_json(string $url, array $headers, int $timeout): array
{
    $response = outbound_http_request('GET', $url, $headers, '', $timeout, OUTBOUND_MAX_RESPONSE_BYTES);
    $responseText = (string) ($response['body'] ?? '');
    $status = (int) ($response['status'] ?? 0);

    if ($responseText === '') throw new RuntimeException('模型列表获取失败，请检查 API 地址或密钥。');
    $data = json_decode($responseText, true);
    if (!is_array($data)) throw new RuntimeException('模型接口返回了无法解析的数据。');
    if ($status >= 400) {
        $message = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? '模型列表获取失败。';
        throw new RuntimeException(is_string($message) ? $message : '模型列表获取失败。');
    }

    return $data;
}

function build_api_models_url(string $apiBaseUrl): string
{
    $baseUrl = normalize_api_base_url($apiBaseUrl ?: DEFAULT_API_BASE_URL);
    if (!valid_api_base_url($baseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);

    $parts = parse_url($baseUrl);
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    if ($path !== '' && substr($path, -3) === '/v1') $path .= '/models';
    elseif ($path === '' || substr($path, -7) !== '/models') $path .= '/v1/models';

    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $user = isset($parts['user']) ? rawurlencode((string) $parts['user']) : '';
    $pass = isset($parts['pass']) ? ':' . rawurlencode((string) $parts['pass']) : '';
    $auth = $user !== '' ? $user . $pass . '@' : '';
    return strtolower((string) $parts['scheme']) . '://' . $auth . strtolower((string) $parts['host']) . $port . $path;
}

function model_ids_from_response(array $data): array
{
    $items = is_array($data['data'] ?? null) ? $data['data'] : (is_array($data['models'] ?? null) ? $data['models'] : []);
    $models = [];
    foreach ($items as $item) {
        $id = is_array($item) ? ($item['id'] ?? $item['model'] ?? $item['name'] ?? '') : $item;
        $id = trim((string) $id);
        if ($id !== '') $models[] = $id;
    }

    return array_values(array_unique($models));
}

function api_config_for_model_fetch(array $user, string $rawId, string $category): array
{
    if (shared_api_enabled() && $rawId === SHARED_API_CONFIG_ID) {
        $row = site_settings_row();
        $client = shared_api_category_client($row, $category);
        return [
            'apiBaseUrl' => $client['apiBaseUrl'],
            'apiKey' => decrypt_shared_api_key($row, $category),
            'requestTimeout' => $client['requestTimeout'],
        ];
    }

    $configId = (int) $rawId;
    if ($configId <= 0) return ['apiBaseUrl' => DEFAULT_API_BASE_URL, 'apiKey' => '', 'requestTimeout' => DEFAULT_REQUEST_TIMEOUT];

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$configId, $user['id']]);
    $row = $stmt->fetch() ?: [];
    $client = api_client_category($row, $category);
    $prefix = $category === 'prompt' ? 'prompt_' : '';
    $apiKey = decrypt_prefixed_api_key($row, $prefix);

    return [
        'apiBaseUrl' => $client['apiBaseUrl'],
        'apiKey' => $apiKey,
        'requestTimeout' => $client['requestTimeout'],
    ];
}

function fetch_api_models_for_user(array $user, array $body): array
{
    $rawId = (string) ($body['configId'] ?? ($body['config_id'] ?? ''));
    $category = (string) ($body['category'] ?? ($body['apiCategory'] ?? ($body['api_category'] ?? 'image')));
    if (!in_array($category, ['image', 'prompt'], true)) $category = 'image';
    $stored = api_config_for_model_fetch($user, $rawId, $category);
    $apiBaseUrl = normalize_api_base_url((string) ($body['apiBaseUrl'] ?? ($body['api_base_url'] ?? $stored['apiBaseUrl'])));
    if ($apiBaseUrl === '') $apiBaseUrl = $stored['apiBaseUrl'];
    $apiKey = trim((string) ($body['apiKey'] ?? ($body['api_key'] ?? '')));
    if ($apiKey === '') $apiKey = $stored['apiKey'];
    if ($apiKey === '') json_response(['error' => '请先填写或保存 API Key 后再获取模型。'], 400);

    $timeout = normalize_request_timeout($body['requestTimeout'] ?? ($body['request_timeout'] ?? $stored['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT));
    $data = fetch_url_json(build_api_models_url($apiBaseUrl), [
        'Accept: application/json',
        'Authorization: Bearer ' . $apiKey,
    ], $timeout);

    return ['models' => model_ids_from_response($data)];
}

function switch_active_api_config(array $user, array $body): array
{
    $rawId = (string) ($body['activeApiConfigId'] ?? ($body['active_api_config_id'] ?? ''));
    $category = (string) ($body['category'] ?? ($body['apiCategory'] ?? ($body['api_category'] ?? 'image')));
    if (!in_array($category, ['image', 'prompt'], true)) $category = 'image';

    if (shared_api_enabled() && $rawId === SHARED_API_CONFIG_ID) {
        ensure_user_settings_row((int) $user['id']);
        if ($category === 'prompt') {
            pdo()->prepare('UPDATE user_settings SET active_prompt_shared = 1 WHERE user_id = ?')->execute([$user['id']]);
        } else {
            pdo()->prepare('UPDATE user_settings SET active_shared = 1 WHERE user_id = ?')->execute([$user['id']]);
        }
        return settings_for_user((int) $user['id']);
    }

    $configId = (int) $rawId;
    if ($configId <= 0) json_response(['error' => '缺少 API 配置 ID'], 400);

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$configId, $user['id']]);
    $active = $stmt->fetch();
    if (!$active) json_response(['error' => 'API 配置不存在'], 404);
    if (!config_scope_allows_category($active, $category)) json_response(['error' => '当前页面不能使用该 API 配置'], 400);

    if ($category === 'prompt') {
        ensure_user_settings_row((int) $user['id']);
        pdo()->prepare('UPDATE user_settings SET active_prompt_api_config_id = ?, active_prompt_shared = 0 WHERE user_id = ?')->execute([$configId, $user['id']]);
        return settings_for_user((int) $user['id']);
    }

    $settings = stored_user_settings_row((int) $user['id']);
    $stream = !empty($settings['stream']) ? 1 : 0;
    $requestTimeout = normalize_request_timeout($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT);
    upsert_user_settings_from_config((int) $user['id'], $active, $configId, $stream, false, $requestTimeout);
    pdo()->prepare('UPDATE user_settings SET active_shared = 0 WHERE user_id = ?')->execute([$user['id']]);

    return settings_for_user((int) $user['id']);
}