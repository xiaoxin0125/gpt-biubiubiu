import { ratioToSize, resolutionGroups } from '../constants/options';
import { getAvailableRatios } from '../lib/size';

const getRatioIconStyle = (ratio) => {
  const [width, height] = String(ratio || '').split(':').map(Number);
  if (!width || !height) return {};

  const maxWidth = 26;
  const maxHeight = 24;
  const scale = Math.min(maxWidth / width, maxHeight / height);

  return {
    '--ratio-icon-width': `${Math.max(8, Math.round(width * scale))}px`,
    '--ratio-icon-height': `${Math.max(8, Math.round(height * scale))}px`,
  };
};

export default function SizeDialog({
  sizeDraft,
  setSizeDraft,
  availableRatios,
  displaySize,
  closeDialog,
  applySize,
  title = '设置图像尺寸',
  currentLabel = '当前',
  summaryLabel = '评估图',
  resolutionLabel = '基准分辨率',
  ratioLabel = '图像比例',
  resolutionOptions = resolutionGroups,
  ratioSizeMap = ratioToSize,
  getRatiosForResolution = getAvailableRatios,
  allowAuto = true,
  allowCustomSize = true,
  allowCustomRatio = true,
  normalizationNote = '',
  ratioGridClassName = '',
  modalClassName = '',
}) {
  const ratioOnly = !allowAuto && !allowCustomSize;
  const activeMode = ratioOnly ? 'ratio' : sizeDraft.mode;

  return (
    <section className={`modal-card size-modal${modalClassName ? ` ${modalClassName}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          <p>{currentLabel}：{displaySize}</p>
        </div>
      </div>

      {ratioOnly ? null : (
        <div className="segmented-control">
          {allowAuto ? <button type="button" className={activeMode === 'auto' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'auto' }))}>自动</button> : null}
          <button type="button" className={activeMode === 'ratio' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'ratio' }))}>按比例</button>
          {allowCustomSize ? <button type="button" className={activeMode === 'custom' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'custom' }))}>自定义宽高</button> : null}
        </div>
      )}

      {allowAuto && activeMode === 'auto' ? (
        <div className="size-tab-panel auto-size-panel">
          <div className="auto-card">
            <span className="auto-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l1.45 4.05L17.5 8.5l-4.05 1.45L12 14l-1.45-4.05L6.5 8.5l4.05-1.45L12 3Z" />
                <path d="M18 14l.82 2.18L21 17l-2.18.82L18 20l-.82-2.18L15 17l2.18-.82L18 14Z" />
                <path d="M6 15l.55 1.45L8 17l-1.45.55L6 19l-.55-1.45L4 17l1.45-.55L6 15Z" />
              </svg>
            </span>
            <div>
              <strong>自动尺寸</strong>
              <p>不向模型传递具体的分辨率参数，由模型或上游接口自行决定生成尺寸。</p>
            </div>
          </div>
        </div>
      ) : null}

      {activeMode === 'ratio' ? (
        <div className="size-tab-panel ratio-size-panel">
          <div className="modal-section">
            <span className="section-label">{resolutionLabel}</span>
            <div className="resolution-row">
              {resolutionOptions.map((item) => (
                <button
                  type="button"
                  className={sizeDraft.resolution === item.value ? 'select-card is-active' : 'select-card'}
                  key={item.value}
                  onClick={() => setSizeDraft((draft) => {
                    const nextRatios = getRatiosForResolution(item.value);
                    const nextRatio = draft.ratio === 'custom-ratio' || ratioSizeMap[item.value]?.[draft.ratio] ? draft.ratio : nextRatios[0]?.value || '1:1';
                    return { ...draft, mode: 'ratio', resolution: item.value, ratio: nextRatio };
                  })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-section">
            <span className="section-label">{ratioLabel}</span>
            <div className={ratioGridClassName ? `ratio-grid ${ratioGridClassName}` : 'ratio-grid'}>
              {availableRatios.filter((item) => item.value !== 'custom-ratio').map((item) => (
                <button
                  type="button"
                  className={`${sizeDraft.ratio === item.value ? 'ratio-card is-active' : 'ratio-card'}${item.scene ? ' has-description' : ''}`}
                  key={item.value}
                  onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'ratio', ratio: item.value }))}
                  title={item.scene || item.label}
                >
                  <span className={`ratio-icon ${item.icon}`} style={getRatioIconStyle(item.value)} />
                  <strong>{item.label}</strong>
                  {item.scene ? <small>{item.scene}</small> : null}
                </button>
              ))}
            </div>
            {allowCustomRatio ? (
              <button
                type="button"
                className={sizeDraft.ratio === 'custom-ratio' ? 'custom-ratio-button is-active' : 'custom-ratio-button'}
                onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'ratio', ratio: 'custom-ratio' }))}
              >
                自定义比例
              </button>
            ) : null}
          </div>

          {allowCustomRatio && sizeDraft.ratio === 'custom-ratio' ? (
            <div className="custom-ratio-row">
              <label>
                <span>宽比例</span>
                <input type="number" min="1" max="300" value={sizeDraft.customRatioWidth} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customRatioWidth: Number(event.target.value) }))} />
              </label>
              <label>
                <span>高比例</span>
                <input type="number" min="1" max="300" value={sizeDraft.customRatioHeight} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customRatioHeight: Number(event.target.value) }))} />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {allowCustomSize && activeMode === 'custom' ? (
        <div className="size-tab-panel custom-size-panel">
          <div className="custom-size-row">
            <label>
              <span>宽度</span>
              <input type="number" min="256" value={sizeDraft.customWidth} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customWidth: Number(event.target.value) }))} />
            </label>
            <label>
              <span>高度</span>
              <input type="number" min="256" value={sizeDraft.customHeight} onChange={(event) => setSizeDraft((draft) => ({ ...draft, customHeight: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="size-limit-note">
            <span className="auto-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="4" y="5" width="16" height="14" rx="2" />
                <path d="M8 9h8" />
                <path d="M8 15h8" />
                <path d="M9 3v4" />
                <path d="M15 17v4" />
              </svg>
            </span>
            <strong>由于模型限制，最终输出会自动规整到合法尺寸</strong>
            <span>宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。</span>
          </div>
        </div>
      ) : null}

      {normalizationNote ? (
        <div className="size-limit-note video-size-note">
          <span className="auto-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="6" width="16" height="12" rx="2" />
              <path d="m10 10 5 2-5 2v-4Z" />
            </svg>
          </span>
          <strong>Agnes Video V2.0 会对部分视频生成参数进行标准化处理</strong>
          <span>{normalizationNote}</span>
        </div>
      ) : null}

      <div className="summary-box">
        <span>{summaryLabel}</span>
        <strong>{displaySize}</strong>
      </div>

      <div className="modal-actions">
        <button type="button" className="secondary-action" onClick={closeDialog}>取消</button>
        <button type="button" className="primary-action" onClick={applySize}>确定</button>
      </div>
    </section>
  );
}