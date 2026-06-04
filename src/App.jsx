import { useEffect, useMemo, useState } from 'react';

const HISTORY_KEY = 'gpt-biubiubiu:image-history';

const qualityOptions = ['auto', 'standard', 'hd', 'low', 'medium', 'high'];
const styleOptions = ['auto', 'vivid', 'natural'];
const responseFormatOptions = ['url', 'b64_json'];
const modelOptions = ['gpt-image-1', 'dall-e-3', 'dall-e-2'];

const resolutionGroups = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

const ratioOptions = [
  { label: '1:1', value: '1:1', icon: 'square' },
  { label: '3:2', value: '3:2', icon: 'landscape' },
  { label: '2:3', value: '2:3', icon: 'portrait' },
  { label: '16:9', value: '16:9', icon: 'wide' },
  { label: '9:16', value: '9:16', icon: 'tall' },
  { label: '4:3', value: '4:3', icon: 'landscape' },
  { label: '3:4', value: '3:4', icon: 'portrait' },
  { label: '21:9', value: '21:9', icon: 'ultra' },
];

const ratioToSize = {
  '1k': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1365x1024',
    '3:4': '1024x1365',
    '21:9': '2048x878',
  },
  '2k': {
    '1:1': '2048x2048',
    '3:2': '2304x1536',
    '2:3': '1536x2304',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '21:9': '2560x1097',
  },
  '4k': {
    '1:1': '4096x4096',
    '3:2': '3840x2560',
    '2:3': '2560x3840',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3': '4096x3072',
    '3:4': '3072x4096',
    '21:9': '4096x1755',
  },
};

const defaultForm = {
  model: 'gpt-image-1',
  prompt: '',
  negative_prompt: '',
  size: '1024x1024',
  n: 1,
  quality: 'auto',
  style: 'auto',
  response_format: 'url',
};

const defaultSizeDraft = {
  mode: 'ratio',
  resolution: '1k',
  ratio: '1:1',
  customWidth: 1024,
  customHeight: 1024,
};

const createImageSrc = (image) => {
  if (image.url) return image.url;
  if (image.b64_json) return `data:image/png;base64,${image.b64_json}`;
  return '';
};

const readHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
};

const saveHistory = (items) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
};

const parseSize = (size) => {
  const [width, height] = size.split('x').map(Number);
  return { width: width || 1024, height: height || 1024 };
};

const getDraftSize = (draft) => {
  if (draft.mode === 'custom') return `${draft.customWidth || 1024}x${draft.customHeight || 1024}`;
  if (draft.mode === 'auto') return '1024x1024';
  return ratioToSize[draft.resolution]?.[draft.ratio] || '1024x1024';
};

const fieldLabel = {
  model: '模型',
  quality: '质量',
  style: '风格',
  response_format: '返回格式',
};

function App() {
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '检查接口中' });
  const [error, setError] = useState('');
  const [activeDialog, setActiveDialog] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(defaultSizeDraft);

  useEffect(() => {
    setHistory(readHistory());

    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setStatus({
          loading: false,
          configured: Boolean(data.configured),
          message: data.configured ? `Ready · ${data.defaultImageModel}` : '未配置 API Key',
        });
      })
      .catch(() => {
        setStatus({ loading: false, configured: false, message: '代理未启动' });
      });
  }, []);

  const visibleImages = useMemo(() => images.filter(createImageSrc), [images]);
  const activeSize = getDraftSize(sizeDraft);
  const { width, height } = parseSize(activeSize);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openSizeDialog = () => {
    const current = parseSize(form.size);
    setSizeDraft((draft) => ({
      ...draft,
      customWidth: current.width,
      customHeight: current.height,
    }));
    setActiveDialog('size');
  };

  const applySize = () => {
    updateForm('size', activeSize);
    setActiveDialog(null);
  };

  const selectHistory = (item) => {
    setForm({ ...defaultForm, ...item.form });
    setImages(item.images || []);
    setError('');
    setActiveDialog(null);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const generate = async (event) => {
    event.preventDefault();
    const prompt = form.prompt.trim();

    if (!prompt) {
      setError('先写提示词，再开始生成。');
      return;
    }

    setError('');
    setStatus((current) => ({ ...current, loading: true, message: 'Generating' }));

    try {
      const response = await fetch('/api/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          prompt,
          n: Number(form.n),
        }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || '生成失败');

      const nextImages = Array.isArray(data.data) ? data.data : [];
      setImages(nextImages);

      const record = {
        id: `${Date.now()}`,
        form: { ...form, prompt },
        images: nextImages,
        createdAt: new Date().toISOString(),
      };

      const nextHistory = [record, ...history].slice(0, 30);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setStatus((current) => ({ ...current, loading: false, message: `Done · ${nextImages.length}` }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '生成失败');
      setStatus((current) => ({ ...current, loading: false, message: current.configured ? 'Failed' : current.message }));
    }
  };

  return (
    <main className="playground-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="GPT Biubiubiu">
          <span className="brand-orb" />
          <span>GPT Image Playground</span>
        </a>

        <nav className="mode-tabs" aria-label="工作台模式">
          <button type="button" className="is-active">生图</button>
          <button type="button">编辑</button>
        </nav>

        <div className="topbar-actions">
          <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{status.message}</span>
          <button type="button" className="round-tool" onClick={() => setActiveDialog('history')} aria-label="历史记录">
            H
          </button>
          <button type="button" className="round-tool" onClick={() => setActiveDialog('settings')} aria-label="参数设置">
            S
          </button>
        </div>
      </header>

      <section className="canvas-stage">
        <div className="canvas-toolbar">
          <button type="button" className="soft-chip is-active">画布</button>
          <button type="button" className="soft-chip">网格</button>
          <button type="button" className="soft-chip">预览</button>
        </div>

        <div className={visibleImages.length ? 'image-board has-images' : 'image-board'}>
          {visibleImages.length ? (
            visibleImages.map((image) => {
              const src = createImageSrc(image);

              return (
                <figure className="result-card" key={image.id || src}>
                  <img src={src} alt={image.revised_prompt || form.prompt || '生成图片'} />
                  <figcaption>
                    <span>{image.revised_prompt || form.prompt || 'Generated image'}</span>
                    <a href={src} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">
                      下载
                    </a>
                  </figcaption>
                </figure>
              );
            })
          ) : (
            <div className="empty-canvas">
              <span className="empty-mark">+</span>
              <h1>What do you want to create?</h1>
              <p>底部工作台输入提示词，尺寸、模型、参数都在弹窗内完成。</p>
            </div>
          )}
        </div>
      </section>

      <form className="bottom-workbench" onSubmit={generate}>
        <div className="workbench-meta">
          <span>文本生成图像</span>
          <small>{form.model} · {form.size} · {form.n} 张</small>
        </div>

        <div className="prompt-console">
          <textarea
            value={form.prompt}
            onChange={(event) => updateForm('prompt', event.target.value)}
            placeholder="Describe an image..."
            rows={2}
          />

          <div className="workbench-actions">
            <button type="button" className="tool-pill" onClick={openSizeDialog}>
              尺寸 {form.size}
            </button>
            <button type="button" className="tool-pill" onClick={() => setActiveDialog('model')}>
              模型 {form.model}
            </button>
            <button type="button" className="tool-pill" onClick={() => setActiveDialog('settings')}>
              参数
            </button>
            <button type="button" className="tool-pill" onClick={() => setActiveDialog('history')}>
              历史
            </button>
            <button type="submit" className="send-button" disabled={status.loading} aria-label="生成图片">
              {status.loading ? '...' : '↑'}
            </button>
          </div>
        </div>

        {error ? <div className="error-toast">{error}</div> : null}
      </form>

      {activeDialog ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={() => setActiveDialog(null)} />

          {activeDialog === 'size' ? (
            <section className="modal-card size-modal" role="dialog" aria-modal="true" aria-label="设置图像尺寸">
              <div className="modal-head">
                <div>
                  <h2>设置图像尺寸</h2>
                  <p>当前：{width}x{height}</p>
                </div>
                <button type="button" className="close-button" onClick={() => setActiveDialog(null)}>×</button>
              </div>

              <div className="segmented-control">
                <button type="button" className={sizeDraft.mode === 'auto' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'auto' }))}>自动</button>
                <button type="button" className={sizeDraft.mode === 'ratio' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'ratio' }))}>按比例</button>
                <button type="button" className={sizeDraft.mode === 'custom' ? 'is-active' : ''} onClick={() => setSizeDraft((draft) => ({ ...draft, mode: 'custom' }))}>自定义宽高</button>
              </div>

              {sizeDraft.mode === 'auto' ? (
                <div className="size-tab-panel auto-size-panel">
                  <div className="auto-card">
                    <span className="auto-icon">A</span>
                    <div>
                      <strong>自动尺寸</strong>
                      <p>使用 OpenAI 兼容接口的默认方图尺寸，适合快速出图和测试模型。</p>
                    </div>
                  </div>
                  <div className="auto-preview-card">
                    <span>默认输出</span>
                    <strong>1024x1024</strong>
                  </div>
                </div>
              ) : null}

              {sizeDraft.mode === 'ratio' ? (
                <div className="size-tab-panel ratio-size-panel">
                  <div className="modal-section">
                    <span className="section-label">基准分辨率</span>
                    <div className="resolution-row">
                      {resolutionGroups.map((item) => (
                        <button
                          type="button"
                          className={sizeDraft.resolution === item.value ? 'select-card is-active' : 'select-card'}
                          key={item.value}
                          onClick={() => setSizeDraft((draft) => ({ ...draft, resolution: item.value }))}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="modal-section">
                    <span className="section-label">图像比例</span>
                    <div className="ratio-grid">
                      {ratioOptions.map((item) => (
                        <button
                          type="button"
                          className={sizeDraft.ratio === item.value ? 'ratio-card is-active' : 'ratio-card'}
                          key={item.value}
                          onClick={() => setSizeDraft((draft) => ({ ...draft, ratio: item.value }))}
                        >
                          <span className={`ratio-icon ${item.icon}`} />
                          <strong>{item.label}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {sizeDraft.mode === 'custom' ? (
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
                  <div className="custom-helper-grid">
                    {['1024x1024', '1536x1024', '1024x1536'].map((size) => {
                      const parsed = parseSize(size);
                      return (
                        <button
                          type="button"
                          className="select-card"
                          key={size}
                          onClick={() => setSizeDraft((draft) => ({ ...draft, customWidth: parsed.width, customHeight: parsed.height }))}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="summary-box">
                <span>评估图</span>
                <strong>{activeSize}</strong>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={() => setActiveDialog(null)}>取消</button>
                <button type="button" className="primary-action" onClick={applySize}>确定</button>
              </div>
            </section>
          ) : null}

          {activeDialog === 'model' ? (
            <section className="modal-card compact-modal" role="dialog" aria-modal="true" aria-label="选择模型">
              <div className="modal-head">
                <div>
                  <h2>选择模型</h2>
                  <p>用于 OpenAI 兼容生图接口</p>
                </div>
                <button type="button" className="close-button" onClick={() => setActiveDialog(null)}>×</button>
              </div>

              <div className="option-list">
                {modelOptions.map((model) => (
                  <button
                    type="button"
                    className={form.model === model ? 'option-row is-active' : 'option-row'}
                    key={model}
                    onClick={() => {
                      updateForm('model', model);
                      setActiveDialog(null);
                    }}
                  >
                    <span>{model}</span>
                    <small>{form.model === model ? '当前使用' : '点击切换'}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {activeDialog === 'settings' ? (
            <section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-label="生成参数">
              <div className="modal-head">
                <div>
                  <h2>生成参数</h2>
                  <p>质量、风格、数量、返回格式和反向提示词</p>
                </div>
                <button type="button" className="close-button" onClick={() => setActiveDialog(null)}>×</button>
              </div>

              <div className="settings-grid">
                <label>
                  <span>{fieldLabel.quality}</span>
                  <select value={form.quality} onChange={(event) => updateForm('quality', event.target.value)}>
                    {qualityOptions.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
                  </select>
                </label>
                <label>
                  <span>{fieldLabel.style}</span>
                  <select value={form.style} onChange={(event) => updateForm('style', event.target.value)}>
                    {styleOptions.map((style) => <option key={style} value={style}>{style}</option>)}
                  </select>
                </label>
                <label>
                  <span>数量</span>
                  <input min="1" max="4" type="number" value={form.n} onChange={(event) => updateForm('n', event.target.value)} />
                </label>
                <label>
                  <span>{fieldLabel.response_format}</span>
                  <select value={form.response_format} onChange={(event) => updateForm('response_format', event.target.value)}>
                    {responseFormatOptions.map((format) => <option key={format} value={format}>{format}</option>)}
                  </select>
                </label>
                <label className="full-field">
                  <span>反向提示词</span>
                  <textarea value={form.negative_prompt} onChange={(event) => updateForm('negative_prompt', event.target.value)} placeholder="不想出现的元素，可留空" rows={3} />
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={() => setForm(defaultForm)}>重置</button>
                <button type="button" className="primary-action" onClick={() => setActiveDialog(null)}>完成</button>
              </div>
            </section>
          ) : null}

          {activeDialog === 'history' ? (
            <section className="modal-card history-modal" role="dialog" aria-modal="true" aria-label="生成历史">
              <div className="modal-head">
                <div>
                  <h2>生成历史</h2>
                  <p>最近 30 条记录保存在当前浏览器</p>
                </div>
                <button type="button" className="close-button" onClick={() => setActiveDialog(null)}>×</button>
              </div>

              <div className="history-list modal-history-list">
                {history.length ? (
                  history.map((item) => (
                    <button type="button" className="history-item" key={item.id} onClick={() => selectHistory(item)}>
                      <span>{item.form.prompt}</span>
                      <small>{item.form.size} · {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
                    </button>
                  ))
                ) : (
                  <div className="empty-history">暂无生成记录</div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={clearHistory} disabled={!history.length}>清空</button>
                <button type="button" className="primary-action" onClick={() => setActiveDialog(null)}>完成</button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export default App;