<?php
$dotenvValues = [];

$loadDotenv = static function (string $path) use (&$dotenvValues): void {
    if (!is_file($path) || !is_readable($path)) return;

    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim((string) $line);
        if ($line === '' || strpos($line, '#') === 0 || strpos($line, '=') === false) continue;

        [$name, $value] = array_map('trim', explode('=', $line, 2));
        if (!preg_match('/^[A-Z0-9_]+$/', $name)) continue;

        $currentValue = getenv($name);
        if ($currentValue !== false && trim((string) $currentValue) !== '') continue;

        $quote = substr($value, 0, 1);
        if (($quote === '"' || $quote === "'") && substr($value, -1) === $quote) {
            $value = substr($value, 1, -1);
            if ($quote === '"') $value = stripcslashes($value);
        }
        $dotenvValues[$name] = $value;
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
};

$loadDotenv(__DIR__ . '/.env');

$envValue = static function (string $name, string $fallback = '') use (&$dotenvValues): string {
    $value = getenv($name);
    if ($value !== false && trim((string) $value) !== '') return trim((string) $value);
    if (array_key_exists($name, $dotenvValues)) return trim((string) $dotenvValues[$name]);
    if (isset($_ENV[$name]) && trim((string) $_ENV[$name]) !== '') return trim((string) $_ENV[$name]);
    if (isset($_SERVER[$name]) && trim((string) $_SERVER[$name]) !== '') return trim((string) $_SERVER[$name]);
    return $fallback;
};

return [
    // 仅作为新用户 API 配置的默认值；真实 API Key 由用户登录后在设置页保存。
    'openai_base_url' => $envValue('OPENAI_BASE_URL', 'https://api.openai.com'),
    'openai_api_key' => $envValue('OPENAI_API_KEY'),
    'openai_image_model' => $envValue('OPENAI_IMAGE_MODEL', 'gpt-image-2'),

    'mysql_host' => $envValue('MYSQL_HOST', '127.0.0.1'),
    'mysql_port' => (int) ($envValue('MYSQL_PORT', '3306') ?: 3306),
    'mysql_user' => $envValue('MYSQL_USER'),
    'mysql_password' => $envValue('MYSQL_PASSWORD'),
    'mysql_database' => $envValue('MYSQL_DATABASE'),

    'session_secret' => $envValue('SESSION_SECRET'),
    'user_api_key_secret' => $envValue('USER_API_KEY_SECRET'),
    'storage_dir' => $envValue('STORAGE_DIR'),

    // 可选：首次部署时显式创建管理员。留空则不自动创建。
    'bootstrap_admin_username' => $envValue('BOOTSTRAP_ADMIN_USERNAME'),
    'bootstrap_admin_password' => $envValue('BOOTSTRAP_ADMIN_PASSWORD'),
    'bootstrap_admin_display_name' => $envValue('BOOTSTRAP_ADMIN_DISPLAY_NAME'),
];
