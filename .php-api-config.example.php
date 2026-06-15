<?php
return [
    // 仅作为新用户 API 配置的默认值；真实 API Key 由用户登录后在设置页保存。
    'openai_base_url' => 'https://api.openai.com',
    'openai_image_model' => 'gpt-image-2',

    'mysql_host' => '127.0.0.1',
    'mysql_port' => 3306,
    'mysql_user' => 'your-db-user',
    'mysql_password' => 'your-db-password',
    'mysql_database' => 'your-db-name',

    'session_secret' => 'replace-with-a-long-random-session-secret',
    'user_api_key_secret' => 'replace-with-a-long-random-api-key-secret',

    // 可选：首次部署时显式创建管理员。留空则不自动创建。
    'bootstrap_admin_username' => '',
    'bootstrap_admin_password' => '',
    'bootstrap_admin_display_name' => '',
];