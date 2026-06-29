import { useCallback, useRef } from 'react';
import { defaultApiConfigItem, defaultForm } from '../constants/options';
import {
  normalizeBackground,
  normalizeForm,
  normalizeModeration,
  normalizeOutputCount,
  normalizeOutputFormat,
  normalizeQuality,
  normalizeResponseFormat,
  normalizeVisibleRevisedPrompt,
} from '../lib/form';
import {
  normalizeDirectImageResponse,
  requestDirectImageFormData,
  requestDirectImageJson,
  requestJson,
} from '../lib/api';
import { normalizeBoardImage } from '../lib/board';
import {
  createImageSrc,
  imageMimeForOutputFormat,
  imageToSavePayload,
  normalizeImageSource,
} from '../lib/images';
import { mergeHistoryRecords, prependHistoryRecord } from '../lib/history';

export const buildGenerationPayload = (formDraft, apiConfig, apiConfigForm) => {
  const normalized = normalizeForm({ ...formDraft, model: apiConfig?.model || formDraft.model });
  const useStream = Boolean(apiConfig?.stream ?? apiConfigForm.stream);
  const responseFormat = useStream ? 'url' : normalizeResponseFormat(normalized.response_format);
  const outputFormat = normalizeOutputFormat(normalized.output_format);
  const payload = {
    model: normalized.model || defaultForm.model,
    prompt: normalized.prompt,
    n: normalizeOutputCount(normalized.n),
    response_format: responseFormat,
    moderation: normalizeModeration(normalized.moderation),
  };

  if (responseFormat === 'url') payload.output_format = outputFormat;
  if (normalized.size) payload.size = normalized.size;
  if (useStream && responseFormat === 'url') payload.stream = true;
  if (normalizeQuality(normalized.quality) !== 'auto') payload.quality = normalizeQuality(normalized.quality);
  if (normalizeBackground(normalized.background) !== 'auto') payload.background = normalizeBackground(normalized.background);

  return payload;
};

export const buildEditPayload = (formDraft, apiConfig, referenceImages, maskImage) => {
  const normalized = normalizeForm({ ...formDraft, model: apiConfig?.model || formDraft.model });
  const responseFormat = normalizeResponseFormat(normalized.response_format);
  const outputFormat = normalizeOutputFormat(normalized.output_format);
  const canUseOutputFormat = responseFormat === 'url';
  const payload = new FormData();

  payload.append('model', normalized.model || defaultForm.model);
  payload.append('prompt', normalized.prompt);
  payload.append('n', String(normalizeOutputCount(normalized.n)));
  payload.append('response_format', responseFormat);
  payload.append('moderation', normalizeModeration(normalized.moderation));
  referenceImages.forEach((image) => {
    payload.append('image[]', image.file, image.name || image.file.name || 'reference-image');
  });

  if (canUseOutputFormat) payload.append('output_format', outputFormat);
  if (normalized.size) payload.append('size', normalized.size);
  if (normalizeQuality(normalized.quality) !== 'auto') payload.append('quality', normalizeQuality(normalized.quality));
  if (normalizeBackground(normalized.background) !== 'auto') payload.append('background', normalizeBackground(normalized.background));
  if (maskImage?.file) payload.append('mask', maskImage.file, maskImage.name || maskImage.file.name || 'mask.png');

  return payload;
};

export const useGeneration = (deps) => {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const generate = useCallback(async (event) => {
    const {
      form,
      hasReferenceImages,
      referenceNames,
      activeApiConfig,
      status,
      apiConfigForm,
      apiKeyVaultRef,
      deletedRequestIdsRef,
      referenceImages,
      maskImage,
      user,
      syncDirectApiKey,
      setError,
      setRunningGenerations,
      setStatus,
      setView,
      setBoardScope,
      setImages,
      setSelectedImage,
      setHistory,
    } = depsRef.current;

    event.preventDefault();
    const prompt = form.prompt.trim();

    if (!prompt) {
      setError('先写提示词，再开始生成。');
      return;
    }

    setError('');
    setRunningGenerations((count) => count + 1);
    setStatus((current) => ({ ...current, message: hasReferenceImages ? 'Editing' : 'Generating' }));
    setView('generate');
    setBoardScope('generate');

    const requestId = `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    deletedRequestIdsRef.current.delete(requestId);
    const startedAt = new Date().toISOString();
    const requestConfig = activeApiConfig || defaultApiConfigItem;
    const requestApiName = requestConfig.apiName || status.apiName || defaultApiConfigItem.apiName;
    const imageForm = normalizeForm({ ...form, prompt, model: requestConfig.model });
    const pendingItem = {
      id: requestId,
      requestId,
      status: 'pending',
      form: imageForm,
      apiName: requestApiName,
      prompt,
      startedAt,
      createdAt: startedAt,
      source: hasReferenceImages ? 'edit' : 'generation',
      referenceName: referenceNames,
    };
    setImages((items) => [pendingItem, ...items]);

    try {
      if (!status.configured && !requestConfig.hasApiKey) throw new Error('请先在参数设置里保存 API Key。');
      let requestApiKey = String(apiKeyVaultRef.current.get(String(requestConfig.id)) || '').trim();
      if (!requestApiKey && requestConfig.hasApiKey) {
        await syncDirectApiKey(apiConfigForm);
        requestApiKey = String(apiKeyVaultRef.current.get(String(requestConfig.id)) || '').trim();
      }
      if (!requestApiKey) throw new Error('服务器未同步到 API Key，请重新登录或重新保存 Key。');
      const payload = hasReferenceImages
        ? buildEditPayload(imageForm, requestConfig, referenceImages, maskImage)
        : buildGenerationPayload(imageForm, { ...requestConfig, stream: apiConfigForm.stream }, apiConfigForm);
      const data = hasReferenceImages
        ? await requestDirectImageFormData(requestConfig, requestApiKey, payload)
        : await requestDirectImageJson(requestConfig, requestApiKey, payload);
      const outputFormat = hasReferenceImages
        ? (normalizeResponseFormat(imageForm.response_format) === 'url' ? normalizeOutputFormat(imageForm.output_format) : defaultForm.output_format)
        : payload.output_format || defaultForm.output_format;
      const normalizedData = normalizeDirectImageResponse(data, outputFormat);

      const finishedAt = new Date().toISOString();
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, message: 'Done · 0' }));
        return;
      }
      const nextImages = Array.isArray(normalizedData.data)
        ? normalizedData.data.map((image, index) => normalizeBoardImage({
            ...image,
            upstreamImageId: image.id || '',
            id: `${requestId}-${index}`,
            requestId,
            status: 'completed',
            form: imageForm,
            apiName: requestApiName,
            prompt,
            startedAt,
            finishedAt,
            createdAt: finishedAt,
            source: hasReferenceImages ? 'edit' : 'generation',
            referenceName: referenceNames,
          }))
        : [];

      if (!nextImages.some((image) => Boolean(createImageSrc(image)))) {
        throw new Error('上游接口未返回可展示图片。');
      }

      let storedImages = nextImages;
      if (user) {
        try {
          const savedImages = [];
          for (const image of nextImages) {
            const imagePayload = imageToSavePayload(image, imageMimeForOutputFormat(imageForm.output_format));
            const saved = await requestJson('/api/generated-images', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId,
                mode: normalizeImageSource(image.source),
                image: imagePayload,
                prompt,
                revised_prompt: normalizeVisibleRevisedPrompt(prompt, image.revised_prompt),
                form: { ...imageForm, apiName: requestApiName, source: normalizeImageSource(image.source), referenceName: referenceNames },
                params: { ...imageForm, apiName: requestApiName, source: normalizeImageSource(image.source), referenceName: referenceNames },
              }),
            });
            savedImages.push(normalizeBoardImage({
              ...image,
              ...(saved.item || {}),
              upstreamImageId: image.upstreamImageId || image.id || '',
              source: normalizeImageSource(image.source),
              apiName: requestApiName,
              prompt,
              form: imageForm,
              referenceName: referenceNames,
            }));
          }
          if (savedImages.length) storedImages = savedImages;
        } catch {
          setError('图片已生成，但服务器保存失败；刷新后可能无法恢复这次未上墙作品。');
        }
      }

      setImages((items) => [
        ...storedImages,
        ...items.filter((item) => item.requestId !== requestId && item.id !== requestId),
      ]);
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? storedImages[0] || current : current));
      setView('generate');

      const record = {
        id: requestId,
        form: imageForm,
        images: storedImages,
        createdAt: finishedAt,
      };

      try {
        const nextHistory = prependHistoryRecord(record);
        setHistory((items) => (user ? mergeHistoryRecords(items, [record]) : nextHistory));
      } catch {
        setHistory((items) => (user ? mergeHistoryRecords(items, [record]) : [record, ...items.filter((item) => item.id !== record.id)].slice(0, 30)));
        setError('图片已生成，但本地历史记录保存失败。');
      }
      setStatus((current) => ({ ...current, message: `Done · ${storedImages.length}` }));
    } catch (requestError) {
      const failedAt = new Date().toISOString();
      const message = requestError instanceof Error ? requestError.message : '生成失败';
      if (deletedRequestIdsRef.current.has(requestId)) {
        setStatus((current) => ({ ...current, message: current.configured ? '已删除' : current.message }));
        return;
      }
      setError(message);
      setImages((items) => items.map((item) => (
        item.requestId === requestId || item.id === requestId
          ? { ...item, status: 'failed', error: message, finishedAt: failedAt }
          : item
      )));
      setSelectedImage((current) => (current?.requestId === requestId || current?.id === requestId ? { ...current, status: 'failed', error: message, finishedAt: failedAt } : current));
      setStatus((current) => ({ ...current, message: current.configured ? 'Failed' : current.message }));
    } finally {
      setRunningGenerations((count) => Math.max(0, count - 1));
    }
  }, []);

  return { generate };
};