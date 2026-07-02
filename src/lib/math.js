export const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

export const normalizePercent = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(normalized)) return fallback;
  return Math.round(clampNumber(normalized, 0, 100));
};