# gpt-biubiubiu

黑白极简风格的在线生图模板，前端使用 Vite + React，后端使用 Node/Express 代理 OpenAI 兼容图片接口。

## 功能

- 统一生图页面：无参考图为文生图，有参考图为图生图
- 底部固定生成工作台：提示词、尺寸、质量、格式、压缩率、审核、数量、参考图、生成按钮
- `image-board` 作为生成图与作品墙展示区域
- 图片详情弹窗：大图预览、参数快照、下载、复用配置、上墙/取消上墙
- 服务端作品墙：未登录上墙显示“未知艺术家”，登录用户显示用户名
- 用户注册登录、个人生成配置保存
- 用户 API Key 可加密保存到 MySQL；保存前前端会二次确认，后端不返回明文
- 服务端代理保存系统 API Key，前端不暴露密钥
- 兼容 OpenAI 风格的 `/v1/images/generations` 与 `/v1/images/edits`
- 支持 `url` 与 `b64_json` 两种图片返回格式
- 最近 30 条生成记录保存在浏览器本地
- 黑白配色、硬边卡片、按钮反色 hover、轻微位移阴影

## 环境变量

复制示例文件：

```bash
cp env.example .env
```

填写：

```bash
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_KEY=sk-your-api-key
OPENAI_IMAGE_MODEL=gpt-image-1
PORT=3030

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=gpt_biubiubiu
MYSQL_PASSWORD=change-me
MYSQL_DATABASE=gpt_biubiubiu
MYSQL_CONNECTION_LIMIT=10

SESSION_SECRET=replace-with-a-long-random-session-secret
USER_API_KEY_SECRET=replace-with-a-long-random-api-key-secret
```

如果你使用第三方 OpenAI 兼容接口，只需要把 `OPENAI_BASE_URL` 改成对应服务地址，不要带 `/v1`。

MySQL 未配置时，基础生图代理仍可运行；账号、作品墙、用户配置会返回未配置提示。

## 数据库

服务启动时会自动创建所需表。也可以手动导入：

```bash
mysql -u gpt_biubiubiu -p gpt_biubiubiu < server/schema.sql
```

主要数据：

- `users`：用户账号
- `user_settings`：用户默认生成参数和加密 API Key
- `image_jobs`：生成记录快照
- `wall_items`：作品墙数据

## 本地开发

```bash
npm install
npm run dev
```

默认：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3030`
- 前端开发环境会自动把 `/api` 转发到后端

## 生产部署

```bash
npm install
npm run build
npm run start
```

生产模式下，Node 服务会同时提供：

- 静态前端页面
- `/api/health`
- `/api/images/generations`
- `/api/images/edits`
- `/api/wall`
- `/api/auth/*`
- `/api/settings`

宝塔/Nginx 推荐把站点反向代理到：

```text
http://127.0.0.1:3030
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
  "quality": "auto",
  "style": "auto",
  "response_format": "url",
  "output_format": "png",
  "output_compression": "",
  "moderation": "auto"
}
```

后端转发：

```text
{OPENAI_BASE_URL}/v1/images/generations
{OPENAI_BASE_URL}/v1/images/edits
```

`quality`、`style`、`moderation` 等高级参数为 `auto` 时不会转发，避免部分兼容服务不支持该值。自动尺寸模式不会向上游传递 `size`。