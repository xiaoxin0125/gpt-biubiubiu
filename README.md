# gpt-biubiubiu

面向 OpenAI 兼容接口的 Web 生图工作台。前端负责交互和私有 API 直连，PHP API 负责账号、站点配置、共享 API 代理、图片落盘、生成记录和作品墙。

## 源码分析结论

这个项目不是一个 Node 服务，而是一个“静态前端 + PHP 单入口 API + MySQL + 本地图片文件”的部署形态。

```text
浏览器
  -> React / Vite 页面
  -> 私有 API Key：浏览器直连 OpenAI 兼容 Images API
  -> 共享 API Key：浏览器调用本站 PHP，PHP 再访问上游

本站 PHP API
  -> public/api/index.php 单入口
  -> public/api/routes.php 路由分发
  -> public/api/lib/* 业务模块

数据持久化
  -> MySQL：账号、配置、生成记录、作品墙
  -> wall-images：原图与展示图
```

核心边界很清晰：

- `src/` 只处理浏览器状态、表单参数、图片展示和用户交互。
- `public/api/` 只处理本站业务状态、安全校验、数据库、共享代理和文件落盘。
- `server/schema.sql` 是初始化参考；真实运行时还会由 PHP 自动建表和补列。
- 私有 API Key 登录后会同步到浏览器用于直连上游；共享 API Key 不下发到浏览器，只在 PHP 后端解密使用。

## 功能概览

- 文生图：兼容 `/v1/images/generations`
- 图生图：兼容 `/v1/images/edits`
- 多参考图：前端最多 16 张
- Mask：页面限制 4MB，服务端共享代理要求 PNG
- 输出数量：最多 10 张
- 尺寸：支持 1K / 2K / 4K、常用比例和自定义尺寸
- 响应格式：支持 URL 与 Base64
- 输出格式：支持 `png`、`jpeg`、`webp`
- 多套 API 配置：每套配置分为生图、提示词优化、图片反推三类 API
- 共享 API：管理员统一配置额度，普通用户可免私有 Key 使用
- 提示词助手：支持提示词优化、图片反推提示词、结果复制和填入生图
- 账号系统：登录、注册、验证码、资料修改、密码修改、频控
- 站点管理：注册开关、作品墙登录开关、提示词助手开关、共享 API 开关
- 生成记录：生成成功后保存到 MySQL，并把图片落盘
- 作品墙：用户发布自己的已保存作品，管理员可管理全部作品

## 模块关系

```text
src/App.jsx
  -> 安装状态、登录态、站点开关、API 配置、生成队列、作品列表

src/hooks/
  -> useSession：账号与设置保存
  -> useGeneration：生图请求、结果归一化、生成记录保存
  -> useBoard / useWall：瀑布流、分页和作品墙数据
  -> useApiConfig：多 API 配置表单操作

src/components/
  -> Workbench：生图参数与提交
  -> ImageBoard / ImageDetailModal：作品展示与详情
  -> AccountModal：登录、账号、API 配置、站点管理入口
  -> SiteAdminPanel：管理员站点开关和共享 API
  -> PromptTools：提示词优化和图片反推
  -> InstallPanel：首次安装配置

public/api/
  -> bootstrap.php：配置加载、JSON 响应、同源校验、外部请求限制
  -> routes.php：路由表
  -> lib/auth.php：账号、验证码、Cookie、频控
  -> lib/settings.php：用户 API 配置、Key 加密、模型列表
  -> lib/site.php：站点开关、共享 API 配置
  -> lib/image_proxy.php：共享生图代理
  -> lib/prompt_tools.php：提示词助手代理
  -> lib/files.php：图片校验、压缩、落盘、删除
  -> lib/generated_images.php：生成记录
  -> lib/wall.php：作品墙
  -> lib/install.php：首次安装写入 `.env`
```

## 关键数据流

### 页面初始化

```text
打开页面
  -> GET /api/install/status
    -> 缺少 MySQL 或密钥配置：显示安装面板
    -> 配置完整：继续初始化
  -> GET /api/health
    -> 读取站点公开开关
  -> GET /api/auth/me
    -> 已登录：同步用户设置、API 配置、生成记录
    -> 未登录：清空用户态，只保留公共作品墙能力
```

### 私有 API 生图

```text
用户保存自己的 API Key
  -> PHP 使用 USER_API_KEY_SECRET 加密后写入 MySQL

用户发起生图
  -> 前端从 /api/settings/direct 取回当前私有 Key
  -> 浏览器直连上游 /v1/images/generations 或 /v1/images/edits
  -> 前端拿到上游图片
  -> POST /api/generated-images
  -> PHP 保存原图、压缩展示图、写入 image_jobs
```

说明：私有 API Key 会在已登录用户浏览器中使用。如果上游不允许浏览器跨域请求，应该改用管理员共享 API。

### 共享 API 生图

```text
管理员保存共享生图 API
  -> PHP 加密共享 Key，写入 site_settings

用户选择共享配置后生图
  -> 浏览器调用 /api/images/generations 或 /api/images/edits
  -> PHP 解密共享 Key
  -> PHP 代理访问上游 Images API
  -> 返回结果给浏览器
  -> 浏览器再保存生成记录到本站
```

说明：共享 API Key 不会下发到浏览器，适合站点统一提供额度。

### 提示词助手

```text
提示词优化
  -> POST /api/prompt-tools/optimize
  -> 使用 prompt API 分类配置
  -> 访问上游 /v1/chat/completions

图片反推
  -> POST /api/prompt-tools/caption
  -> 使用 vision API 分类配置
  -> 上传图片转为 data URL
  -> 访问上游 /v1/chat/completions
```

提示词助手优先使用用户自己的对应分类 API；没有可用私有配置且共享 API 开启时，使用管理员共享配置。

### 图片生命周期

```text
生成成功
  -> 保存到 image_jobs
  -> 原图：wall-images/original
  -> 展示图：wall-images/display

发布作品墙
  -> wall_items 引用 image_jobs 的已保存图片
  -> 不重复复制文件

删除生成记录
  -> 如果作品墙仍引用图片，只断开生成记录
  -> 如果没有作品墙引用，同步删除本地图片

取消上墙
  -> 解除 wall_items
  -> 如果图片不再被生成记录引用，同步删除本地图片
```

## 环境要求

- Node.js：仅用于前端开发和构建
- PHP：建议 8.x
- MySQL：建议 5.7+ 或 8.x
- PHP 扩展：`pdo_mysql`、`openssl`、`gd`、`json`、`mbstring`
- Web 服务器：Nginx / Apache / PHP 内置服务均可

生产环境不需要 Node 常驻进程。构建完成后，Web 服务器托管静态文件，PHP 执行 `api/index.php`。

## 快速开始

安装依赖：

```bash
npm install
```

复制配置模板：

```bash
cp .php-api-config.example.php .php-api-config.php
cp env.example .env
```

编辑 `.env`：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=replace-with-db-user
MYSQL_PASSWORD=replace-with-db-password
MYSQL_DATABASE=replace-with-db-name
SESSION_SECRET=replace-with-at-least-32-random-characters
USER_API_KEY_SECRET=replace-with-another-32-random-characters
```

启动开发环境：

```bash
npm run dev
```

开发模式下：

- PHP API 运行在 `http://127.0.0.1:8088`
- Vite 运行在自己的开发端口
- Vite 会把 `/api` 代理到 PHP API

也可以分开启动：

```bash
npm run dev:server
npm run dev:client
```

## 首次安装

项目内置了安装面板。当前端检测到必要配置缺失时，会显示安装表单。

安装面板只做三件事：

1. 校验 MySQL 地址、端口、用户名、密码和数据库名。
2. 校验 `SESSION_SECRET` 与 `USER_API_KEY_SECRET` 强度。
3. 写入项目根目录 `.env`。

安装面板不会删库、清表或覆盖已有业务表。数据库表会在后续访问 API 时自动创建或补齐。

`SESSION_SECRET` 和 `USER_API_KEY_SECRET` 必须满足：

- 至少 32 位随机字符串
- 不能使用示例值
- 两者不能相同

老站点迁移时必须保留原来的 `USER_API_KEY_SECRET`。否则旧 API Key 密文无法解密，但用户数据本身不会丢失。

## 配置说明

`.php-api-config.php` 会优先读取 PHP 进程环境变量，其次读取同目录 `.env`。生产环境建议把真实密钥放进 PHP-FPM / Web 服务器环境，或放在 Web 根目录之外的 `.php-api-config.php` 和 `.env`。

必填配置：

| 配置 | 说明 |
| --- | --- |
| `MYSQL_HOST` | MySQL 地址 |
| `MYSQL_PORT` | MySQL 端口，默认 `3306` |
| `MYSQL_USER` | MySQL 用户名 |
| `MYSQL_PASSWORD` | MySQL 密码 |
| `MYSQL_DATABASE` | MySQL 数据库名 |
| `SESSION_SECRET` | 登录 Cookie 签名密钥 |
| `USER_API_KEY_SECRET` | 用户和共享 API Key 加密密钥 |

默认上游配置：

| 配置 | 说明 |
| --- | --- |
| `OPENAI_BASE_URL` | 新用户默认 API 地址 |
| `OPENAI_IMAGE_MODEL` | 新用户默认生图模型 |

这两个值只是默认表单值。真实生图 Key 由用户登录后保存，或由管理员在共享 API 中保存。

可选 PHP 配置：

```php
return [
    'legacy_user_api_key_secrets' => ['old-secret'], // 轮换 USER_API_KEY_SECRET 时用于旧密文迁移
    'allowed_outbound_ports' => [80, 443],           // 后端外部请求允许端口
];
```

## 管理员初始化

首次部署可临时在 `.env` 或 PHP 环境中配置：

```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-with-strong-password
BOOTSTRAP_ADMIN_DISPLAY_NAME=管理员
```

管理员创建完成后，建议清空 `BOOTSTRAP_ADMIN_PASSWORD`，避免后续误改密码。

管理员登录后，在「账号设置 -> 网站管理」维护：

- 开放注册：关闭后注册入口和注册接口都会停用
- 作品墙需登录：开启后未登录访客不能查看作品墙
- 启用提示词助手：控制提示词优化和图片反推入口
- 启用共享 API：控制用户是否可使用管理员共享配置
- 共享生图 API：用于文生图和图生图
- 共享提示词助手 API：用于提示词优化和图片反推提示词

## API 配置模型

每套 API 配置分两类：

```text
API 配置
  -> imageApi：文生图、图生图
  -> promptApi：提示词优化、图片反推/视觉理解
```

用户私有配置和管理员共享配置使用同一套结构。每个分类都可以独立填写：

- API 名称
- API 地址
- 模型 ID
- API Key
- 请求超时

模型列表通过 `/v1/models` 获取。API 地址会自动补齐常见路径：

- `https://api.example.com` -> `/v1/models`
- `https://api.example.com/v1` -> `/models`
- `https://api.example.com/v1/models` -> 原样使用

## 数据库

运行时会自动执行建表和补列，并通过 `schema_meta` 记录当前 schema 版本。也可以手动导入初始化脚本：

```bash
mysql -u your-db-user -p your-db-name < server/schema.sql
```

主要数据表：

| 表 | 用途 |
| --- | --- |
| `schema_meta` | 运行时 schema 版本 |
| `users` | 用户账号、展示名、管理员标记、会话版本 |
| `user_settings` | 用户当前启用配置、流式开关、超时和共享选择 |
| `user_api_configs` | 用户多套 API 配置，包含生图、提示词、视觉三类 Key |
| `auth_rate_limits` | 登录、注册、改密频控 |
| `image_jobs` | 生成记录、参数快照、图片地址和文件大小 |
| `wall_items` | 公开作品墙数据 |
| `site_settings` | 站点开关和管理员共享 API 配置 |

注意：`server/schema.sql` 适合作为空库初始化参考；已有数据库升级时以运行时自动补列逻辑为准。

## API 路由

前端统一使用 `/api/...`，浏览器端会转换为 PHP 单入口：

```text
/api/settings
  -> /api/index.php?route=/settings
```

路由清单：

```text
GET    /api/health

GET    /api/install/status
POST   /api/install

GET    /api/auth/captcha
GET    /api/auth/me
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/profile
POST   /api/auth/password
POST   /api/auth/logout

GET    /api/settings
GET    /api/settings/direct
POST   /api/settings
POST   /api/settings/active-api
POST   /api/settings/models

POST   /api/images/generations
POST   /api/images/edits

POST   /api/prompt-tools/optimize
POST   /api/prompt-tools/caption

GET    /api/admin/site-settings
POST   /api/admin/site-settings

GET    /api/generated-images
POST   /api/generated-images
DELETE /api/generated-images
DELETE /api/generated-images/{id}

GET    /api/wall
GET    /api/wall/mine
GET    /api/wall/{id}
POST   /api/wall
DELETE /api/wall/{id}
```

## 图片和上传限制

| 场景 | 限制 |
| --- | --- |
| 参考图数量 | 前端最多 16 张 |
| 单张图片校验 | 服务端最多 20MB |
| 共享图生图总上传 | 最多 80MB |
| Mask | 页面限制 4MB，服务端共享代理要求 PNG |
| 图片反推上传 | PNG、JPEG、WEBP、GIF，最多 20MB |
| 展示图 | 超过 1MB 时尝试压缩 |
| 代理响应 | 最多 120MB |

图片保存目录：

```text
wall-images/original   原图
wall-images/display    展示图
```

开发环境目录位于 `public/wall-images`。生产环境以实际 Web 根目录为准，通常是 `dist/wall-images`。

## 生产部署

构建前端：

```bash
npm run build
```

部署要点：

- Web 根目录指向 `dist`
- `dist/api/index.php` 必须能被 PHP 执行
- `dist/wall-images` 需要 Web 用户可写
- `.php-api-config.php` 和 `.env` 不要放在可被公开下载的位置
- 反向代理需要正确传递 `Host` 和 `X-Forwarded-Proto`
- Nginx / 宝塔 / PHP-FPM 超时要大于生图请求超时
- SPA fallback 只应作用于前端页面，不要吞掉 `/api/index.php`

Vite 构建不会清空整个 `dist`，但会清理：

```text
dist/assets
dist/index.html
dist/favicon.ico
dist/api/.php-api-config.php
```

PHP 内置服务预览生产构建：

```bash
npm run start
```

## 常用命令

```bash
npm run dev          # 同时启动 PHP API 和 Vite
npm run dev:server   # 只启动 PHP API
npm run dev:client   # 只启动 Vite
npm run build        # 构建前端
npm run preview      # 预览 Vite 构建结果
npm run start        # 用 PHP 内置服务运行 dist
```

## 验证

检查前端构建：

```bash
npm run build
```

检查 PHP 语法：

```bash
php -l public/api/index.php
php -l public/api/bootstrap.php
php -l public/api/routes.php
php -l public/api/lib/database.php
php -l public/api/lib/auth.php
php -l public/api/lib/settings.php
php -l public/api/lib/site.php
php -l public/api/lib/files.php
php -l public/api/lib/image_proxy.php
php -l public/api/lib/prompt_tools.php
php -l public/api/lib/generated_images.php
php -l public/api/lib/wall.php
php -l public/api/lib/install.php
```

检查 API 健康状态：

```bash
curl 'http://127.0.0.1:8088/api/index.php?route=/health'
```

## 安全边界

- 不要提交 `.env` 或 `.php-api-config.php`
- 不要使用示例密钥部署生产环境
- 不要随意更换 `USER_API_KEY_SECRET`
- 如需轮换 `USER_API_KEY_SECRET`，先配置 `legacy_user_api_key_secrets`
- 私有 API Key 会在已登录用户浏览器中使用，适合可信用户范围
- 共享 API Key 只在后端解密，不会下发到浏览器
- 写接口会校验 `Origin` / `Referer`
- 登录和注册需要验证码，并有频控
- 后端外部请求默认只允许 `80` 和 `443` 端口，并拒绝私有或保留网段目标

## 常见问题

### 页面提示需要安装

说明缺少 MySQL 或密钥配置。可以通过安装面板写入 `.env`，也可以手动补齐 PHP 环境变量。

### 私有 API 生图跨域失败

私有 API 是浏览器直连上游。如果上游没有开放 CORS，改用管理员共享 API，让 PHP 后端代理请求。

### 已保存 API Key 突然不可用

优先检查 `USER_API_KEY_SECRET` 是否变化。该密钥用于解密 MySQL 中的 API Key 密文。

### 作品生成成功但保存失败

检查 `wall-images` 目录写权限、PHP `gd` 扩展、服务器磁盘空间，以及远程图片是否能被 PHP 后端访问。

### API 返回页面内容

通常是 `/api` 反向代理或 PHP 执行配置错误。确认 `/api/index.php?route=/health` 返回 JSON，而不是 HTML 页面。
