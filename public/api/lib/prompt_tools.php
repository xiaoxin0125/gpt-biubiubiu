<?php

declare(strict_types=1);

function prompt_tools_language_rule(string $outputLanguage): string
{
    $language = strtolower(trim($outputLanguage));
    if (in_array($language, ['zh', 'chinese', '中文'], true)) return '输出语言：中文。';
    if (in_array($language, ['en', 'english'], true)) return 'Output language: English.';
    return '输出语言：自动识别用户输入语言，用户用中文则输出中文，用户用英文则输出英文；如果输入语言混合，以用户主要语言输出。';
}

function prompt_tools_rule_text(string $type, string $rule, string $customRule = '', string $outputLanguage = 'auto'): string
{
    $optimizeRules = [
        'general' => '你是一位拥有全学科视觉知识的图像生成提示词专家。将原始提示词扩写为更完整的图像生成提示词，先判断内容所属领域，再补足主体、场景、构图、光线、材质、风格和画面细节。严格保留用户原意和核心关键词，不输出解释、Markdown、标题、前缀或引号。',
        'portrait' => '你是一位追求自然真实感与极致细节的人像摄影提示词专家。将用户的人像描述扩写为画面感强、细节丰富、符合自然审美的高质量提示词，重点补足皮肤质感、五官情绪、服饰材质、构图视角、光影色彩和环境氛围。严格保留用户原意和核心关键词，不输出解释、Markdown、标题、前缀或引号。',
        'tags' => '你是一位精通 Danbooru 标签体系与 Stable Diffusion 权重语法的提示词工程师。将原始提示词转为 tags 风格，使用逗号分隔，按画质词、主体、服饰与特征、背景、光影构图、风格后缀的顺序组织。可按重要程度合理使用括号权重，只输出 tags，不输出完整自然语言句子。',
    ];
    $captionRules = [
        'natural' => '根据图片反推出适合生图的自然语言提示词，描述主体、场景、构图、光照、色彩、风格和关键细节。只输出提示词，不输出解释、Markdown、标题、前缀或引号。',
        'tags' => '根据图片反推出 tags 风格提示词，使用逗号分隔，优先输出可用于图像生成的视觉标签，可包含画质词、主体细节、环境、构图、光影和风格词。只输出 tags，不输出解释、Markdown、标题、前缀或引号。',
    ];

    $legacyRules = $type === 'caption' ? ['edit' => 'natural'] : ['qwen-edit' => 'general', 'kontext' => 'general'];
    $ruleKey = $legacyRules[$rule] ?? $rule;
    $rules = $type === 'caption' ? $captionRules : $optimizeRules;
    $base = $rules[$ruleKey] ?? reset($rules);
    $custom = trim($customRule);
    $segments = [$base, prompt_tools_language_rule($outputLanguage)];
    if ($custom !== '') $segments[] = '额外规则：' . $custom;
    return implode("\n", $segments);
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

function prompt_tools_active_config(array $user, string $category): array
{
    $userId = (int) $user['id'];
    $settings = ensure_user_settings_row($userId);
    $configs = user_api_config_rows($userId);
    $keyedOwnConfig = first_keyed_user_api_config_row_for_category($configs, $category);
    $categoryLabel = $category === 'vision' ? '图片反推/视觉' : '提示词优化';

    if (shared_api_enabled() && (!$keyedOwnConfig || !empty($settings['active_shared']))) {
        $row = site_settings_row();
        $client = shared_api_category_client($row, $category);
        return [
            'apiName' => $client['apiName'],
            'apiBaseUrl' => $client['apiBaseUrl'],
            'model' => $client['model'],
            'requestTimeout' => $client['requestTimeout'],
            'apiKey' => decrypt_shared_api_key($row, $category),
            'isShared' => true,
            'categoryLabel' => $categoryLabel,
        ];
    }

    $active = active_api_config_row($userId) ?: [];
    $prefix = $category === 'vision' ? 'vision_' : 'prompt_';
    $client = api_client_category($active, $category);
    $apiKey = decrypt_prefixed_api_key($active, $prefix);
    if ($apiKey === '' && $keyedOwnConfig) {
        $active = $keyedOwnConfig;
        $client = api_client_category($active, $category);
        $apiKey = decrypt_prefixed_api_key($active, $prefix);
    }

    return [
        'apiName' => $client['apiName'],
        'apiBaseUrl' => $client['apiBaseUrl'],
        'model' => $client['model'],
        'requestTimeout' => $client['requestTimeout'],
        'apiKey' => $apiKey,
        'isShared' => false,
        'categoryLabel' => $categoryLabel,
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
    if ($apiKey === '') json_response(['error' => '当前' . ($config['categoryLabel'] ?? '提示词助手') . ' API 配置缺少 API Key'], 400);
    if ($model === '') json_response(['error' => '请先配置' . ($config['categoryLabel'] ?? '提示词助手') . '使用的模型'], 400);

    $payload = [
        'model' => $model,
        'messages' => $messages,
        'temperature' => 0.4,
        'stream' => false,
    ];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('请求参数序列化失败');

    $response = outbound_http_request('POST', prompt_tools_chat_url((string) $config['apiBaseUrl']), [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $apiKey,
    ], $json, normalize_request_timeout($config['requestTimeout'] ?? DEFAULT_REQUEST_TIMEOUT), OUTBOUND_MAX_RESPONSE_BYTES);
    $responseText = (string) ($response['body'] ?? '');
    $status = (int) ($response['status'] ?? 0);

    if ($responseText === '') throw new RuntimeException('上游接口请求失败，请检查 API 地址、密钥或模型。');
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
    $outputLanguage = trim((string) ($body['outputLanguage'] ?? ($body['output_language'] ?? 'auto'))) ?: 'auto';
    $customRule = trim((string) ($body['customRule'] ?? ($body['custom_rule'] ?? '')));
    $ruleText = prompt_tools_rule_text('optimize', $rule, $customRule, $outputLanguage);
    $config = prompt_tools_active_config($user, 'prompt');

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

function prompt_tools_image_mime_from_header(string $bytes): string
{
    if (strncmp($bytes, "\x89PNG\r\n\x1a\n", 8) === 0) return 'image/png';
    if (strncmp($bytes, "\xff\xd8\xff", 3) === 0) return 'image/jpeg';
    if (strncmp($bytes, 'GIF87a', 6) === 0 || strncmp($bytes, 'GIF89a', 6) === 0) return 'image/gif';
    if (strlen($bytes) >= 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') return 'image/webp';
    return '';
}

function prompt_tools_image_mime(string $bytes, array $file): string
{
    if (class_exists('finfo')) {
        try {
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->buffer($bytes);
            if (is_string($mime) && $mime !== '') return $mime;
        } catch (Throwable $error) {
        }
    }

    $headerMime = prompt_tools_image_mime_from_header($bytes);
    if ($headerMime !== '') return $headerMime;

    if (function_exists('getimagesizefromstring')) {
        $info = @getimagesizefromstring($bytes);
        if (is_array($info) && !empty($info['mime'])) return (string) $info['mime'];
    }

    $uploadedMime = trim((string) ($file['type'] ?? ''));
    return $uploadedMime !== '' ? $uploadedMime : 'application/octet-stream';
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
        $mime = prompt_tools_image_mime($bytes, $file);
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
    $outputLanguage = trim((string) ($_POST['outputLanguage'] ?? ($_POST['output_language'] ?? ($body['outputLanguage'] ?? ($body['output_language'] ?? 'auto'))))) ?: 'auto';
    $customRule = trim((string) ($_POST['customRule'] ?? ($_POST['custom_rule'] ?? ($body['customRule'] ?? ($body['custom_rule'] ?? '')))));
    $extraPrompt = trim((string) ($_POST['extraPrompt'] ?? ($_POST['extra_prompt'] ?? ($body['extraPrompt'] ?? ($body['extra_prompt'] ?? '')))));
    $ruleText = prompt_tools_rule_text('caption', $rule, $customRule, $outputLanguage);
    $config = prompt_tools_active_config($user, 'vision');

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