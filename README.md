# gpt-biubiubiu

一个基于 Vite + React + PHP 单入口 API 的图片生成工作台。前端负责调用 OpenAI 兼容图片接口，PHP 负责账号、API 配置、生成记录、图片落盘和作品墙。

生产环境不需要 Node 服务：`npm run build` 后部署静态产物，由 PHP 处理 `/api/index.php`。

## 当前架构

```text
浏览器 React 页面
  ├─ 直连 OpenAI 兼容图片 API：/v1/images/generations、/v1/images/edits
  └─ 调用本站 PHP API：账号、配置、生成记录、作品墙

PHP API
  ├─ public/api/index.php        单入口
  ├─ public/api/routes.php       路由表
  └─ public/api/lib/*.php        数据库、账号、设置、文件、生成记录、作品墙

MySQL
  ├─ users
  ├─ user_settings
  ├─ user_api_configs
  ├─ auth_rate_limits
  ├─ image_jobs
  └─ wall_items
```

## 目录结构

```text
src/
  App.jsx                       页面装配和主状态编排
  constants/options.js           选项、默认表单、尺寸限制
  lib/api.js                     本站 API 请求、上游直连请求、响应解析
  lib/images.js                  图片来源、MIME、data URL、展示数据归一化
  lib/history.js                 本地历史
  lib/size.js                    尺寸和比例
  lib/board.js                   作品列表、过滤、排序、瀑布流
  components/                    顶栏、工作台、作品板、弹窗组件

public/api/
  index.php                      PHP API 单入口
  routes.php                     路由分发
  bootstrap.php                  配置、响应、请求体、公共常量
  lib/database.php               PDO、建表、补列、数据库可用性
  lib/auth.php                   登录态、注册登录、个人资料、密码
  lib/settings.php               API 配置、API Key 加密保存、当前配置切换
  lib/files.php                  图片解码、压缩、落盘、公开路径
  lib/generated_images.php       生成记录保存、列表、删除、清空
  lib/wall.php                   作品墙列表、详情、上墙、取消上墙

server/schema.sql                数据库初始化脚本
.php-api-config.example.php       PHP 配置模板
.php-api-config.php               本机/生产配置，不提交
```

## 功能边界

### 前端直连上游

生图请求由浏览器直接访问用户配置的 OpenAI 兼容 API 地址：

- 文生图：`/v1/images/generations`
- 图片编辑：`/v1/images/edits`

这意味着：

- PHP 不再代理上游生图请求。
- 用户登录后可保存多套 API 配置。
- 前端生成成功后，再把图片结果保存到本站 `/api/generated-images`。
- 服务端保存图片时会落盘到 `public/wall-images`，作品墙使用压缩后的展示图。

### PHP API

PHP 只保留本站业务接口：

```text
GET    /api/health
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

前端会通过 `src/lib/api.js` 转成兼容 PHP 单入口的形式：

```text
/api/index.php?route=/auth/me
/api/index.php?route=/generated-images
/api/index.php?route=/wall
```

已删除旧 PHP 代理链路，不再提供服务端生图中转和请求日志接口。

## PHP 配置

复制配置模板：

```bash
cp .php-api-config.example.php .php-api-config.php
```

配置内容：

```php
<?php
return [
    'openai_base_url' => 'https://api.openai.com',
    'openai_image_model' => 'gpt-image-2',

    'mysql_host' => '127.0.0.1',
    'mysql_port' => 3306,
    'mysql_user' => 'your-db-user',
    'mysql_password' => 'your-db-password',
    'mysql_database' => 'your-db-name',

    'session_secret' => 'generate-at-least-32-random-characters-before-deploy',
    'user_api_key_secret' => 'generate-another-32-random-characters-before-deploy',
];
```

说明：

- `.php-api-config.php` 不进入前端构建，也不应提交；生产环境建议放在 Web 根目录之外，或至少由 Web 服务器禁止直接访问。
- `session_secret` 用于签名登录 Cookie，必须是 32 位以上随机值；空值或示例弱值会被拒绝。
- `user_api_key_secret` 用于加密保存用户 API Key，必须和 `session_secret` 不同，且部署后不要随意更换，否则旧 API Key 无法解密。
- 写接口会拒绝跨站 Origin/Referer，请确保生产域名和反向代理 Host 配置一致。
- `openai_base_url` 和 `openai_image_model` 只是默认值，用户登录后可在页面里保存自己的 API 配置。

## 数据库

PHP API 首次请求会自动创建/补齐表结构。也可以手动导入：

```bash
mysql -u your-db-user -p your-db-name < server/schema.sql
```

主要数据表：

- `users`：账号与管理员标记
- `user_settings`：当前 API 配置、stream 等用户设置
- `user_api_configs`：多套 OpenAI 兼容 API 配置，加密保存 API Key
- `auth_rate_limits`：登录、注册、改密等账号接口的短窗口频控
- `image_jobs`：已保存生成记录、图片地址、参数快照
- `wall_items`：作品墙数据

管理员账号不会内置默认密码。首次部署如需自动创建管理员，可在 `.php-api-config.php` 中填写：

```php
'bootstrap_admin_username' => 'admin',
'bootstrap_admin_password' => '至少 12 位的强密码',
'bootstrap_admin_display_name' => '管理员',
```

创建后建议清空 `bootstrap_admin_password`，避免后续误改管理员密码。

## 本地开发

安装依赖：

```bash
npm install
```

启动 PHP API：

```bash
npm run dev:server
```

启动 Vite：

```bash
npm run dev:client
```

或者同时启动：

```bash
npm run dev
```

Vite 开发服务会把 `/api` 代理到 `http://127.0.0.1:8088`。

## 生产部署

构建前端：

```bash
npm run build
```

部署要求：

- 网站运行目录指向 Vite 构建产物目录。
- 保留 `api/index.php` 和 `api/lib/*.php` 可由 PHP 执行。
- 不需要启动 Node 服务。
- PHP 建议启用：PDO MySQL、OpenSSL、GD。

如果构建流程没有自动复制 `public/api`，请确保生产目录里包含：

```text
api/index.php
api/routes.php
api/bootstrap.php
api/lib/*.php
```

`wall-images` 目录用于保存原图和压缩展示图，需要 Web 用户可写。

## 图片与作品墙

生成成功后的流向：

```text
上游图片结果
  -> 前端展示
  -> POST /api/generated-images
  -> PHP 保存图片文件和 image_jobs
  -> 用户点击上墙
  -> POST /api/wall
  -> wall_items
```

文件保存策略：

- 原图保存到 `public/wall-images/original`。
- 展示图保存到 `public/wall-images/display`。
- 展示图超过 1MB 时，服务端会尝试压缩。
- 删除生成记录时，如果没有作品墙引用，会同步删除关联本地图片文件。
- 取消上墙时，如果作品墙图片已经脱离生成记录，也会清理对应本地文件。

## 验证命令

```bash
npm run build
php -l public/api/index.php
php -l public/api/routes.php
php -l public/api/bootstrap.php
php -l public/api/lib/database.php
php -l public/api/lib/auth.php
php -l public/api/lib/settings.php
php -l public/api/lib/files.php
php -l public/api/lib/generated_images.php
php -l public/api/lib/wall.php
```

最小接口检查：

```bash
curl 'http://127.0.0.1:8088/api/index.php?route=/health'
```