import { MASONRY_CARD_GAP_RATIO, MASONRY_CARD_TEXT_HEIGHT_RATIO } from '../constants/options';
import { normalizeForm, normalizeVisibleRevisedPrompt } from './form';
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
  const rawForm = image?.form || fallback.form || {};
  const form = normalizeForm(rawForm);
  const prompt = image?.prompt || fallback.prompt || rawForm.prompt || fallback.form?.prompt || '';
  const durationSeconds = image?.durationSeconds ?? image?.duration_seconds ?? rawForm.durationSeconds ?? rawForm.duration_seconds ?? fallback.durationSeconds ?? fallback.form?.durationSeconds ?? null;
  const startedAt = image?.startedAt || image?.started_at || rawForm.startedAt || rawForm.started_at || fallback.startedAt || fallback.form?.startedAt || '';
  const finishedAt = image?.finishedAt || image?.finished_at || image?.completedAt || image?.completed_at || rawForm.finishedAt || rawForm.finished_at || fallback.finishedAt || fallback.form?.finishedAt || '';

  return {
    ...image,
    id: image?.id || fallback.id || `image-${Date.now()}`,
    status: hasRenderableImage ? 'completed' : image?.status || 'completed',
    form,
    prompt,
    revised_prompt: normalizeVisibleRevisedPrompt(prompt, image?.revised_prompt, image?.revisedPrompt, image?.prompt_revised),
    createdAt: image?.createdAt || fallback.createdAt || new Date().toISOString(),
    startedAt,
    finishedAt,
    completedAt: image?.completedAt || image?.completed_at || finishedAt || null,
    durationSeconds,
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

const getVideoSrc = (image) => String(image?.videoUrl || image?.video_url || image?.url || '').trim();

export const canRenderBoardItem = (image) => {
  if (image?.mediaType === 'video' || image?.source === 'agnes-video') {
    return image?.status === 'pending' || image?.status === 'running' || image?.status === 'failed' || Boolean(getVideoSrc(image) || image?.videoId || image?.video_id);
  }
  return image?.status === 'pending' || image?.status === 'failed' || Boolean(createImageSrc(image));
};

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
  if (image?.source === 'agnes-image') return 'Agnes 生图';
  if (image?.source === 'agnes-video') return 'Agnes 视频';
  if (image?.source === 'edit') return '图生图';
  if (image?.source === 'wall') return '作品墙';
  return '文生图';
};

export const estimateImageAspectRatio = (image, meta = {}) => {
  if (meta.aspectRatio) return clampNumber(Number(meta.aspectRatio) || 1, 0.28, 3.2);
  const isVideo = image?.mediaType === 'video' || image?.source === 'agnes-video';
  const explicitSize = image?.form?.size || image?.size || (image?.width && image?.height ? `${image.width}x${image.height}` : '');
  const size = parseSize(explicitSize || (isVideo ? '1280x720' : '1024x1024'));
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
  if (window.innerWidth <= 640) return 2;
  if (window.innerWidth <= 1024) return 2;
  return 4;
};