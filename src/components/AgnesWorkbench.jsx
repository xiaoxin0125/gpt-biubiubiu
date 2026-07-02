import { useEffect, useMemo, useRef, useState } from 'react';
import {
  API_CONFIG_SCOPE_AGNES,
  BOARD_LOAD_DELAY_MS,
  BOARD_PAGE_SIZE,
  MAX_REFERENCE_IMAGES,
  agnesBoardScopeOptions,
  agnesMediaOptions,
  agnesResponseFormatOptions,
  agnesVideoModeOptions,
  agnesVideoRatioOptions,
  agnesVideoRatioToSize,
  agnesVideoResolutionGroups,
  defaultAgnesVideoForm,
  defaultAgnesVideoSizeDraft,
  defaultSizeDraft,
} from '../constants/options';
import SizeDialog from './SizeDialog';
import ScrollTopButton from './ScrollTopButton';
import { apiConfigHasKeyForScope, apiConfigLabelForScope, requestReferenceImageUpload } from '../lib/api';
import { createImageSrc } from '../lib/images';
import { estimateImageAspectRatio, getImageIdentity, getMasonryColumns } from '../lib/board';
import { clampNumber, normalizePercent } from '../lib/math';
import { getAgnesVideoDraftSize, getAvailableRatios, getDraftSize, parseSize } from '../lib/size';
import { useAgnesGeneration } from '../hooks/useAgnesGeneration';
import { useBoard } from '../hooks/useBoard';

const statusLabel = (status) => {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '生成中';
  return '等待中';
};

const modeLabel = (mode) => {
  const normalized = ['text', 'image', 'multi'].includes(String(mode || '').trim()) ? 'ti2vid' : mode;
  return agnesVideoModeOptions.find((option) => option.value === normalized)?.label || '文生/图生视频';
};

const TuneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M7 12h10" />
    <path d="M10 17h4" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12 20 5l-5.4 14-3.1-6.5L4 12Z" />
    <path d="m11.5 12.5 4.2-4.2" />
  </svg>
);

const LoadingDotsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="loading-dots-icon">
    <circle cx="6" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18" cy="12" r="1.8" />
  </svg>
);

const ReferenceUploadIcon = ({ count }) => (
  <strong>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="m7 15 3.2-3.2 2.6 2.6 1.7-1.7L18 16" />
      <circle cx="15.5" cy="9.5" r="1.5" />
      <path d="M18 4v4" />
      <path d="M16 6h4" />
    </svg>
    <em>{count || ''}</em>
  </strong>
);

const splitLines = (value) => String(value || '').split(/\r?\n/);

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const createReferenceId = (file) => `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;

const appendLines = (value, lines) => [
  String(value || '').trim(),
  lines.map((line) => String(line || '').trim()).filter(Boolean).join('\n'),
].filter(Boolean).join('\n');

const findAgnesVideoSizeDraft = (width, height) => {
  const currentWidth = Number(width) || defaultAgnesVideoForm.width;
  const currentHeight = Number(height) || defaultAgnesVideoForm.height;
  const currentSize = `${currentWidth}x${currentHeight}`;
  let closest = defaultAgnesVideoSizeDraft;
  let bestScore = Number.POSITIVE_INFINITY;

  Object.entries(agnesVideoRatioToSize).forEach(([resolution, ratios]) => {
    Object.entries(ratios).forEach(([ratio, size]) => {
      if (size === currentSize) {
        closest = { ...defaultAgnesVideoSizeDraft, resolution, ratio };
        bestScore = 0;
        return;
      }

      const parsed = parseSize(size);
      const ratioScore = Math.abs(Math.log((currentWidth / currentHeight) / (parsed.width / parsed.height)));
      const pixelScore = Math.abs(Math.log((currentWidth * currentHeight) / (parsed.width * parsed.height)));
      const score = ratioScore * 4 + pixelScore;
      if (score < bestScore) {
        closest = { ...defaultAgnesVideoSizeDraft, resolution, ratio };
        bestScore = score;
      }
    });
  });

  return closest;
};

const getDisplayVideoSize = (task) => (
  String(task.size || task.form?.size || '').trim()
  || (task.width && task.height ? `${task.width}x${task.height}` : '')
  || '自动'
);

const videoSizeNormalizationNote = '当提交的 width、height 或宽高比与模型支持规格不完全匹配时，系统会自动映射到最接近的标准输出尺寸。';

const EmptyAgnesCanvas = ({ activeTab, configured, openAccount, emptyText }) => (
  <div className="empty-canvas agnes-empty-canvas">
    <span className="empty-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48">
        {activeTab === 'image' ? (
          <>
            <rect x="8" y="10" width="32" height="28" rx="3" />
            <path d="M14 31l7-7 5 5 4-4 6 6" />
            <circle cx="31" cy="18" r="3" />
          </>
        ) : (
          <>
            <rect x="8" y="12" width="32" height="24" rx="4" />
            <path d="m20 20 9 4-9 4v-8Z" />
            <path d="M12 16h4" />
            <path d="M32 32h4" />
          </>
        )}
      </svg>
    </span>
    <p>{emptyText || (configured ? (activeTab === 'image' ? '填写底部提示词开始 Agnes 生图' : '填写底部提示词创建 Agnes 视频任务') : '请先配置 Agnes API')}</p>
    {!configured ? <button type="button" className="secondary-action" onClick={openAccount}>去配置</button> : null}
  </div>
);

const getAgnesSource = (item) => String(item?.source || item?.form?.source || '').trim();
const isAgnesHistoryImage = (item) => getAgnesSource(item) === 'agnes-image';
const isAgnesHistoryVideo = (item) => getAgnesSource(item) === 'agnes-video' || item?.mediaType === 'video';

const uniqueByImageIdentity = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const identity = getImageIdentity(item);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const ResultShell = ({ children, caption, className = '', onOpen, onDelete }) => (
  <figure
    className={`result-card agnes-result-card ${className}`.trim()}
    onClick={onOpen}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen?.();
      }
    }}
    role="button"
    tabIndex={0}
  >
    {onDelete ? (
      <button
        type="button"
        className="result-delete-button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label="删除作品"
      >
        ×
      </button>
    ) : null}
    {children}
    <figcaption className="result-caption" title={caption}>
      <span>{caption}</span>
    </figcaption>
  </figure>
);

const AgnesResults = ({
  items,
  masonryColumns,
  masonryColumnCount,
  boardLoadSentinelRef,
  hasMoreItems,
  loadingMore,
  openDetail,
  deleteImage,
  imageLayoutMeta,
  setImageLayoutMeta,
}) => {
  if (!items.length) {
    if (!hasMoreItems && !loadingMore) return null;

    return (
      <>
        <div className="board-load-sentinel" ref={boardLoadSentinelRef} aria-hidden="true" />
        <div className="board-loader" role="status">
          {loadingMore ? '加载更多作品...' : '继续加载作品...'}
        </div>
      </>
    );
  }

  const renderResultItem = (item) => {
    const isVideo = item.mediaType === 'video';
    const isFailed = item.status === 'failed';
    const isPending = item.status === 'pending' || item.status === 'running';

    if (isVideo) {
      const videoUrl = String(item.videoUrl || '').trim();
      const responseSize = getDisplayVideoSize(item);
      const progress = normalizePercent(item.progress, isFailed ? '' : isPending ? 0 : 100);
      const hasProgress = progress !== '';
      const progressLabel = hasProgress ? `${progress}%` : '未知';
      const statusNotice = String(item.statusNotice || '').trim();
      const caption = item.error || [statusLabel(item.status), hasProgress ? `进度 ${progressLabel}` : '', item.seconds ? `${item.seconds}s` : '', responseSize].filter(Boolean).join(' · ') || 'Agnes 视频任务';
      return (
        <ResultShell key={`video-${item.id}`} caption={caption} className={`${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''}`} onOpen={() => openDetail?.(item)} onDelete={() => deleteImage?.(item)}>
          <div className="agnes-video-card-body">
            <div className="agnes-video-preview-wrap">
              {videoUrl && isHttpUrl(videoUrl) ? (
                <video src={videoUrl} controls playsInline onClick={(event) => event.stopPropagation()} />
              ) : (
                <div className="pending-preview agnes-video-pending-preview">
                  <span className="loading-ring" aria-hidden="true" />
                  <strong>{isFailed ? '任务失败' : statusLabel(item.status)}</strong>
                  <p>{item.error || statusNotice || item.videoId || '等待 Agnes 返回视频结果。'}</p>
                </div>
              )}
              {isPending && hasProgress ? (
                <div className="agnes-progress agnes-card-progress" role="progressbar" aria-label="视频生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
                  <div className="agnes-progress-head">
                    <span>当前进度</span>
                    <strong>{progressLabel}</strong>
                  </div>
                  <span className="agnes-progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                </div>
              ) : null}
            </div>
            <div className="agnes-task-meta">
              <span>{modeLabel(item.mode)}</span>
              <span>{responseSize}</span>
              {hasProgress ? <span>进度 {progressLabel}</span> : null}
              {item.seconds ? <span>{item.seconds} 秒</span> : null}
              <span>{item.numFrames || defaultAgnesVideoForm.numFrames} 帧 / {item.frameRate || defaultAgnesVideoForm.frameRate} fps</span>
              {statusNotice ? <span>{statusNotice}</span> : null}
              {videoUrl && !isHttpUrl(videoUrl) ? <span>结果字段：{videoUrl}</span> : null}
            </div>
          </div>
        </ResultShell>
      );
    }

    const src = createImageSrc(item);
    const imageId = getImageIdentity(item);
    const imageMeta = imageLayoutMeta[imageId] || {};
    const aspectRatio = estimateImageAspectRatio(item, imageMeta);
    const caption = item.error || item.apiName || 'Agnes API';
    return (
      <ResultShell key={`image-${item.id}`} caption={caption} className={`${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''} ${src && !imageMeta.loaded ? 'is-image-loading' : ''}`} onOpen={() => openDetail?.(item)} onDelete={() => deleteImage?.(item)}>
        <div className="result-image-wrap agnes-result-media" style={{ aspectRatio }}>
          {src ? (
            <>
              {!imageMeta.loaded ? <div className="image-loading-placeholder" aria-hidden="true" /> : null}
              <img
                src={src}
                alt={item.prompt || 'Agnes 生成图片'}
                loading="lazy"
                decoding="async"
                onLoad={(event) => {
                  const naturalWidth = event.currentTarget.naturalWidth || 1;
                  const naturalHeight = event.currentTarget.naturalHeight || 1;
                  setImageLayoutMeta((current) => ({
                    ...current,
                    [imageId]: {
                      loaded: true,
                      aspectRatio: clampNumber(naturalWidth / naturalHeight, 0.28, 3.2),
                    },
                  }));
                }}
                onError={() => {
                  setImageLayoutMeta((current) => ({
                    ...current,
                    [imageId]: { ...(current[imageId] || {}), loaded: true, failed: true },
                  }));
                }}
              />
            </>
          ) : (
            <div className="pending-preview">
              <span className="loading-ring" aria-hidden="true" />
              <strong>{isFailed ? '生成失败' : '生成中...'}</strong>
              {item.error ? <p>{item.error}</p> : null}
            </div>
          )}
        </div>
      </ResultShell>
    );
  };

  return (
    <>
      <div className="masonry-board" style={{ '--masonry-columns': masonryColumnCount }}>
        {masonryColumns.map((column) => (
          <div className="masonry-column" key={column.id}>
            {column.items.map(renderResultItem)}
          </div>
        ))}
      </div>
      <div className="board-load-sentinel" ref={boardLoadSentinelRef} aria-hidden="true" />
      {hasMoreItems || loadingMore ? (
        <div className="board-loader" role="status">
          {loadingMore ? '加载更多作品...' : '继续下滑加载更多'}
        </div>
      ) : (
        <div className="board-loader is-complete">已展示全部作品</div>
      )}
    </>
  );
};

export default function AgnesWorkbench({
  user,
  activeAgnesApiConfig,
  apiConfigForm,
  apiKeyVaultRef,
  syncDirectApiKey,
  renderSelect,
  setError,
  openAccount,
  openDetail,
  deleteImage,
  persistImageResults,
  persistVideoTask,
  historyImages = [],
  historyHasMore = false,
  loadMoreHistory,
  refreshHistory,
}) {
  const [activeTab, setActiveTab] = useState('image');
  const [agnesBoardScope, setAgnesBoardScope] = useState('current');
  const [agnesBoardSearch, setAgnesBoardSearch] = useState('');
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [imageSizeDialogOpen, setImageSizeDialogOpen] = useState(false);
  const [videoSizeDialogOpen, setVideoSizeDialogOpen] = useState(false);
  const [imageSizeDraft, setImageSizeDraft] = useState(defaultSizeDraft);
  const [videoSizeDraft, setVideoSizeDraft] = useState(defaultAgnesVideoSizeDraft);
  const [uploadedImageReferences, setUploadedImageReferences] = useState([]);
  const [imageLayoutMeta, setImageLayoutMeta] = useState({});
  const refreshedVideoHistoryRef = useRef(new Set());
  const {
    imageForm,
    videoForm,
    imageResults,
    videoTasks,
    imageLoading,
    videoLoading,
    estimatedVideoSeconds,
    updateImageForm,
    updateVideoForm,
    setVideoResolution,
    runImageGeneration,
    runVideoGeneration,
    removeImageResult,
    removeVideoTask,
    refreshVideoTasks,
    refreshVideoHistoryTasks,
  } = useAgnesGeneration({ activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey, setError, persistImageResults, persistVideoTask });
  const {
    boardVisibleCount,
    setBoardVisibleCount,
    boardLoadingMore,
    setBoardLoadingMore,
    masonryColumnCount,
    boardRef,
    boardLoadSentinelRef,
  } = useBoard();

  const configured = Boolean(user) && apiConfigHasKeyForScope(activeAgnesApiConfig, API_CONFIG_SCOPE_AGNES);
  const apiName = useMemo(
    () => apiConfigLabelForScope(activeAgnesApiConfig, API_CONFIG_SCOPE_AGNES, 'Agnes API'),
    [activeAgnesApiConfig],
  );
  const activePrompt = activeTab === 'image' ? imageForm.prompt : videoForm.prompt;
  const activeLoading = activeTab === 'image' ? imageLoading : videoLoading;
  const videoResolution = `${videoForm.width}x${videoForm.height}`;
  const imageAvailableRatios = getAvailableRatios(imageSizeDraft.resolution);
  const videoAvailableRatios = getAvailableRatios(videoSizeDraft.resolution, agnesVideoRatioOptions, agnesVideoRatioToSize);
  const activeImageSize = getDraftSize(imageSizeDraft);
  const activeVideoSize = getAgnesVideoDraftSize(videoSizeDraft) || videoResolution;
  const displayImageSize = activeImageSize || '自动';
  const displayVideoSize = activeVideoSize;
  const uploadedReferenceNames = uploadedImageReferences.map((item, index) => `图${index + 1}:${item.name}`).join('，');
  const workbenchClassName = workbenchExpanded ? 'workbench-actions agnes-workbench-actions is-expanded' : 'workbench-actions agnes-workbench-actions';
  const agnesHistoryImages = useMemo(() => historyImages.filter(isAgnesHistoryImage), [historyImages]);
  const agnesHistoryVideos = useMemo(() => historyImages.filter(isAgnesHistoryVideo), [historyImages]);
  const agnesItems = useMemo(() => {
    const imageItems = imageResults.map((item) => ({
      ...item,
      source: 'agnes-image',
      mediaType: 'image',
      apiName: item.apiName || apiName,
      form: {
        ...imageForm,
        ...(item.form || {}),
        prompt: item.prompt || imageForm.prompt,
        response_format: item.form?.response_format || item.form?.responseFormat || imageForm.responseFormat,
        responseFormat: item.form?.responseFormat || item.form?.response_format || imageForm.responseFormat,
        size: item.form?.size || item.size || imageForm.size || '',
        source: 'agnes-image',
      },
      removeFromAgnes: () => removeImageResult(item.id),
    }));
    const historyImageItems = agnesHistoryImages.map((item) => ({
      ...item,
      source: 'agnes-image',
      mediaType: 'image',
      apiName: item.apiName || item.form?.apiName || apiName,
      form: {
        ...imageForm,
        ...(item.form || {}),
        prompt: item.prompt || item.form?.prompt || '',
        response_format: item.form?.response_format || item.form?.responseFormat || imageForm.responseFormat,
        responseFormat: item.form?.responseFormat || item.form?.response_format || imageForm.responseFormat,
        size: item.form?.size || item.size || '',
        source: 'agnes-image',
      },
    }));
    const allImageItems = uniqueByImageIdentity([...imageItems, ...historyImageItems]);
    const videoItems = videoTasks.map((task) => ({
      ...task,
      source: 'agnes-video',
      mediaType: 'video',
      apiName: task.apiName || apiName,
      form: {
        ...videoForm,
        ...(task.form || {}),
        prompt: task.prompt || videoForm.prompt,
        size: task.size || task.form?.size || `${task.width || videoForm.width}x${task.height || videoForm.height}`,
        response_format: 'url',
        responseFormat: 'url',
        source: 'agnes-video',
      },
      removeFromAgnes: () => removeVideoTask(task.id),
    }));
    const historyVideoItems = agnesHistoryVideos.map((item) => ({
      ...item,
      source: 'agnes-video',
      mediaType: 'video',
      apiName: item.apiName || item.form?.apiName || apiName,
      form: {
        ...videoForm,
        ...(item.form || {}),
        prompt: item.prompt || item.form?.prompt || '',
        size: item.form?.size || item.size || `${item.width || videoForm.width}x${item.height || videoForm.height}`,
        response_format: 'url',
        responseFormat: 'url',
        source: 'agnes-video',
      },
    }));
    const allVideoItems = uniqueByImageIdentity([...videoItems, ...historyVideoItems]);
    const sourceItems = activeTab === 'image'
      ? (agnesBoardScope === 'all' ? allImageItems : imageItems)
      : (agnesBoardScope === 'all' ? allVideoItems : videoItems);
    const scopedItems = agnesBoardScope === 'all'
      ? [...sourceItems].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      : sourceItems;
    const keyword = agnesBoardSearch.trim().toLowerCase();
    if (!keyword) return scopedItems;
    return scopedItems.filter((item) => [
      item.prompt,
      item.apiName,
      item.status,
      item.rawStatus,
      item.error,
      item.statusNotice,
      item.videoId,
      item.videoUrl,
      item.mode,
      item.form?.size,
    ].filter(Boolean).join(' ').toLowerCase().includes(keyword));
  }, [activeTab, agnesBoardScope, agnesBoardSearch, agnesHistoryImages, agnesHistoryVideos, apiName, imageForm, imageResults, removeImageResult, removeVideoTask, videoForm, videoTasks]);
  const activeResultCount = activeTab === 'image'
    ? (agnesBoardScope === 'all' ? imageResults.length + agnesHistoryImages.length : imageResults.length)
    : (agnesBoardScope === 'all' ? videoTasks.length + agnesHistoryVideos.length : videoTasks.length);
  const visibleAgnesItems = agnesItems.slice(0, boardVisibleCount);
  const hasMoreLoadedAgnesItems = visibleAgnesItems.length < agnesItems.length;
  const hasMoreHistoryItems = Boolean(user && activeTab === 'image' && agnesBoardScope === 'all' && historyHasMore);
  const hasMoreAgnesItems = hasMoreLoadedAgnesItems || hasMoreHistoryItems;
  const masonryColumns = useMemo(
    () => getMasonryColumns(visibleAgnesItems, masonryColumnCount, imageLayoutMeta),
    [imageLayoutMeta, masonryColumnCount, visibleAgnesItems],
  );
  const emptyText = agnesBoardSearch.trim() && activeResultCount ? '没有匹配的 Agnes 作品' : '';
  const showAgnesResults = visibleAgnesItems.length > 0 || hasMoreAgnesItems || boardLoadingMore;

  useEffect(() => {
    setBoardVisibleCount(BOARD_PAGE_SIZE);
    setBoardLoadingMore(false);
    if (boardRef.current) boardRef.current.scrollTop = 0;
  }, [activeTab, agnesBoardScope, agnesBoardSearch, setBoardLoadingMore, setBoardVisibleCount, boardRef]);

  useEffect(() => {
    if (!hasMoreAgnesItems || boardLoadingMore) return undefined;

    const loadNextPage = () => {
      setBoardLoadingMore(true);
      if (hasMoreLoadedAgnesItems) {
        window.setTimeout(() => {
          setBoardVisibleCount((count) => Math.min(count + BOARD_PAGE_SIZE, agnesItems.length));
          setBoardLoadingMore(false);
        }, BOARD_LOAD_DELAY_MS);
        return;
      }

      if (hasMoreHistoryItems && typeof loadMoreHistory === 'function') {
        Promise.resolve(loadMoreHistory()).finally(() => setBoardLoadingMore(false));
        return;
      }

      setBoardLoadingMore(false);
    };

    const sentinel = boardLoadSentinelRef.current;
    const board = boardRef.current;
    const usePageScroll = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const scrollRoot = usePageScroll ? null : board;

    if (sentinel && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
      }, { root: scrollRoot, rootMargin: '260px 0px 260px 0px' });
      observer.observe(sentinel);
      return () => observer.disconnect();
    }

    const scrollTarget = usePageScroll ? window : board;
    if (!scrollTarget) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        if (usePageScroll) {
          const doc = document.documentElement;
          if (window.innerHeight + window.scrollY >= doc.scrollHeight - 260) loadNextPage();
        } else if (board && board.scrollTop + board.clientHeight >= board.scrollHeight - 260) {
          loadNextPage();
        }
      });
    };
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', onScroll);
  }, [agnesItems.length, boardLoadSentinelRef, boardLoadingMore, boardRef, hasMoreAgnesItems, hasMoreHistoryItems, hasMoreLoadedAgnesItems, loadMoreHistory, setBoardLoadingMore, setBoardVisibleCount]);

  useEffect(() => {
    if (activeTab !== 'video' || agnesBoardScope !== 'all' || typeof refreshVideoHistoryTasks !== 'function') return;
    const targets = agnesHistoryVideos.filter((item) => {
      const videoId = String(item.videoId || item.video_id || '').trim();
      if (!videoId || refreshedVideoHistoryRef.current.has(videoId)) return false;
      refreshedVideoHistoryRef.current.add(videoId);
      return true;
    });
    if (targets.length) refreshVideoHistoryTasks(targets);
  }, [activeTab, agnesBoardScope, agnesHistoryVideos, refreshVideoHistoryTasks]);

  const updateActivePrompt = (value) => {
    if (activeTab === 'image') updateImageForm('prompt', value);
    else updateVideoForm('prompt', value);
  };

  const openImageSizeDialog = () => {
    if (!imageForm.size) {
      setImageSizeDraft((draft) => ({ ...draft, mode: 'auto' }));
      setImageSizeDialogOpen(true);
      return;
    }

    const current = parseSize(imageForm.size);
    setImageSizeDraft((draft) => ({
      ...draft,
      mode: 'custom',
      customWidth: current.width,
      customHeight: current.height,
    }));
    setImageSizeDialogOpen(true);
  };

  const applyImageSize = () => {
    updateImageForm('size', activeImageSize);
    setImageSizeDialogOpen(false);
  };

  const openVideoSizeDialog = () => {
    setVideoSizeDraft(findAgnesVideoSizeDraft(videoForm.width, videoForm.height));
    setVideoSizeDialogOpen(true);
  };

  const applyVideoSize = () => {
    const size = getAgnesVideoDraftSize(videoSizeDraft);
    const { width, height } = parseSize(size || videoResolution);
    setVideoResolution(`${width}x${height}`);
    setVideoSizeDialogOpen(false);
  };

  const handleImageReferenceChange = async (event) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;

    const remaining = Math.max(0, MAX_REFERENCE_IMAGES - uploadedImageReferences.length);
    if (!remaining) {
      setError(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张。`);
      event.target.value = '';
      return;
    }

    try {
      const nextFiles = files.slice(0, remaining);
      const formData = new FormData();
      nextFiles.forEach((file) => formData.append('images[]', file, file.name));
      const data = await requestReferenceImageUpload(formData);
      const uploadedItems = Array.isArray(data.items) ? data.items : [];
      const nextReferences = uploadedItems.map((item, index) => ({
        id: createReferenceId(nextFiles[index] || { name: item.name || 'reference-image', size: index, lastModified: Date.now() }),
        name: item.name || nextFiles[index]?.name || 'reference-image',
        url: item.absoluteUrl || item.url || '',
        previewUrl: item.displayUrl || item.absoluteUrl || item.url || '',
      })).filter((item) => item.url);
      if (!nextReferences.length) throw new Error('参考图上传后没有返回 URL。');
      if (files.length > remaining) setError(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张，已保留前 ${MAX_REFERENCE_IMAGES} 张。`);
      setUploadedImageReferences((current) => [...current, ...nextReferences]);
      updateImageForm('imageInputs', (value) => appendLines(value, nextReferences.map((item) => item.url)));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '参考图读取失败。');
    } finally {
      event.target.value = '';
    }
  };

  const removeUploadedImageReference = (id) => {
    const target = uploadedImageReferences.find((item) => item.id === id);
    if (!target) return;
    setUploadedImageReferences((current) => current.filter((item) => item.id !== id));
    updateImageForm('imageInputs', (value) => splitLines(value).filter((line) => line.trim() !== target.url).join('\n'));
  };

  const clearUploadedImageReferences = () => {
    const referenceUrls = new Set(uploadedImageReferences.map((item) => item.url));
    setUploadedImageReferences([]);
    updateImageForm('imageInputs', (value) => splitLines(value).filter((line) => !referenceUrls.has(line.trim())).join('\n'));
  };

  const refreshActiveResults = () => {
    if (agnesBoardScope === 'all' && activeTab === 'image') refreshHistory?.();
    if (activeTab === 'video') {
      refreshVideoTasks();
      if (agnesBoardScope === 'all' && typeof refreshVideoHistoryTasks === 'function') {
        refreshedVideoHistoryRef.current.clear();
        refreshVideoHistoryTasks(agnesHistoryVideos);
      }
    }
  };
  const submitActiveForm = activeTab === 'image' ? runImageGeneration : runVideoGeneration;

  return (
    <section className="agnes-page canvas-stage">
      <div className="canvas-toolbar agnes-toolbar">
        <button type="button" className="toolbar-icon-button" onClick={refreshActiveResults} aria-label="刷新 Agnes 作品" disabled={(activeTab === 'video' || agnesBoardScope === 'all') && videoLoading}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.34 5.66" />
            <path d="M20 5v6h-6" />
          </svg>
        </button>
        {renderSelect({
          id: 'agnes-media',
          label: '',
          value: activeTab,
          options: agnesMediaOptions,
          onChange: setActiveTab,
          className: 'toolbar-scope agnes-media-select',
          menuDirection: 'down',
        })}
        {renderSelect({
          id: 'agnes-board-scope',
          label: '',
          value: agnesBoardScope,
          options: agnesBoardScopeOptions,
          onChange: setAgnesBoardScope,
          className: 'toolbar-filter agnes-scope-select',
          menuDirection: 'down',
        })}
        <label className="toolbar-search" aria-label="搜索 Agnes 作品">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21 21-4.3-4.3" />
            <circle cx="11" cy="11" r="7" />
          </svg>
          <input value={agnesBoardSearch} onChange={(event) => setAgnesBoardSearch(event.target.value)} placeholder="搜索提示词、任务、参数..." />
        </label>
      </div>

      <div className={showAgnesResults ? 'image-board agnes-board has-images' : 'image-board agnes-board'} ref={boardRef}>
        {showAgnesResults ? (
          <AgnesResults
            items={visibleAgnesItems}
            masonryColumns={masonryColumns}
            masonryColumnCount={masonryColumnCount}
            boardLoadSentinelRef={boardLoadSentinelRef}
            hasMoreItems={hasMoreAgnesItems}
            loadingMore={boardLoadingMore}
            openDetail={openDetail}
            deleteImage={deleteImage}
            imageLayoutMeta={imageLayoutMeta}
            setImageLayoutMeta={setImageLayoutMeta}
          />
        ) : (
          <EmptyAgnesCanvas activeTab={activeTab} configured={configured} openAccount={openAccount} emptyText={emptyText} />
        )}
      </div>

      <ScrollTopButton
        targetRef={boardRef}
        className="is-page is-generate-board"
        refreshKey={`agnes-${agnesItems.length}-${activeTab}-${agnesBoardScope}`}
      />

      <form className="bottom-workbench agnes-bottom-workbench" onSubmit={submitActiveForm}>
        <div className="prompt-console agnes-prompt-console">
          <div className="prompt-input-wrap">
            <textarea
              value={activePrompt}
              onChange={(event) => updateActivePrompt(event.target.value)}
              placeholder={activeTab === 'image' ? '描述你想用 Agnes 生成的图片...' : '描述 Agnes 视频的动作、镜头和风格...'}
              rows={2}
            />
            {activePrompt ? (
              <button type="button" className="prompt-clear-button" onClick={() => updateActivePrompt('')} aria-label="清空描述内容">
                ×
              </button>
            ) : null}
          </div>

          <div className={workbenchClassName}>
            <button type="button" className="workbench-toggle-button" onClick={() => setWorkbenchExpanded((current) => !current)} aria-expanded={workbenchExpanded} aria-label={workbenchExpanded ? '收起参数' : '展开参数'}>
              <TuneIcon />
            </button>

            {activeTab === 'image' ? (
              <>
                <div className="agnes-image-options-column">
                  <div className="control-field size-control workbench-extra-control">
                    <span>尺寸</span>
                    <button type="button" className="tool-pill" onClick={openImageSizeDialog}>
                      {imageForm.size || '自动'}
                    </button>
                  </div>
                  {renderSelect({
                    id: 'agnes-image-response-format',
                    label: '返回格式',
                    value: imageForm.responseFormat,
                    options: agnesResponseFormatOptions,
                    onChange: (value) => updateImageForm('responseFormat', value),
                    className: 'control-field response-format-control workbench-extra-control',
                  })}
                </div>
                <div className="agnes-image-reference-column">
                  <label className="control-field workbench-extra-control agnes-wide-control agnes-reference-input-control">
                    <span>参考图 URL / Base64</span>
                    <textarea value={imageForm.imageInputs} onChange={(event) => updateImageForm('imageInputs', event.target.value)} rows={2} placeholder="每行一张图片；可上传自动回填，也可手动填写" />
                  </label>
                  <div className="agnes-image-action-column">
                    <label className={uploadedImageReferences.length ? 'control-field file-control has-file icon-file-control' : 'control-field file-control icon-file-control'} title={uploadedReferenceNames || '上传参考图'} aria-label="上传参考图">
                      <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={handleImageReferenceChange} />
                      <ReferenceUploadIcon count={uploadedImageReferences.length} />
                    </label>
                    <button type="submit" className="send-button" disabled={!configured || activeLoading} aria-label="生成图片">
                      {activeLoading ? <LoadingDotsIcon /> : <SendIcon />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {renderSelect({
                  id: 'agnes-video-mode',
                  label: '模式',
                  value: videoForm.mode,
                  options: agnesVideoModeOptions,
                  onChange: (value) => updateVideoForm('mode', value),
                  className: 'control-field workbench-extra-control agnes-mode-control',
                })}
                <div className="control-field size-control workbench-extra-control agnes-resolution-control">
                  <span>分辨率</span>
                  <button type="button" className="tool-pill" onClick={openVideoSizeDialog}>
                    {videoResolution}
                  </button>
                </div>
                <label className="control-field count-field workbench-extra-control">
                  <span>帧数</span>
                  <input type="number" min="9" max="441" step="8" value={videoForm.numFrames} onChange={(event) => updateVideoForm('numFrames', event.target.value)} />
                </label>
                <label className="control-field count-field workbench-extra-control">
                  <span>帧率</span>
                  <input type="number" min="1" max="60" value={videoForm.frameRate} onChange={(event) => updateVideoForm('frameRate', event.target.value)} />
                </label>
                <label className="control-field count-field workbench-extra-control">
                  <span>步数</span>
                  <input type="number" min="1" value={videoForm.numInferenceSteps} onChange={(event) => updateVideoForm('numInferenceSteps', event.target.value)} placeholder="可选" />
                </label>
                <label className="control-field count-field workbench-extra-control">
                  <span>Seed</span>
                  <input type="number" value={videoForm.seed} onChange={(event) => updateVideoForm('seed', event.target.value)} placeholder="可选" />
                </label>
                <div className="control-field workbench-extra-control agnes-duration-control">
                  <span>估算</span>
                  <strong>{estimatedVideoSeconds.toFixed(1)} 秒</strong>
                </div>
                <label className="control-field workbench-extra-control agnes-wide-control">
                  <span>主图 URL / Base64</span>
                  <textarea value={videoForm.image} onChange={(event) => updateVideoForm('image', event.target.value)} rows={2} placeholder="图生视频、多图视频或关键帧模式使用" />
                </label>
                <label className="control-field workbench-extra-control agnes-wide-control">
                  <span>额外图片 URL / Base64</span>
                  <textarea value={videoForm.extraImages} onChange={(event) => updateVideoForm('extraImages', event.target.value)} rows={2} placeholder="每行一张；多图视频和关键帧使用" />
                </label>
                <label className="control-field workbench-extra-control agnes-wide-control">
                  <span>负向提示词</span>
                  <textarea value={videoForm.negativePrompt} onChange={(event) => updateVideoForm('negativePrompt', event.target.value)} rows={2} placeholder="可选" />
                </label>
              </>
            )}

            {activeTab === 'video' ? (
              <button type="submit" className="send-button" disabled={!configured || activeLoading} aria-label="创建视频任务">
                {activeLoading ? <LoadingDotsIcon /> : <SendIcon />}
              </button>
            ) : null}
          </div>

          {activeTab === 'image' && uploadedImageReferences.length ? (
            <div className="reference-preview agnes-reference-preview">
              <div className="reference-preview-list">
                {uploadedImageReferences.map((image, index) => (
                  <figure key={image.id}>
                    <img src={image.previewUrl || image.url} alt={`Agnes 参考图 ${index + 1}`} />
                    <figcaption>图{index + 1}</figcaption>
                    <button type="button" className="mini-remove" onClick={() => removeUploadedImageReference(image.id)} aria-label={`移除 Agnes 参考图 ${index + 1}`}>×</button>
                  </figure>
                ))}
              </div>
              <span>{uploadedReferenceNames}</span>
              <button type="button" className="text-button" onClick={clearUploadedImageReferences}>移除全部</button>
            </div>
          ) : null}
        </div>
      </form>

      {imageSizeDialogOpen ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={() => setImageSizeDialogOpen(false)} />
          <div className="modal-frame size-modal-frame">
            <button type="button" className="close-button modal-close-button" aria-label="关闭弹窗" onClick={() => setImageSizeDialogOpen(false)}>×</button>
            <SizeDialog
              sizeDraft={imageSizeDraft}
              setSizeDraft={setImageSizeDraft}
              availableRatios={imageAvailableRatios}
              displaySize={displayImageSize}
              closeDialog={() => setImageSizeDialogOpen(false)}
              applySize={applyImageSize}
            />
          </div>
        </div>
      ) : null}
      {videoSizeDialogOpen ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={() => setVideoSizeDialogOpen(false)} />
          <div className="modal-frame size-modal-frame">
            <button type="button" className="close-button modal-close-button" aria-label="关闭弹窗" onClick={() => setVideoSizeDialogOpen(false)}>×</button>
            <SizeDialog
              sizeDraft={videoSizeDraft}
              setSizeDraft={setVideoSizeDraft}
              availableRatios={videoAvailableRatios}
              displaySize={displayVideoSize}
              closeDialog={() => setVideoSizeDialogOpen(false)}
              applySize={applyVideoSize}
              title="设置视频分辨率"
              currentLabel="提交尺寸"
              summaryLabel="预计提交"
              resolutionLabel="标准档位"
              ratioLabel="视频比例"
              resolutionOptions={agnesVideoResolutionGroups}
              ratioSizeMap={agnesVideoRatioToSize}
              getRatiosForResolution={(resolution) => getAvailableRatios(resolution, agnesVideoRatioOptions, agnesVideoRatioToSize)}
              allowAuto={false}
              allowCustomSize={false}
              allowCustomRatio={false}
              normalizationNote={videoSizeNormalizationNote}
              ratioGridClassName="video-ratio-list"
              modalClassName="video-size-modal"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}