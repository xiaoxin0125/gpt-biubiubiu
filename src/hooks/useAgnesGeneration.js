import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultAgnesApiCategory,
  defaultAgnesImageForm,
  defaultAgnesVideoForm,
} from '../constants/options';
import {
  normalizeDirectImageResponse,
  requestAgnesJson,
  requestAgnesResult,
  requestSharedAgnesJson,
  requestSharedAgnesResult,
} from '../lib/api';
import { clampNumber } from '../lib/math';

const pollDelayMs = 3000;
const maxPollAttempts = 80;

const splitInputs = (value) => String(value || '')
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const firstString = (...values) => values
  .flatMap((value) => (Array.isArray(value) ? value : [value]))
  .map((value) => String(value || '').trim())
  .find(Boolean) || '';

const nestedObject = (value) => (value && typeof value === 'object' ? value : {});

const agnesCategoryFromConfig = (config = {}, globalRequestTimeout) => {
  const category = config.agnesApi || config || {};
  return {
    ...defaultAgnesApiCategory,
    ...category,
    requestTimeout: category.requestTimeout || config.requestTimeout || globalRequestTimeout || defaultAgnesApiCategory.requestTimeout,
  };
};

const createRequestClient = async ({ config, apiConfigForm, apiKeyVaultRef, syncDirectApiKey }) => {
  const category = agnesCategoryFromConfig(config, apiConfigForm?.requestTimeout);
  if (config?.isShared) {
    if (!category.hasApiKey) throw new Error('共享 Agnes API 未配置 Key 或已被关闭。');
    return { category, isShared: true, apiKey: '' };
  }

  const currentFormApiKey = String(category.apiKey || '').trim();
  let apiKey = currentFormApiKey || String(apiKeyVaultRef.current.get(`${config.id}:agnesApi`) || '').trim();
  if (!apiKey && category.hasApiKey) {
    await syncDirectApiKey(apiConfigForm);
    apiKey = String(apiKeyVaultRef.current.get(`${config.id}:agnesApi`) || '').trim();
  }
  if (!apiKey) throw new Error('请先在参数设置里保存 Agnes API Key。');
  return { category, isShared: false, apiKey };
};

const callAgnesJson = ({ client, path, payload }) => (
  client.isShared
    ? requestSharedAgnesJson(path, payload)
    : requestAgnesJson(client.category, client.apiKey, path, payload)
);

const callAgnesResult = ({ client, videoId }) => (
  client.isShared
    ? requestSharedAgnesResult(videoId)
    : requestAgnesResult(client.category, client.apiKey, videoId)
);

export const normalizeAgnesVideoResult = (data = {}) => {
  const body = nestedObject(data);
  const dataNode = nestedObject(body.data);
  const resultNode = nestedObject(body.result);
  const outputNode = nestedObject(body.output);
  const source = Object.keys(dataNode).length ? dataNode : Object.keys(resultNode).length ? resultNode : body;
  const rawStatus = firstString(source.status, body.status, resultNode.status, outputNode.status).toLowerCase();
  const videoId = firstString(source.video_id, source.videoId, source.task_id, source.taskId, body.video_id, body.task_id, body.id);
  const videoUrl = firstString(
    source.remixed_from_video_id,
    source.video_url,
    source.videoUrl,
    source.url,
    outputNode.video_url,
    outputNode.url,
    Array.isArray(body.output) ? body.output.map((item) => item?.url || item?.video_url) : '',
  );
  const progressValue = source.progress ?? body.progress ?? resultNode.progress ?? null;
  const status = videoUrl || ['completed', 'succeeded', 'success', 'done'].includes(rawStatus)
    ? 'completed'
    : ['failed', 'error', 'cancelled', 'canceled'].includes(rawStatus)
      ? 'failed'
      : 'running';

  return {
    status,
    rawStatus: rawStatus || status,
    videoId,
    videoUrl,
    progress: progressValue === null || progressValue === undefined || progressValue === '' ? '' : String(progressValue),
    seconds: source.seconds ?? body.seconds ?? resultNode.seconds ?? '',
    size: source.size ?? body.size ?? resultNode.size ?? '',
    error: firstString(source.error, source.message, body.error?.message, body.error, body.message),
    raw: data,
  };
};

const extractVideoId = (data = {}) => {
  const normalized = normalizeAgnesVideoResult(data);
  return normalized.videoId || firstString(data.video_id, data.videoId, data.task_id, data.taskId, data.id);
};

const normalizeAgnesVideoMode = (mode) => (String(mode || '').trim() === 'keyframes' ? 'keyframes' : 'ti2vid');

const validateVideoForm = (form) => {
  const numFrames = Number(form.numFrames);
  const frameRate = Number(form.frameRate);
  const apiMode = normalizeAgnesVideoMode(form.mode);
  if (!form.prompt.trim()) return '请输入 Agnes 视频提示词。';
  if (!Number.isFinite(numFrames) || numFrames < 9 || numFrames > 441 || (numFrames - 1) % 8 !== 0) return '视频帧数必须小于等于 441，并符合 8n + 1。';
  if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 60) return '帧率必须在 1–60 之间。';
  if (apiMode === 'keyframes' && !String(form.image || form.extraImages || '').trim()) return '关键帧模式需要至少提供一张图片 URL 或 Base64。';
  return '';
};

const buildAgnesImagePayload = (form, category) => {
  const imageInputs = splitInputs(form.imageInputs);
  const extraBody = {
    response_format: form.responseFormat,
    return_base64: form.responseFormat === 'b64_json',
  };
  if (imageInputs.length) extraBody.image = imageInputs.length === 1 ? imageInputs[0] : imageInputs;

  const payload = {
    model: category.model || defaultAgnesImageForm.model,
    prompt: form.prompt.trim(),
    extra_body: extraBody,
  };
  if (String(form.size || '').trim()) payload.size = form.size;
  return payload;
};

const buildAgnesVideoPayload = (form) => {
  const images = [form.image.trim(), ...splitInputs(form.extraImages)].filter(Boolean);
  const extraBody = { mode: normalizeAgnesVideoMode(form.mode) };
  if (images.length) extraBody.image = images.length === 1 ? images[0] : images;

  const payload = {
    model: form.model || defaultAgnesVideoForm.model,
    prompt: form.prompt.trim(),
    width: Number(form.width),
    height: Number(form.height),
    num_frames: Number(form.numFrames),
    frame_rate: Number(form.frameRate),
    extra_body: extraBody,
  };

  if (String(form.numInferenceSteps).trim()) payload.num_inference_steps = Number(form.numInferenceSteps);
  if (String(form.seed).trim()) payload.seed = Number(form.seed);
  if (String(form.negativePrompt).trim()) payload.negative_prompt = form.negativePrompt.trim();
  return payload;
};

export const useAgnesGeneration = ({
  activeAgnesApiConfig,
  apiConfigForm,
  apiKeyVaultRef,
  syncDirectApiKey,
  setError,
}) => {
  const [imageForm, setImageForm] = useState(defaultAgnesImageForm);
  const [videoForm, setVideoForm] = useState(defaultAgnesVideoForm);
  const [imageResults, setImageResults] = useState([]);
  const [videoTasks, setVideoTasks] = useState([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  const updateImageForm = (key, value) => setImageForm((current) => ({
    ...current,
    [key]: typeof value === 'function' ? value(current[key], current) : value,
  }));
  const updateVideoForm = (key, value) => setVideoForm((current) => ({
    ...current,
    [key]: typeof value === 'function' ? value(current[key], current) : value,
  }));
  const clearImageResults = () => setImageResults([]);
  const clearVideoTasks = () => setVideoTasks([]);

  const setVideoResolution = (value) => {
    const [width, height] = String(value || '').split('x').map((item) => Number(item));
    if (!width || !height) return;
    setVideoForm((current) => ({ ...current, width, height }));
  };

  const runImageGeneration = useCallback(async (event) => {
    event.preventDefault();
    if (!imageForm.prompt.trim()) {
      setError('请输入 Agnes 生图提示词。');
      return;
    }

    setImageLoading(true);
    setError('');
    const requestId = `agnes-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    setImageResults((items) => [{ id: requestId, status: 'pending', prompt: imageForm.prompt, createdAt: startedAt }, ...items]);

    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const payload = buildAgnesImagePayload(imageForm, client.category);
      const data = await callAgnesJson({ client, path: '/v1/images/generations', payload });
      const normalized = normalizeDirectImageResponse(data, 'png');
      const completedAt = new Date().toISOString();
      const nextImages = normalized.data.map((image, index) => ({
        ...image,
        id: `${requestId}-${index}`,
        status: 'completed',
        prompt: imageForm.prompt,
        apiName: client.category.apiName || defaultAgnesApiCategory.apiName,
        createdAt: completedAt,
        raw: data,
      }));
      if (!nextImages.length) throw new Error('Agnes 未返回可展示图片。');
      setImageResults((items) => [...nextImages, ...items.filter((item) => item.id !== requestId)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agnes 生图失败';
      setError(message);
      setImageResults((items) => items.map((item) => (item.id === requestId ? { ...item, status: 'failed', error: message } : item)));
    } finally {
      setImageLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, imageForm, setError, syncDirectApiKey]);

  const pollVideoTask = useCallback(async ({ client, taskId, videoId }) => {
    let latestVideoId = videoId || taskId;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (cancelledRef.current) return;
      const data = await callAgnesResult({ client, videoId: latestVideoId });
      const normalized = normalizeAgnesVideoResult(data);
      latestVideoId = normalized.videoId || latestVideoId;
      setVideoTasks((items) => items.map((item) => (
        item.id === taskId
          ? { ...item, ...normalized, videoId: latestVideoId, updatedAt: new Date().toISOString() }
          : item
      )));
      if (normalized.status === 'completed' || normalized.status === 'failed') return;
      await wait(pollDelayMs);
    }
    setVideoTasks((items) => items.map((item) => (
      item.id === taskId ? { ...item, status: 'failed', error: 'Agnes 视频任务轮询超时。' } : item
    )));
  }, []);

  const runVideoGeneration = useCallback(async (event) => {
    event.preventDefault();
    const validationMessage = validateVideoForm(videoForm);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setVideoLoading(true);
    setError('');
    const localId = `agnes-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    setVideoTasks((items) => [{
      id: localId,
      status: 'pending',
      rawStatus: 'pending',
      prompt: videoForm.prompt,
      mode: videoForm.mode,
      width: Number(videoForm.width),
      height: Number(videoForm.height),
      frameRate: Number(videoForm.frameRate),
      numFrames: Number(videoForm.numFrames),
      createdAt: startedAt,
    }, ...items]);

    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const payload = buildAgnesVideoPayload(videoForm);
      const data = await callAgnesJson({ client, path: '/v1/videos', payload });
      const videoId = extractVideoId(data);
      if (!videoId) throw new Error('Agnes 未返回 video_id 或 task_id。');
      setVideoTasks((items) => items.map((item) => (
        item.id === localId
          ? { ...item, status: 'running', rawStatus: 'created', videoId, apiName: client.category.apiName || defaultAgnesApiCategory.apiName, rawCreate: data }
          : item
      )));
      await pollVideoTask({ client, taskId: localId, videoId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agnes 视频生成失败';
      setError(message);
      setVideoTasks((items) => items.map((item) => (item.id === localId ? { ...item, status: 'failed', error: message } : item)));
    } finally {
      setVideoLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, pollVideoTask, setError, syncDirectApiKey, videoForm]);

  return {
    imageForm,
    videoForm,
    imageResults,
    videoTasks,
    imageLoading,
    videoLoading,
    estimatedVideoSeconds: clampNumber(Number(videoForm.numFrames) || 0, 0, 441) / clampNumber(Number(videoForm.frameRate) || 1, 1, 60),
    updateImageForm,
    updateVideoForm,
    setVideoResolution,
    runImageGeneration,
    runVideoGeneration,
    clearImageResults,
    clearVideoTasks,
  };
};