CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(96) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  model VARCHAR(128) DEFAULT NULL,
  api_name VARCHAR(128) DEFAULT NULL,
  api_base_url VARCHAR(255) DEFAULT NULL,
  request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
  stream TINYINT(1) NOT NULL DEFAULT 0,
  active_api_config_id BIGINT UNSIGNED DEFAULT NULL,
  active_shared TINYINT(1) NOT NULL DEFAULT 0,
  active_prompt_api_config_id BIGINT UNSIGNED DEFAULT NULL,
  active_prompt_shared TINYINT(1) NOT NULL DEFAULT 0,
  api_key_ciphertext TEXT DEFAULT NULL,
  api_key_iv VARCHAR(64) DEFAULT NULL,
  api_key_tag VARCHAR(64) DEFAULT NULL,
  api_key_hint VARCHAR(24) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_api_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  api_scope VARCHAR(32) NOT NULL DEFAULT 'all',
  api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
  api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
  model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
  request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
  api_key_ciphertext TEXT DEFAULT NULL,
  api_key_iv VARCHAR(64) DEFAULT NULL,
  api_key_tag VARCHAR(64) DEFAULT NULL,
  api_key_hint VARCHAR(24) DEFAULT NULL,
  prompt_api_name VARCHAR(128) NOT NULL DEFAULT '提示词助手 API',
  prompt_api_base_url VARCHAR(255) DEFAULT NULL,
  prompt_model VARCHAR(128) DEFAULT NULL,
  prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
  prompt_api_key_ciphertext TEXT DEFAULT NULL,
  prompt_api_key_iv VARCHAR(64) DEFAULT NULL,
  prompt_api_key_tag VARCHAR(64) DEFAULT NULL,
  prompt_api_key_hint VARCHAR(24) DEFAULT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_api_configs_user_sort (user_id, sort_order, id),
  CONSTRAINT fk_user_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key VARCHAR(191) NOT NULL PRIMARY KEY,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED DEFAULT NULL,
  request_id VARCHAR(80) DEFAULT NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'generation',
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  prompt TEXT DEFAULT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wall_items (
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
  INDEX idx_wall_items_source_job (source_job_id),
  CONSTRAINT fk_wall_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_wall_items_job FOREIGN KEY (source_job_id) REFERENCES image_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  wall_require_login TINYINT(1) NOT NULL DEFAULT 0,
  registration_enabled TINYINT(1) NOT NULL DEFAULT 1,
  shared_api_enabled TINYINT(1) NOT NULL DEFAULT 0,
  shared_api_name VARCHAR(128) NOT NULL DEFAULT 'OpenAI gpt-image-2',
  shared_api_base_url VARCHAR(255) NOT NULL DEFAULT 'https://api.openai.com',
  shared_model VARCHAR(128) NOT NULL DEFAULT 'gpt-image-2',
  shared_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
  shared_api_key_ciphertext TEXT DEFAULT NULL,
  shared_api_key_iv VARCHAR(64) DEFAULT NULL,
  shared_api_key_tag VARCHAR(64) DEFAULT NULL,
  shared_api_key_hint VARCHAR(24) DEFAULT NULL,
  prompt_tools_enabled TINYINT(1) NOT NULL DEFAULT 1,
  shared_prompt_api_name VARCHAR(128) NOT NULL DEFAULT '提示词助手 API',
  shared_prompt_api_base_url VARCHAR(255) DEFAULT NULL,
  shared_prompt_model VARCHAR(128) DEFAULT NULL,
  shared_prompt_request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
  shared_prompt_api_key_ciphertext TEXT DEFAULT NULL,
  shared_prompt_api_key_iv VARCHAR(64) DEFAULT NULL,
  shared_prompt_api_key_tag VARCHAR(64) DEFAULT NULL,
  shared_prompt_api_key_hint VARCHAR(24) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;