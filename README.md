# gpt-biubiubiu

黑白极简风格的在线生图模板，前端使用 Vite + React，后端使用 Node/Express 代理 OpenAI 兼容图片生成接口。

## 功能

- 三栏生图工作台：生成记录、参数表单、结果画布
- 服务端代理保存 API Key，前端不暴露密钥
- 兼容 OpenAI 风格的 `/v1/images/generations`
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
```

如果你使用第三方 OpenAI 兼容接口，只需要把 `OPENAI_BASE_URL` 改成对应服务地址，不要带 `/v1`。

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

宝塔/Nginx 推荐把站点反向代理到：

```text
http://127.0.0.1:3030
```

## 接口形态

前端请求：

```text
POST /api/images/generations
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
  "response_format": "url"
}
```

后端会转发到：

```text
{OPENAI_BASE_URL}/v1/images/generations
```

`quality`、`style` 等高级参数为 `auto` 时不会转发，避免部分兼容服务不支持该值。