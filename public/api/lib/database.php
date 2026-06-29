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

    $stmt = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $existing = $stmt->fetch();
    if ($existing) {
        $db->prepare('UPDATE users SET is_admin = 1 WHERE id = ?')->execute([(int) $existing['id']]);
        return;
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
    $db->exec("CREATE TABLE IF NOT EXISTS schema_meta (
      meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
      meta_value VARCHAR(191) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $stmt = $db->prepare('SELECT meta_value FROM schema_meta WHERE meta_key = ? LIMIT 1');
    $stmt->execute(['schema_version']);
    $currentSchemaVersion = (string) $stmt->fetchColumn();
    if ($currentSchemaVersion === SCHEMA_VERSION) {
        $state['schemaReady'] = true;
        return;
    }

    $db->exec("CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(96) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      token_version INT UNSIGNED NOT NULL DEFAULT 0,
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
      active_shared TINYINT(1) NOT NULL DEFAULT 0,
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
      config_name VARCHAR(128) DEFAULT NULL,
      api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
      api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
      model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      prompt_api_name VARCHAR(128) NOT NULL DEFAULT '提示词优化 API',
      prompt_api_base_url VARCHAR(255) DEFAULT NULL,
      prompt_model VARCHAR(128) DEFAULT NULL,
      prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      prompt_api_key_ciphertext TEXT DEFAULT NULL,
      prompt_api_key_iv VARCHAR(64) DEFAULT NULL,
      prompt_api_key_tag VARCHAR(64) DEFAULT NULL,
      prompt_api_key_hint VARCHAR(24) DEFAULT NULL,
      vision_api_name VARCHAR(128) NOT NULL DEFAULT '图片反推/视觉 API',
      vision_api_base_url VARCHAR(255) DEFAULT NULL,
      vision_model VARCHAR(128) DEFAULT NULL,
      vision_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      vision_api_key_ciphertext TEXT DEFAULT NULL,
      vision_api_key_iv VARCHAR(64) DEFAULT NULL,
      vision_api_key_tag VARCHAR(64) DEFAULT NULL,
      vision_api_key_hint VARCHAR(24) DEFAULT NULL,
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
      INDEX idx_image_jobs_user_completed_id (user_id, status, completed_at, created_at, id),
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
      INDEX idx_wall_items_created_id (created_at, id),
      INDEX idx_wall_items_user (user_id),
      INDEX idx_wall_items_client (client_id),
      INDEX idx_wall_items_source_job (source_job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS site_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
      wall_require_login TINYINT(1) NOT NULL DEFAULT 0,
      registration_enabled TINYINT(1) NOT NULL DEFAULT 1,
      shared_api_enabled TINYINT(1) NOT NULL DEFAULT 1,
      shared_api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
      shared_api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
      shared_model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
      shared_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      shared_api_key_ciphertext TEXT DEFAULT NULL,
      shared_api_key_iv VARCHAR(64) DEFAULT NULL,
      shared_api_key_tag VARCHAR(64) DEFAULT NULL,
      shared_api_key_hint VARCHAR(24) DEFAULT NULL,
      prompt_tools_enabled TINYINT(1) NOT NULL DEFAULT 1,
      shared_prompt_api_name VARCHAR(128) NOT NULL DEFAULT '提示词优化 API',
      shared_prompt_api_base_url VARCHAR(255) DEFAULT NULL,
      shared_prompt_model VARCHAR(128) DEFAULT NULL,
      shared_prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      shared_prompt_api_key_ciphertext TEXT DEFAULT NULL,
      shared_prompt_api_key_iv VARCHAR(64) DEFAULT NULL,
      shared_prompt_api_key_tag VARCHAR(64) DEFAULT NULL,
      shared_prompt_api_key_hint VARCHAR(24) DEFAULT NULL,
      shared_vision_api_name VARCHAR(128) NOT NULL DEFAULT '图片反推/视觉 API',
      shared_vision_api_base_url VARCHAR(255) DEFAULT NULL,
      shared_vision_model VARCHAR(128) DEFAULT NULL,
      shared_vision_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      shared_vision_api_key_ciphertext TEXT DEFAULT NULL,
      shared_vision_api_key_iv VARCHAR(64) DEFAULT NULL,
      shared_vision_api_key_tag VARCHAR(64) DEFAULT NULL,
      shared_vision_api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    ensure_column($db, 'users', 'display_name', 'display_name VARCHAR(96) DEFAULT NULL AFTER username');
    ensure_column($db, 'users', 'is_admin', 'is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
    ensure_column($db, 'users', 'token_version', 'token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_admin');
    ensure_column($db, 'user_settings', 'api_name', 'api_name VARCHAR(128) DEFAULT NULL AFTER model');
    ensure_column($db, 'user_settings', 'api_base_url', 'api_base_url VARCHAR(255) DEFAULT NULL AFTER api_name');
    ensure_column($db, 'user_settings', 'request_timeout', 'request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER api_base_url');
    ensure_column($db, 'user_settings', 'stream', 'stream TINYINT(1) NOT NULL DEFAULT 0 AFTER request_timeout');
    ensure_column($db, 'user_settings', 'active_api_config_id', 'active_api_config_id BIGINT UNSIGNED DEFAULT NULL AFTER stream');
    ensure_column($db, 'user_settings', 'active_shared', 'active_shared TINYINT(1) NOT NULL DEFAULT 0 AFTER active_api_config_id');
    ensure_column($db, 'user_settings', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER active_api_config_id');
    ensure_column($db, 'user_settings', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_settings', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_settings', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'user_api_configs', 'config_name', 'config_name VARCHAR(128) DEFAULT NULL AFTER user_id');
    ensure_column($db, 'user_api_configs', 'api_key_ciphertext', 'api_key_ciphertext TEXT DEFAULT NULL AFTER request_timeout');
    ensure_column($db, 'user_api_configs', 'api_key_iv', 'api_key_iv VARCHAR(64) DEFAULT NULL AFTER api_key_ciphertext');
    ensure_column($db, 'user_api_configs', 'api_key_tag', 'api_key_tag VARCHAR(64) DEFAULT NULL AFTER api_key_iv');
    ensure_column($db, 'user_api_configs', 'api_key_hint', 'api_key_hint VARCHAR(24) DEFAULT NULL AFTER api_key_tag');
    ensure_column($db, 'user_api_configs', 'prompt_api_name', 'prompt_api_name VARCHAR(128) NOT NULL DEFAULT ' . $db->quote(DEFAULT_PROMPT_API_NAME) . ' AFTER api_key_hint');
    ensure_column($db, 'user_api_configs', 'prompt_api_base_url', 'prompt_api_base_url VARCHAR(255) DEFAULT NULL AFTER prompt_api_name');
    ensure_column($db, 'user_api_configs', 'prompt_model', 'prompt_model VARCHAR(128) DEFAULT NULL AFTER prompt_api_base_url');
    ensure_column($db, 'user_api_configs', 'prompt_request_timeout', 'prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER prompt_model');
    ensure_column($db, 'user_api_configs', 'prompt_api_key_ciphertext', 'prompt_api_key_ciphertext TEXT DEFAULT NULL AFTER prompt_request_timeout');
    ensure_column($db, 'user_api_configs', 'prompt_api_key_iv', 'prompt_api_key_iv VARCHAR(64) DEFAULT NULL AFTER prompt_api_key_ciphertext');
    ensure_column($db, 'user_api_configs', 'prompt_api_key_tag', 'prompt_api_key_tag VARCHAR(64) DEFAULT NULL AFTER prompt_api_key_iv');
    ensure_column($db, 'user_api_configs', 'prompt_api_key_hint', 'prompt_api_key_hint VARCHAR(24) DEFAULT NULL AFTER prompt_api_key_tag');
    ensure_column($db, 'user_api_configs', 'vision_api_name', 'vision_api_name VARCHAR(128) NOT NULL DEFAULT ' . $db->quote(DEFAULT_VISION_API_NAME) . ' AFTER prompt_api_key_hint');
    ensure_column($db, 'user_api_configs', 'vision_api_base_url', 'vision_api_base_url VARCHAR(255) DEFAULT NULL AFTER vision_api_name');
    ensure_column($db, 'user_api_configs', 'vision_model', 'vision_model VARCHAR(128) DEFAULT NULL AFTER vision_api_base_url');
    ensure_column($db, 'user_api_configs', 'vision_request_timeout', 'vision_request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER vision_model');
    ensure_column($db, 'user_api_configs', 'vision_api_key_ciphertext', 'vision_api_key_ciphertext TEXT DEFAULT NULL AFTER vision_request_timeout');
    ensure_column($db, 'user_api_configs', 'vision_api_key_iv', 'vision_api_key_iv VARCHAR(64) DEFAULT NULL AFTER vision_api_key_ciphertext');
    ensure_column($db, 'user_api_configs', 'vision_api_key_tag', 'vision_api_key_tag VARCHAR(64) DEFAULT NULL AFTER vision_api_key_iv');
    ensure_column($db, 'user_api_configs', 'vision_api_key_hint', 'vision_api_key_hint VARCHAR(24) DEFAULT NULL AFTER vision_api_key_tag');
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
    ensure_column($db, 'site_settings', 'shared_request_timeout', 'shared_request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER shared_model');
    ensure_column($db, 'site_settings', 'shared_api_key_ciphertext', 'shared_api_key_ciphertext TEXT DEFAULT NULL AFTER shared_request_timeout');
    ensure_column($db, 'site_settings', 'shared_api_key_iv', 'shared_api_key_iv VARCHAR(64) DEFAULT NULL AFTER shared_api_key_ciphertext');
    ensure_column($db, 'site_settings', 'shared_api_key_tag', 'shared_api_key_tag VARCHAR(64) DEFAULT NULL AFTER shared_api_key_iv');
    ensure_column($db, 'site_settings', 'shared_api_key_hint', 'shared_api_key_hint VARCHAR(24) DEFAULT NULL AFTER shared_api_key_tag');
    ensure_column($db, 'site_settings', 'prompt_tools_enabled', 'prompt_tools_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER shared_api_key_hint');
    ensure_column($db, 'site_settings', 'shared_prompt_api_name', 'shared_prompt_api_name VARCHAR(128) NOT NULL DEFAULT ' . $db->quote(DEFAULT_PROMPT_API_NAME) . ' AFTER prompt_tools_enabled');
    ensure_column($db, 'site_settings', 'shared_prompt_api_base_url', 'shared_prompt_api_base_url VARCHAR(255) DEFAULT NULL AFTER shared_prompt_api_name');
    ensure_column($db, 'site_settings', 'shared_prompt_model', 'shared_prompt_model VARCHAR(128) DEFAULT NULL AFTER shared_prompt_api_base_url');
    ensure_column($db, 'site_settings', 'shared_prompt_request_timeout', 'shared_prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER shared_prompt_model');
    ensure_column($db, 'site_settings', 'shared_prompt_api_key_ciphertext', 'shared_prompt_api_key_ciphertext TEXT DEFAULT NULL AFTER shared_prompt_request_timeout');
    ensure_column($db, 'site_settings', 'shared_prompt_api_key_iv', 'shared_prompt_api_key_iv VARCHAR(64) DEFAULT NULL AFTER shared_prompt_api_key_ciphertext');
    ensure_column($db, 'site_settings', 'shared_prompt_api_key_tag', 'shared_prompt_api_key_tag VARCHAR(64) DEFAULT NULL AFTER shared_prompt_api_key_iv');
    ensure_column($db, 'site_settings', 'shared_prompt_api_key_hint', 'shared_prompt_api_key_hint VARCHAR(24) DEFAULT NULL AFTER shared_prompt_api_key_tag');
    ensure_column($db, 'site_settings', 'shared_vision_api_name', 'shared_vision_api_name VARCHAR(128) NOT NULL DEFAULT ' . $db->quote(DEFAULT_VISION_API_NAME) . ' AFTER shared_prompt_api_key_hint');
    ensure_column($db, 'site_settings', 'shared_vision_api_base_url', 'shared_vision_api_base_url VARCHAR(255) DEFAULT NULL AFTER shared_vision_api_name');
    ensure_column($db, 'site_settings', 'shared_vision_model', 'shared_vision_model VARCHAR(128) DEFAULT NULL AFTER shared_vision_api_base_url');
    ensure_column($db, 'site_settings', 'shared_vision_request_timeout', 'shared_vision_request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER shared_vision_model');
    ensure_column($db, 'site_settings', 'shared_vision_api_key_ciphertext', 'shared_vision_api_key_ciphertext TEXT DEFAULT NULL AFTER shared_vision_request_timeout');
    ensure_column($db, 'site_settings', 'shared_vision_api_key_iv', 'shared_vision_api_key_iv VARCHAR(64) DEFAULT NULL AFTER shared_vision_api_key_ciphertext');
    ensure_column($db, 'site_settings', 'shared_vision_api_key_tag', 'shared_vision_api_key_tag VARCHAR(64) DEFAULT NULL AFTER shared_vision_api_key_iv');
    ensure_column($db, 'site_settings', 'shared_vision_api_key_hint', 'shared_vision_api_key_hint VARCHAR(24) DEFAULT NULL AFTER shared_vision_api_key_tag');
    ensure_index($db, 'user_api_configs', 'idx_user_api_configs_user_sort', 'INDEX idx_user_api_configs_user_sort (user_id, sort_order, id)');
    ensure_index($db, 'image_jobs', 'idx_image_jobs_user_created', 'INDEX idx_image_jobs_user_created (user_id, created_at)');
    ensure_index($db, 'image_jobs', 'idx_image_jobs_user_completed_id', 'INDEX idx_image_jobs_user_completed_id (user_id, status, completed_at, created_at, id)');
    ensure_index($db, 'wall_items', 'idx_wall_items_created_id', 'INDEX idx_wall_items_created_id (created_at, id)');
    ensure_index($db, 'wall_items', 'idx_wall_items_source_job', 'INDEX idx_wall_items_source_job (source_job_id)');

    bootstrap_admin_user($db);

    $db->exec('INSERT IGNORE INTO site_settings (id) VALUES (1)');

    $db->exec('UPDATE user_settings SET request_timeout = 999 WHERE request_timeout IN (180, 600)');
    $db->exec("UPDATE user_settings SET model = 'gpt-image-2' WHERE model = 'gpt-image-1'");
    $db->exec("UPDATE user_api_configs SET config_name = CONCAT('API 配置 ', sort_order + 1) WHERE config_name IS NULL OR TRIM(config_name) = ''");
    $shouldRepairCopiedApiNames = $currentSchemaVersion === '' || strcmp($currentSchemaVersion, '2026-06-18c') < 0;
    $copiedPromptApiNameFallback = $shouldRepairCopiedApiNames ? ' OR (api_name IS NOT NULL AND prompt_api_name = api_name)' : '';
    $copiedVisionApiNameFallback = $shouldRepairCopiedApiNames ? ' OR (api_name IS NOT NULL AND vision_api_name = api_name)' : '';
    $copiedSharedPromptApiNameFallback = $shouldRepairCopiedApiNames ? ' OR (shared_api_name IS NOT NULL AND shared_prompt_api_name = shared_api_name)' : '';
    $copiedSharedVisionApiNameFallback = $shouldRepairCopiedApiNames ? ' OR (shared_api_name IS NOT NULL AND shared_vision_api_name = shared_api_name)' : '';
    $db->exec("UPDATE user_api_configs SET
      prompt_api_name = CASE WHEN prompt_api_name IS NULL OR TRIM(prompt_api_name) = ''" . $copiedPromptApiNameFallback . " THEN " . $db->quote(DEFAULT_PROMPT_API_NAME) . " ELSE prompt_api_name END,
      prompt_api_base_url = COALESCE(NULLIF(prompt_api_base_url, ''), api_base_url),
      prompt_request_timeout = IFNULL(NULLIF(prompt_request_timeout, 0), request_timeout),
      prompt_api_key_ciphertext = COALESCE(prompt_api_key_ciphertext, api_key_ciphertext),
      prompt_api_key_iv = COALESCE(prompt_api_key_iv, api_key_iv),
      prompt_api_key_tag = COALESCE(prompt_api_key_tag, api_key_tag),
      prompt_api_key_hint = COALESCE(prompt_api_key_hint, api_key_hint),
      vision_api_name = CASE WHEN vision_api_name IS NULL OR TRIM(vision_api_name) = ''" . $copiedVisionApiNameFallback . " THEN " . $db->quote(DEFAULT_VISION_API_NAME) . " ELSE vision_api_name END,
      vision_api_base_url = COALESCE(NULLIF(vision_api_base_url, ''), api_base_url),
      vision_request_timeout = IFNULL(NULLIF(vision_request_timeout, 0), request_timeout),
      vision_api_key_ciphertext = COALESCE(vision_api_key_ciphertext, api_key_ciphertext),
      vision_api_key_iv = COALESCE(vision_api_key_iv, api_key_iv),
      vision_api_key_tag = COALESCE(vision_api_key_tag, api_key_tag),
      vision_api_key_hint = COALESCE(vision_api_key_hint, api_key_hint)");
    $db->exec("UPDATE site_settings SET
      shared_prompt_api_name = CASE WHEN shared_prompt_api_name IS NULL OR TRIM(shared_prompt_api_name) = ''" . $copiedSharedPromptApiNameFallback . " THEN " . $db->quote(DEFAULT_PROMPT_API_NAME) . " ELSE shared_prompt_api_name END,
      shared_prompt_api_base_url = COALESCE(NULLIF(shared_prompt_api_base_url, ''), shared_api_base_url),
      shared_prompt_request_timeout = IFNULL(NULLIF(shared_prompt_request_timeout, 0), shared_request_timeout),
      shared_prompt_api_key_ciphertext = COALESCE(shared_prompt_api_key_ciphertext, shared_api_key_ciphertext),
      shared_prompt_api_key_iv = COALESCE(shared_prompt_api_key_iv, shared_api_key_iv),
      shared_prompt_api_key_tag = COALESCE(shared_prompt_api_key_tag, shared_api_key_tag),
      shared_prompt_api_key_hint = COALESCE(shared_prompt_api_key_hint, shared_api_key_hint),
      shared_vision_api_name = CASE WHEN shared_vision_api_name IS NULL OR TRIM(shared_vision_api_name) = ''" . $copiedSharedVisionApiNameFallback . " THEN " . $db->quote(DEFAULT_VISION_API_NAME) . " ELSE shared_vision_api_name END,
      shared_vision_api_base_url = COALESCE(NULLIF(shared_vision_api_base_url, ''), shared_api_base_url),
      shared_vision_request_timeout = IFNULL(NULLIF(shared_vision_request_timeout, 0), shared_request_timeout),
      shared_vision_api_key_ciphertext = COALESCE(shared_vision_api_key_ciphertext, shared_api_key_ciphertext),
      shared_vision_api_key_iv = COALESCE(shared_vision_api_key_iv, shared_api_key_iv),
      shared_vision_api_key_tag = COALESCE(shared_vision_api_key_tag, shared_api_key_tag),
      shared_vision_api_key_hint = COALESCE(shared_vision_api_key_hint, shared_api_key_hint)");

    $db->exec("UPDATE image_jobs SET completed_at = created_at WHERE status = 'completed' AND completed_at IS NULL");
    $db->exec("UPDATE image_jobs SET revised_prompt = NULL WHERE revised_prompt IS NOT NULL AND (TRIM(revised_prompt) = '' OR TRIM(revised_prompt) = TRIM(COALESCE(prompt, '')))");
    $db->exec("UPDATE wall_items SET revised_prompt = NULL WHERE revised_prompt IS NOT NULL AND (TRIM(revised_prompt) = '' OR TRIM(revised_prompt) = TRIM(COALESCE(prompt, '')))");

    $stmt = $db->prepare('INSERT INTO schema_meta (meta_key, meta_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)');
    $stmt->execute(['schema_version', SCHEMA_VERSION]);

    $state['schemaReady'] = true;
}

function require_database(): void
{
    try {
        ensure_schema();
    } catch (Throwable $error) {
        $message = $error->getMessage();
        error_log('[gpt_biubiubiu] schema: ' . $message);
        if (preg_match('/Missing required environment variable: ([A-Z0-9_]+)/', $message, $matches)) {
            json_response(['error' => '服务端缺少环境变量：' . $matches[1]], 503);
        }
        if (preg_match('/Missing strong environment secret: ([A-Z0-9_]+)/', $message, $matches)) {
            json_response(['error' => '服务端缺少强随机密钥：' . $matches[1]], 503);
        }
        json_response(['error' => '服务端未配置 MySQL'], 503);
    }
}