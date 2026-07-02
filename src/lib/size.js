import { agnesVideoRatioToSize, ratioOptions, ratioToSize, resolutionMaxEdges, sizeLimits } from '../constants/options';
import { clampNumber } from './math';

export const parseSize = (size) => {
  const [width, height] = String(size || '').split('x').map(Number);
  return { width: width || 1024, height: height || 1024 };
};

export const getAvailableRatios = (resolution, options = ratioOptions, sizeMap = ratioToSize) => options.filter((item) => item.value === 'custom-ratio' || Boolean(sizeMap[resolution]?.[item.value]));

export const getMappedDraftSize = (draft, sizeMap) => {
  if (draft.mode === 'auto') return '';
  return sizeMap[draft.resolution]?.[draft.ratio] || '';
};

export const getAgnesVideoDraftSize = (draft) => getMappedDraftSize(draft, agnesVideoRatioToSize);

const ceilToStep = (value) => Math.ceil(value / sizeLimits.step) * sizeLimits.step;
const floorToStep = (value) => Math.floor(value / sizeLimits.step) * sizeLimits.step;

const isLegalSize = (width, height) => {
  const pixels = width * height;
  const ratio = Math.max(width / height, height / width);

  return (
    width % sizeLimits.step === 0 &&
    height % sizeLimits.step === 0 &&
    width <= sizeLimits.maxEdge &&
    height <= sizeLimits.maxEdge &&
    ratio <= sizeLimits.maxRatio &&
    pixels >= sizeLimits.minPixels &&
    pixels <= sizeLimits.maxPixels
  );
};

export const clampSizeToLegalRange = (width, height) => {
  const targetWidth = Math.max(sizeLimits.step, Number(width) || 1024);
  const targetHeight = Math.max(sizeLimits.step, Number(height) || 1024);
  const targetRatio = clampNumber(targetWidth / targetHeight, 1 / sizeLimits.maxRatio, sizeLimits.maxRatio);
  const targetPixels = clampNumber(targetWidth * targetHeight, sizeLimits.minPixels, sizeLimits.maxPixels);

  let best = { width: 1024, height: 1024 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (let candidateWidth = sizeLimits.step; candidateWidth <= sizeLimits.maxEdge; candidateWidth += sizeLimits.step) {
    const minHeight = ceilToStep(Math.max(sizeLimits.step, candidateWidth / sizeLimits.maxRatio, sizeLimits.minPixels / candidateWidth));
    const maxHeight = floorToStep(Math.min(sizeLimits.maxEdge, candidateWidth * sizeLimits.maxRatio, sizeLimits.maxPixels / candidateWidth));

    for (let candidateHeight = minHeight; candidateHeight <= maxHeight; candidateHeight += sizeLimits.step) {
      if (!isLegalSize(candidateWidth, candidateHeight)) continue;

      const ratioScore = Math.abs(Math.log((candidateWidth / candidateHeight) / targetRatio));
      const pixelScore = Math.abs(Math.log((candidateWidth * candidateHeight) / targetPixels));
      const score = ratioScore * 4 + pixelScore;

      if (score < bestScore) {
        best = { width: candidateWidth, height: candidateHeight };
        bestScore = score;
      }
    }
  }

  return best;
};

const getCustomRatioSize = (draft) => {
  const ratioWidth = Math.max(1, Number(draft.customRatioWidth) || 1);
  const ratioHeight = Math.max(1, Number(draft.customRatioHeight) || 1);
  const maxEdge = resolutionMaxEdges[draft.resolution] || sizeLimits.maxEdge;
  const landscape = ratioWidth >= ratioHeight;
  const rawWidth = landscape ? maxEdge : (maxEdge * ratioWidth) / ratioHeight;
  const rawHeight = landscape ? (maxEdge * ratioHeight) / ratioWidth : maxEdge;
  return clampSizeToLegalRange(rawWidth, rawHeight);
};

export const getDraftSize = (draft) => {
  if (draft.mode === 'auto') return '';

  if (draft.mode === 'custom') {
    const size = clampSizeToLegalRange(draft.customWidth, draft.customHeight);
    return `${size.width}x${size.height}`;
  }

  if (draft.ratio === 'custom-ratio') {
    const size = getCustomRatioSize(draft);
    return `${size.width}x${size.height}`;
  }

  const parsed = parseSize(ratioToSize[draft.resolution]?.[draft.ratio] || ratioToSize[draft.resolution]?.['1:1'] || '1024x1024');
  const size = clampSizeToLegalRange(parsed.width, parsed.height);
  return `${size.width}x${size.height}`;
};