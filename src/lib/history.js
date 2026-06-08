import { HISTORY_KEY } from '../constants/options';
import { normalizeBoardImage } from './board';
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