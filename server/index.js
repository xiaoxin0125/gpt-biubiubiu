import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
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
const systemApiKey = process.env.OPENAI_API_KEY || '';
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const apiKeySecret = process.env.USER_API_KEY_SECRET || process.env.SESSION_SECRET || '';
const mysqlConfigured = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 18 * 1024 * 1024 } });

const pool = mysqlConfigured
  ? mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: true,
    })
  : null;

let schemaReady = false;

app.use(express.json({ limit: '30mb' }));
app.use(cookieParser(sessionSecret));

const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  signed: true,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const ensureSchema = async () => {
  if (!pool || schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      model VARCHAR(128) DEFAULT NULL,
      size VARCHAR(64) DEFAULT NULL,
      quality VARCHAR(64) DEFAULT NULL,
      style VARCHAR(64) DEFAULT NULL,
      response_format VARCHAR(64) DEFAULT NULL,
      output_format VARCHAR(64) DEFAULT NULL,
      output_compression VARCHAR(16) DEFAULT NULL,
      moderation VARCHAR(64) DEFAULT NULL,
      n INT UNSIGNED DEFAULT 1,
      api_key_ciphertext TEXT DEFAULT NULL,
      api_key_iv VARCHAR(64) DEFAULT NULL,
      api_key_tag VARCHAR(64) DEFAULT NULL,
      api_key_hint VARCHAR(24) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'generation',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_image_jobs_user_created (user_id, created_at),
      CONSTRAINT fk_image_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wall_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED DEFAULT NULL,
      client_id VARCHAR(80) DEFAULT NULL,
      author_name VARCHAR(96) NOT NULL DEFAULT '未知艺术家',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      image_mime VARCHAR(80) DEFAULT 'image/png',
      params_json JSON DEFAULT NULL,
      source_job_id BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wall_items_created (created_at),
      INDEX idx_wall_items_user (user_id),
      INDEX idx_wall_items_client (client_id),
      CONSTRAINT fk_wall_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_wall_items_job FOREIGN KEY (source_job_id) REFERENCES image_jobs(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  schemaReady = true;
};

const requireDatabase = async (res) => {
  if (!pool) {
    res.status(503).json({ error: '服务端未配置 MySQL' });
    return false;
  }

  await ensureSchema();
  return true;
};

const parseJsonText = (text) => {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getSessionUserId = (req) => {
  const raw = req.signedCookies?.session_user;
  const id = Number(raw || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const setSessionUser = (res, userId) => {
  res.cookie('session_user', String(userId), authCookieOptions);
};

const clearSessionUser = (res) => {
  res.clearCookie('session_user', { ...authCookieOptions, maxAge: undefined });
};

const getVisitorId = (req, res) => {
  const existing = req.signedCookies?.visitor_id;
  if (existing) return existing;

  const visitorId = crypto.randomUUID();
  res.cookie('visitor_id', visitorId, {
    ...authCookieOptions,
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  return visitorId;
};

const getCurrentUser = async (req) => {
  const userId = getSessionUserId(req);
  if (!userId || !pool) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT id, username, created_at FROM users WHERE id = ? LIMIT 1', [userId]);
  const user = rows[0];
  return user ? { id: user.id, username: user.username, createdAt: user.created_at } : null;
};

const requireUser = async (req, res) => {
  if (!(await requireDatabase(res))) return null;

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: '请先登录' });
    return null;
  }

  return user;
};

const createEncryptionKey = () => crypto.createHash('sha256').update(apiKeySecret).digest();

const encryptApiKey = (value) => {
  if (!apiKeySecret) throw new Error('服务端未配置 USER_API_KEY_SECRET');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', createEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    api_key_ciphertext: ciphertext.toString('base64'),
    api_key_iv: iv.toString('base64'),
    api_key_tag: tag.toString('base64'),
    api_key_hint: value.length > 8 ? `${value.slice(0, 3)}...${value.slice(-4)}` : '已保存',
  };
};

const decryptApiKey = (settings) => {
  if (!apiKeySecret || !settings?.api_key_ciphertext || !settings?.api_key_iv || !settings?.api_key_tag) return '';

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', createEncryptionKey(), Buffer.from(settings.api_key_iv, 'base64'));
    decipher.setAuthTag(Buffer.from(settings.api_key_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(settings.api_key_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
};

const toOpenAIImagePayload = (body = {}) => {
  const payload = {
    model: body.model || defaultImageModel,
    prompt: body.prompt,
    n: Number(body.n || 1),
    response_format: body.response_format || 'url',
  };

  if (body.size) payload.size = body.size;

  ['quality', 'style', 'background', 'moderation', 'output_format', 'output_compression'].forEach((key) => {
    if (body[key] !== undefined && body[key] !== '' && body[key] !== 'auto') payload[key] = body[key];
  });

  if (body.negative_prompt) payload.negative_prompt = body.negative_prompt;
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

const getSettingsForUser = async (userId) => {
  if (!pool || !userId) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
  const settings = rows[0];
  if (!settings) return null;

  return {
    model: settings.model || '',
    size: settings.size || '',
    quality: settings.quality || '',
    style: settings.style || '',
    response_format: settings.response_format || '',
    output_format: settings.output_format || '',
    output_compression: settings.output_compression || '',
    moderation: settings.moderation || '',
    n: settings.n || 1,
    hasApiKey: Boolean(settings.api_key_ciphertext),
    apiKeyHint: settings.api_key_hint || '',
  };
};

const getStoredUserApiKey = async (req) => {
  const userId = getSessionUserId(req);
  if (!pool || !userId) return '';

  await ensureSchema();
  const [rows] = await pool.query('SELECT api_key_ciphertext, api_key_iv, api_key_tag FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
  return decryptApiKey(rows[0]);
};

const getEffectiveApiKey = async (req) => (await getStoredUserApiKey(req)) || systemApiKey;

const persistImageJobs = async (req, images, params, mode) => {
  if (!pool || !images.length) return images;

  try {
    await ensureSchema();
    const userId = getSessionUserId(req);
    const result = [];

    for (const image of images) {
      const [insertResult] = await pool.query(
        `INSERT INTO image_jobs (user_id, mode, prompt, revised_prompt, image_url, image_b64, params_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, mode, params.prompt || '', image.revised_prompt || '', image.url || null, image.b64_json || null, JSON.stringify(params)]
      );
      result.push({ ...image, jobId: insertResult.insertId });
    }

    return result;
  } catch {
    return images;
  }
};

const toClientWallItem = (item) => ({
  id: item.id,
  wallItemId: item.id,
  url: item.image_url || '',
  b64_json: item.image_b64 || '',
  imageMime: item.image_mime || 'image/png',
  prompt: item.prompt || '',
  revised_prompt: item.revised_prompt || '',
  form: typeof item.params_json === 'string' ? parseJsonText(item.params_json) : item.params_json || {},
  authorName: item.author_name || '未知艺术家',
  sourceJobId: item.source_job_id || null,
  createdAt: item.created_at,
  isOnWall: true,
  source: 'wall',
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(systemApiKey),
    mysqlConfigured,
    baseUrl,
    defaultImageModel,
  });
});

app.get('/api/auth/me', async (req, res) => {
  if (!pool) {
    res.json({ user: null, settings: null, mysqlConfigured: false });
    return;
  }

  try {
    await ensureSchema();
    const user = await getCurrentUser(req);
    res.json({ user, settings: user ? await getSettingsForUser(user.id) : null, mysqlConfigured: true });
  } catch (error) {
    res.status(500).json({ error: '读取用户信息失败', detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!(await requireDatabase(res))) return;

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!/^[\w\u4e00-\u9fa5.-]{3,30}$/.test(username)) {
    res.status(400).json({ error: '用户名需为 3-30 位中文、字母、数字、下划线、点或短横线' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    setSessionUser(res, result.insertId);
    res.json({ user: { id: result.insertId, username }, settings: null });
  } catch (error) {
    const message = error?.code === 'ER_DUP_ENTRY' ? '用户名已存在' : '注册失败';
    res.status(400).json({ error: message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!(await requireDatabase(res))) return;

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  setSessionUser(res, user.id);
  res.json({ user: { id: user.id, username: user.username, createdAt: user.created_at }, settings: await getSettingsForUser(user.id) });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionUser(res);
  res.json({ ok: true });
});

app.get('/api/settings', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  res.json({ settings: await getSettingsForUser(user.id) });
});

app.post('/api/settings', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const settings = req.body?.settings || {};
  const apiKeyToSave = String(req.body?.apiKey || '').trim();
  const clearApiKey = Boolean(req.body?.clearApiKey);

  if (apiKeyToSave && !req.body?.confirmApiKeySave) {
    res.status(400).json({ error: '保存 API Key 前需要确认' });
    return;
  }

  if (apiKeyToSave && !apiKeySecret) {
    res.status(500).json({ error: '服务端未配置 USER_API_KEY_SECRET' });
    return;
  }

  const [existingRows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [user.id]);
  const existing = existingRows[0] || {};
  const encrypted = apiKeyToSave ? encryptApiKey(apiKeyToSave) : {};

  const apiFields = clearApiKey
    ? { api_key_ciphertext: null, api_key_iv: null, api_key_tag: null, api_key_hint: null }
    : {
        api_key_ciphertext: encrypted.api_key_ciphertext ?? existing.api_key_ciphertext ?? null,
        api_key_iv: encrypted.api_key_iv ?? existing.api_key_iv ?? null,
        api_key_tag: encrypted.api_key_tag ?? existing.api_key_tag ?? null,
        api_key_hint: encrypted.api_key_hint ?? existing.api_key_hint ?? null,
      };

  await pool.query(
    `INSERT INTO user_settings (
      user_id, model, size, quality, style, response_format, output_format, output_compression, moderation, n,
      api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      model = VALUES(model),
      size = VALUES(size),
      quality = VALUES(quality),
      style = VALUES(style),
      response_format = VALUES(response_format),
      output_format = VALUES(output_format),
      output_compression = VALUES(output_compression),
      moderation = VALUES(moderation),
      n = VALUES(n),
      api_key_ciphertext = VALUES(api_key_ciphertext),
      api_key_iv = VALUES(api_key_iv),
      api_key_tag = VALUES(api_key_tag),
      api_key_hint = VALUES(api_key_hint)`,
    [
      user.id,
      settings.model || defaultImageModel,
      settings.size || '',
      settings.quality || 'auto',
      settings.style || 'auto',
      settings.response_format || 'url',
      settings.output_format || 'png',
      settings.output_compression || '',
      settings.moderation || 'auto',
      Number(settings.n || 1),
      apiFields.api_key_ciphertext,
      apiFields.api_key_iv,
      apiFields.api_key_tag,
      apiFields.api_key_hint,
    ]
  );

  res.json({ settings: await getSettingsForUser(user.id) });
});

app.get('/api/wall', async (_req, res) => {
  if (!(await requireDatabase(res))) return;

  const [rows] = await pool.query('SELECT * FROM wall_items ORDER BY created_at DESC LIMIT 80');
  res.json({ items: rows.map(toClientWallItem) });
});

app.post('/api/wall', async (req, res) => {
  if (!(await requireDatabase(res))) return;

  const image = req.body?.image || {};
  const imageUrl = String(image.url || '').trim();
  const imageB64 = String(image.b64_json || '').trim();

  if (!imageUrl && !imageB64) {
    res.status(400).json({ error: '缺少可上墙的图片' });
    return;
  }

  const user = await getCurrentUser(req);
  const visitorId = user ? null : getVisitorId(req, res);
  const prompt = String(req.body?.prompt || req.body?.form?.prompt || '未命名作品').trim();
  const params = req.body?.params || req.body?.form || {};

  const [result] = await pool.query(
    `INSERT INTO wall_items (user_id, client_id, author_name, prompt, revised_prompt, image_url, image_b64, image_mime, params_json, source_job_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.id || null,
      visitorId,
      user?.username || '未知艺术家',
      prompt,
      req.body?.revised_prompt || '',
      imageUrl || null,
      imageB64 || null,
      image.mime || 'image/png',
      JSON.stringify(params),
      req.body?.jobId || null,
    ]
  );

  const [rows] = await pool.query('SELECT * FROM wall_items WHERE id = ? LIMIT 1', [result.insertId]);
  res.json({ item: toClientWallItem(rows[0]) });
});

app.delete('/api/wall/:id', async (req, res) => {
  if (!(await requireDatabase(res))) return;

  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM wall_items WHERE id = ? LIMIT 1', [id]);
  const item = rows[0];

  if (!item) {
    res.status(404).json({ error: '作品不存在' });
    return;
  }

  const userId = getSessionUserId(req);
  const visitorId = req.signedCookies?.visitor_id || '';
  const isOwner = item.user_id ? Number(item.user_id) === Number(userId) : item.client_id && item.client_id === visitorId;

  if (!isOwner) {
    res.status(403).json({ error: '只能取消自己上墙的作品' });
    return;
  }

  await pool.query('DELETE FROM wall_items WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.post('/api/images/generations', async (req, res) => {
  const effectiveApiKey = await getEffectiveApiKey(req);

  if (!effectiveApiKey) {
    res.status(500).json({ error: '服务端未配置 OPENAI_API_KEY，且当前用户未保存 API Key' });
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
        Authorization: `Bearer ${effectiveApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const data = parseJsonText(text);

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || data?.message || '生图接口请求失败',
        detail: data,
      });
      return;
    }

    const normalized = normalizeImageData(data);
    normalized.data = await persistImageJobs(req, normalized.data, payload, 'generation');
    res.json(normalized);
  } catch (error) {
    res.status(500).json({
      error: '代理请求异常',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/images/edits', upload.single('image'), async (req, res) => {
  const effectiveApiKey = await getEffectiveApiKey(req);

  if (!effectiveApiKey) {
    res.status(500).json({ error: '服务端未配置 OPENAI_API_KEY，且当前用户未保存 API Key' });
    return;
  }

  if (!req.body?.prompt?.trim()) {
    res.status(400).json({ error: '提示词不能为空' });
    return;
  }

  if (!req.file?.buffer) {
    res.status(400).json({ error: '请上传参考图' });
    return;
  }

  const payload = toOpenAIImagePayload(req.body);
  const formData = new FormData();
  const imageBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'image/png' });
  formData.append('image', imageBlob, req.file.originalname || 'reference.png');

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== '') formData.append(key, String(value));
  });

  try {
    const response = await fetch(`${baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: formData,
    });

    const text = await response.text();
    const data = parseJsonText(text);

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || data?.message || '图生图接口请求失败',
        detail: data,
      });
      return;
    }

    const normalized = normalizeImageData(data);
    normalized.data = await persistImageJobs(req, normalized.data, payload, 'edit');
    res.json(normalized);
  } catch (error) {
    res.status(500).json({
      error: '图生图代理请求异常',
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

ensureSchema().catch((error) => {
  console.warn('MySQL 初始化跳过：', error instanceof Error ? error.message : String(error));
});

app.listen(port, () => {
  console.log(`gpt-biubiubiu server listening on http://0.0.0.0:${port}`);
});