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

const DEFAULT_REQUEST_TIMEOUT = 999;
const MAX_REQUEST_TIMEOUT = 999;
const MAX_EDIT_IMAGES = 16;
const MAX_EDIT_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_MASK_SIZE_BYTES = 4 * 1024 * 1024;
const app = express();
const port = Number(process.env.PORT || 3030);
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
const defaultImageModel = process.env.OPENAI_IMAGE_MODEL && process.env.OPENAI_IMAGE_MODEL !== 'gpt-image-1' ? process.env.OPENAI_IMAGE_MODEL : 'gpt-image-2';
const systemApiKey = process.env.OPENAI_API_KEY || '';
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const apiKeySecret = process.env.USER_API_KEY_SECRET || process.env.SESSION_SECRET || '';
const mysqlConfigured = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EDIT_IMAGE_SIZE_BYTES, files: MAX_EDIT_IMAGES + 1 } });
const allowedImageQualities = new Set(['low', 'medium', 'high']);
const allowedOutputFormats = new Set(['png', 'jpeg', 'webp']);
const allowedBackgrounds = new Set(['auto', 'opaque']);
const allowedModerations = new Set(['auto', 'low']);

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
app.use((req, res, next) => {
  if (req.path !== '/api/index.php') {
    next();
    return;
  }

  const route = String(req.query.route || '').replace(/^\/+/, '');
  if (!route) {
    res.status(404).json({ error: '接口不存在', route: '/' });
    return;
  }

  const query = new URLSearchParams();
  Object.entries(req.query).forEach(([key, value]) => {
    if (key === 'route' || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, String(item)));
      return;
    }
    query.set(key, String(value));
  });

  const queryString = query.toString();
  req.url = `/api/${route}${queryString ? `?${queryString}` : ''}`;
  next();
});

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
      display_name VARCHAR(96) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      model VARCHAR(128) DEFAULT NULL,
      api_name VARCHAR(128) DEFAULT NULL,
      api_base_url VARCHAR(255) DEFAULT NULL,
      request_timeout INT UNSIGNED NOT NULL DEFAULT 999,
      stream_enabled TINYINT(1) NOT NULL DEFAULT 0,
      size VARCHAR(64) DEFAULT NULL,
      quality VARCHAR(64) DEFAULT NULL,
      style VARCHAR(64) DEFAULT NULL,
      response_format VARCHAR(64) DEFAULT NULL,
      background VARCHAR(64) DEFAULT NULL,
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
      request_id VARCHAR(80) DEFAULT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'generation',
      status VARCHAR(32) NOT NULL DEFAULT 'completed',
      prompt TEXT NOT NULL,
      revised_prompt TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      image_url TEXT DEFAULT NULL,
      image_b64 LONGTEXT DEFAULT NULL,
      params_json JSON DEFAULT NULL,
      result_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL DEFAULT NULL,
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

  const ensureColumn = async (table, column, definition) => {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, column]
    );
    if (Number(rows[0]?.count || 0) > 0) return;
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  };

  await ensureColumn('users', 'display_name', 'display_name VARCHAR(96) DEFAULT NULL AFTER username');
  await ensureColumn('user_settings', 'api_name', 'api_name VARCHAR(128) DEFAULT NULL AFTER model');
  await ensureColumn('user_settings', 'api_base_url', 'api_base_url VARCHAR(255) DEFAULT NULL AFTER api_name');
  await ensureColumn('user_settings', 'request_timeout', 'request_timeout INT UNSIGNED NOT NULL DEFAULT 999 AFTER api_base_url');
  await ensureColumn('user_settings', 'stream_enabled', 'stream_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER request_timeout');
  await ensureColumn('user_settings', 'background', 'background VARCHAR(64) DEFAULT NULL AFTER response_format');
  await ensureColumn('user_settings', 'output_compression', 'output_compression VARCHAR(16) DEFAULT NULL AFTER output_format');
  await ensureColumn('image_jobs', 'request_id', 'request_id VARCHAR(80) DEFAULT NULL AFTER user_id');
  await ensureColumn('image_jobs', 'status', "status VARCHAR(32) NOT NULL DEFAULT 'completed' AFTER mode");
  await ensureColumn('image_jobs', 'error_message', 'error_message TEXT DEFAULT NULL AFTER revised_prompt');
  await ensureColumn('image_jobs', 'result_json', 'result_json JSON DEFAULT NULL AFTER params_json');
  await ensureColumn('image_jobs', 'completed_at', 'completed_at TIMESTAMP NULL DEFAULT NULL AFTER created_at');
  await pool.query('UPDATE user_settings SET request_timeout = 999 WHERE request_timeout IN (180, 600)');
  await pool.query("UPDATE user_settings SET model = 'gpt-image-2' WHERE model = 'gpt-image-1'");
  await pool.query("UPDATE user_settings SET size = '768x768' WHERE size = '1024x1024'");

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

  const trimmed = String(text).trim();
  if (trimmed.split(/\r?\n/).some((line) => line.trim().startsWith('data:'))) {
    let lastJson = null;
    for (const line of trimmed.split(/\r?\n/)) {
      const value = line.trim();
      if (!value.startsWith('data:')) continue;
      const payload = value.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const decoded = JSON.parse(payload);
        if (Array.isArray(decoded?.data)) return decoded;
        lastJson = decoded;
      } catch {
        // 忽略非 JSON 的流式心跳片段
      }
    }
    if (lastJson) return lastJson;
  }

  try {
    return JSON.parse(text);
  } catch {
    const snippet = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) || '上游接口返回了非 JSON 内容';
    return {
      message: '上游接口返回了非 JSON 内容，请检查 API 地址是否应填写到 /v1 或只填写域名。',
      snippet,
    };
  }
};

const upstreamErrorMessage = (data, fallback) => data?.error?.message || data?.message || fallback;

const upstreamErrorPayload = (data, fallback, status) => {
  const message = upstreamErrorMessage(data, fallback);
  if (status === 504 && message.toLowerCase().includes('stream disconnected before completion')) {
    return {
      error: '上游 API 中转 504：生图流在完成前断开。应用层超时已支持最高 999 秒；仍失败时请把宝塔/Nginx 的 request timeout、read timeout、proxy_read_timeout 或 fastcgi_read_timeout 调到 999 秒以上，或降低尺寸/质量后重试。',
      detail: data,
    };
  }

  return { error: message, detail: data };
};

const assertImageResponse = (data, fallback) => {
  if (Array.isArray(data?.data)) return null;
  return {
    error: upstreamErrorMessage(data, fallback),
    detail: data,
  };
};

const buildUpstreamUrl = (base, routePath) => {
  const normalizedBase = String(base || baseUrl).replace(/\s+/g, '').replace(/\/$/, '');
  const url = new URL(normalizedBase);
  const basePath = url.pathname.replace(/\/$/, '');
  let nextPath = `/${String(routePath || '').replace(/^\/+/, '')}`;

  if (basePath && nextPath.startsWith(`${basePath}/`)) nextPath = nextPath.slice(basePath.length);
  url.pathname = `${basePath}${nextPath}`.replace(/\/+/g, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
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

const normalizeDisplayName = (value, fallback) => {
  const displayName = String(value || '').trim();
  if (!displayName) return fallback;
  if (!/^[\p{L}\p{N}_ .-]{1,30}$/u.test(displayName)) {
    const error = new Error('展示名称需为 1-30 位中文、字母、数字、空格、下划线、点或短横线');
    error.status = 400;
    throw error;
  }
  return displayName;
};

const isValidApiBaseUrl = (value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const getCurrentUser = async (req) => {
  const userId = getSessionUserId(req);
  if (!userId || !pool) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT id, username, display_name, created_at FROM users WHERE id = ? LIMIT 1', [userId]);
  const user = rows[0];
  return user ? { id: user.id, username: user.username, displayName: user.display_name || user.username, createdAt: user.created_at } : null;
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

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const toGenerationImagePayload = (body = {}) => {
  const outputFormat = allowedOutputFormats.has(body.output_format) ? body.output_format : 'png';
  const payload = {
    model: body.model || defaultImageModel,
    prompt: body.prompt,
    n: 1,
    output_format: outputFormat,
  };

  if (body.size) payload.size = String(body.size);
  if (allowedImageQualities.has(body.quality)) payload.quality = body.quality;
  if (allowedBackgrounds.has(body.background) && body.background !== 'auto') payload.background = body.background;
  if (allowedModerations.has(body.moderation)) payload.moderation = body.moderation;
  if (['jpeg', 'webp'].includes(outputFormat) && body.output_compression !== undefined && body.output_compression !== '') {
    payload.output_compression = clampNumber(body.output_compression, 0, 100);
  }
  if (body.user) payload.user = String(body.user);
  if (body.stream === true || body.stream === 'true' || body.stream === 1 || body.stream === '1') payload.stream = true;

  return payload;
};

const toEditImagePayload = (body = {}) => {
  const outputFormat = allowedOutputFormats.has(body.output_format) ? body.output_format : 'png';
  const payload = {
    model: body.model || defaultImageModel,
    prompt: body.prompt,
    output_format: outputFormat,
  };

  if (body.size) payload.size = String(body.size);
  if (allowedImageQualities.has(body.quality)) payload.quality = body.quality;
  if (allowedBackgrounds.has(body.background) && body.background !== 'auto') payload.background = body.background;
  if (['jpeg', 'webp'].includes(outputFormat) && body.output_compression !== undefined && body.output_compression !== '') {
    payload.output_compression = clampNumber(body.output_compression, 0, 100);
  }
  if (body.user) payload.user = String(body.user);
  if (body.stream === true || body.stream === 'true' || body.stream === 1 || body.stream === '1') payload.stream = true;

  return payload;
};

const imageMimeForOutputFormat = (format) => {
  const value = String(format || '').toLowerCase();
  if (value === 'jpeg') return 'image/jpeg';
  if (value === 'webp') return 'image/webp';
  return 'image/png';
};

const normalizeImageData = (data, outputFormat = 'png') => {
  const imageMime = imageMimeForOutputFormat(outputFormat);
  return {
    created: data?.created || Math.floor(Date.now() / 1000),
    data: Array.isArray(data?.data)
      ? data.data.map((item, index) => ({
          id: `${Date.now()}-${index}`,
          url: item.url || '',
          b64_json: item.b64_json || '',
          imageMime,
          revised_prompt: item.revised_prompt || '',
        }))
      : [],
    raw: data,
  };
};

const getSettingsForUser = async (userId) => {
  if (!pool || !userId) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
  const settings = rows[0];
  if (!settings) return null;

  return {
    model: settings.model || '',
    apiName: settings.api_name || 'OpenAI Compatible',
    apiBaseUrl: settings.api_base_url || '',
    requestTimeout: Number(settings.request_timeout || DEFAULT_REQUEST_TIMEOUT),
    streamEnabled: Boolean(settings.stream_enabled),
    size: settings.size || '',
    quality: settings.quality || '',
    background: settings.background || '',
    output_format: settings.output_format || '',
    output_compression: settings.output_compression || '',
    moderation: allowedModerations.has(settings.moderation) ? settings.moderation : 'auto',
    n: settings.n || 1,
    hasApiKey: Boolean(settings.api_key_ciphertext),
    apiKeyHint: settings.api_key_hint || '',
  };
};

const getStoredUserSettings = async (req) => {
  const userId = getSessionUserId(req);
  if (!pool || !userId) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
};

const getStoredUserApiKey = async (req) => {
  const settings = await getStoredUserSettings(req);
  return decryptApiKey(settings);
};

const getEffectiveApiBaseUrl = async (req) => {
  const settings = await getStoredUserSettings(req);
  return String(settings?.api_base_url || baseUrl).replace(/\s+/g, '').replace(/\/$/, '');
};

const getEffectiveRequestTimeout = async (req) => {
  const settings = await getStoredUserSettings(req);
  const timeout = Number(settings?.request_timeout || DEFAULT_REQUEST_TIMEOUT);
  return Math.max(10, Math.min(MAX_REQUEST_TIMEOUT, Number.isFinite(timeout) ? timeout : DEFAULT_REQUEST_TIMEOUT));
};

const getEffectiveApiKey = async (req) => (await getStoredUserApiKey(req)) || systemApiKey;

const imageJobOwnerValues = (req, res) => {
  const userId = getSessionUserId(req);
  if (userId) return [userId, null];
  return [null, res ? getVisitorId(req, res) : req.signedCookies?.visitor_id || null];
};

const parseParamsJson = (value) => {
  if (!value) return {};
  if (typeof value === 'string') return parseJsonText(value);
  return typeof value === 'object' ? value : {};
};

const createPendingImageJob = async (req, res, params, mode) => {
  if (!pool) return null;

  await ensureSchema();
  const [userId, requestId] = imageJobOwnerValues(req, res);
  const [result] = await pool.query(
    'INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, params_json) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, requestId, mode, 'running', params.prompt || '', JSON.stringify(params)]
  );
  return result.insertId;
};

const toClientImageJob = (row) => {
  const params = parseParamsJson(row.params_json);
  const status = row.status || (row.image_url || row.image_b64 ? 'completed' : 'running');

  return {
    id: row.id,
    jobId: row.id,
    status,
    mode: row.mode || 'generation',
    prompt: row.prompt || params.prompt || '',
    revised_prompt: row.revised_prompt || '',
    error: row.error_message || '',
    form: params,
    createdAt: row.created_at || null,
    finishedAt: row.completed_at || null,
  };
};

const completedJobPayload = (row) => {
  const job = toClientImageJob(row);
  const params = job.form || {};
  const imageMime = imageMimeForOutputFormat(params.output_format || 'png');
  const resultJson = parseParamsJson(row.result_json);
  const savedImages = Array.isArray(resultJson.data) ? resultJson.data : [];
  const images = savedImages.length
    ? savedImages.map((image) => ({ ...image, imageMime: image.imageMime || imageMime }))
    : [
        {
          id: row.id,
          jobId: row.id,
          url: row.image_url || '',
          b64_json: row.image_b64 || '',
          imageMime,
          revised_prompt: row.revised_prompt || '',
        },
      ];

  images[0].id = images[0].id || row.id;
  images[0].jobId = images[0].jobId || row.id;

  return {
    created: row.completed_at ? Math.floor(new Date(row.completed_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
    data: images,
    job,
  };
};

const imageJobResponse = (row) => {
  const job = toClientImageJob(row);
  if (job.status === 'completed' && (row.image_url || row.image_b64)) return completedJobPayload(row);
  return { job };
};

const fetchOwnedImageJob = async (req, jobId) => {
  if (!pool) return null;

  await ensureSchema();
  const [rows] = await pool.query('SELECT * FROM image_jobs WHERE id = ? LIMIT 1', [jobId]);
  const row = rows[0];
  if (!row) return null;

  const userId = getSessionUserId(req);
  const visitorId = req.signedCookies?.visitor_id || '';
  if (row.user_id) return Number(row.user_id) === Number(userId) ? row : null;
  if (row.request_id) return visitorId && String(row.request_id) === String(visitorId) ? row : null;
  return userId ? row : null;
};

const updateImageJobFailed = async (jobId, message) => {
  if (!pool || !jobId) return;

  try {
    await pool.query('UPDATE image_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?', ['failed', message, jobId]);
  } catch {
    // ignore persistence failure for the dev fallback path
  }
};

const completeImageJob = async (jobId, normalized, params) => {
  if (!pool || !jobId) return normalized;

  const images = Array.isArray(normalized.data) ? normalized.data : [];
  if (!images.length) throw new Error('生图接口没有返回图片数据');

  const first = images[0];
  await pool.query(
    'UPDATE image_jobs SET status = ?, revised_prompt = ?, image_url = ?, image_b64 = ?, params_json = ?, result_json = ?, completed_at = NOW() WHERE id = ?',
    [
      'completed',
      first.revised_prompt || '',
      first.url || null,
      first.b64_json || null,
      JSON.stringify(params),
      JSON.stringify({ data: images }),
      jobId,
    ]
  );

  images[0].jobId = jobId;
  return { ...normalized, data: images };
};

const persistImageJobs = async (req, images, params, mode) => {
  if (!pool || !images.length) return images;

  try {
    await ensureSchema();
    const [userId, requestId] = imageJobOwnerValues(req);
    const result = [];

    for (const image of images) {
      const [insertResult] = await pool.query(
        `INSERT INTO image_jobs (user_id, request_id, mode, status, prompt, revised_prompt, image_url, image_b64, params_json, result_json, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          userId,
          requestId,
          mode,
          'completed',
          params.prompt || '',
          image.revised_prompt || '',
          image.url || null,
          image.b64_json || null,
          JSON.stringify(params),
          JSON.stringify({ data: [image] }),
        ]
      );
      result.push({ ...image, jobId: insertResult.insertId });
    }

    return result;
  } catch {
    return images;
  }
};

const normalizeUploadedEditImages = (files = {}) => {
  const items = [
    ...(Array.isArray(files.image) ? files.image : []),
    ...(Array.isArray(files['image[]']) ? files['image[]'] : []),
    ...(Array.isArray(files.referenceImage) ? files.referenceImage : []),
  ].slice(0, MAX_EDIT_IMAGES);

  for (const file of items) {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime)) {
      const error = new Error('参考图仅支持 png / jpg / webp');
      error.status = 400;
      throw error;
    }
  }

  return items;
};

const normalizeUploadedMask = (files = {}) => {
  const mask = Array.isArray(files.mask) ? files.mask[0] : null;
  if (!mask) return null;

  if (String(mask.mimetype || '').toLowerCase() !== 'image/png') {
    const error = new Error('mask 必须是 PNG 图片');
    error.status = 400;
    throw error;
  }
  if (Number(mask.size || 0) > MAX_MASK_SIZE_BYTES) {
    const error = new Error('mask 文件必须小于 4MB');
    error.status = 400;
    throw error;
  }

  return mask;
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

app.get('/api/health', async (req, res) => {
  try {
    if (req.query.job !== undefined) {
      if (!(await requireDatabase(res))) return;
      const jobId = Number(req.query.job || 0);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        res.json({ job: { id: jobId, jobId, status: 'failed', error: '任务不存在或无权访问' } });
        return;
      }

      const row = await fetchOwnedImageJob(req, jobId);
      if (!row) {
        res.json({ job: { id: jobId, jobId, status: 'failed', error: '任务不存在或无权访问' } });
        return;
      }

      res.json(imageJobResponse(row));
      return;
    }

    const settings = await getStoredUserSettings(req);
    const apiName = settings?.api_name || 'OpenAI Compatible';
    const configured = Boolean(await getEffectiveApiKey(req));

    res.json({
      ok: true,
      configured,
      mysqlConfigured,
      apiName,
      baseUrl,
      defaultImageModel,
    });
  } catch {
    res.json({
      ok: true,
      configured: Boolean(systemApiKey),
      mysqlConfigured,
      apiName: 'OpenAI Compatible',
      baseUrl,
      defaultImageModel,
    });
  }
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
  let displayName = '';

  if (!/^[\w\u4e00-\u9fa5.-]{2,20}$/.test(username)) {
    res.status(400).json({ error: '用户名需为 2-20 位中文、字母、数字、下划线、点或短横线' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' });
    return;
  }

  try {
    displayName = normalizeDisplayName(req.body?.displayName ?? req.body?.display_name, username);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)', [username, displayName, passwordHash]);
    setSessionUser(res, result.insertId);
    res.json({ user: { id: result.insertId, username, displayName }, settings: null });
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
  res.json({ user: { id: user.id, username: user.username, displayName: user.display_name || user.username, createdAt: user.created_at }, settings: await getSettingsForUser(user.id) });
});

app.post('/api/auth/profile', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const displayName = normalizeDisplayName(req.body?.displayName ?? req.body?.display_name, user.username);
    await pool.query('UPDATE users SET display_name = ? WHERE id = ?', [displayName, user.id]);
    res.json({ user: { ...user, displayName } });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '保存账号信息失败' });
  }
});

app.post('/api/auth/password', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const currentPassword = String(req.body?.currentPassword || req.body?.current_password || '');
  const newPassword = String(req.body?.newPassword || req.body?.new_password || '');
  if (newPassword.length < 6) {
    res.status(400).json({ error: '新密码至少 6 位' });
    return;
  }

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [user.id]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    res.status(401).json({ error: '旧密码错误' });
    return;
  }

  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 12), user.id]);
  res.json({ ok: true });
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

  const apiBaseUrl = String(settings.apiBaseUrl || settings.api_base_url || '').replace(/\s+/g, '');
  const requestTimeout = Math.max(10, Math.min(MAX_REQUEST_TIMEOUT, Number(settings.requestTimeout || settings.request_timeout || DEFAULT_REQUEST_TIMEOUT)));
  const moderation = allowedModerations.has(settings.moderation) ? settings.moderation : 'auto';
  const background = allowedBackgrounds.has(settings.background) ? settings.background : 'auto';
  const outputFormat = allowedOutputFormats.has(settings.output_format) ? settings.output_format : 'png';
  const outputCompression = clampNumber(settings.output_compression ?? 100, 0, 100);
  if (!isValidApiBaseUrl(apiBaseUrl)) {
    res.status(400).json({ error: 'API 地址必须是 http 或 https 地址' });
    return;
  }

  await pool.query(
    `INSERT INTO user_settings (
      user_id, model, api_name, api_base_url, request_timeout, stream_enabled, size, quality, style, response_format, background, output_format, output_compression, moderation, n,
      api_key_ciphertext, api_key_iv, api_key_tag, api_key_hint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      model = VALUES(model),
      api_name = VALUES(api_name),
      api_base_url = VALUES(api_base_url),
      request_timeout = VALUES(request_timeout),
      stream_enabled = VALUES(stream_enabled),
      size = VALUES(size),
      quality = VALUES(quality),
      style = VALUES(style),
      response_format = VALUES(response_format),
      background = VALUES(background),
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
      String(settings.apiName || settings.api_name || 'OpenAI Compatible').trim(),
      apiBaseUrl,
      requestTimeout,
      settings.streamEnabled || settings.stream_enabled ? 1 : 0,
      settings.size || '',
      ['auto', ...allowedImageQualities].includes(settings.quality) ? settings.quality : 'auto',
      settings.style || 'auto',
      settings.response_format || '',
      background,
      outputFormat,
      String(outputCompression),
      moderation,
      1,
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
      user?.displayName || user?.username || '未知艺术家',
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

app.get(['/api/image-job', '/api/image-jobs', '/api/image-jobs/:id'], async (req, res) => {
  if (!(await requireDatabase(res))) return;

  const jobId = Number(req.params.id || req.query.id || 0);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    res.json({ job: { id: jobId, jobId, status: 'failed', error: '任务不存在或无权访问' } });
    return;
  }

  const row = await fetchOwnedImageJob(req, jobId);
  if (!row) {
    res.json({ job: { id: jobId, jobId, status: 'failed', error: '任务不存在或无权访问' } });
    return;
  }

  res.json(imageJobResponse(row));
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

  const payload = toGenerationImagePayload(req.body);
  const effectiveBaseUrl = await getEffectiveApiBaseUrl(req);
  const requestTimeout = await getEffectiveRequestTimeout(req);
  const runGeneration = async () => {
    const response = await fetch(buildUpstreamUrl(effectiveBaseUrl, '/v1/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(requestTimeout * 1000),
    });

    const text = await response.text();
    const data = parseJsonText(text);

    if (!response.ok) {
      const payloadError = upstreamErrorPayload(data, '生图接口请求失败', response.status);
      const error = new Error(payloadError.error || '生图接口请求失败');
      error.status = response.status;
      error.detail = payloadError;
      throw error;
    }

    const invalidResponse = assertImageResponse(data, '生图接口没有返回图片数据');
    if (invalidResponse) {
      const error = new Error(invalidResponse.error || '生图接口没有返回图片数据');
      error.status = 502;
      error.detail = invalidResponse;
      throw error;
    }

    return normalizeImageData(data, payload.output_format);
  };

  if (pool) {
    if (!(await requireDatabase(res))) return;
    const jobId = await createPendingImageJob(req, res, payload, 'generation');
    res.status(202).json({ job: { id: jobId, jobId, status: 'running', mode: 'generation' } });

    runGeneration()
      .then((normalized) => completeImageJob(jobId, normalized, payload))
      .catch((error) => updateImageJobFailed(jobId, error instanceof Error ? error.message : String(error)));
    return;
  }

  try {
    const normalized = await runGeneration();
    normalized.data = await persistImageJobs(req, normalized.data, payload, 'generation');
    res.json(normalized);
  } catch (error) {
    res.status(error.status || 500).json(error.detail || {
      error: '代理请求异常',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/images/edits', upload.fields([
  { name: 'image', maxCount: MAX_EDIT_IMAGES },
  { name: 'image[]', maxCount: MAX_EDIT_IMAGES },
  { name: 'referenceImage', maxCount: MAX_EDIT_IMAGES },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  const effectiveApiKey = await getEffectiveApiKey(req);

  if (!effectiveApiKey) {
    res.status(500).json({ error: '服务端未配置 OPENAI_API_KEY，且当前用户未保存 API Key' });
    return;
  }

  if (!req.body?.prompt?.trim()) {
    res.status(400).json({ error: '提示词不能为空' });
    return;
  }

  let editImages = [];
  let maskFile = null;
  try {
    editImages = normalizeUploadedEditImages(req.files || {});
    maskFile = normalizeUploadedMask(req.files || {});
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '上传文件不符合要求' });
    return;
  }

  if (!editImages.length) {
    res.status(400).json({ error: '请上传参考图' });
    return;
  }

  const payload = toEditImagePayload(req.body);
  const effectiveBaseUrl = await getEffectiveApiBaseUrl(req);
  const requestTimeout = await getEffectiveRequestTimeout(req);
  const runEdit = async () => {
    const formData = new FormData();

    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
    });

    editImages.forEach((image, index) => {
      const imageBlob = new Blob([image.buffer], { type: image.mimetype || 'image/png' });
      formData.append('image[]', imageBlob, image.originalname || `image-${index + 1}.png`);
    });

    if (maskFile) {
      const maskBlob = new Blob([maskFile.buffer], { type: maskFile.mimetype || 'image/png' });
      formData.append('mask', maskBlob, maskFile.originalname || 'mask.png');
    }

    const response = await fetch(buildUpstreamUrl(effectiveBaseUrl, '/v1/images/edits'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(requestTimeout * 1000),
    });

    const text = await response.text();
    const data = parseJsonText(text);

    if (!response.ok) {
      const payloadError = upstreamErrorPayload(data, '图生图接口请求失败', response.status);
      const error = new Error(payloadError.error || '图生图接口请求失败');
      error.status = response.status;
      error.detail = payloadError;
      throw error;
    }

    const invalidResponse = assertImageResponse(data, '图生图接口没有返回图片数据');
    if (invalidResponse) {
      const error = new Error(invalidResponse.error || '图生图接口没有返回图片数据');
      error.status = 502;
      error.detail = invalidResponse;
      throw error;
    }

    return normalizeImageData(data, payload.output_format);
  };

  if (pool) {
    if (!(await requireDatabase(res))) return;
    const jobId = await createPendingImageJob(req, res, payload, 'edit');
    res.status(202).json({ job: { id: jobId, jobId, status: 'running', mode: 'edit' } });

    runEdit()
      .then((normalized) => completeImageJob(jobId, normalized, payload))
      .catch((error) => updateImageJobFailed(jobId, error instanceof Error ? error.message : String(error)));
    return;
  }

  try {
    const normalized = await runEdit();
    normalized.data = await persistImageJobs(req, normalized.data, payload, 'edit');
    res.json(normalized);
  } catch (error) {
    res.status(error.status || 500).json(error.detail || {
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