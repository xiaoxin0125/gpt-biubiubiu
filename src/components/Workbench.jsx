import {
  backgroundOptions,
  MAX_OUTPUT_IMAGES,
  moderationOptions,
  outputFormatOptions,
  qualityOptions,
  responseFormatOptions,
} from '../constants/options';
import { normalizeOutputCount } from '../lib/form';

export default function Workbench({
  form,
  updateForm,
  generate,
  workbenchExpanded,
  setWorkbenchExpanded,
  openSizeDialog,
  renderSelect,
  responseFormat,
  canUseOutputFormat,
  hasReferenceImages,
  referenceNames,
  referenceImages,
  maskImage,
  canSubmitGeneration,
  isGenerating,
  handleReferenceChange,
  handleMaskChange,
  removeReference,
  clearMask,
  clearReference,
}) {
  return (
    <form className="bottom-workbench" onSubmit={generate}>
      <div className="prompt-console">
        <div className="prompt-input-wrap">
          <textarea
            value={form.prompt}
            onChange={(event) => updateForm('prompt', event.target.value)}
            placeholder="描述你想生成的图片..."
            rows={2}
          />
          {form.prompt ? (
            <button type="button" className="prompt-clear-button" onClick={() => updateForm('prompt', '')} aria-label="清空描述内容">
              ×
            </button>
          ) : null}
        </div>

        <div className={workbenchExpanded ? 'workbench-actions is-expanded' : 'workbench-actions'}>
          <button type="button" className="workbench-toggle-button" onClick={() => setWorkbenchExpanded((current) => !current)} aria-expanded={workbenchExpanded} aria-label={workbenchExpanded ? '收起参数' : '展开参数'}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M7 12h10" />
              <path d="M10 17h4" />
            </svg>
          </button>
          <div className="control-field size-control workbench-extra-control">
            <span>尺寸</span>
            <button type="button" className="tool-pill" onClick={openSizeDialog}>
              {form.size || '自动'}
            </button>
          </div>

          {renderSelect({
            id: 'workbench-quality',
            label: '质量',
            value: form.quality,
            options: qualityOptions,
            onChange: (value) => updateForm('quality', value),
            className: 'control-field workbench-extra-control',
          })}

          {renderSelect({
            id: 'workbench-background',
            label: '背景',
            value: form.background,
            options: backgroundOptions,
            onChange: (value) => updateForm('background', value),
            className: 'control-field workbench-extra-control',
          })}

          {renderSelect({
            id: 'workbench-response-format',
            label: '返回格式',
            value: responseFormat,
            options: responseFormatOptions,
            onChange: (value) => updateForm('response_format', value),
            className: 'control-field response-format-control workbench-extra-control',
          })}

          {renderSelect({
            id: 'workbench-output-format',
            label: '格式',
            value: form.output_format,
            options: outputFormatOptions.map((format) => ({ label: format.toUpperCase(), value: format })),
            onChange: (value) => updateForm('output_format', value),
            disabled: !canUseOutputFormat,
            className: 'control-field workbench-extra-control',
          })}

          {renderSelect({
            id: 'workbench-moderation',
            label: '审核',
            value: form.moderation,
            options: moderationOptions,
            onChange: (value) => updateForm('moderation', value),
            className: 'control-field workbench-extra-control',
          })}

          <label className="control-field count-field workbench-extra-control">
            <span>数量</span>
            <input min="1" max={MAX_OUTPUT_IMAGES} type="number" value={form.n} onChange={(event) => updateForm('n', normalizeOutputCount(event.target.value))} />
          </label>

          <label className={hasReferenceImages ? 'control-field file-control has-file icon-file-control' : 'control-field file-control icon-file-control'} title={referenceNames || '上传参考图'} aria-label="上传参考图">
            <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={handleReferenceChange} />
            <strong>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="16" height="14" rx="3" />
                <path d="m7 15 3.2-3.2 2.6 2.6 1.7-1.7L18 16" />
                <circle cx="15.5" cy="9.5" r="1.5" />
                <path d="M18 4v4" />
                <path d="M16 6h4" />
              </svg>
              <em>{hasReferenceImages ? referenceImages.length : ''}</em>
            </strong>
          </label>

          <label className={hasReferenceImages ? 'control-field file-control mask-control icon-file-control' : 'control-field file-control mask-control icon-file-control is-disabled'} title={maskImage?.name || '上传 mask'} aria-label="上传 mask">
            <input type="file" accept="image/png" disabled={!hasReferenceImages} onChange={handleMaskChange} />
            <strong>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5h14v7c0 4.2-2.8 6.9-7 8-4.2-1.1-7-3.8-7-8V5Z" />
                <path d="M8 10h3" />
                <path d="M13 10h3" />
                <path d="M9 15c1.8 1.2 4.2 1.2 6 0" />
                <path d="M19 5 5 19" />
              </svg>
              <em>{maskImage ? '1' : ''}</em>
            </strong>
          </label>

          <button type="submit" className="send-button" disabled={!canSubmitGeneration} aria-label="生成图片">
            {isGenerating ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="loading-dots-icon">
                <circle cx="6" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="18" cy="12" r="1.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12 20 5l-5.4 14-3.1-6.5L4 12Z" />
                <path d="m11.5 12.5 4.2-4.2" />
              </svg>
            )}
          </button>
        </div>

        {hasReferenceImages ? (
          <div className="reference-preview">
            <div className="reference-preview-list">
              {referenceImages.map((image, index) => (
                <figure key={image.id}>
                  <img src={image.previewUrl} alt={`参考图 ${index + 1}`} />
                  <figcaption>图{index + 1}</figcaption>
                  <button type="button" className="mini-remove" onClick={() => removeReference(image.id)} aria-label={`移除参考图 ${index + 1}`}>×</button>
                </figure>
              ))}
              {maskImage ? (
                <figure className="mask-preview-card">
                  <img src={maskImage.previewUrl} alt="mask" />
                  <figcaption>Mask</figcaption>
                  <button type="button" className="mini-remove" onClick={clearMask} aria-label="移除 mask">×</button>
                </figure>
              ) : null}
            </div>
            <span>{referenceNames}</span>
            <button type="button" className="text-button" onClick={clearReference}>移除全部</button>
          </div>
        ) : null}
      </div>
    </form>
  );
}