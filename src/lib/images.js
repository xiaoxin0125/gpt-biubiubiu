export const DATA_IMAGE_URL_PATTERN = /^data[:：](image\/[a-z0-9.+-]+);base64,/i;

const objectImageUrlCache = new Map();

export const getDataImageMime = (value) => String(value || '').match(DATA_IMAGE_URL_PATTERN)?.[1] || '';

export const isDataImageValue = (value) => DATA_IMAGE_URL_PATTERN.test(String(value || ''));

export const stripDataImagePrefix = (value) => String(value || '').replace(DATA_IMAGE_URL_PATTERN, '');

const toCompactBase64 = (value) => stripDataImagePrefix(value).replace(/\s+/g, '');

export const createObjectImageUrl = (value, fallbackMime = 'image/png') => {
  const compactBase64 = toCompactBase64(value);
  if (!compactBase64) return '';

  const mime = getDataImageMime(value) || fallbackMime || 'image/png';
  const cacheKey = `${mime}:${compactBase64}`;
  const cachedUrl = objectImageUrlCache.get(cacheKey);
  if (cachedUrl) return cachedUrl;

  if (typeof window === 'undefined' || typeof window.atob !== 'function' || !window.URL?.createObjectURL) {
    return `data:${mime};base64,${compactBase64}`;
  }

  try {
    const binary = window.atob(compactBase64);
    const chunkSize = 8192;
    const chunks = [];

    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const chunk = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(chunk.length);
      for (let index = 0; index < chunk.length; index += 1) bytes[index] = chunk.charCodeAt(index);
      chunks.push(bytes);
    }

    const objectUrl = window.URL.createObjectURL(new Blob(chunks, { type: mime }));
    objectImageUrlCache.set(cacheKey, objectUrl);
    return objectUrl;
  } catch {
    return `data:${mime};base64,${compactBase64}`;
  }
};

export const revokeObjectImageUrls = () => {
  if (typeof window === 'undefined' || !window.URL?.revokeObjectURL) return;
  objectImageUrlCache.forEach((objectUrl) => window.URL.revokeObjectURL(objectUrl));
  objectImageUrlCache.clear();
};

export const createImageSrc = (image) => {
  const url = String(image?.url || image?.image_url || '');
  if (url) return isDataImageValue(url) ? createObjectImageUrl(url, getDataImageMime(url) || image?.imageMime || 'image/png') : url;

  const b64Json = String(image?.b64_json || image?.image_b64 || '');
  if (!b64Json) return '';

  return createObjectImageUrl(b64Json, getDataImageMime(b64Json) || image?.imageMime || image?.image_mime || 'image/png');
};

export const createImageDownloadSrc = (image) => {
  const url = String(image?.downloadUrl || image?.originalUrl || image?.original_url || image?.url || image?.image_url || '');
  if (url) return isDataImageValue(url) ? createObjectImageUrl(url, getDataImageMime(url) || image?.imageMime || 'image/png') : url;
  return createImageSrc(image);
};

export const normalizeImageSource = (source) => {
  if (source === 'edit') return 'edit';
  if (source === 'wall') return 'wall';
  return 'generation';
};

export const getGeneratedImageJobId = (image) => {
  const value = image?.sourceJobId || image?.jobId || image?.source_job_id || image?.job_id || image?.id;
  const matched = String(value || '').match(/^(?:job-)?(\d+)$/);
  return matched ? Number(matched[1]) : 0;
};

export const imageMimeForOutputFormat = (format) => {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
};