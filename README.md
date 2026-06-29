# gpt-biubiubiu

一个面向 OpenAI 兼容图片接口的 Web 生图工作台。

前端使用 Vite + React，后端使用 PHP 单入口 API，数据保存在 MySQL。项目重点是：账号登录、多套 API 配置、共享 API、管理员站点开关、模型列表获取、文生图、图生图、生成记录、作品墙和图片本地落盘。

## 功能概览

- 文生图：调用 `/v1/images/generations`
- 图生图：调用 `/v1/images/edits`
- 支持多张参考图，最多 16 张
- 支持 mask 图片，最大 4MB
- 支持 1K / 2K / 4K 和常用比例，也支持自定义尺寸
- 支持 URL / Base64 两种响应格式
- 支持 `png`、`jpeg`、`webp` 输出格式
- 支持多套 OpenAI 兼容 API 配置
- 支持管理员共享 API，用户无私有 Key 时也可直接生成
- 支持从上游 `/v1/models` 获取模型列表
- 支持账号资料、密码修改、注册开关和作品墙访问开关
- 用户 API Key 与共享 API Key 加密保存到 MySQL
- 生成成功后可保存到个人记录
- 作品可发布到公开作品墙
- 服务端自动保存原图和压缩展示图

## 技术栈

```text
浏览器
  └─ React + Vite

本站 API
  └─ PHP 单入口：public/api/index.php

数据层
  └─ MySQL + 本地图片文件

上游生图接口
  └─ OpenAI 兼容 Images API
```

生产环境不需要 Node 服务。前端构建后由 Web 服务器托管静态文件，PHP 只负责本站业务 API。

## 目录结构

```text
src/
  App.jsx                  页面状态和业务编排
  main.jsx                 前端入口
  styles.css               页面样式
  components/              顶栏、工作台、作品板、弹窗
  constants/               默认参数、尺寸、选项
  lib/                     API、图片、历史、表单、作品墙工具

public/api/
  index.php                API 单入口
  bootstrap.php            配置、响应、请求解析、安全校验
  routes.php               路由表
  lib/
    auth.php               账号、登录态、资料、密码
    database.php           PDO、建表、补列
    settings.php           API 配置、模型列表、API Key 加密保存
    site.php               站点开关、共享 API、管理员设置
    files.php              图片解码、压缩、落盘
    generated_images.php   生成记录
    wall.php               作品墙

server/
  schema.sql               数据库初始化脚本

.php-api-config.example.php 配置模板
.php-api-config.php         本机/生产配置，不提交
```

## 运行流程

```text
用户登录
  -> 选择管理员共享 API，或保存自己的 API 配置和 API Key
  -> 用户自有 Key：浏览器直连 OpenAI 兼容图片接口
  -> 管理员共享 Key：前端调用本站 PHP 代理，PHP 解密后访问上游接口
  -> 前端拿到图片结果
  -> 保存生成记录到本站 PHP API
  -> PHP 写入 MySQL，并把图片落盘到 public/wall-images
  -> 用户选择发布到作品墙
```

用户自有 API Key 的生图请求仍由浏览器直接访问当前启用的 API 地址。管理员共享 API Key 不会下发到浏览器，共享文生图和图生图统一通过 PHP 后端代理转发。

共享 API 由管理员在「账号设置 -> 网站管理」中维护。开启后：

- 没有私有 API Key 的用户会默认使用共享 API
- 已保存私有 API Key 的用户仍可手动切换到共享 API
- 共享配置不会写入用户自己的 `user_api_configs`
- 共享 API Key 使用同一套 `user_api_key_secret` 加密保存，只在后端解密调用

## 环境要求

- Node.js：用于前端开发和构建
- PHP：建议 8.x
- MySQL：建议 5.7+ 或 8.x
- PHP 扩展：PDO MySQL、OpenSSL、GD
- Web 服务器：Nginx / Apache / PHP 内置服务均可

## 快速开始

安装依赖：

```bash
npm install
```

复制 PHP 配置模板和本地环境文件：

```bash
cp .php-api-config.example.php .php-api-config.php
cp env.example .env
```

编辑 `.env`，填入运行时配置：

```bash
MYSQL_USER=replace-with-db-user
MYSQL_PASSWORD=replace-with-db-password
MYSQL_DATABASE=replace-with-db-name
SESSION_SECRET=replace-with-at-least-32-random-characters
USER_API_KEY_SECRET=replace-with-another-32-random-characters
```

`.php-api-config.php` 会优先读取 PHP 进程环境变量，其次读取项目根目录 `.env`。如果站点提示缺少 `MYSQL_USER`，可以打开安装页填写同一套数据库账号；安装页只测试连接并写入 `.env`，不会清空或覆盖已有数据库内容。

生产环境不要把数据库密码、Cookie 签名密钥或 API Key 写进仓库文件。

启动开发环境：

```bash
npm run dev
```

也可以分开启动：

```bash
npm run dev:server
npm run dev:client
```

开发模式下，Vite 会把 `/api` 代理到 `http://127.0.0.1:8088`。

## 数据库

PHP API 首次访问时会尝试自动创建和补齐表结构。也可以手动导入：

```bash
mysql -u your-db-user -p your-db-name < server/schema.sql
```

主要数据表：

| 表 | 用途 |
| --- | --- |
| `users` | 用户账号、展示名、管理员标记 |
| `user_settings` | 当前 API 配置、stream、超时、共享配置选择等用户设置 |
| `user_api_configs` | 多套 OpenAI 兼容 API 配置 |
| `auth_rate_limits` | 登录、注册、改密频控 |
| `image_jobs` | 生成记录、参数快照、图片地址 |
| `wall_items` | 公开作品墙数据 |
| `site_settings` | 注册开关、作品墙访问开关、共享 API 配置 |

## 配置说明

### 必填配置

| 配置 | 说明 |
| --- | --- |
| `mysql_host` | MySQL 地址 |
| `mysql_port` | MySQL 端口 |
| `mysql_user` | MySQL 用户 |
| `mysql_password` | MySQL 密码 |
| `mysql_database` | MySQL 数据库 |
| `session_secret` | 登录 Cookie 签名密钥 |
| `user_api_key_secret` | 用户 API Key 加密密钥 |

`session_secret` 和 `user_api_key_secret` 必须是 32 位以上随机字符串，不能使用示例值，也不能相同。

### 默认上游配置

| 配置 | 说明 |
| --- | --- |
| `openai_base_url` | 新用户默认 API 地址 |
| `openai_image_model` | 新用户默认图片模型 |

这两个值只是默认值。用户登录后可以在页面中保存自己的 API 地址、模型和 API Key。

### 可选兼容配置

| 配置 | 说明 |
| --- | --- |
| `legacy_user_api_key_secrets` | 旧版 API Key 加密密钥列表，用于更换 `user_api_key_secret` 后平滑迁移 |
| `allowed_outbound_ports` | 后端代理、模型列表和远程图片读取允许访问的端口，默认只允许 `80`、`443` |

如果需要轮换 `user_api_key_secret`，先把旧密钥放入 `legacy_user_api_key_secrets`，用户下次读取配置时会自动尝试用新密钥重写密文。

### 管理员初始化

如需首次部署时自动创建管理员，可临时填写：

```php
'bootstrap_admin_username' => 'admin',
'bootstrap_admin_password' => '至少 12 位的强密码',
'bootstrap_admin_display_name' => '管理员',
```

管理员创建完成后，建议清空 `bootstrap_admin_password`，避免后续误改密码。

### 站点管理

管理员登录后可在「账号设置 -> 网站管理」中维护：

- 开放注册：关闭后访客只能登录，注册入口和注册接口都会停用
- 作品墙需登录：开启后未登录访客无法查看作品墙
- 共享 API：开启后向登录用户注入一条只读的共享配置，生图请求由后端代理执行
- 共享模型：可手动填写，也可通过上游 `/v1/models` 获取列表后选择

共享 API 适合站点统一提供额度；用户保存自己的 API Key 后，默认优先使用自己的配置，也可以切回共享配置。

## 生产部署

构建前端：

```bash
npm run build
```

部署要点：

- 站点运行目录指向 `dist`
- `dist/api/index.php` 需要能被 PHP 执行
- 构建不会清空整个 `dist`，但会清理 `dist/assets`、`dist/index.html`、`dist/favicon.ico` 和误放入 `dist/api/.php-api-config.php` 的配置文件
- `.php-api-config.php` 放在项目根目录或 Web 根目录上级均可
- `.php-api-config.php` 不要提交到仓库，也不要放入可被公开下载的位置
- `wall-images` 目录需要 Web 用户可写
- 反向代理的 Host、Scheme 需要和实际访问域名一致，否则写接口可能被同源校验拒绝
- 如果启用了共享 API，管理员保存共享 Key 前必须确保 `user_api_key_secret` 已配置为强随机值

如果构建产物没有包含 API 文件，需要确保以下文件存在：

```text
api/index.php
api/bootstrap.php
api/routes.php
api/lib/*.php
```

PHP 内置服务预览生产构建：

```bash
npm run start
```

## API 路由

前端访问时通常会走 PHP 单入口：

```text
/api/index.php?route=/auth/me
/api/index.php?route=/settings
/api/index.php?route=/generated-images
/api/index.php?route=/wall
```

本站 API：

```text
GET    /api/health

GET    /api/install/status
POST   /api/install

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

## 图片保存策略

```text
public/wall-images/original   原图
public/wall-images/display    展示图
```

- 服务端会保存生成结果对应的原图
- 展示图超过 1MB 时会尝试压缩
- 删除生成记录时，如果图片没有被作品墙引用，会同步清理本地文件
- 取消上墙时，如果图片已经脱离生成记录，也会清理对应本地文件

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
php -l public/api/lib/generated_images.php
php -l public/api/lib/wall.php
```

检查 API 健康状态：

```bash
curl 'http://127.0.0.1:8088/api/index.php?route=/health'
```

## 安全注意

- 不要提交 `.php-api-config.php`
- 不要使用示例密钥部署生产环境
- 不要随意更换 `user_api_key_secret`，否则已保存的 API Key 将无法解密
- 如需轮换 `user_api_key_secret`，先配置 `legacy_user_api_key_secrets` 做过渡
- 生图请求由浏览器直连上游接口，当前启用的 API Key 会在已登录用户浏览器内使用；共享 API 只适合可信用户范围
- 生产环境建议禁止直接访问配置文件
- 写接口会校验 Origin / Referer，跨站请求会被拒绝