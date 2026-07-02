import { HISTORY_KEY } from '../constants/options';
import { getImageIdentity, normalizeBoardImage } from './board';
import { normalizeForm } from './form';
import { normalizeImageSource } from './images';

export const readHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
};

export const saveHistory = (items) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
};

export const prependHistoryRecord = (record) => {
  const nextHistory = [record, ...readHistory().filter((item) => item.id !== record.id)].slice(0, 30);
  saveHistory(nextHistory);
  return nextHistory;
};

const getRecordTime = (record) => new Date(record?.createdAt || 0).getTime() || 0;

const getHistoryItemSource = (item, fallbackSource = 'generation') => normalizeImageSource(item?.source || item?.form?.source || fallbackSource);

const getHistoryImageIdentity = (image) => {
  const source = getHistoryItemSource(image);
  if (source === 'agnes-video') return String(image?.videoId || image?.video_id || image?.requestId || image?.request_id || image?.id || image?.jobId || image?.sourceJobId || image?.videoUrl || image?.video_url || image?.url || image?.image_url || getImageIdentity(image) || '');
  return String(image?.jobId || image?.sourceJobId || getImageIdentity(image) || '');
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const mergeHistoryImage = (primary, fallback) => {
  const merged = { ...fallback, ...primary };
  ['durationSeconds', 'startedAt', 'finishedAt', 'completedAt'].forEach((key) => {
    if (!hasValue(merged[key]) && hasValue(fallback?.[key])) merged[key] = fallback[key];
  });
  const form = { ...(fallback?.form || {}), ...(primary?.form || {}) };
  ['durationSeconds', 'startedAt', 'finishedAt'].forEach((key) => {
    if (!hasValue(form[key]) && hasValue(fallback?.form?.[key])) form[key] = fallback.form[key];
  });
  return { ...merged, form };
};

const uniqueHistoryImages = (images) => {
  const seen = new Map();
  const result = [];
  (images || []).forEach((image) => {
    const identity = getHistoryImageIdentity(image);
    if (!identity) {
      result.push(image);
      return;
    }
    if (!seen.has(identity)) {
      seen.set(identity, result.length);
      result.push(image);
      return;
    }
    const index = seen.get(identity);
    result[index] = mergeHistoryImage(result[index], image);
  });
  return result;
};

export const mergeHistoryRecords = (currentRecords, incomingRecords) => {
  const recordsById = new Map();

  [...(incomingRecords || []), ...(currentRecords || [])].forEach((record) => {
    if (!record?.id) return;
    const existing = recordsById.get(record.id);
    if (!existing) {
      recordsById.set(record.id, { ...record, images: uniqueHistoryImages(record.images) });
      return;
    }

    recordsById.set(record.id, {
      ...record,
      ...existing,
      createdAt: getRecordTime(existing) >= getRecordTime(record) ? existing.createdAt : record.createdAt,
      images: uniqueHistoryImages([...(existing.images || []), ...(record.images || [])]),
    });
  });

  return Array.from(recordsById.values())
    .filter((record) => (record.images || []).length > 0)
    .sort((left, right) => getRecordTime(right) - getRecordTime(left));
};

export const createHistoryRecordsFromGeneratedItems = (generatedItems) => {
  const recordsByRequest = new Map();

  (generatedItems || []).forEach((item) => {
    const requestId = item.requestId || item.request_id || `job-${item.jobId || item.id}`;
    const rawForm = { ...(item.form || {}), prompt: item.prompt || item.form?.prompt || '' };
    const source = getHistoryItemSource(item, rawForm.source);
    const formDraft = source === 'agnes-video'
      ? {
          ...rawForm,
          prompt: rawForm.prompt || item.prompt || '',
          size: rawForm.size || item.size || '',
          response_format: 'url',
          responseFormat: 'url',
          source,
        }
      : { ...normalizeForm(rawForm), source };
    const image = source === 'agnes-video'
      ? {
          ...item,
          id: item.id || `job-${item.jobId}`,
          requestId,
          status: item.status || 'completed',
          source,
          mediaType: 'video',
          url: item.url || item.videoUrl || item.video_url || item.image_url || '',
          image_url: item.image_url || item.url || item.videoUrl || item.video_url || '',
          videoUrl: item.videoUrl || item.video_url || item.url || item.image_url || '',
          videoId: item.videoId || item.video_id || item.form?.videoId || '',
          form: formDraft,
          prompt: item.prompt || formDraft.prompt || '',
          createdAt: item.createdAt || item.completedAt || item.finishedAt || new Date().toISOString(),
        }
      : normalizeBoardImage({
          ...item,
          id: item.id || `job-${item.jobId}`,
          requestId,
          status: 'completed',
          url: item.url || item.image_url || '',
          image_url: item.image_url || item.url || '',
          downloadUrl: item.downloadUrl || item.originalUrl || item.original_url || '',
          originalUrl: item.originalUrl || item.downloadUrl || item.original_url || '',
          b64_json: item.url || item.image_url ? '' : item.b64_json || '',
          form: formDraft,
          prompt: item.prompt || formDraft.prompt || '',
          source,
          isOnWall: Boolean(item.wallItemId),
          createdAt: item.createdAt || item.completedAt || item.finishedAt || new Date().toISOString(),
        });

    if (!recordsByRequest.has(requestId)) {
      recordsByRequest.set(requestId, {
        id: requestId,
        form: formDraft,
        images: [],
        createdAt: image.createdAt,
      });
    }

    recordsByRequest.get(requestId).images.push(image);
  });

  return Array.from(recordsByRequest.values())
    .map((record) => ({ ...record, images: uniqueHistoryImages(record.images) }))
    .sort((left, right) => getRecordTime(right) - getRecordTime(left));
};

export const flattenHistoryImages = (items) => items.flatMap((record) => {
  const fallbackSource = getHistoryItemSource(record.form);
  const form = fallbackSource === 'agnes-video' ? { ...(record.form || {}), source: fallbackSource } : normalizeForm(record.form || {});
  return (record.images || []).map((image) => {
    const source = getHistoryItemSource(image, fallbackSource);
    if (source === 'agnes-video') {
      return {
        ...image,
        id: image.id || image.videoId || image.videoUrl || record.id,
        historyId: record.id,
        source,
        mediaType: 'video',
        status: image.status || 'completed',
        form: { ...form, ...(image.form || {}), source, response_format: 'url', responseFormat: 'url' },
        prompt: image.prompt || image.form?.prompt || form.prompt || '',
        videoUrl: image.videoUrl || image.video_url || image.url || image.image_url || '',
        videoId: image.videoId || image.video_id || image.form?.videoId || '',
        createdAt: image.createdAt || record.createdAt,
      };
    }

    return {
      ...normalizeBoardImage(image, {
        form,
        prompt: form.prompt || '',
        createdAt: record.createdAt,
        source,
        historyId: record.id,
      }),
      historyId: record.id,
      source,
    };
  });
});

export const removeImageFromHistory = (items, target, isSameImage) => items
  .map((record) => {
    const nextImages = (record.images || []).filter((image) => {
      const normalized = normalizeBoardImage(image, {
        form: record.form,
        createdAt: record.createdAt,
        source: image.source || 'generation',
      });
      return !isSameImage(normalized, target);
    });
    return { ...record, images: nextImages };
  })
  .filter((record) => (record.images || []).length > 0);