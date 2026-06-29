<?php

declare(strict_types=1);

function install_required_env_keys(): array
{
    return ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'SESSION_SECRET', 'USER_API_KEY_SECRET'];
}

function install_project_root(): string
{
    return dirname(__DIR__, 3);
}

function install_env_path(): string
{
    return install_project_root() . '/.env';
}

function install_env_value(string $name): string
{
    $value = getenv($name);
    if ($value !== false && trim((string) $value) !== '') return trim((string) $value);

    foreach ([$_ENV[$name] ?? null, $_SERVER[$name] ?? null] as $candidate) {
        if ($candidate !== null && trim((string) $candidate) !== '') return trim((string) $candidate);
    }

    $configKeys = [
        'MYSQL_HOST' => 'mysql_host',
        'MYSQL_PORT' => 'mysql_port',
        'MYSQL_USER' => 'mysql_user',
        'MYSQL_PASSWORD' => 'mysql_password',
        'MYSQL_DATABASE' => 'mysql_database',
        'SESSION_SECRET' => 'session_secret',
        'USER_API_KEY_SECRET' => 'user_api_key_secret',
    ];
    $configKey = $configKeys[$name] ?? '';
    if ($configKey !== '' && array_key_exists($configKey, $GLOBALS['config'] ?? [])) return trim((string) $GLOBALS['config'][$configKey]);

    return '';
}

function install_missing_env_keys(): array
{
    $missing = [];
    foreach (install_required_env_keys() as $key) {
        if (install_env_value($key) === '') $missing[] = $key;
    }

    foreach (['SESSION_SECRET', 'USER_API_KEY_SECRET'] as $key) {
        $value = install_env_value($key);
        if ($value !== '' && (strlen($value) < MIN_SECRET_LENGTH || in_array($value, WEAK_SECRET_VALUES, true))) $missing[] = $key;
    }

    return array_values(array_unique($missing));
}

function install_mysql_input(array $body): array
{
    $input = [
        'mysqlHost' => trim((string) ($body['mysqlHost'] ?? $body['mysql_host'] ?? '127.0.0.1')),
        'mysqlPort' => (int) ($body['mysqlPort'] ?? $body['mysql_port'] ?? 3306),
        'mysqlUser' => trim((string) ($body['mysqlUser'] ?? $body['mysql_user'] ?? '')),
        'mysqlPassword' => (string) ($body['mysqlPassword'] ?? $body['mysql_password'] ?? ''),
        'mysqlDatabase' => trim((string) ($body['mysqlDatabase'] ?? $body['mysql_database'] ?? '')),
        'sessionSecret' => trim((string) ($body['sessionSecret'] ?? $body['session_secret'] ?? '')),
        'userApiKeySecret' => trim((string) ($body['userApiKeySecret'] ?? $body['user_api_key_secret'] ?? '')),
    ];

    if ($input['mysqlHost'] === '') json_response(['error' => '请输入 MySQL 地址'], 400);
    if ($input['mysqlPort'] < 1 || $input['mysqlPort'] > 65535) json_response(['error' => 'MySQL 端口不合法'], 400);
    if ($input['mysqlUser'] === '') json_response(['error' => '请输入 MySQL 用户名'], 400);
    if ($input['mysqlPassword'] === '') json_response(['error' => '请输入 MySQL 密码'], 400);
    if ($input['mysqlDatabase'] === '') json_response(['error' => '请输入 MySQL 数据库名'], 400);
    if (!preg_match('/^[a-zA-Z0-9_\-]+$/', $input['mysqlDatabase'])) json_response(['error' => 'MySQL 数据库名只能包含字母、数字、下划线或短横线'], 400);

    foreach ([
        'sessionSecret' => 'SESSION_SECRET',
        'userApiKeySecret' => 'USER_API_KEY_SECRET',
    ] as $field => $label) {
        if (strlen($input[$field]) < MIN_SECRET_LENGTH || in_array($input[$field], WEAK_SECRET_VALUES, true)) {
            json_response(['error' => $label . ' 必须是 32 位以上强随机字符串'], 400);
        }
    }
    if ($input['sessionSecret'] === $input['userApiKeySecret']) json_response(['error' => 'SESSION_SECRET 和 USER_API_KEY_SECRET 不能相同'], 400);

    return $input;
}

function install_connect_mysql(array $input): PDO
{
    $dsn = 'mysql:host=' . $input['mysqlHost'] . ';port=' . $input['mysqlPort'] . ';dbname=' . $input['mysqlDatabase'] . ';charset=utf8mb4';
    return new PDO($dsn, $input['mysqlUser'], $input['mysqlPassword'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function install_existing_tables(PDO $db): array
{
    $knownTables = ['users', 'user_settings', 'user_api_configs', 'image_jobs', 'wall_items', 'site_settings'];
    $placeholders = implode(',', array_fill(0, count($knownTables), '?'));
    $stmt = $db->prepare("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ({$placeholders}) ORDER BY TABLE_NAME ASC");
    $stmt->execute($knownTables);
    return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function dotenv_encode_value(string $value): string
{
    $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) throw new RuntimeException('配置值编码失败');
    return $encoded;
}

function install_write_env(array $input): void
{
    $envPath = install_env_path();
    $managed = [
        'MYSQL_HOST' => $input['mysqlHost'],
        'MYSQL_PORT' => (string) $input['mysqlPort'],
        'MYSQL_USER' => $input['mysqlUser'],
        'MYSQL_PASSWORD' => $input['mysqlPassword'],
        'MYSQL_DATABASE' => $input['mysqlDatabase'],
        'SESSION_SECRET' => $input['sessionSecret'],
        'USER_API_KEY_SECRET' => $input['userApiKeySecret'],
    ];

    $existingLines = is_file($envPath) ? (file($envPath, FILE_IGNORE_NEW_LINES) ?: []) : [];
    $nextLines = [];
    foreach ($existingLines as $line) {
        $name = trim(explode('=', (string) $line, 2)[0] ?? '');
        if ($name !== '' && array_key_exists($name, $managed)) continue;
        $nextLines[] = (string) $line;
    }

    if ($nextLines && trim((string) end($nextLines)) !== '') $nextLines[] = '';
    $nextLines[] = '# gpt-biubiubiu runtime config';
    foreach ($managed as $name => $value) {
        $nextLines[] = $name . '=' . dotenv_encode_value((string) $value);
    }

    $content = implode("\n", $nextLines) . "\n";
    $tmpPath = $envPath . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmpPath, $content, LOCK_EX) === false) throw new RuntimeException('.env 写入失败，请检查目录权限');
    @chmod($tmpPath, 0600);
    if (is_file($envPath)) @copy($envPath, $envPath . '.backup.' . date('YmdHis'));
    if (!@rename($tmpPath, $envPath)) {
        @unlink($tmpPath);
        throw new RuntimeException('.env 替换失败，请检查目录权限');
    }
    @chmod($envPath, 0600);
}

function install_status_payload(): array
{
    $missing = install_missing_env_keys();
    $configError = (string) ($GLOBALS['state']['configLoadError'] ?? '');
    $mysqlConnected = false;
    $existingTables = [];
    $message = '';

    if (!$missing) {
        try {
            $input = [
                'mysqlHost' => install_env_value('MYSQL_HOST') ?: '127.0.0.1',
                'mysqlPort' => (int) (install_env_value('MYSQL_PORT') ?: 3306),
                'mysqlUser' => install_env_value('MYSQL_USER'),
                'mysqlPassword' => install_env_value('MYSQL_PASSWORD'),
                'mysqlDatabase' => install_env_value('MYSQL_DATABASE'),
            ];
            $db = install_connect_mysql($input);
            $db->query('SELECT 1');
            $mysqlConnected = true;
            $existingTables = install_existing_tables($db);
        } catch (Throwable $error) {
            $message = 'MySQL 连接失败，请检查数据库地址、用户名、密码和库名。';
        }
    }

    return [
        'needsInstall' => !empty($missing),
        'missing' => $missing,
        'mysqlConnected' => $mysqlConnected,
        'existingTables' => $existingTables,
        'envExists' => is_file(install_env_path()),
        'configError' => $configError,
        'message' => $message,
    ];
}

function handle_install_status(): array
{
    return install_status_payload();
}

function handle_install_save(array $body): array
{
    $status = install_status_payload();
    if (empty($status['needsInstall'])) json_response(['error' => '当前站点已完成配置，安装入口已关闭。'], 403);

    $input = install_mysql_input($body);
    try {
        $db = install_connect_mysql($input);
        $db->query('SELECT 1');
        $existingTables = install_existing_tables($db);
    } catch (Throwable $error) {
        json_response(['error' => 'MySQL 连接失败，请确认填写的是已存在数据库的账号和库名。'], 400);
    }

    install_write_env($input);
    return [
        'installed' => true,
        'existingTables' => $existingTables,
        'message' => $existingTables ? '配置已保存，检测到已有数据表，未覆盖任何数据库内容。' : '配置已保存，数据库为空，后续访问会自动创建表结构。',
    ];
}