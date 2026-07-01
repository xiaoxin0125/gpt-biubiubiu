import { useMemo, useState } from 'react';
import {
  API_CONFIG_SCOPE_AGNES,
  MAX_REFERENCE_IMAGES,
  agnesResponseFormatOptions,
  agnesVideoModeOptions,
  agnesVideoResolutionOptions,
  defaultAgnesVideoForm,
  defaultSizeDraft,
} from '../constants/options';
import SizeDialog from './SizeDialog';
import { apiConfigHasKeyForScope, apiConfigLabelForScope, requestReferenceImageUpload } from '../lib/api';
import { createImageSrc } from '../lib/images';
import { getAvailableRatios, getDraftSize, parseSize } from '../lib/size';
import { useAgnesGeneration } from '../hooks/useAgnesGeneration';

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

const createReferenceId = (file) => `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;

const appendLines = (value, lines) => [
  String(value || '').trim(),
  lines.map((line) => String(line || '').trim()).filter(Boolean).join('\n'),
].filter(Boolean).join('\n');

const EmptyAgnesCanvas = ({ activeTab, configured, openAccount }) => (
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
    <p>{configured ? (activeTab === 'image' ? '填写底部提示词开始 Agnes 生图' : '填写底部提示词创建 Agnes 视频任务') : '请先配置 Agnes API'}</p>
    {!configured ? <button type="button" className="secondary-action" onClick={openAccount}>去配置</button> : null}
  </div>
);

const ResultShell = ({ children, caption, className = '' }) => (
  <figure className={`result-card agnes-result-card ${className}`.trim()}>
    {children}
    <figcaption className="result-caption" title={caption}>
      <span>{caption}</span>
    </figcaption>
  </figure>
);

const AgnesImageResults = ({ results }) => {
  if (!results.length) return null;

  return (
    <div className="agnes-result-grid agnes-image-grid">
      {results.map((item) => {
        const src = createImageSrc(item);
        const isPending = item.status === 'pending';
        const isFailed = item.status === 'failed';
        return (
          <ResultShell key={item.id} caption={item.error || item.apiName || 'Agnes API'} className={`${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''}`}>
            <div className="result-image-wrap agnes-result-media">
              {src ? <img src={src} alt={item.prompt || 'Agnes 生成图片'} loading="lazy" decoding="async" /> : (
                <div className="pending-preview">
                  <span className="loading-ring" aria-hidden="true" />
                  <strong>{isFailed ? '生成失败' : '生成中...'}</strong>
                  {item.error ? <p>{item.error}</p> : null}
                </div>
              )}
            </div>
          </ResultShell>
        );
      })}
    </div>
  );
};

const AgnesVideoResults = ({ tasks }) => {
  if (!tasks.length) return null;

  return (
    <div className="agnes-result-grid agnes-video-grid">
      {tasks.map((task) => {
        const videoUrl = String(task.videoUrl || '').trim();
        const isFailed = task.status === 'failed';
        const isPending = task.status === 'pending' || task.status === 'running';
        const caption = [statusLabel(task.status), task.progress ? `进度 ${task.progress}` : '', task.seconds ? `${task.seconds}s` : '', task.size || ''].filter(Boolean).join(' · ');
        return (
          <ResultShell key={task.id} caption={task.error || caption || 'Agnes 视频任务'} className={`${isPending ? 'is-pending' : ''} ${isFailed ? 'is-failed' : ''}`}>
            <div className="agnes-video-card-body">
              {videoUrl && /^https?:\/\//i.test(videoUrl) ? (
                <video src={videoUrl} controls playsInline />
              ) : (
                <div className="pending-preview">
                  <span className="loading-ring" aria-hidden="true" />
                  <strong>{isFailed ? '任务失败' : statusLabel(task.status)}</strong>
                  <p>{task.error || task.videoId || '等待 Agnes 返回视频结果。'}</p>
                </div>
              )}
              <div className="agnes-task-meta">
                <span>{modeLabel(task.mode)}</span>
                <span>{task.numFrames || defaultAgnesVideoForm.numFrames} 帧 / {task.frameRate || defaultAgnesVideoForm.frameRate} fps</span>
                {videoUrl && !/^https?:\/\//i.test(videoUrl) ? <span>结果字段：{videoUrl}</span> : null}
              </div>
            </div>
          </ResultShell>
        );
      })}
    </div>
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
}) {
  const [activeTab, setActiveTab] = useState('image');
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false);
  const [imageSizeDialogOpen, setImageSizeDialogOpen] = useState(false);
  const [imageSizeDraft, setImageSizeDraft] = useState(defaultSizeDraft);
  const [uploadedImageReferences, setUploadedImageReferences] = useState([]);
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
    clearImageResults,
    clearVideoTasks,
  } = useAgnesGeneration({ activeAgnesApiConfig, apiConfigForm, apiKeyVaultRef, syncDirectApiKey, setError });

  const configured = Boolean(user) && apiConfigHasKeyForScope(activeAgnesApiConfig, API_CONFIG_SCOPE_AGNES);
  const apiName = useMemo(
    () => apiConfigLabelForScope(activeAgnesApiConfig, API_CONFIG_SCOPE_AGNES, 'Agnes API'),
    [activeAgnesApiConfig],
  );
  const activePrompt = activeTab === 'image' ? imageForm.prompt : videoForm.prompt;
  const activeLoading = activeTab === 'image' ? imageLoading : videoLoading;
  const activeResultCount = activeTab === 'image' ? imageResults.length : videoTasks.length;
  const videoResolution = `${videoForm.width}x${videoForm.height}`;
  const imageAvailableRatios = getAvailableRatios(imageSizeDraft.resolution);
  const activeImageSize = getDraftSize(imageSizeDraft);
  const displayImageSize = activeImageSize || '自动';
  const uploadedReferenceNames = uploadedImageReferences.map((item, index) => `图${index + 1}:${item.name}`).join('，');
  const workbenchClassName = workbenchExpanded ? 'workbench-actions agnes-workbench-actions is-expanded' : 'workbench-actions agnes-workbench-actions';

  const updateActivePrompt = (value) => {
    if (activeTab === 'image') updateImageForm('prompt', value);
    else updateVideoForm('prompt', value);
  };

  const clearActiveResults = () => {
    if (activeTab === 'image') clearImageResults();
    else clearVideoTasks();
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

  const submitActiveForm = activeTab === 'image' ? runImageGeneration : runVideoGeneration;

  return (
    <section className="agnes-page canvas-stage">
      <div className="canvas-toolbar agnes-toolbar">
        <div className="segmented-control two-tabs agnes-toolbar-tabs">
          <button type="button" className={activeTab === 'image' ? 'is-active' : ''} onClick={() => setActiveTab('image')}>生图</button>
          <button type="button" className={activeTab === 'video' ? 'is-active' : ''} onClick={() => setActiveTab('video')}>视频</button>
        </div>
        <span className={configured ? 'status-pill is-ready agnes-status-pill' : 'status-pill is-warning agnes-status-pill'}>{configured ? apiName : '未配置 Agnes API'}</span>
        <span className="status-pill is-warning agnes-stream-pill">暂不支持流式</span>
        {!configured ? <button type="button" className="toolbar-text-button" onClick={openAccount}>去配置</button> : null}
        <button type="button" className="toolbar-text-button" onClick={clearActiveResults} disabled={!activeResultCount}>清空</button>
      </div>

      <div className={activeResultCount ? 'image-board agnes-board has-images' : 'image-board agnes-board'}>
        {activeResultCount ? (
          activeTab === 'image' ? <AgnesImageResults results={imageResults} /> : <AgnesVideoResults tasks={videoTasks} />
        ) : (
          <EmptyAgnesCanvas activeTab={activeTab} configured={configured} openAccount={openAccount} />
        )}
      </div>

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
                <label className={uploadedImageReferences.length ? 'control-field file-control has-file icon-file-control' : 'control-field file-control icon-file-control'} title={uploadedReferenceNames || '上传参考图'} aria-label="上传参考图">
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={handleImageReferenceChange} />
                  <ReferenceUploadIcon count={uploadedImageReferences.length} />
                </label>
                <label className="control-field workbench-extra-control agnes-wide-control agnes-reference-input-control">
                  <span>参考图 URL / Base64</span>
                  <textarea value={imageForm.imageInputs} onChange={(event) => updateImageForm('imageInputs', event.target.value)} rows={2} placeholder="每行一张图片；可上传自动回填，也可手动填写" />
                </label>
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
                {renderSelect({
                  id: 'agnes-video-resolution',
                  label: '分辨率',
                  value: videoResolution,
                  options: agnesVideoResolutionOptions,
                  onChange: setVideoResolution,
                  className: 'control-field workbench-extra-control agnes-resolution-control',
                })}
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

            <button type="submit" className="send-button" disabled={!configured || activeLoading} aria-label={activeTab === 'image' ? '生成图片' : '创建视频任务'}>
              {activeLoading ? <LoadingDotsIcon /> : <SendIcon />}
            </button>
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
    </section>
  );
}