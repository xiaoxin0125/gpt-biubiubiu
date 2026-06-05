# gpt-biubiubiu

黑白硬边风格的在线生图模板。前端使用 Vite + React，后端改为 PHP 单入口 API，部署后不需要单独启动 Node 服务。

## 功能

- 文生图和图生图合并在同一页面：无参考图走文生图，有参考图走图生图
- `image-board` 作为生成图与作品墙展示区域
- 顶部 `canvas-toolbar` 支持搜索提示词、参数、作者，并按状态筛选
- 图片详情弹窗：大图预览、参数快照、下载、复用配置、上墙/取消上墙
- 作品墙：未登录上墙显示“未知艺术家”，登录用户显示用户名
- 用户注册登录、个人生成配置保存
- 用户 API Key 可加密保存到 MySQL；保存前前端会二次确认，后端不返回明文
- 兼容 OpenAI 风格的 `/v1/images/generations` 与 `/v1/images/edits`
- 支持 `url` 与 `b64_json` 两种图片返回格式
- 最近 30 条生成记录保存在浏览器本地

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
    'openai_image_model' => 'gpt-image-1',
    'mysql_host' => '127.0.0.1',
    'mysql_port' => 3306,
    'mysql_user' => 'your-db-user',
    'mysql_password' => 'your-db-password',
    'mysql_database' => 'your-db-name',
    'session_secret' => 'replace-with-a-long-random-session-secret',
    'user_api_key_secret' => 'replace-with-a-long-random-api-key-secret',
];
```

当前本机配置文件已按你的数据库信息写入：数据库名、用户和密码保存在 `.php-api-config.php`，不会在页面暴露。

## 数据库

PHP API 首次请求会自动创建所需表，也可以手动导入：

```bash
mysql -u your-db-user -p your-db-name < server/schema.sql
```

主要数据：

- `users`：用户账号
- `user_settings`：用户默认生成参数和加密 API Key
- `image_jobs`：生成记录快照
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

Vite 会把 `/api` 代理到 `http://127.0.0.1:8088`。

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

前端请求会访问：

```text
/api/index.php?route=/health
/api/index.php?route=/images/generations
/api/index.php?route=/images/edits
/api/index.php?route=/wall
/api/index.php?route=/auth/me
/api/index.php?route=/settings
```

## 接口形态

文生图：

```text
POST /api/images/generations
```

图生图：

```text
POST /api/images/edits
Content-Type: multipart/form-data
```

常用参数：

```json
{
  "model": "gpt-image-1",
  "prompt": "黑白极简风格的机械猫",
  "negative_prompt": "低清晰度，畸形",
  "size": "1024x1024",
  "n": 1,
  "quality": "medium",
  "style": "auto",
  "response_format": "url",
  "output_format": "png",
  "moderation": "auto"
}
```

规则：

- 自动尺寸模式不会向上游传递 `size`
- `quality` 只允许 `low / medium / high`
- `style`、`moderation` 等为 `auto` 时不会转发
- 不再转发 `output_compression`