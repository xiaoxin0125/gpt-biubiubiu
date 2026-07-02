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
import { isDataImageValue, stripDataImagePrefix } from '../lib/images';
import { clampNumber, normalizePercent } from '../lib/math';

const pollDelayMs = 10000;
const maxPollAttempts = 120;
const pollRateLimitDelayMs = 20000;
const maxPollDelayMs = 45000;
const manualRefreshThrottleMs = 12000;

const isRateLimitError = (error) => /rate limit|too many|429|exceeded/i.test(String(error?.message || error || ''));

const splitInputs = (value) => String(value || '')
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const isHttpImageReference = (value) => /^https?:\/\//i.test(String(value || '').trim());

const looksLikeImageBase64 = (value) => {
  const compactValue = stripDataImagePrefix(value).replace(/\s+/g, '');
  if (compactValue.length < 80 || compactValue.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compactValue);
};

const isValidVideoImageInput = (value) => {
  const currentValue = String(value || '').trim();
  return isHttpImageReference(currentValue) || isDataImageValue(currentValue) || looksLikeImageBase64(currentValue);
};

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

  const progress = normalizePercent(progressValue, status === 'completed' ? 100 : status === 'failed' ? '' : 0);

  return {
    status,
    rawStatus: rawStatus || status,
    videoId,
    videoUrl,
    progress,
    seconds: source.seconds ?? body.seconds ?? resultNode.seconds ?? outputNode.seconds ?? '',
    size: source.size ?? body.size ?? resultNode.size ?? outputNode.size ?? '',
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
  const imageInputs = [String(form.image || '').trim(), ...splitInputs(form.extraImages)].filter(Boolean);
  const invalidImageInput = imageInputs.find((value) => !isValidVideoImageInput(value));
  if (invalidImageInput) return '主图和额外图片只能填写 http(s) 链接或图片 Base64。';
  if (apiMode === 'keyframes' && imageInputs.length < 2) return '关键帧模式需要至少提供两张图片 URL 或 Base64。';
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
  const primaryImage = String(form.image || '').trim();
  const extraImages = splitInputs(form.extraImages);
  const images = [primaryImage, ...extraImages].filter(Boolean);
  const apiMode = normalizeAgnesVideoMode(form.mode);

  const payload = {
    model: form.model || defaultAgnesVideoForm.model,
    prompt: form.prompt.trim(),
    width: Number(form.width),
    height: Number(form.height),
    num_frames: Number(form.numFrames),
    frame_rate: Number(form.frameRate),
  };

  if (apiMode === 'keyframes') {
    payload.extra_body = {
      image: images,
      mode: 'keyframes',
    };
  } else if (images.length === 1) {
    payload.image = images[0];
  } else if (images.length > 1) {
    payload.extra_body = { image: images };
  }

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
  persistImageResults,
  persistVideoTask,
}) => {
  const [imageForm, setImageForm] = useState(defaultAgnesImageForm);
  const [videoForm, setVideoForm] = useState(defaultAgnesVideoForm);
  const [imageResults, setImageResults] = useState([]);
  const [videoTasks, setVideoTasks] = useState([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const cancelledRef = useRef(false);
  const lastVideoRefreshAtRef = useRef(0);

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
  const removeImageResult = (id) => setImageResults((items) => items.filter((item) => item.id !== id));
  const removeVideoTask = (id) => setVideoTasks((items) => items.filter((item) => item.id !== id));

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
    setImageResults((items) => [{
      id: requestId,
      status: 'pending',
      prompt: imageForm.prompt,
      form: { ...imageForm, response_format: imageForm.responseFormat, source: 'agnes-image' },
      source: 'agnes-image',
      mediaType: 'image',
      createdAt: startedAt,
      startedAt,
    }, ...items]);

    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const payload = buildAgnesImagePayload(imageForm, client.category);
      const data = await callAgnesJson({ client, path: '/v1/images/generations', payload });
      const normalized = normalizeDirectImageResponse(data, 'png');
      const completedAt = new Date().toISOString();
      const durationSeconds = Math.max(1, Math.floor((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000));
      const resultForm = {
        ...imageForm,
        model: payload.model,
        prompt: imageForm.prompt,
        response_format: imageForm.responseFormat,
        responseFormat: imageForm.responseFormat,
        size: imageForm.size || '',
        startedAt,
        finishedAt: completedAt,
        durationSeconds,
        source: 'agnes-image',
      };
      const nextImages = normalized.data.map((image, index) => ({
        ...image,
        id: `${requestId}-${index}`,
        status: 'completed',
        prompt: imageForm.prompt,
        form: resultForm,
        source: 'agnes-image',
        mediaType: 'image',
        apiName: client.category.apiName || defaultAgnesApiCategory.apiName,
        createdAt: completedAt,
        startedAt,
        finishedAt: completedAt,
        durationSeconds,
        raw: data,
      }));
      if (!nextImages.length) throw new Error('Agnes 未返回可展示图片。');
      let storedImages = nextImages;
      if (typeof persistImageResults === 'function') {
        try {
          const persistedImages = await persistImageResults({
            requestId,
            images: nextImages,
            form: resultForm,
            prompt: imageForm.prompt,
            apiName: client.category.apiName || defaultAgnesApiCategory.apiName,
            startedAt,
            finishedAt: completedAt,
            durationSeconds,
            raw: data,
          });
          if (Array.isArray(persistedImages) && persistedImages.length) storedImages = persistedImages;
        } catch (saveError) {
          const saveMessage = saveError instanceof Error ? saveError.message : '未知错误';
          setError(`图片已生成，但服务器保存失败：${saveMessage}；刷新后可能无法恢复这次 Agnes 作品。`);
        }
      }
      setImageResults((items) => [...storedImages, ...items.filter((item) => item.id !== requestId)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agnes 生图失败';
      setError(message);
      setImageResults((items) => items.map((item) => (item.id === requestId ? { ...item, status: 'failed', error: message } : item)));
    } finally {
      setImageLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, imageForm, persistImageResults, setError, syncDirectApiKey]);

  const pollVideoTask = useCallback(async ({ client, taskId, videoId }) => {
    let latestVideoId = videoId || taskId;
    let nextDelayMs = pollDelayMs;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (cancelledRef.current) return;
      try {
        const data = await callAgnesResult({ client, videoId: latestVideoId });
        const normalized = normalizeAgnesVideoResult(data);
        latestVideoId = normalized.videoId || latestVideoId;
        nextDelayMs = pollDelayMs;
        let nextTask = null;
        setVideoTasks((items) => items.map((item) => {
          if (item.id !== taskId) return item;
          const updatedAt = new Date().toISOString();
          nextTask = {
            ...item,
            ...normalized,
            videoId: latestVideoId,
            error: normalized.error || '',
            statusNotice: '',
            updatedAt,
            ...(['completed', 'failed'].includes(normalized.status) ? { finishedAt: updatedAt } : {}),
          };
          return nextTask;
        }));
        if (nextTask && typeof persistVideoTask === 'function') persistVideoTask(nextTask);
        if (normalized.status === 'completed' || normalized.status === 'failed') return;
      } catch (error) {
        if (!isRateLimitError(error)) throw error;
        nextDelayMs = Math.min(maxPollDelayMs, Math.max(pollRateLimitDelayMs, nextDelayMs * 2));
        let throttledTask = null;
        setVideoTasks((items) => items.map((item) => {
          if (item.id !== taskId) return item;
          throttledTask = {
            ...item,
            status: item.status === 'pending' ? 'running' : item.status,
            rawStatus: 'rate_limited',
            statusNotice: '状态查询过快，已自动降低刷新频率。',
            videoId: latestVideoId,
            updatedAt: new Date().toISOString(),
          };
          return throttledTask;
        }));
        if (throttledTask && typeof persistVideoTask === 'function') persistVideoTask(throttledTask);
      }
      await wait(nextDelayMs);
    }
    let timeoutTask = null;
    setVideoTasks((items) => items.map((item) => {
      if (item.id !== taskId) return item;
      timeoutTask = { ...item, status: 'failed', error: 'Agnes 视频任务轮询超时。', finishedAt: new Date().toISOString() };
      return timeoutTask;
    }));
    if (timeoutTask && typeof persistVideoTask === 'function') persistVideoTask(timeoutTask);
  }, [persistVideoTask]);

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
    const taskForm = {
      ...videoForm,
      prompt: videoForm.prompt,
      size: `${Number(videoForm.width)}x${Number(videoForm.height)}`,
      response_format: 'url',
      responseFormat: 'url',
      source: 'agnes-video',
    };
    const pendingTask = {
      id: localId,
      requestId: localId,
      status: 'pending',
      rawStatus: 'pending',
      prompt: videoForm.prompt,
      form: taskForm,
      source: 'agnes-video',
      mediaType: 'video',
      mode: videoForm.mode,
      width: Number(videoForm.width),
      height: Number(videoForm.height),
      frameRate: Number(videoForm.frameRate),
      numFrames: Number(videoForm.numFrames),
      createdAt: startedAt,
      startedAt,
    };
    setVideoTasks((items) => [pendingTask, ...items]);

    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const payload = buildAgnesVideoPayload(videoForm);
      const data = await callAgnesJson({ client, path: '/v1/videos', payload });
      const createdResult = normalizeAgnesVideoResult(data);
      const videoId = createdResult.videoId || extractVideoId(data);
      if (!videoId) throw new Error('Agnes 未返回 video_id 或 task_id。');
      const runningTask = {
        ...pendingTask,
        ...createdResult,
        status: createdResult.status || 'running',
        rawStatus: createdResult.rawStatus || 'created',
        videoId,
        apiName: client.category.apiName || defaultAgnesApiCategory.apiName,
      };
      setVideoTasks((items) => items.map((item) => (item.id === localId ? runningTask : item)));
      if (typeof persistVideoTask === 'function') persistVideoTask(runningTask);
      if (!['completed', 'failed'].includes(runningTask.status)) await pollVideoTask({ client, taskId: localId, videoId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agnes 视频生成失败';
      setError(message);
      setVideoTasks((items) => items.map((item) => (item.id === localId ? { ...item, status: 'failed', error: message } : item)));
    } finally {
      setVideoLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, persistVideoTask, pollVideoTask, setError, syncDirectApiKey, videoForm]);

  const refreshVideoTasks = useCallback(async () => {
    const targets = videoTasks.filter((task) => task.videoId && !['completed', 'failed'].includes(task.status));
    if (!targets.length) return;
    const now = Date.now();
    if (now - lastVideoRefreshAtRef.current < manualRefreshThrottleMs) {
      setError('视频状态刷新太频繁，请稍后再试。');
      return;
    }
    lastVideoRefreshAtRef.current = now;

    setVideoLoading(true);
    setError('');
    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const updates = [];
      for (const task of targets) {
        try {
          const data = await callAgnesResult({ client, videoId: task.videoId });
          updates.push({ id: task.id, normalized: normalizeAgnesVideoResult(data) });
          if (targets.length > 1) await wait(pollDelayMs);
        } catch (error) {
          if (!isRateLimitError(error)) throw error;
          updates.push({ id: task.id, rateLimited: true });
          setError('Agnes 状态查询频率受限，已降低刷新频率。');
          break;
        }
      }
      const updatedAt = new Date().toISOString();
      const persistedTasks = [];
      setVideoTasks((items) => items.map((item) => {
        const update = updates.find((entry) => entry.id === item.id);
        if (!update) return item;
        const nextTask = update.rateLimited ? {
          ...item,
          rawStatus: 'rate_limited',
          statusNotice: '状态查询过快，已自动降低刷新频率。',
          updatedAt,
        } : {
          ...item,
          ...update.normalized,
          videoId: update.normalized.videoId || item.videoId,
          error: update.normalized.error || '',
          statusNotice: '',
          updatedAt,
          ...(['completed', 'failed'].includes(update.normalized.status) ? { finishedAt: updatedAt } : {}),
        };
        persistedTasks.push(nextTask);
        return nextTask;
      }));
      if (typeof persistVideoTask === 'function') persistedTasks.forEach((task) => persistVideoTask(task));
    } catch (error) {
      setError(error instanceof Error ? error.message : '刷新 Agnes 视频任务失败');
    } finally {
      setVideoLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, persistVideoTask, setError, syncDirectApiKey, videoTasks]);

  const refreshVideoHistoryTasks = useCallback(async (tasks = []) => {
    const targets = tasks.filter((task) => {
      if (!String(task?.videoId || task?.video_id || '').trim()) return false;
      return !['completed', 'failed'].includes(String(task?.status || '').trim());
    });
    if (!targets.length) return [];

    setVideoLoading(true);
    setError('');
    try {
      const client = await createRequestClient({ config: activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey });
      const updatedAt = new Date().toISOString();
      const refreshedTasks = [];
      for (const task of targets) {
        try {
          const data = await callAgnesResult({ client, videoId: task.videoId || task.video_id });
          const normalized = normalizeAgnesVideoResult(data);
          const nextTask = {
            ...task,
            ...normalized,
            videoId: normalized.videoId || task.videoId || task.video_id,
            error: normalized.error || '',
            statusNotice: '',
            source: 'agnes-video',
            mediaType: 'video',
            updatedAt,
            ...(['completed', 'failed'].includes(normalized.status) ? { finishedAt: updatedAt } : {}),
          };
          if (typeof persistVideoTask === 'function') persistVideoTask(nextTask);
          refreshedTasks.push(nextTask);
          if (targets.length > 1) await wait(pollDelayMs);
        } catch (error) {
          if (!isRateLimitError(error)) throw error;
          setError('Agnes 状态查询频率受限，已降低刷新频率。');
          break;
        }
      }
      return refreshedTasks;
    } catch (error) {
      setError(error instanceof Error ? error.message : '刷新 Agnes 视频历史失败');
      return [];
    } finally {
      setVideoLoading(false);
    }
  }, [activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, persistVideoTask, setError, syncDirectApiKey]);

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
    removeImageResult,
    removeVideoTask,
    refreshVideoTasks,
    refreshVideoHistoryTasks,
  };
};