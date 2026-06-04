import { useEffect, useMemo, useState } from 'react';

const HISTORY_KEY = 'gpt-biubiubiu:image-history';

const sizeOptions = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'];
const qualityOptions = ['auto', 'standard', 'hd', 'low', 'medium', 'high'];
const styleOptions = ['auto', 'vivid', 'natural'];
const responseFormatOptions = ['url', 'b64_json'];

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

function App() {
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '正在检查接口配置' });
  const [error, setError] = useState('');

  useEffect(() => {
    setHistory(readHistory());

    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setStatus({
          loading: false,
          configured: Boolean(data.configured),
          message: data.configured ? `已连接：${data.defaultImageModel}` : '服务端未配置 API Key',
        });
      })
      .catch(() => {
        setStatus({ loading: false, configured: false, message: '后端代理未启动' });
      });
  }, []);

  const resultCount = useMemo(() => images.filter(createImageSrc).length, [images]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectHistory = (item) => {
    setForm({ ...defaultForm, ...item.form });
    setImages(item.images || []);
    setError('');
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
    setStatus((current) => ({ ...current, loading: true, message: '正在生成图片' }));

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

      if (!response.ok) {
        throw new Error(data.error || '生成失败');
      }

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
      setStatus((current) => ({ ...current, loading: false, message: `生成完成：${nextImages.length} 张` }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '生成失败');
      setStatus((current) => ({ ...current, loading: false, message: current.configured ? '接口可用，生成失败' : current.message }));
    }
  };

  return (
    <main className="app-shell">
      <aside className="history-panel panel">
        <div className="brand-block">
          <div className="brand-mark">BIU</div>
          <div>
            <p className="eyebrow">OpenAI Compatible</p>
            <h1>在线生图</h1>
          </div>
        </div>

        <div className={`status-card ${status.configured ? 'is-ready' : 'is-warning'}`}>
          <span className="status-dot" />
          <span>{status.message}</span>
        </div>

        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>生成记录</h2>
          </div>
          <button type="button" className="ghost-button small" onClick={clearHistory} disabled={!history.length}>
            清空
          </button>
        </div>

        <div className="history-list">
          {history.length === 0 ? (
            <div className="empty-history">生成后会保留最近 30 条记录。</div>
          ) : (
            history.map((item) => (
              <button type="button" className="history-item" key={item.id} onClick={() => selectHistory(item)}>
                <span>{item.form.prompt}</span>
                <small>
                  {item.form.size} · {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </small>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workbench-panel panel">
        <div className="hero-copy">
          <p className="eyebrow">Image Studio</p>
          <h2>黑白极简生图工作台</h2>
          <p>服务端代理保存密钥，前端只负责提交参数和展示结果。兼容 OpenAI 风格的图片生成接口。</p>
        </div>

        <form className="generator-form" onSubmit={generate}>
          <label className="field-block wide">
            <span>提示词</span>
            <textarea
              value={form.prompt}
              onChange={(event) => updateForm('prompt', event.target.value)}
              placeholder="例如：黑白极简风格的机械猫，强烈光影，高级杂志封面"
              rows={6}
            />
          </label>

          <label className="field-block wide">
            <span>反向提示词</span>
            <textarea
              value={form.negative_prompt}
              onChange={(event) => updateForm('negative_prompt', event.target.value)}
              placeholder="不想出现的元素，可留空"
              rows={3}
            />
          </label>

          <label className="field-block">
            <span>模型</span>
            <input value={form.model} onChange={(event) => updateForm('model', event.target.value)} placeholder="gpt-image-1" />
          </label>

          <label className="field-block">
            <span>尺寸</span>
            <select value={form.size} onChange={(event) => updateForm('size', event.target.value)}>
              {sizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <label className="field-block">
            <span>质量</span>
            <select value={form.quality} onChange={(event) => updateForm('quality', event.target.value)}>
              {qualityOptions.map((quality) => (
                <option key={quality} value={quality}>
                  {quality}
                </option>
              ))}
            </select>
          </label>

          <label className="field-block">
            <span>风格</span>
            <select value={form.style} onChange={(event) => updateForm('style', event.target.value)}>
              {styleOptions.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>

          <label className="field-block">
            <span>数量</span>
            <input
              min="1"
              max="4"
              type="number"
              value={form.n}
              onChange={(event) => updateForm('n', event.target.value)}
            />
          </label>

          <label className="field-block">
            <span>返回格式</span>
            <select value={form.response_format} onChange={(event) => updateForm('response_format', event.target.value)}>
              {responseFormatOptions.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </label>

          {error ? <div className="error-box wide">{error}</div> : null}

          <div className="action-row wide">
            <button type="submit" className="primary-button" disabled={status.loading}>
              {status.loading ? '生成中...' : '开始生成'}
            </button>
            <button type="button" className="ghost-button" onClick={() => setForm(defaultForm)}>
              重置参数
            </button>
          </div>
        </form>
      </section>

      <section className="result-panel panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Canvas</p>
            <h2>生成结果</h2>
          </div>
          <span className="count-pill">{resultCount} 张</span>
        </div>

        <div className={resultCount ? 'result-grid' : 'result-empty'}>
          {resultCount ? (
            images.map((image) => {
              const src = createImageSrc(image);
              if (!src) return null;

              return (
                <figure className="image-card" key={image.id || src}>
                  <img src={src} alt={image.revised_prompt || form.prompt || '生成图片'} />
                  <figcaption>
                    <span>{image.revised_prompt || '生成图片'}</span>
                    <a href={src} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">
                      下载
                    </a>
                  </figcaption>
                </figure>
              );
            })
          ) : (
            <div>
              <span className="empty-orbit" />
              <h3>还没有生成图片</h3>
              <p>填写提示词后，右侧会显示大画布预览。</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;