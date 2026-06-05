# gpt-biubiubiu

黑白硬边风格的在线生图模板。前端使用 Vite + React，生产后端是 PHP 单入口 API，部署后不需要单独启动 Node 服务。

## 功能

- GPT-Image-2 文生图和图片编辑合并在同一工作台：无参考图走文生图，有参考图走图片编辑
- 图片编辑支持最多 16 张 `image[]` 参考图，上传顺序对应提示词中的“图1/图2/...”
- 支持可选 `mask`，用于第一张参考图的局部重绘
- `workbench-actions` 集中展示尺寸、质量、背景、格式、压缩、审核、数量、参考图、mask 和发送按钮
- 压缩参数始终显示；仅 `jpeg` / `webp` 可编辑，`png` 时置灰且不向上游发送
- 支持保存 `stream` 开关，请求时转发 `stream=true`；前端仍通过任务状态和轮询拿最终 JSON 图片结果
- 支持最高 999 秒应用层请求超时，避免长时间生图在 600 秒处被本地中转主动断开
- `image-board` 展示生成图与作品墙，支持搜索、筛选、下载、复用配置、上墙/取消上墙
- 用户注册登录、个人生成配置保存；用户 API Key 加密保存到 MySQL，后端不返回明文
- 兼容 OpenAI 风格的 `/v1/images/generations` 与 `/v1/images/edits`
- 支持 `url` 与 `b64_json` 两种图片返回格式

## PHP 配置

生产环境使用项目根目录的 `.php-api-config.php`，它不会进入前端，也已被 `.gitignore` 忽略。

可复制示例：

```bash
cp .php-api-config.example.php .php-api-config.php
```

配置项：

```php
<?php
return [
    'openai_base_url' => 'https://api.openai.com',
    'openai_api_key' => 'sk-your-api-key',
    'openai_image_model' => 'gpt-image-2',
    'mysql_host' => '127.0.0.1',
    'mysql_port' => 3306,
    'mysql_user' => 'your-db-user',
    'mysql_password' => 'your-db-password',
    'mysql_database' => 'your-db-name',
    'session_secret' => 'replace-with-a-long-random-session-secret',
    'user_api_key_secret' => 'replace-with-a-long-random-api-key-secret',
];
```

`.php-api-config.example.php` 与 `env.example` 都默认使用 `gpt-image-2`。个人 API 地址和 API Key 也可以登录后在设置页保存。

## 数据库

PHP API 首次请求会自动创建所需表，也可以手动导入：

```bash
mysql -u your-db-user -p your-db-name < server/schema.sql
```

主要数据：

- `users`：用户账号
- `user_settings`：用户默认生成参数、流式开关、999 秒请求超时和加密 API Key
- `image_jobs`：生成任务状态与结果快照
- `wall_items`：作品墙数据

## 本地开发

启动 PHP API：

```bash
php -S 127.0.0.1:8088 -t public
```

启动前端：

```bash
npm install
npm run dev:client
```

Vite 会把 `/api` 代理到 `http://127.0.0.1:8088`。`server/index.js` 仅作为开发/备用 Node 入口保留，生产部署不需要运行它。

## 生产部署

```bash
npm install
npm run build
```

构建后 `public/api` 会复制到 `dist/api`。

宝塔/PHP 推荐：

- 网站运行目录指向 `dist`
- PHP 版本建议 7.4+
- 启用扩展：PDO MySQL、cURL、OpenSSL
- 不需要反向代理到 Node，也不需要运行 `node server/index.js`

长时间 GPT-Image-2 生图建议同步放大外层超时：

```nginx
proxy_read_timeout 999s;
fastcgi_read_timeout 999s;
send_timeout 999s;
```

如果仍出现 `stream disconnected before completion` 或 504，优先检查宝塔/Nginx/PHP-FPM 的外层超时是否早于应用层 999 秒。

前端请求会访问：

```text
/api/index.php?route=/health
/api/index.php?route=/health&job={jobId}
/api/index.php?route=/images/generations
/api/index.php?route=/images/edits
/api/index.php?route=/wall
/api/index.php?route=/auth/me
/api/index.php?route=/settings
```

## GPT-Image-2 参数

### 文生图

```text
POST /api/images/generations
Content-Type: application/json
```

转发白名单：

```json
{
  "model": "gpt-image-2",
  "prompt": "黑白极简风格的机械猫",
  "size": "2048x2048",
  "quality": "medium",
  "output_format": "jpeg",
  "output_compression": 85,
  "background": "opaque",
  "moderation": "auto",
  "n": 1,
  "stream": true
}
```

规则：

- `n` 固定为 `1`
- `quality` 支持 `low` / `medium` / `high` / `auto`；`auto` 不主动转发
- `background` 支持 `auto` / `opaque`；不支持 `transparent`
- `output_format` 支持 `png` / `jpeg` / `webp`
- `output_compression` 只在 `jpeg` / `webp` 时转发
- `moderation` 仅文生图转发，支持 `auto` / `low`
- 不转发 `negative_prompt`、`style`、`response_format`、`input_fidelity`

### 图片编辑

```text
POST /api/images/edits
Content-Type: multipart/form-data
```

转发白名单：

```text
model=gpt-image-2
prompt=把图1的人物放进图2的场景，沿用图3的色彩风格
image[]=person.png
image[]=scene.png
image[]=style.png
mask=mask.png
size=1536x1024
quality=high
output_format=webp
output_compression=85
background=opaque
stream=true
```

规则：

- `image[]` 最多 16 张，支持 `png` / `jpg` / `webp`
- 多图顺序会保留，提示词中可用“图1/图2/图3”指代
- `mask` 可选，仅对第一张参考图生效，必须是 PNG 且小于 4MB
- 图片编辑不转发 `n` / `moderation`
- `output_compression` 只在 `jpeg` / `webp` 时转发
- 不转发 `input_fidelity` 和 `background=transparent`

## 响应说明

API易 GPT-Image-2 返回的 `b64_json` 是纯 base64 字符串，不包含 `data:image/...;base64,` 前缀。

前端展示时会按 `output_format` 自动补齐 MIME 前缀；如果你自己消费接口，需要自行 decode 或拼接 data URL。
