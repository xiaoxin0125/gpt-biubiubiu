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
    return [
        'id' => (int) $row['id'],
        'apiName' => $row['api_name'] ?: DEFAULT_API_NAME,
        'apiBaseUrl' => $row['api_base_url'] ?: DEFAULT_API_BASE_URL,
        'model' => $row['model'] ?: DEFAULT_IMAGE_MODEL,
        'promptModel' => trim((string) ($row['prompt_model'] ?? '')),
        'visionModel' => trim((string) ($row['vision_model'] ?? '')),
        'requestTimeout' => (int) ($row['request_timeout'] ?: DEFAULT_REQUEST_TIMEOUT),
        'hasApiKey' => !empty($row['api_key_ciphertext']),
        'apiKeyHint' => $row['api_key_hint'] ?: '',
        'sortOrder' => (int) ($row['sort_order'] ?? 0),
    ];
}

function legacy_settings_config(array $settings): array
{
    return [
        'apiName' => trim((string) ($settings['api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($settings['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($settings['model'] ?? '')) ?: DEFAULT_IMAGE_MODEL,
        'promptModel' => trim((string) ($settings['prompt_model'] ?? '')),
        'visionModel' => trim((string) ($settings['vision_model'] ?? '')),
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
    $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_name, api_base_url, model, prompt_model, vision_model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
    $stmt->execute([
        $userId,
        $legacy['apiName'],
        $legacy['apiBaseUrl'],
        $legacy['model'],
        $legacy['promptModel'],
        $legacy['visionModel'],
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
        if (!empty($config['api_key_ciphertext'])) return $config;
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
        if ($row) return $row;
    }

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE user_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch() ?: null;
    if ($row) {
        $stmt = pdo()->prepare('UPDATE user_settings SET active_api_config_id = ? WHERE user_id = ?');
        $stmt->execute([(int) $row['id'], $userId]);
    }
    return $row;
}

function settings_for_user(int $userId): ?array
{
    $settings = ensure_user_settings_row($userId);
    $configs = user_api_config_rows($userId);
    $active = active_api_config_row($userId);
    $activeClient = $active ? config_from_row($active) : null;

    $apiConfigs = array_map('config_from_row', $configs);
    if (shared_api_enabled()) {
        $sharedClient = shared_api_config_client();
        $keyedOwnConfig = first_keyed_user_api_config_row($configs);
        $wantsShared = !empty($settings['active_shared']);
        if ($keyedOwnConfig) {
            $apiConfigs[] = $sharedClient;
            if ($wantsShared) $activeClient = $sharedClient;
            elseif (!$activeClient || empty($activeClient['hasApiKey'])) $activeClient = config_from_row($keyedOwnConfig);
        } else {
            array_unshift($apiConfigs, $sharedClient);
            $activeClient = $sharedClient;
        }
    }

    return [
        'stream' => !empty($settings['stream']),
        'activeApiConfigId' => $activeClient['id'] ?? null,
        'apiConfigs' => $apiConfigs,
        'activeConfig' => $activeClient,
        'model' => $activeClient['model'] ?? DEFAULT_IMAGE_MODEL,
        'promptModel' => $activeClient['promptModel'] ?? '',
        'visionModel' => $activeClient['visionModel'] ?? '',
        'apiName' => $activeClient['apiName'] ?? DEFAULT_API_NAME,
        'apiBaseUrl' => $activeClient['apiBaseUrl'] ?? DEFAULT_API_BASE_URL,
        'requestTimeout' => normalize_request_timeout($settings['request_timeout'] ?? ($activeClient['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT)),
        'hasApiKey' => $activeClient['hasApiKey'] ?? false,
        'apiKeyHint' => $activeClient['apiKeyHint'] ?? '',
    ];
}

function stored_user_api_key(): string
{
    $userId = session_user_id();
    if (!$userId) return '';
    $settings = ensure_user_settings_row($userId);
    if (shared_api_enabled()) {
        $configs = user_api_config_rows($userId);
        $keyedOwnConfig = first_keyed_user_api_config_row($configs);
        if (!$keyedOwnConfig || !empty($settings['active_shared'])) return decrypt_shared_api_key();

        $active = active_api_config_row($userId);
        return decrypt_api_key($active) ?: decrypt_api_key($keyedOwnConfig);
    }
    return decrypt_api_key(active_api_config_row($userId));
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
    $wantShared = shared_api_enabled() && $activeRawId === SHARED_API_CONFIG_ID;
    $activeId = $wantShared ? 0 : (int) $activeRawId;
    $stream = !empty($settings['stream']);
    $requestTimeout = normalize_request_timeout($settings['requestTimeout'] ?? ($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT));
    $seenIds = [];

    $db->beginTransaction();
    try {
        foreach ($configs as $index => $config) {
            $configId = (int) ($config['id'] ?? 0);
            $apiName = trim((string) ($config['apiName'] ?? ($config['api_name'] ?? 'OpenAI Compatible'))) ?: 'OpenAI Compatible';
            $apiBaseUrl = normalize_api_base_url((string) ($config['apiBaseUrl'] ?? ($config['api_base_url'] ?? '')));
            $model = trim((string) ($config['model'] ?? cfg('openai_image_model', 'gpt-image-2'))) ?: 'gpt-image-2';
            $promptModel = trim((string) ($config['promptModel'] ?? ($config['prompt_model'] ?? '')));
            $visionModel = trim((string) ($config['visionModel'] ?? ($config['vision_model'] ?? '')));
            $apiKey = trim((string) ($config['apiKey'] ?? ''));
            $clearApiKey = !empty($config['clearApiKey']);
            if (!valid_api_base_url($apiBaseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);
            if ($apiKey !== '' && empty($config['confirmApiKeySave'])) json_response(['error' => '保存 API Key 前需要确认'], 400);
            if ($apiKey !== '' && api_key_secret() === '') json_response(['error' => '服务端未配置 USER_API_KEY_SECRET'], 500);

            $existing = [];
            if ($configId > 0) {
                $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
                $stmt->execute([$configId, $user['id']]);
                $existing = $stmt->fetch() ?: [];
                if (!$existing) $configId = 0;
            }

            $encrypted = $apiKey !== '' ? encrypt_api_key($apiKey) : [];
            $apiFields = $clearApiKey ? [null, null, null, null] : [
                $encrypted['api_key_ciphertext'] ?? ($existing['api_key_ciphertext'] ?? null),
                $encrypted['api_key_iv'] ?? ($existing['api_key_iv'] ?? null),
                $encrypted['api_key_tag'] ?? ($existing['api_key_tag'] ?? null),
                $encrypted['api_key_hint'] ?? ($existing['api_key_hint'] ?? null),
            ];

            if ($configId > 0) {
                $stmt = $db->prepare('UPDATE user_api_configs SET api_name = ?, api_base_url = ?, model = ?, prompt_model = ?, vision_model = ?, request_timeout = ?, api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, api_key_hint = ?, sort_order = ? WHERE id = ? AND user_id = ?');
                $stmt->execute([$apiName, $apiBaseUrl, $model, $promptModel, $visionModel, $requestTimeout, $apiFields[0], $apiFields[1], $apiFields[2], $apiFields[3], $index, $configId, $user['id']]);
            } else {
                $stmt = $db->prepare('INSERT INTO user_api_configs (user_id, api_name, api_base_url, model, prompt_model, vision_model, request_timeout, api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$user['id'], $apiName, $apiBaseUrl, $model, $promptModel, $visionModel, $requestTimeout, $apiFields[0], $apiFields[1], $apiFields[2], $apiFields[3], $index]);
                $configId = (int) $db->lastInsertId();
            }

            $seenIds[] = $configId;
            // 尚未选定 active，或本配置的 raw id 正是请求指定的 active，则锁定为当前真实数字 id。
            if (!$activeId || (isset($config['id']) && (string) $config['id'] === $activeRawId)) $activeId = $configId;
        }

        $placeholders = implode(',', array_fill(0, count($seenIds), '?'));
        $params = array_merge([$user['id']], $seenIds);
        $db->prepare("DELETE FROM user_api_configs WHERE user_id = ? AND id NOT IN ({$placeholders})")->execute($params);
        if (!in_array($activeId, $seenIds, true)) $activeId = $seenIds[0];

        $stmt = $db->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$activeId, $user['id']]);
        $active = $stmt->fetch();
        if (!$active) throw new RuntimeException('当前 API 配置不存在');

        upsert_user_settings_from_config((int) $user['id'], $active, $activeId, $stream ? 1 : 0, true, $requestTimeout);
        $db->prepare('UPDATE user_settings SET active_shared = ? WHERE user_id = ?')->execute([$wantShared ? 1 : 0, $user['id']]);

        $db->commit();
        return settings_for_user((int) $user['id']);
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function fetch_url_json(string $url, array $headers, int $timeout): array
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers) . "\r\n",
            'timeout' => normalize_request_timeout($timeout),
            'ignore_errors' => true,
        ],
    ]);

    $responseText = @file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $matches)) {
            $status = (int) $matches[1];
            break;
        }
    }

    if ($responseText === false || $responseText === '') throw new RuntimeException('模型列表获取失败，请检查 API 地址或密钥。');
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

function api_config_for_model_fetch(array $user, string $rawId): array
{
    if (shared_api_enabled() && $rawId === SHARED_API_CONFIG_ID) {
        $row = site_settings_row();
        return [
            'apiBaseUrl' => trim((string) ($row['shared_api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
            'apiKey' => decrypt_shared_api_key($row),
        ];
    }

    $configId = (int) $rawId;
    if ($configId <= 0) return ['apiBaseUrl' => DEFAULT_API_BASE_URL, 'apiKey' => ''];

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$configId, $user['id']]);
    $row = $stmt->fetch() ?: [];

    return [
        'apiBaseUrl' => trim((string) ($row['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'apiKey' => decrypt_api_key($row),
    ];
}

function fetch_api_models_for_user(array $user, array $body): array
{
    $rawId = (string) ($body['configId'] ?? ($body['config_id'] ?? ''));
    $stored = api_config_for_model_fetch($user, $rawId);
    $apiBaseUrl = normalize_api_base_url((string) ($body['apiBaseUrl'] ?? ($body['api_base_url'] ?? $stored['apiBaseUrl'])));
    if ($apiBaseUrl === '') $apiBaseUrl = $stored['apiBaseUrl'];
    $apiKey = trim((string) ($body['apiKey'] ?? ($body['api_key'] ?? '')));
    if ($apiKey === '') $apiKey = $stored['apiKey'];
    if ($apiKey === '') json_response(['error' => '请先填写或保存 API Key 后再获取模型。'], 400);

    $timeout = normalize_request_timeout($body['requestTimeout'] ?? ($body['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT));
    $data = fetch_url_json(build_api_models_url($apiBaseUrl), [
        'Accept: application/json',
        'Authorization: Bearer ' . $apiKey,
    ], $timeout);

    return ['models' => model_ids_from_response($data)];
}

function switch_active_api_config(array $user, array $body): array
{
    $rawId = (string) ($body['activeApiConfigId'] ?? ($body['active_api_config_id'] ?? ''));
    if (shared_api_enabled() && $rawId === SHARED_API_CONFIG_ID) {
        ensure_user_settings_row((int) $user['id']);
        pdo()->prepare('UPDATE user_settings SET active_shared = 1 WHERE user_id = ?')->execute([$user['id']]);
        return settings_for_user((int) $user['id']);
    }

    $configId = (int) $rawId;
    if ($configId <= 0) json_response(['error' => '缺少 API 配置 ID'], 400);

    $stmt = pdo()->prepare('SELECT * FROM user_api_configs WHERE id = ? AND user_id = ? LIMIT 1');
    $stmt->execute([$configId, $user['id']]);
    $active = $stmt->fetch();
    if (!$active) json_response(['error' => 'API 配置不存在'], 404);

    $settings = stored_user_settings_row((int) $user['id']);
    $stream = !empty($settings['stream']) ? 1 : 0;
    $requestTimeout = normalize_request_timeout($settings['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT);
    upsert_user_settings_from_config((int) $user['id'], $active, $configId, $stream, false, $requestTimeout);
    pdo()->prepare('UPDATE user_settings SET active_shared = 0 WHERE user_id = ?')->execute([$user['id']]);

    return settings_for_user((int) $user['id']);
}