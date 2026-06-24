<?php

declare(strict_types=1);

function prompt_tools_rule_text(string $type, string $rule, string $customRule = ''): string
{
    $optimizeRules = [
        'general' => '将原始提示词扩写为更完整的图像生成提示词，补足主体、场景、构图、光线、材质、风格和画面细节。保留用户原意，不添加解释。',
        'tags' => '将原始提示词优化为英文 tags 风格，使用逗号分隔，适合 Stable Diffusion / LoRA / 通用生图模型。只输出 tags。',
        'qwen-edit' => '将原始提示词优化为 Qwen-Image-Edit 图像编辑指令，明确要保留的元素、要修改的区域、目标效果和约束。只输出编辑指令。',
        'kontext' => '将原始提示词优化为 Kontext 图像编辑指令，并翻译成自然、准确的英文。强调主体一致性、局部编辑范围和最终效果。只输出英文指令。',
    ];
    $captionRules = [
        'natural' => '根据图片反推出适合生图的自然语言提示词，描述主体、场景、构图、光照、色彩、风格和关键细节。只输出提示词。',
        'tags' => '根据图片反推出英文 tags 风格提示词，使用逗号分隔，优先输出可用于图像生成的视觉标签。只输出 tags。',
        'edit' => '根据图片内容反推出适合图像编辑模型的指令，描述需要保留的画面信息和可执行的编辑方向。只输出编辑指令。',
    ];

    $rules = $type === 'caption' ? $captionRules : $optimizeRules;
    $base = $rules[$rule] ?? reset($rules);
    $custom = trim($customRule);
    return $custom === '' ? $base : $base . "\n额外规则：" . $custom;
}

function prompt_tools_chat_url(string $apiBaseUrl): string
{
    $baseUrl = normalize_api_base_url($apiBaseUrl ?: DEFAULT_API_BASE_URL);
    if (!valid_api_base_url($baseUrl)) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);

    $parts = parse_url($baseUrl);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) json_response(['error' => 'API 地址必须是 http 或 https 地址'], 400);

    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    if ($path === '') {
        $path = '/v1/chat/completions';
    } elseif (substr($path, -3) === '/v1') {
        $path .= '/chat/completions';
    } elseif (substr($path, -17) !== '/chat/completions') {
        $path .= '/v1/chat/completions';
    }

    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
    $user = isset($parts['user']) ? rawurlencode((string) $parts['user']) : '';
    $pass = isset($parts['pass']) ? ':' . rawurlencode((string) $parts['pass']) : '';
    $auth = $user !== '' ? $user . $pass . '@' : '';
    return strtolower((string) $parts['scheme']) . '://' . $auth . strtolower((string) $parts['host']) . $port . $path;
}

function prompt_tools_active_config(array $user, string $modelField, string $sharedModelField): array
{
    $userId = (int) $user['id'];
    $settings = ensure_user_settings_row($userId);
    $configs = user_api_config_rows($userId);
    $keyedOwnConfig = first_keyed_user_api_config_row($configs);

    if (shared_api_enabled() && (!$keyedOwnConfig || !empty($settings['active_shared']))) {
        $row = site_settings_row();
        return [
            'apiName' => trim((string) ($row['shared_api_name'] ?? '')) ?: DEFAULT_API_NAME,
            'apiBaseUrl' => trim((string) ($row['shared_api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
            'model' => trim((string) ($row[$sharedModelField] ?? '')),
            'requestTimeout' => normalize_request_timeout($row['shared_request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
            'apiKey' => decrypt_shared_api_key($row),
            'isShared' => true,
        ];
    }

    $active = active_api_config_row($userId) ?: [];
    $apiKey = decrypt_api_key($active);
    if ($apiKey === '' && $keyedOwnConfig) {
        $active = $keyedOwnConfig;
        $apiKey = decrypt_api_key($active);
    }

    return [
        'apiName' => trim((string) ($active['api_name'] ?? '')) ?: DEFAULT_API_NAME,
        'apiBaseUrl' => trim((string) ($active['api_base_url'] ?? '')) ?: DEFAULT_API_BASE_URL,
        'model' => trim((string) ($active[$modelField] ?? '')),
        'requestTimeout' => normalize_request_timeout($active['request_timeout'] ?? DEFAULT_REQUEST_TIMEOUT),
        'apiKey' => $apiKey,
        'isShared' => false,
    ];
}

function prompt_tools_extract_text($value): string
{
    if (is_string($value)) return trim($value);
    if (is_array($value)) {
        $parts = [];
        foreach ($value as $item) {
            if (is_string($item)) {
                $parts[] = $item;
            } elseif (is_array($item)) {
                if (isset($item['text']) && is_string($item['text'])) $parts[] = $item['text'];
                elseif (isset($item['text']['value']) && is_string($item['text']['value'])) $parts[] = $item['text']['value'];
            }
        }
        return trim(implode("\n", $parts));
    }
    return '';
}

function prompt_tools_result_from_response(array $data): string
{
    $choice = $data['choices'][0] ?? [];
    if (is_array($choice)) {
        $message = is_array($choice['message'] ?? null) ? $choice['message'] : [];
        $content = prompt_tools_extract_text($message['content'] ?? null);
        if ($content !== '') return $content;
        $text = prompt_tools_extract_text($choice['text'] ?? null);
        if ($text !== '') return $text;
    }

    $outputText = prompt_tools_extract_text($data['output_text'] ?? null);
    if ($outputText !== '') return $outputText;

    if (is_array($data['output'] ?? null)) {
        foreach ($data['output'] as $item) {
            if (!is_array($item)) continue;
            $text = prompt_tools_extract_text($item['content'] ?? null);
            if ($text !== '') return $text;
        }
    }

    throw new RuntimeException('上游接口没有返回可用文本。');
}

function prompt_tools_post_chat(array $config, array $messages): array
{
    $apiKey = trim((string) ($config['apiKey'] ?? ''));
    $model = trim((string) ($config['model'] ?? ''));
    if ($apiKey === '') json_response(['error' => '当前 API 配置缺少 API Key'], 400);
    if ($model === '') json_response(['error' => '请先配置提示词助手使用的模型'], 400);

    $payload = [
        'model' => $model,
        'messages' => $messages,
        'temperature' => 0.4,
        'stream' => false,
    ];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('请求参数序列化失败');

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", [
                'Content-Type: application/json',
                'Accept: application/json',
                'Authorization: Bearer ' . $apiKey,
            ]) . "\r\n",
            'content' => $json,
            'timeout' => normalize_request_timeout($config['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT),
            'ignore_errors' => true,
        ],
    ]);

    $responseText = @file_get_contents(prompt_tools_chat_url((string) $config['apiBaseUrl']), false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $matches)) {
            $status = (int) $matches[1];
            break;
        }
    }

    if ($responseText === false || $responseText === '') throw new RuntimeException('上游接口请求失败，请检查 API 地址、密钥或模型。');
    $data = json_decode($responseText, true);
    if (!is_array($data)) throw new RuntimeException('上游接口返回了无法解析的数据。');
    if ($status >= 400) {
        $message = $data['error']['message'] ?? $data['error'] ?? $data['message'] ?? '上游接口请求失败。';
        throw new RuntimeException(is_string($message) ? $message : '上游接口请求失败。');
    }

    return $data;
}

function handle_prompt_optimize(array $body): array
{
    $user = require_user();
    if (!prompt_tools_enabled()) json_response(['error' => '提示词助手已关闭'], 403);

    $prompt = trim((string) ($body['prompt'] ?? ($body['inputPrompt'] ?? ($body['text'] ?? ''))));
    if ($prompt === '') json_response(['error' => '请输入需要优化的提示词'], 400);
    if (mb_strlen($prompt) > 8000) json_response(['error' => '提示词过长，请控制在 8000 字以内'], 400);

    $rule = trim((string) ($body['rule'] ?? 'general')) ?: 'general';
    $customRule = trim((string) ($body['customRule'] ?? ($body['custom_rule'] ?? '')));
    $ruleText = prompt_tools_rule_text('optimize', $rule, $customRule);
    $config = prompt_tools_active_config($user, 'prompt_model', 'shared_prompt_model');

    $messages = [
        ['role' => 'system', 'content' => '你是图像生成提示词优化助手。严格遵守用户给出的规则，只输出最终提示词文本，不输出解释、Markdown、标题、前缀或引号。'],
        ['role' => 'user', 'content' => "规则：{$ruleText}\n\n原始提示词：{$prompt}"],
    ];
    $data = prompt_tools_post_chat($config, $messages);

    return [
        'result' => prompt_tools_result_from_response($data),
        'model' => $config['model'],
        'rule' => $rule,
        'apiName' => $config['apiName'],
        'usage' => $data['usage'] ?? null,
    ];
}

function prompt_tools_image_data_url(array $body): string
{
    $file = $_FILES['image'] ?? null;
    if (is_array($file) && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0) json_response(['error' => '图片文件为空'], 400);
        if ($size > MAX_IMAGE_UPLOAD_BYTES) json_response(['error' => '图片不能超过 20MB'], 400);
        $bytes = @file_get_contents((string) ($file['tmp_name'] ?? ''));
        if ($bytes === false || $bytes === '') json_response(['error' => '图片读取失败'], 400);
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->buffer($bytes) ?: 'application/octet-stream';
        if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true)) json_response(['error' => '仅支持 PNG、JPEG、WEBP 或 GIF 图片'], 400);
        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    $dataUrl = trim((string) ($body['image'] ?? ($body['dataUrl'] ?? ($body['data_url'] ?? ''))));
    if ($dataUrl !== '' && preg_match('#^data:image/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$#i', $dataUrl)) return $dataUrl;

    json_response(['error' => '请上传一张图片'], 400);
    return '';
}

function handle_prompt_caption(array $body): array
{
    $user = require_user();
    if (!prompt_tools_enabled()) json_response(['error' => '提示词助手已关闭'], 403);

    $dataUrl = prompt_tools_image_data_url($body);
    $rule = trim((string) ($_POST['rule'] ?? ($body['rule'] ?? 'natural'))) ?: 'natural';
    $customRule = trim((string) ($_POST['customRule'] ?? ($_POST['custom_rule'] ?? ($body['customRule'] ?? ($body['custom_rule'] ?? '')))));
    $extraPrompt = trim((string) ($_POST['extraPrompt'] ?? ($_POST['extra_prompt'] ?? ($body['extraPrompt'] ?? ($body['extra_prompt'] ?? '')))));
    $ruleText = prompt_tools_rule_text('caption', $rule, $customRule);
    $config = prompt_tools_active_config($user, 'vision_model', 'shared_vision_model');

    $text = "规则：{$ruleText}";
    if ($extraPrompt !== '') $text .= "\n额外要求：{$extraPrompt}";

    $messages = [
        ['role' => 'system', 'content' => '你是图像提示词反推助手。根据图片生成可用于图像生成或图像编辑的提示词。只输出最终提示词文本，不输出解释、Markdown、标题、前缀或引号。'],
        ['role' => 'user', 'content' => [
            ['type' => 'text', 'text' => $text],
            ['type' => 'image_url', 'image_url' => ['url' => $dataUrl]],
        ]],
    ];
    $data = prompt_tools_post_chat($config, $messages);

    return [
        'result' => prompt_tools_result_from_response($data),
        'model' => $config['model'],
        'rule' => $rule,
        'apiName' => $config['apiName'],
        'usage' => $data['usage'] ?? null,
    ];
}