<?php

declare(strict_types=1);

function pdo(): PDO
{
    global $state;
    if ($state['pdo'] instanceof PDO) return $state['pdo'];

    $host = cfg('mysql_host', '127.0.0.1');
    $port = (int) cfg('mysql_port', 3306);
    $db = cfg('mysql_database', 'gpt-biubiubiu');
    $user = cfg('mysql_user', 'GPT-biubiubiu');
    $password = cfg('mysql_password', '');
    $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";

    $state['pdo'] = new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $state['pdo'];
}

function ensure_column(PDO $db, string $table, string $column, string $definition): void
{
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $column)) return;

    $stmt = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $stmt->execute([$table, $column]);
    if ((int) $stmt->fetchColumn() > 0) return;

    try {
        $db->exec("ALTER TABLE `{$table}` ADD COLUMN {$definition}");
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) !== 1060) throw $error;
    }
}

function ensure_index(PDO $db, string $table, string $index, string $definition): void
{
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $index)) return;

    $stmt = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $stmt->execute([$table, $index]);
    if ((int) $stmt->fetchColumn() > 0) return;

    try {
        $db->exec("ALTER TABLE `{$table}` ADD {$definition}");
    } catch (PDOException $error) {
        if (($error->errorInfo[1] ?? null) !== 1061) throw $error;
    }
}

function bootstrap_admin_user(PDO $db): void
{
    $username = trim((string) cfg('bootstrap_admin_username', ''));
    $password = (string) cfg('bootstrap_admin_password', '');
    if ($username === '' || $password === '') return;

    if (!preg_match('/^[\w\x{4e00}-\x{9fa5}.-]{2,20}$/u', $username)) {
        throw new RuntimeException('bootstrap_admin_username 不合法');
    }
    if (strlen($password) < 12) {
        throw new RuntimeException('bootstrap_admin_password 至少 12 位');
    }

    $displayName = normalize_display_name((string) cfg('bootstrap_admin_display_name', $username), $username);
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = $db->prepare("INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE is_admin = 1, display_name = COALESCE(NULLIF(display_name, ''), VALUES(display_name))");
    $stmt->execute([$username, $displayName, $hash]);
}

function ensure_schema(): void
{
    global $state;
    if ($state['schemaReady']) return;

    $db = pdo();
    $db->exec("CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(96) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      model VARCHAR(128) DEFAULT NULL,
      api_name VARCHAR(128) DEFAULT NULL,
      api_base_url VARCHAR(255) DEFAULT NULL,
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      stream TINYINT(1) NOT NULL DEFAULT 0,
      active_api_config_id BIGINT UNSIGNED DEFAULT NULL,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS user_api_configs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
      api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
      model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_api_configs_user_sort (user_id, sort_order, id),
      CONSTRAINT fk_user_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS auth_rate_limits (
      rate_key VARCHAR(191) NOT NULL PRIMARY KEY,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS image_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      request_id VARCHAR(80) DEFAULT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'generation',
      status VARCHAR(32) NOT NULL DEFAULT 'completed',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      original_url TEXT DEFAULT NULL,
      display_url TEXT DEFAULT NULL,
      image_mime VARCHAR(80) DEFAULT 'image/png',
      original_bytes BIGINT UNSIGNED DEFAULT NULL,
      display_bytes BIGINT UNSIGNED DEFAULT NULL,
      wall_item_id BIGINT UNSIGNED DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      result_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_image_jobs_user_created (user_id, created_at),
      CONSTRAINT fk_image_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS wall_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      client_id VARCHAR(80) DEFAULT NULL,
      author_name VARCHAR(96) NOT NULL DEFAULT '未知艺术家',
      prompt TEXT DEFAULT NULL,
      revised_prompt TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      image_mime VARCHAR(80) DEFAULT 'image/png',
      original_url TEXT DEFAULT NULL,
      display_url TEXT DEFAULT NULL,
      original_path TEXT DEFAULT NULL,
      display_path TEXT DEFAULT NULL,
      original_bytes BIGINT UNSIGNED DEFAULT NULL,
      display_bytes BIGINT UNSIGNED DEFAULT NULL,
      duration_seconds INT UNSIGNED DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      source_job_id BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wall_items_created (created_at),
      INDEX idx_wall_items_user (user_id),
      INDEX idx_wall_items_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    ensure_column($db, 'users', 'display_name', 'display_name VARCHAR(96) DEFAULT NULL AFTER username');
    ensure_column($db, 'users', 'is_admin', 'is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
    ensure_column($db, 'user_settings', 'api_name', 'api_name VARCHAR(128) DEFAULT NULL AFTER model');
    ensure_column($db, 'user_settings', 'api_base_url', 'api_base_url VARCHAR(255) DEFAULT NULL AFTER api_name');
    ensure_column($db, 'user_settings', 'request_timeout', 'request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER api_base_url');
    ensure_column($db, 'user_settings', 'stream', 'stream TINYINT(1) NOT NULL DEFAULT 0 AFTER request_timeout');
    ensure_column($db, 'user_settings', 'active_api_config_id', 'active_api_config_id BIGINT UNSIGNED DEFAULT NULL AFTER stream');
    ensure_column($db, 'user_settings', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER active_api_config_id');
    ensure_column($db, 'user_settings', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_settings', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_settings', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'user_api_configs', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER request_timeout');
    ensure_column($db, 'user_api_configs', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_api_configs', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_api_configs', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'wall_items', 'user_id', 'user_id BIGINT UNSIGNED DEFAULT NULL AFTER id');
    ensure_column($db, 'wall_items', 'client_id', 'client_id VARCHAR(80) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'wall_items', 'author_name', 'author_name VARCHAR(96) NOT NULL DEFAULT ' . $db->quote('未知艺术家') . ' AFTER client_id');
    ensure_column($db, 'wall_items', 'prompt', 'prompt TEXT DEFAULT NULL AFTER author_name');
    ensure_column($db, 'wall_items', 'revised_prompt', 'revised_prompt TEXT DEFAULT NULL AFTER prompt');
    ensure_column($db, 'wall_items', 'image_url', 'image_url TEXT DEFAULT NULL AFTER revised_prompt');
    ensure_column($db, 'wall_items', 'image_b64', 'image_b64 LONGTEXT DEFAULT NULL AFTER image_url');
    ensure_column($db, 'wall_items', 'image_mime', 'image_mime VARCHAR(80) DEFAULT ' . $db->quote('image/png') . ' AFTER image_b64');
    ensure_column($db, 'wall_items', 'original_url', 'original_url TEXT DEFAULT NULL AFTER image_mime');
    ensure_column($db, 'wall_items', 'display_url', 'display_url TEXT DEFAULT NULL AFTER original_url');
    ensure_column($db, 'wall_items', 'original_path', 'original_path TEXT DEFAULT NULL AFTER display_url');
    ensure_column($db, 'wall_items', 'display_path', 'display_path TEXT DEFAULT NULL AFTER original_path');
    ensure_column($db, 'wall_items', 'original_bytes', 'original_bytes BIGINT UNSIGNED DEFAULT NULL AFTER display_path');
    ensure_column($db, 'wall_items', 'display_bytes', 'display_bytes BIGINT UNSIGNED DEFAULT NULL AFTER original_bytes');
    ensure_column($db, 'wall_items', 'duration_seconds', 'duration_seconds INT UNSIGNED DEFAULT NULL AFTER display_bytes');
    ensure_column($db, 'wall_items', 'params_json', 'params_json JSON DEFAULT NULL AFTER duration_seconds');
    ensure_column($db, 'wall_items', 'source_job_id', 'source_job_id BIGINT UNSIGNED DEFAULT NULL AFTER params_json');
    ensure_column($db, 'wall_items', 'created_at', 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER source_job_id');
    ensure_column($db, 'image_jobs', 'user_id', 'user_id BIGINT UNSIGNED DEFAULT NULL AFTER id');
    ensure_column($db, 'image_jobs', 'request_id', 'request_id VARCHAR(80) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'image_jobs', 'mode', 'mode VARCHAR(32) NOT NULL DEFAULT ' . $db->quote('generation') . ' AFTER request_id');
    ensure_column($db, 'image_jobs', 'status', 'status VARCHAR(32) NOT NULL DEFAULT ' . $db->quote('completed') . ' AFTER mode');
    ensure_column($db, 'image_jobs', 'prompt', 'prompt TEXT DEFAULT NULL AFTER status');
    ensure_column($db, 'image_jobs', 'revised_prompt', 'revised_prompt TEXT DEFAULT NULL AFTER prompt');
    ensure_column($db, 'image_jobs', 'error_message', 'error_message TEXT DEFAULT NULL AFTER revised_prompt');
    ensure_column($db, 'image_jobs', 'image_url', 'image_url TEXT DEFAULT NULL AFTER error_message');
    ensure_column($db, 'image_jobs', 'original_url', 'original_url TEXT DEFAULT NULL AFTER image_url');
    ensure_column($db, 'image_jobs', 'display_url', 'display_url TEXT DEFAULT NULL AFTER original_url');
    ensure_column($db, 'image_jobs', 'image_mime', 'image_mime VARCHAR(80) DEFAULT ' . $db->quote('image/png') . ' AFTER display_url');
    ensure_column($db, 'image_jobs', 'original_bytes', 'original_bytes BIGINT UNSIGNED DEFAULT NULL AFTER image_mime');
    ensure_column($db, 'image_jobs', 'display_bytes', 'display_bytes BIGINT UNSIGNED DEFAULT NULL AFTER original_bytes');
    ensure_column($db, 'image_jobs', 'wall_item_id', 'wall_item_id BIGINT UNSIGNED DEFAULT NULL AFTER display_bytes');
    ensure_column($db, 'image_jobs', 'image_b64', 'image_b64 LONGTEXT DEFAULT NULL AFTER wall_item_id');
    ensure_column($db, 'image_jobs', 'params_json', 'params_json JSON DEFAULT NULL AFTER image_b64');
    ensure_column($db, 'image_jobs', 'result_json', 'result_json JSON DEFAULT NULL AFTER params_json');
    ensure_column($db, 'image_jobs', 'created_at', 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER result_json');
    ensure_column($db, 'image_jobs', 'completed_at', 'completed_at TIMESTAMP NULL DEFAULT NULL AFTER created_at');
    ensure_index($db, 'user_api_configs', 'idx_user_api_configs_user_sort', 'INDEX idx_user_api_configs_user_sort (user_id, sort_order, id)');
    ensure_index($db, 'image_jobs', 'idx_image_jobs_user_created', 'INDEX idx_image_jobs_user_created (user_id, created_at)');

    bootstrap_admin_user($db);

    $db->exec('UPDATE user_settings SET request_timeout = 999 WHERE request_timeout IN (180, 600)');
    $db->exec("UPDATE user_settings SET model = 'gpt-image-2' WHERE model = 'gpt-image-1'");

    $state['schemaReady'] = true;
}

function require_database(): void
{
    try {
        ensure_schema();
    } catch (Throwable $error) {
        json_response(['error' => '服务端未配置 MySQL', 'detail' => $error->getMessage()], 503);
    }
}