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

const getHistoryImageIdentity = (image) => String(image?.jobId || image?.sourceJobId || getImageIdentity(image) || '');

const uniqueHistoryImages = (images) => {
  const seen = new Set();
  return (images || []).filter((image) => {
    const identity = getHistoryImageIdentity(image);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
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
    const formDraft = normalizeForm({ ...(item.form || {}), prompt: item.prompt || item.form?.prompt || '' });
    const image = normalizeBoardImage({
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
      source: normalizeImageSource(item.source),
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
  const form = normalizeForm(record.form || {});
  return (record.images || []).map((image) => normalizeBoardImage(image, {
    form,
    prompt: form.prompt || '',
    createdAt: record.createdAt,
    source: image.source || 'generation',
    historyId: record.id,
  })).map((image) => ({ ...image, historyId: record.id, source: normalizeImageSource(image.source) }));
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