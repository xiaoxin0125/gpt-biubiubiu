import { MASONRY_CARD_GAP_RATIO, MASONRY_CARD_TEXT_HEIGHT_RATIO } from '../constants/options';
import { normalizeForm } from './form';
import { createImageSrc, normalizeImageSource } from './images';
import { clampNumber } from './math';
import { parseSize } from './size';

export const getImageIdentity = (image) => String(image?.id || image?.jobId || image?.sourceJobId || image?.source_job_id || image?.wallItemId || createImageSrc(image) || '');

export const getEmptyBoardText = (scope, view = 'generate') => {
  if (view === 'wall') return '暂无上墙作品';
  if (scope === 'history') return '暂无历史记录';
  if (scope === 'all') return '暂无作品记录';
  return '输入提示词开始生成图片';
};

export const normalizeBoardImage = (image, fallback = {}) => {
  const hasRenderableImage = Boolean(createImageSrc(image));
  return {
    ...image,
    id: image?.id || fallback.id || `image-${Date.now()}`,
    status: hasRenderableImage ? 'completed' : image?.status || 'completed',
    form: normalizeForm(image?.form || fallback.form || {}),
    prompt: image?.prompt || fallback.prompt || image?.form?.prompt || fallback.form?.prompt || '',
    createdAt: image?.createdAt || fallback.createdAt || new Date().toISOString(),
    source: normalizeImageSource(image?.source || fallback.source),
  };
};

export const isSameImageIdentity = (left, right) => {
  if (!left || !right) return false;
  if (left.wallItemId && right.wallItemId && Number(left.wallItemId) === Number(right.wallItemId)) return true;
  if (left.id && right.id && String(left.id) === String(right.id)) return true;
  const leftSrc = createImageSrc(left);
  const rightSrc = createImageSrc(right);
  return Boolean(leftSrc && rightSrc && leftSrc === rightSrc);
};

export const canRenderBoardItem = (image) => image?.status === 'pending' || image?.status === 'failed' || Boolean(createImageSrc(image));

export const formatDate = (value) => {
  if (!value) return '刚刚';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

export const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

export const getSourceLabel = (image) => {
  if (image?.source === 'edit') return '图生图';
  if (image?.source === 'wall') return '作品墙';
  return '文生图';
};

export const estimateImageAspectRatio = (image, meta = {}) => {
  if (meta.aspectRatio) return clampNumber(Number(meta.aspectRatio) || 1, 0.28, 3.2);
  const size = parseSize(image?.form?.size || image?.size || '1024x1024');
  return clampNumber(size.width / size.height, 0.28, 3.2);
};

export const getMasonryColumns = (items, columnCount, imageMeta) => {
  const safeColumnCount = Math.max(1, Number(columnCount) || 1);
  const columns = Array.from({ length: safeColumnCount }, (_, index) => ({ id: `masonry-column-${index}`, height: 0, items: [] }));

  items.forEach((image) => {
    const identity = getImageIdentity(image);
    const meta = imageMeta[identity] || {};
    const aspectRatio = estimateImageAspectRatio(image, meta);
    const estimatedHeight = 1 / aspectRatio + MASONRY_CARD_TEXT_HEIGHT_RATIO + MASONRY_CARD_GAP_RATIO;
    const target = columns.reduce((shortest, column) => (column.height < shortest.height ? column : shortest), columns[0]);
    target.items.push(image);
    target.height += estimatedHeight;
  });

  return columns;
};

export const getResponsiveMasonryColumnCount = () => {
  if (typeof window === 'undefined') return 4;
  if (window.innerWidth <= 640) return 1;
  if (window.innerWidth <= 1024) return 2;
  return 4;
};