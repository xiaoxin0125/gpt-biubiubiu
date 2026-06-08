import { boardFilterOptions, boardScopeOptions, wallFilterOptions } from '../constants/options';
import { createImageSrc } from '../lib/images';
import { clampNumber } from '../lib/math';
import { estimateImageAspectRatio, getEmptyBoardText, getImageIdentity } from '../lib/board';
import { normalizeRevisedPrompt } from '../lib/form';
import { defaultApiConfigItem } from '../constants/options';

export default function ImageBoard({
  view,
  boardScope,
  setBoardScope,
  boardFilter,
  setBoardFilter,
  activeBoardFilter,
  boardSearch,
  setBoardSearch,
  renderSelect,
  loadWall,
  refreshHistory,
  clearHistory,
  history,
  renderableBoardItems,
  masonryColumnCount,
  masonryColumns,
  boardRef,
  boardLoadSentinelRef,
  hasMoreBoardItems,
  boardLoadingMore,
  imageLayoutMeta,
  setImageLayoutMeta,
  openDetail,
  deleteImage,
  status,
  activeApiConfig,
  userDisplayName,
}) {
  const activeFilterOptions = view === 'wall' ? wallFilterOptions : boardFilterOptions;

  const renderImageCard = (image) => {
    const src = createImageSrc(image);
    const imageId = getImageIdentity(image);
    const imageMeta = imageLayoutMeta[imageId] || {};
    const aspectRatio = estimateImageAspectRatio(image, imageMeta);
    const isPending = image.status === 'pending';
    const isFailed = image.status === 'failed';
    const title = normalizeRevisedPrompt(image.revised_prompt) || image.prompt || image.form?.prompt || 'Generated image';
    const savedApiName = String(image.apiName || image.api_name || image.form?.apiName || image.form?.api_name || '').trim();
    const apiName = view === 'wall'
      ? savedApiName || '未知 API'
      : savedApiName || status.apiName || activeApiConfig?.apiName || defaultApiConfigItem.apiName;
    const authorName = view === 'wall'
      ? String(image.authorName || image.author_name || '').trim() || '未知艺术家'
      : String(image.authorName || image.author_name || userDisplayName || '').trim() || '未知艺术家';
    const metaText = view === 'wall' ? `${apiName} · ${authorName}` : apiName;
    const canDelete = view !== 'wall';
    const cardClassName = [
      'result-card',
      isPending ? 'is-pending' : '',
      isFailed ? 'is-failed' : '',
      src && !imageMeta.loaded ? 'is-image-loading' : '',
    ].filter(Boolean).join(' ');

    return (
      <figure className={cardClassName} key={`${image.source || 'image'}-${image.id || image.wallItemId || src}`} onClick={() => openDetail(image)}>
        {canDelete ? (
          <button
            type="button"
            className="result-delete-button"
            onClick={(event) => {
              event.stopPropagation();
              deleteImage(image);
            }}
            aria-label="删除图片"
          >
            ×
          </button>
        ) : null}
        <div className="result-image-wrap" style={{ aspectRatio }}>
          {src ? (
            <>
              {!imageMeta.loaded ? <div className="image-loading-placeholder" aria-hidden="true" /> : null}
              <img
                src={src}
                alt={title || '生成图片'}
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
            </div>
          )}
        </div>
        <figcaption className={view === 'wall' ? 'result-caption result-caption-spread' : 'result-caption'} title={metaText}>
          {view === 'wall' ? (
            <>
              <span>{apiName}</span>
              <span>{authorName}</span>
            </>
          ) : (
            <span>{metaText}</span>
          )}
        </figcaption>
      </figure>
    );
  };

  return (
    <section className={view === 'wall' ? 'canvas-stage is-wall-view' : 'canvas-stage'}>
      <div className="canvas-toolbar">
        <button type="button" className="toolbar-icon-button" onClick={view === 'wall' ? loadWall : refreshHistory} aria-label={view === 'wall' ? '刷新作品墙' : '刷新作品'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.34 5.66" />
            <path d="M20 5v6h-6" />
          </svg>
        </button>
        {view === 'generate' ? renderSelect({
          id: 'board-scope',
          label: '',
          value: boardScope,
          options: boardScopeOptions,
          onChange: setBoardScope,
          className: 'toolbar-scope',
          menuDirection: 'down',
        }) : null}
        {renderSelect({
          id: 'board-filter',
          label: '',
          value: activeBoardFilter,
          options: activeFilterOptions,
          onChange: setBoardFilter,
          className: 'toolbar-filter',
          menuDirection: 'down',
        })}
        <label className="toolbar-search" aria-label="搜索作品">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21 21-4.3-4.3" />
            <circle cx="11" cy="11" r="7" />
          </svg>
          <input value={boardSearch} onChange={(event) => setBoardSearch(event.target.value)} placeholder="搜索提示词、参数、作者..." />
        </label>
        {view === 'generate' && boardScope === 'history' ? (
          <button type="button" className="toolbar-text-button" onClick={clearHistory} disabled={!history.length}>清空历史</button>
        ) : null}
      </div>

      <div className={renderableBoardItems.length ? 'image-board has-images' : 'image-board'} ref={boardRef}>
        {renderableBoardItems.length ? (
          <>
            <div className="masonry-board" style={{ '--masonry-columns': masonryColumnCount }}>
              {masonryColumns.map((column) => (
                <div className="masonry-column" key={column.id}>
                  {column.items.map(renderImageCard)}
                </div>
              ))}
            </div>
            <div className="board-load-sentinel" ref={boardLoadSentinelRef} aria-hidden="true" />
            {hasMoreBoardItems || boardLoadingMore ? (
              <div className="board-loader" role="status">
                {boardLoadingMore ? '加载更多作品...' : '继续下滑加载更多'}
              </div>
            ) : (
              <div className="board-loader is-complete">已展示全部作品</div>
            )}
          </>
        ) : (
          <div className="empty-canvas">
            <span className="empty-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48">
                <rect x="8" y="10" width="32" height="28" rx="3" />
                <path d="M14 31l7-7 5 5 4-4 6 6" />
                <circle cx="31" cy="18" r="3" />
                <path d="M24 4v6" />
                <path d="M18 7h12" />
              </svg>
            </span>
            <p>{getEmptyBoardText(boardScope, view)}</p>
          </div>
        )}
      </div>
    </section>
  );
}