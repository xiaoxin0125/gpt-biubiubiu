import { formatDate } from '../lib/board';
import { getQualityLabel, getResponseFormatLabel } from '../lib/form';
import { getSourceLabel } from '../lib/board';

export default function ImageDetailModal({
  selectedImage,
  view,
  detailParams,
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
  closeDialog,
  reuseConfig,
  checkWallState,
  deleteImage,
  toggleWall,
}) {
  if (!selectedImage) return null;

  return (
    <section className="modal-card image-detail-modal" role="dialog" aria-modal="true" aria-label="图片详情">
      <div className="detail-preview">
        <div className="detail-badges">
          {detailElapsed ? <span>◷ {detailElapsed}</span> : null}
          <span>{detailParams.size || '自动'}</span>
          <span>{detailParams.response_format === 'url' ? detailParams.output_format || 'png' : getResponseFormatLabel(detailParams.response_format)}</span>
        </div>
        {detailSrc ? (
          <img src={detailSrc} alt={detailRevisedPrompt || selectedImage.prompt || '图片详情'} />
        ) : (
          <div className="pending-preview detail-pending-preview">
            <span className="loading-ring" aria-hidden="true" />
            <strong>{detailIsFailed ? '生成失败' : '生成中...'}</strong>
            {selectedImage.error ? <p>{selectedImage.error}</p> : null}
          </div>
        )}
      </div>

      <div className="detail-panel">
        <div className="modal-head">
          <div>
            <h2>{detailIsPending ? '请求详情' : detailIsFailed ? '失败详情' : '图片详情'}</h2>
            <p>{detailIsPending ? '生成中' : detailIsFailed ? '请求失败' : selectedImage.authorName || (selectedOnWall ? '已上墙' : '本地生成')}</p>
          </div>
          <button type="button" className="close-button" onClick={closeDialog}>×</button>
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
          <div><span>来源</span><strong>{getSourceLabel(selectedImage)}</strong></div>
          <div><span>尺寸</span><strong>{detailParams.size || '自动'}</strong></div>
          <div><span>质量</span><strong>{getQualityLabel(detailParams.quality)}</strong></div>
          <div><span>返回格式</span><strong>{getResponseFormatLabel(detailParams.response_format)}</strong></div>
          <div><span>格式</span><strong>{detailParams.response_format === 'url' ? detailParams.output_format || 'png' : '禁用'}</strong></div>
          <div><span>背景</span><strong>{detailParams.background || 'auto'}</strong></div>
          <div><span>审核</span><strong>{detailParams.moderation || 'auto'}</strong></div>
          <div><span>数量</span><strong>{detailParams.n || 1}</strong></div>
        </div>

        <p className="created-line">创建于 {formatDate(selectedImage.createdAt)}{detailElapsed ? ` · 耗时 ${detailElapsed}` : ''}</p>

        <div className="detail-actions">
          {detailDownloadSrc ? <a className="secondary-action" href={detailDownloadSrc} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">下载</a> : null}
          <button type="button" className="secondary-action" onClick={() => reuseConfig(selectedImage)}>复用配置</button>
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
  );
}