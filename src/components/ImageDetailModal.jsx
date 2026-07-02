import { useEffect, useState } from 'react';
import { formatDate } from '../lib/board';
import { getQualityLabel, getResponseFormatLabel } from '../lib/form';
import { getSourceLabel } from '../lib/board';

export default function ImageDetailModal({
  selectedImage,
  view,
  detailParams,
  detailMediaType,
  detailSrc,
  detailDownloadSrc,
  detailIsFailed,
  detailIsPending,
  detailInputPrompt,
  detailRevisedPrompt,
  detailElapsed,
  selectedOnWall,
  canManageSelectedWall,
  busySelected,
  reuseConfig,
  checkWallState,
  deleteImage,
  toggleWall,
  detailModalRef,
  detailPanelRef,
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setLightboxOpen(false);
  }, [selectedImage]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [lightboxOpen]);

  if (!selectedImage) return null;

  const isVideo = detailMediaType === 'video';
  const videoStatusLabel = selectedImage.status === 'completed' ? '已完成' : selectedImage.status === 'failed' ? '任务失败' : selectedImage.status === 'running' ? '生成中' : '等待中';
  const videoSize = selectedImage.size || detailParams.size || (selectedImage.width && selectedImage.height ? `${selectedImage.width}x${selectedImage.height}` : '自动');
  const lightboxSrc = detailDownloadSrc || detailSrc;
  const openLightbox = () => {
    if (detailSrc) setLightboxOpen(true);
  };

  return (
    <>
    <section className="modal-card image-detail-modal" ref={detailModalRef} role="dialog" aria-modal="true" aria-label={isVideo ? '视频详情' : '图片详情'}>
      <div className="detail-preview">
        <div className="detail-badges">
          {detailElapsed ? <span>◷ {detailElapsed}</span> : null}
          <span>{isVideo ? videoSize : detailParams.size || '自动'}</span>
          <span>{isVideo ? videoStatusLabel : detailParams.response_format === 'url' ? detailParams.output_format || 'png' : getResponseFormatLabel(detailParams.response_format)}</span>
        </div>
        {isVideo && detailDownloadSrc ? (
          <video className="detail-preview-video" src={detailDownloadSrc} controls playsInline />
        ) : detailSrc ? (
          <img
            src={detailSrc}
            alt={detailRevisedPrompt || selectedImage.prompt || '图片详情'}
            className="detail-preview-image"
            role="button"
            tabIndex={0}
            title="点击全屏查看"
            onClick={openLightbox}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openLightbox();
              }
            }}
          />
        ) : (
          <div className="pending-preview detail-pending-preview">
            <span className="loading-ring" aria-hidden="true" />
            <strong>{detailIsFailed ? (isVideo ? '任务失败' : '生成失败') : isVideo ? videoStatusLabel : '生成中...'}</strong>
            {selectedImage.error ? <p>{selectedImage.error}</p> : null}
          </div>
        )}
      </div>

      <div className="detail-panel" ref={detailPanelRef}>
        <div className="modal-head">
          <div>
            <h2>{detailIsPending ? '请求详情' : detailIsFailed ? '失败详情' : isVideo ? '视频详情' : '图片详情'}</h2>
            <p>{detailIsPending ? videoStatusLabel : detailIsFailed ? '请求失败' : isVideo ? selectedImage.apiName || 'Agnes 视频' : selectedImage.authorName || (selectedOnWall ? '已上墙' : '本地生成')}</p>
          </div>
        </div>

        <div className="prompt-detail prompt-detail-stack">
          <div>
            <span>输入提示词</span>
            <p>{detailInputPrompt || '无提示词'}</p>
          </div>
          {detailRevisedPrompt ? (
            <div>
              <span>优化提示词</span>
              <p>{detailRevisedPrompt}</p>
            </div>
          ) : null}
        </div>

        <div className="detail-meta-grid">
          <div><span>来源</span><strong>{isVideo ? 'Agnes 视频' : getSourceLabel(selectedImage)}</strong></div>
          <div><span>尺寸</span><strong>{isVideo ? videoSize : detailParams.size || '自动'}</strong></div>
          {isVideo ? (
            <>
              <div><span>状态</span><strong>{videoStatusLabel}</strong></div>
              <div><span>进度</span><strong>{selectedImage.progress || '未知'}</strong></div>
              {selectedImage.seconds ? <div><span>视频时长</span><strong>{selectedImage.seconds} 秒</strong></div> : null}
              <div><span>帧数</span><strong>{selectedImage.numFrames || detailParams.numFrames || '自动'}</strong></div>
              <div><span>帧率</span><strong>{selectedImage.frameRate || detailParams.frameRate || '自动'}</strong></div>
              <div><span>任务 ID</span><strong>{selectedImage.videoId || selectedImage.id || '无'}</strong></div>
              <div><span>结果</span><strong>{detailDownloadSrc ? '可播放' : '等待返回'}</strong></div>
            </>
          ) : (
            <>
              <div><span>质量</span><strong>{getQualityLabel(detailParams.quality)}</strong></div>
              <div><span>返回格式</span><strong>{getResponseFormatLabel(detailParams.response_format)}</strong></div>
              <div><span>格式</span><strong>{detailParams.response_format === 'url' ? detailParams.output_format || 'png' : '禁用'}</strong></div>
              <div><span>背景</span><strong>{detailParams.background || 'auto'}</strong></div>
              <div><span>审核</span><strong>{detailParams.moderation || 'auto'}</strong></div>
              <div><span>数量</span><strong>{detailParams.n || 1}</strong></div>
            </>
          )}
        </div>

        <p className="created-line">创建于 {formatDate(selectedImage.createdAt)}{detailElapsed ? ` · 耗时 ${detailElapsed}` : ''}</p>

        <div className="detail-actions">
          {detailDownloadSrc ? <a className="secondary-action" href={detailDownloadSrc} download={isVideo ? 'gpt-biubiubiu-agnes-video.mp4' : 'gpt-biubiubiu.png'} target="_blank" rel="noreferrer">下载</a> : null}
          {!String(selectedImage.source || '').startsWith('agnes-') ? <button type="button" className="secondary-action" onClick={() => reuseConfig(selectedImage)}>复用配置</button> : null}
          {view !== 'wall' && selectedOnWall ? (
            <button type="button" className="secondary-action" onClick={() => checkWallState(selectedImage)} disabled={busySelected}>检测上墙</button>
          ) : null}
          {view !== 'wall' ? (
            <button type="button" className="secondary-action danger-action" onClick={() => deleteImage(selectedImage)}>删除</button>
          ) : null}
          {detailSrc && canManageSelectedWall ? (
            <button type="button" className={selectedOnWall ? 'primary-action wall-button is-active' : 'primary-action wall-button'} onClick={() => toggleWall(selectedImage)} disabled={busySelected}>
              {selectedOnWall ? '★ 取消上墙' : '☆ 上墙'}
            </button>
          ) : null}
        </div>
      </div>
    </section>

    {lightboxOpen && lightboxSrc ? (
      <div className="lightbox-layer" role="dialog" aria-modal="true" aria-label="图片全屏查看">
        <button type="button" className="lightbox-backdrop" aria-label="关闭全屏" onClick={() => setLightboxOpen(false)} />
        <figure className="lightbox-figure">
          <img src={lightboxSrc} alt={detailRevisedPrompt || selectedImage.prompt || '图片全屏查看'} onClick={() => setLightboxOpen(false)} />
        </figure>
        <button type="button" className="close-button lightbox-close" aria-label="关闭全屏" onClick={() => setLightboxOpen(false)}>×</button>
      </div>
    ) : null}
    </>
  );
}