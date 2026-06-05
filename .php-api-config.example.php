<?php
return [
    'openai_base_url' => 'https://api.openai.com',
    'openai_api_key' => 'sk-your-api-key',
    'openai_image_model' => 'gpt-image-2',
    // 单次生图应用层超时最高支持 999 秒；外层 Nginx/宝塔超时也需要同步放大。
    'mysql_host' => '127.0.0.1',
    'mysql_port' => 3306,
    'mysql_user' => 'your-db-user',
    'mysql_password' => 'your-db-password',
    'mysql_database' => 'your-db-name',
    'session_secret' => 'replace-with-a-long-random-session-secret',
    'user_api_key_secret' => 'replace-with-a-long-random-api-key-secret',
];