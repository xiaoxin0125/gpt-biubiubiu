import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const app = express();
const port = Number(process.env.PORT || 3030);
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
const defaultImageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const apiKey = process.env.OPENAI_API_KEY || '';

app.use(express.json({ limit: '30mb' }));

const toOpenAIImagePayload = (body = {}) => {
  const payload = {
    model: body.model || defaultImageModel,
    prompt: body.prompt,
    n: Number(body.n || 1),
    size: body.size || '1024x1024',
    response_format: body.response_format || 'url',
  };

  ['quality', 'style', 'background', 'moderation', 'output_format', 'output_compression'].forEach((key) => {
    if (body[key] !== undefined && body[key] !== '' && body[key] !== 'auto') payload[key] = body[key];
  });

  if (body.negative_prompt) payload.negative_prompt = body.negative_prompt;
  if (Array.isArray(body.input_image) && body.input_image.length > 0) payload.input_image = body.input_image;
  if (body.user) payload.user = body.user;

  return payload;
};

const normalizeImageData = (data) => ({
  created: data?.created || Math.floor(Date.now() / 1000),
  data: Array.isArray(data?.data)
    ? data.data.map((item, index) => ({
        id: `${Date.now()}-${index}`,
        url: item.url || '',
        b64_json: item.b64_json || '',
        revised_prompt: item.revised_prompt || '',
      }))
    : [],
  raw: data,
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(apiKey),
    baseUrl,
    defaultImageModel,
  });
});

app.post('/api/images/generations', async (req, res) => {
  if (!apiKey) {
    res.status(500).json({ error: '服务端未配置 OPENAI_API_KEY' });
    return;
  }

  if (!req.body?.prompt?.trim()) {
    res.status(400).json({ error: '提示词不能为空' });
    return;
  }

  const payload = toOpenAIImagePayload(req.body);

  try {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || data?.message || '生图接口请求失败',
        detail: data,
      });
      return;
    }

    res.json(normalizeImageData(data));
  } catch (error) {
    res.status(500).json({
      error: '代理请求异常',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get('*splat', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`gpt-biubiubiu server listening on http://0.0.0.0:${port}`);
});