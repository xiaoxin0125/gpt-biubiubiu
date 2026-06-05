import { useEffect, useMemo, useState } from 'react';

const HISTORY_KEY = 'gpt-biubiubiu:image-history';

const qualityOptions = ['auto', 'standard', 'hd', 'low', 'medium', 'high'];
const styleOptions = ['auto', 'vivid', 'natural'];
const responseFormatOptions = ['url', 'b64_json'];
const outputFormatOptions = ['png', 'jpeg', 'webp'];
const moderationOptions = ['auto', 'low', 'off'];
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
  { label: '自定义', value: 'custom-ratio', icon: 'custom' },
];

const ratioToSize = {
  '1k': {
    '1:1': '1024x1024',
    '3:2': '1152x768',
    '2:3': '768x1152',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1280x544',
  },
  '2k': {
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '1920x1440',
    '3:4': '1440x1920',
    '21:9': '2560x1088',
  },
  '4k': {
    '1:1': '2880x2880',
    '3:2': '3232x2160',
    '2:3': '2160x3232',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '2880x2160',
    '3:4': '2160x2880',
    '21:9': '3840x1600',
  },
};

const sizeLimits = {
  step: 16,
  maxEdge: 3840,
  maxRatio: 3,
  minPixels: 655360,
  maxPixels: 8294400,
};

const resolutionMaxEdges = {
  '1k': 1280,
  '2k': 2560,
  '4k': 3840,
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
  output_format: 'png',
  output_compression: '',
  moderation: 'auto',
};

const defaultSizeDraft = {
  mode: 'ratio',
  resolution: '1k',
  ratio: '1:1',
  customRatioWidth: 1,
  customRatioHeight: 1,
  customWidth: 1024,
  customHeight: 1024,
};

const emptyAuthForm = {
  username: '',
  password: '',
};

const createImageSrc = (image) => {
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:${image.imageMime || 'image/png'};base64,${image.b64_json}`;
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
  const [width, height] = String(size || '').split('x').map(Number);
  return { width: width || 1024, height: height || 1024 };
};

const formatDate = (value) => {
  if (!value) return '刚刚';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const getAvailableRatios = (resolution) => ratioOptions.filter((item) => item.value === 'custom-ratio' || Boolean(ratioToSize[resolution]?.[item.value]));

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
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

const clampSizeToLegalRange = (width, height) => {
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

const getDraftSize = (draft) => {
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

const fieldLabel = {
  model: '模型',
  quality: '质量',
  style: '风格',
  response_format: '返回',
  output_format: '格式',
  output_compression: '压缩率',
  moderation: '审核',
};

function App() {
  const [view, setView] = useState('generate');
  const [form, setForm] = useState(defaultForm);
  const [history, setHistory] = useState([]);
  const [images, setImages] = useState([]);
  const [wallItems, setWallItems] = useState([]);
  const [referenceImage, setReferenceImage] = useState(null);
  const [user, setUser] = useState(null);
  const [settingsMeta, setSettingsMeta] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [status, setStatus] = useState({ loading: true, configured: false, message: '检查接口中' });
  const [error, setError] = useState('');
  const [activeDialog, setActiveDialog] = useState(null);
  const [sizeDraft, setSizeDraft] = useState(defaultSizeDraft);
  const [wallBusyId, setWallBusyId] = useState('');

  const availableRatios = getAvailableRatios(sizeDraft.resolution);
  const activeSize = getDraftSize(sizeDraft);
  const displaySize = activeSize || '自动';
  const visibleImages = useMemo(() => images.filter(createImageSrc), [images]);
  const boardItems = view === 'wall' ? wallItems : visibleImages;

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const buildPayload = (prompt) => {
    const payload = {
      ...form,
      prompt,
      n: Number(form.n || 1),
    };

    if (!payload.size) delete payload.size;
    if (!payload.output_compression) delete payload.output_compression;
    return payload;
  };

  const applySettings = (settings) => {
    if (!settings) return;

    setSettingsMeta(settings);
    setForm((current) => ({
      ...current,
      model: settings.model || current.model,
      size: settings.size !== undefined ? settings.size : current.size,
      quality: settings.quality || current.quality,
      style: settings.style || current.style,
      response_format: settings.response_format || current.response_format,
      output_format: settings.output_format || current.output_format,
      output_compression: settings.output_compression !== undefined ? settings.output_compression : current.output_compression,
      moderation: settings.moderation || current.moderation,
      n: settings.n || current.n,
    }));
  };

  const loadWall = async () => {
    try {
      const response = await fetch('/api/wall');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '作品墙加载失败');
      setWallItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '作品墙加载失败');
    }
  };

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

    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user || null);
        applySettings(data.settings || null);
      })
      .catch(() => null);

    loadWall();
  }, []);

  const findWallItem = (image) => {
    if (!image) return null;
    if (image.wallItemId) return wallItems.find((item) => Number(item.id) === Number(image.wallItemId)) || { id: image.wallItemId };

    const src = createImageSrc(image);
    return wallItems.find((item) => {
      if (image.jobId && item.sourceJobId && Number(image.jobId) === Number(item.sourceJobId)) return true;
      const wallSrc = createImageSrc(item);
      return src && wallSrc && src === wallSrc;
    }) || null;
  };

  const isSameImage = (left, right) => {
    if (!left || !right) return false;
    if (left.jobId && right.jobId && Number(left.jobId) === Number(right.jobId)) return true;
    if (left.wallItemId && right.wallItemId && Number(left.wallItemId) === Number(right.wallItemId)) return true;
    if (left.id && right.id && left.id === right.id) return true;
    const leftSrc = createImageSrc(left);
    const rightSrc = createImageSrc(right);
    return Boolean(leftSrc && rightSrc && leftSrc === rightSrc);
  };

  const openSizeDialog = () => {
    if (!form.size) {
      setSizeDraft((draft) => ({ ...draft, mode: 'auto' }));
      setActiveDialog('size');
      return;
    }

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
    setImages((item.images || []).map((image) => ({
      ...image,
      form: { ...defaultForm, ...item.form },
      prompt: item.form?.prompt || '',
      createdAt: item.createdAt,
      source: image.source || 'generated',
    })));
    setView('generate');
    setError('');
    setActiveDialog(null);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const openDetail = (image) => {
    setSelectedImage(image);
    setActiveDialog('detail');
  };

  const closeDialog = () => {
    setActiveDialog(null);
    setSelectedImage(null);
  };

  const handleReferenceChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (referenceImage?.previewUrl) URL.revokeObjectURL(referenceImage.previewUrl);
    setReferenceImage({ file, name: file.name, previewUrl: URL.createObjectURL(file) });
    event.target.value = '';
  };

  const clearReference = () => {
    if (referenceImage?.previewUrl) URL.revokeObjectURL(referenceImage.previewUrl);
    setReferenceImage(null);
  };

  const generate = async (event) => {
    event.preventDefault();
    const prompt = form.prompt.trim();

    if (!prompt) {
      setError('先写提示词，再开始生成。');
      return;
    }

    setError('');
    setStatus((current) => ({ ...current, loading: true, message: referenceImage ? 'Editing' : 'Generating' }));

    try {
      const payload = buildPayload(prompt);
      const response = referenceImage
        ? await submitImageEdit(payload)
        : await fetch('/api/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || '生成失败');

      const createdAt = new Date().toISOString();
      const nextImages = Array.isArray(data.data)
        ? data.data.map((image) => ({
            ...image,
            form: payload,
            prompt,
            createdAt,
            source: referenceImage ? 'edit' : 'generated',
            referenceName: referenceImage?.name || '',
          }))
        : [];

      setImages(nextImages);
      setView('generate');

      const record = {
        id: `${Date.now()}`,
        form: payload,
        images: nextImages,
        createdAt,
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

  const submitImageEdit = (payload) => {
    const formData = new FormData();
    formData.append('image', referenceImage.file);
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
    });

    return fetch('/api/images/edits', {
      method: 'POST',
      body: formData,
    });
  };

  const toggleWall = async (image) => {
    const wallItem = findWallItem(image);
    const busyId = String(image.jobId || image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    setError('');

    try {
      if (wallItem?.id) {
        const response = await fetch(`/api/wall/${wallItem.id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '取消上墙失败');

        setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
        setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: null, isOnWall: false } : item)));
        setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: null, isOnWall: false } : current));
        return;
      }

      const response = await fetch('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: {
            url: image.url || '',
            b64_json: image.b64_json || '',
            mime: image.imageMime || 'image/png',
          },
          prompt: image.prompt || image.form?.prompt || form.prompt,
          revised_prompt: image.revised_prompt || '',
          form: image.form || form,
          params: image.form || form,
          jobId: image.jobId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '上墙失败');

      const nextWallItem = data.item;
      setWallItems((items) => [nextWallItem, ...items.filter((item) => Number(item.id) !== Number(nextWallItem.id))]);
      setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, wallItemId: nextWallItem.id, isOnWall: true } : item)));
      setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: nextWallItem.id, isOnWall: true } : current));
    } catch (wallError) {
      setError(wallError instanceof Error ? wallError.message : '作品墙操作失败');
    } finally {
      setWallBusyId('');
    }
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const response = await fetch(`/api/auth/${authMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '账号操作失败');

      setUser(data.user || null);
      applySettings(data.settings || null);
      setAuthForm(emptyAuthForm);
      setActiveDialog(null);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '账号操作失败');
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setSettingsMeta(null);
    setSettingsApiKey('');
  };

  const saveAccountSettings = async () => {
    if (!user) {
      setAuthMode('login');
      setActiveDialog('auth');
      setError('登录后才能保存个人配置。');
      return;
    }

    const apiKey = settingsApiKey.trim();
    if (apiKey && !window.confirm('API Key 会加密保存到服务端数据库。确认保存？')) return;

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: form,
          apiKey,
          confirmApiKeySave: Boolean(apiKey),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存配置失败');

      setSettingsApiKey('');
      applySettings(data.settings || null);
      setError('');
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : '保存配置失败');
    }
  };

  const reuseConfig = (image) => {
    if (image?.form) setForm({ ...defaultForm, ...image.form });
    setView('generate');
    closeDialog();
  };

  const detailParams = selectedImage?.form || form;
  const detailSrc = createImageSrc(selectedImage);
  const selectedWallItem = findWallItem(selectedImage);
  const selectedOnWall = Boolean(selectedWallItem);
  const busySelected = selectedImage && wallBusyId === String(selectedImage.jobId || selectedImage.wallItemId || selectedImage.id || createImageSrc(selectedImage));

  const renderImageCard = (image) => {
    const src = createImageSrc(image);
    const wallItem = findWallItem(image);
    const onWall = Boolean(wallItem);
    const busyId = String(image.jobId || image.wallItemId || image.id || src);

    return (
      <figure className={onWall ? 'result-card is-on-wall' : 'result-card'} key={`${image.source || 'image'}-${image.id || image.wallItemId || image.jobId || src}`} onClick={() => openDetail(image)}>
        <div className="result-image-wrap">
          <img src={src} alt={image.revised_prompt || image.prompt || image.form?.prompt || '生成图片'} />
          <button
            type="button"
            className={onWall ? 'wall-icon is-active' : 'wall-icon'}
            onClick={(event) => {
              event.stopPropagation();
              toggleWall(image);
            }}
            disabled={wallBusyId === busyId}
            aria-label={onWall ? '取消上墙' : '上墙'}
          >
            {onWall ? '★' : '☆'}
          </button>
        </div>
        <figcaption>
          <span>{image.revised_prompt || image.prompt || image.form?.prompt || 'Generated image'}</span>
          <a href={src} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            下载
          </a>
        </figcaption>
        {image.authorName ? <small className="author-line">{image.authorName}</small> : null}
      </figure>
    );
  };

  return (
    <main className="playground-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="GPT Biubiubiu">
          <span className="brand-orb" />
          <span>GPT Image Playground</span>
        </a>

        <nav className="mode-tabs" aria-label="工作台模式">
          <button type="button" className={view === 'generate' ? 'is-active' : ''} onClick={() => setView('generate')}>
            生图
          </button>
          <button
            type="button"
            className={view === 'wall' ? 'is-active' : ''}
            onClick={() => {
              setView('wall');
              loadWall();
            }}
          >
            作品墙
          </button>
        </nav>

        <div className="topbar-actions">
          <span className={`status-pill ${status.configured ? 'is-ready' : 'is-warning'}`}>{status.message}</span>
          <button type="button" className="round-tool account-tool" onClick={() => setActiveDialog('auth')} aria-label="账号">
            {user ? user.username.slice(0, 1).toUpperCase() : '登'}
          </button>
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
          <button type="button" className={view === 'generate' ? 'soft-chip is-active' : 'soft-chip'} onClick={() => setView('generate')}>
            生成区
          </button>
          <button type="button" className={referenceImage ? 'soft-chip is-active' : 'soft-chip'} onClick={() => setView('generate')}>
            {referenceImage ? '图生图' : '文生图'}
          </button>
          <button type="button" className={view === 'wall' ? 'soft-chip is-active' : 'soft-chip'} onClick={() => { setView('wall'); loadWall(); }}>
            作品墙
          </button>
        </div>

        <div className={boardItems.length ? 'image-board has-images' : 'image-board'}>
          {boardItems.length ? (
            boardItems.filter(createImageSrc).map(renderImageCard)
          ) : (
            <div className="empty-canvas">
              <span className="empty-mark">+</span>
              <h1>{view === 'wall' ? 'No works on the wall yet' : 'What do you want to create?'}</h1>
              <p>{view === 'wall' ? '生成图片后点击星标即可上墙，未登录会显示为未知艺术家。' : '底部工作台输入提示词，可直接文生图，也可以上传参考图进入图生图。'}</p>
            </div>
          )}
        </div>
      </section>

      {view === 'generate' ? (
        <form className="bottom-workbench" onSubmit={generate}>
          <div className="prompt-console">
            <textarea
              value={form.prompt}
              onChange={(event) => updateForm('prompt', event.target.value)}
              placeholder="描述你想生成的图片，可输入 @ 来指定参考图..."
              rows={2}
            />

            <div className="workbench-actions">
              <button type="button" className="tool-pill" onClick={openSizeDialog}>
                <span>尺寸</span>
                <strong>{form.size || '自动'}</strong>
              </button>

              <label className="control-field">
                <span>质量</span>
                <select value={form.quality} onChange={(event) => updateForm('quality', event.target.value)}>
                  {qualityOptions.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
                </select>
              </label>

              <label className="control-field">
                <span>格式</span>
                <select value={form.output_format} onChange={(event) => updateForm('output_format', event.target.value)}>
                  {outputFormatOptions.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                </select>
              </label>

              <label className="control-field">
                <span>压缩率</span>
                <input min="0" max="100" type="number" value={form.output_compression} onChange={(event) => updateForm('output_compression', event.target.value)} placeholder="0-100" />
              </label>

              <label className="control-field">
                <span>审核</span>
                <select value={form.moderation} onChange={(event) => updateForm('moderation', event.target.value)}>
                  {moderationOptions.map((moderation) => <option key={moderation} value={moderation}>{moderation}</option>)}
                </select>
              </label>

              <label className="control-field count-field">
                <span>数量</span>
                <input min="1" max="4" type="number" value={form.n} onChange={(event) => updateForm('n', event.target.value)} />
              </label>

              <label className={referenceImage ? 'reference-uploader has-file' : 'reference-uploader'} title={referenceImage?.name || '上传参考图'}>
                <input type="file" accept="image/*" onChange={handleReferenceChange} />
                <span>{referenceImage ? '已附图' : '附图'}</span>
              </label>

              <button type="submit" className="send-button" disabled={status.loading} aria-label="生成图片">
                {status.loading ? '...' : '→'}
              </button>
            </div>

            {referenceImage ? (
              <div className="reference-preview">
                <img src={referenceImage.previewUrl} alt="参考图" />
                <span>{referenceImage.name}</span>
                <button type="button" className="text-button" onClick={clearReference}>移除参考图</button>
              </div>
            ) : null}
          </div>

          {error ? <div className="error-toast">{error}</div> : null}
        </form>
      ) : null}

      {activeDialog ? (
        <div className="modal-layer" role="presentation">
          <button type="button" className="modal-backdrop" aria-label="关闭弹窗" onClick={closeDialog} />

          {activeDialog === 'detail' && selectedImage ? (
            <section className="modal-card image-detail-modal" role="dialog" aria-modal="true" aria-label="图片详情">
              <div className="detail-preview">
                <div className="detail-badges">
                  <span>{detailParams.size || '自动'}</span>
                  <span>{detailParams.output_format || detailParams.response_format || 'png'}</span>
                </div>
                <img src={detailSrc} alt={selectedImage.revised_prompt || selectedImage.prompt || '图片详情'} />
              </div>

              <div className="detail-panel">
                <div className="modal-head">
                  <div>
                    <h2>图片详情</h2>
                    <p>{selectedImage.authorName || (selectedOnWall ? '已上墙' : '本地生成')}</p>
                  </div>
                  <button type="button" className="close-button" onClick={closeDialog}>×</button>
                </div>

                <div className="prompt-detail">
                  <span>输入内容</span>
                  <p>{selectedImage.revised_prompt || selectedImage.prompt || detailParams.prompt || '无提示词'}</p>
                </div>

                <div className="detail-meta-grid">
                  <div><span>来源</span><strong>{selectedImage.source === 'edit' ? '图生图' : selectedImage.source === 'wall' ? '作品墙' : '文生图'}</strong></div>
                  <div><span>尺寸</span><strong>{detailParams.size || '自动'}</strong></div>
                  <div><span>质量</span><strong>{detailParams.quality || 'auto'}</strong></div>
                  <div><span>格式</span><strong>{detailParams.output_format || detailParams.response_format || 'png'}</strong></div>
                  <div><span>审核</span><strong>{detailParams.moderation || 'auto'}</strong></div>
                  <div><span>数量</span><strong>{detailParams.n || 1}</strong></div>
                </div>

                <p className="created-line">创建于 {formatDate(selectedImage.createdAt)}</p>

                <div className="detail-actions">
                  <a className="secondary-action" href={detailSrc} download="gpt-biubiubiu.png" target="_blank" rel="noreferrer">下载</a>
                  <button type="button" className="secondary-action" onClick={() => reuseConfig(selectedImage)}>复用配置</button>
                  <button type="button" className={selectedOnWall ? 'primary-action wall-button is-active' : 'primary-action wall-button'} onClick={() => toggleWall(selectedImage)} disabled={busySelected}>
                    {selectedOnWall ? '★ 取消上墙' : '☆ 上墙'}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeDialog === 'auth' ? (
            <section className="modal-card compact-modal" role="dialog" aria-modal="true" aria-label="账号">
              <div className="modal-head">
                <div>
                  <h2>{user ? '账号信息' : authMode === 'login' ? '登录' : '注册'}</h2>
                  <p>{user ? '登录用户可保存个人配置和 API Key' : '登录后可保存配置，上墙作品显示用户名'}</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
              </div>

              {user ? (
                <div className="account-panel">
                  <div className="summary-box">
                    <span>当前用户</span>
                    <strong>{user.username}</strong>
                  </div>
                  <div className="summary-box">
                    <span>API Key</span>
                    <strong>{settingsMeta?.hasApiKey ? settingsMeta.apiKeyHint || '已保存' : '未保存'}</strong>
                  </div>
                  <button type="button" className="secondary-action" onClick={logout}>退出登录</button>
                </div>
              ) : (
                <form className="auth-form" onSubmit={submitAuth}>
                  <div className="segmented-control two-tabs">
                    <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>登录</button>
                    <button type="button" className={authMode === 'register' ? 'is-active' : ''} onClick={() => setAuthMode('register')}>注册</button>
                  </div>
                  <label>
                    <span>用户名</span>
                    <input value={authForm.username} onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))} placeholder="3-30 位" />
                  </label>
                  <label>
                    <span>密码</span>
                    <input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 6 位" />
                  </label>
                  <button type="submit" className="primary-action">{authMode === 'login' ? '登录' : '注册'}</button>
                </form>
              )}
            </section>
          ) : null}

          {activeDialog === 'size' ? (
            <section className="modal-card size-modal" role="dialog" aria-modal="true" aria-label="设置图像尺寸">
              <div className="modal-head">
                <div>
                  <h2>设置图像尺寸</h2>
                  <p>当前：{displaySize}</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
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
                      <p>不向模型传递具体的分辨率参数，由模型或上游接口自行决定生成尺寸。</p>
                    </div>
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
                          onClick={() => setSizeDraft((draft) => {
                            const nextRatios = getAvailableRatios(item.value);
                            const nextRatio = draft.ratio === 'custom-ratio' || ratioToSize[item.value]?.[draft.ratio] ? draft.ratio : nextRatios[0]?.value || '1:1';
                            return { ...draft, resolution: item.value, ratio: nextRatio };
                          })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="modal-section">
                    <span className="section-label">图像比例</span>
                    <div className="ratio-grid">
                      {availableRatios.filter((item) => item.value !== 'custom-ratio').map((item) => (
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
                    <button
                      type="button"
                      className={sizeDraft.ratio === 'custom-ratio' ? 'custom-ratio-button is-active' : 'custom-ratio-button'}
                      onClick={() => setSizeDraft((draft) => ({ ...draft, ratio: 'custom-ratio' }))}
                    >
                      自定义比例
                    </button>
                  </div>

                  {sizeDraft.ratio === 'custom-ratio' ? (
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
                  <div className="size-limit-note">
                    <strong>由于模型限制，最终输出会自动规整到合法尺寸：</strong>
                    <span>宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。</span>
                  </div>
                </div>
              ) : null}

              <div className="summary-box">
                <span>评估图</span>
                <strong>{displaySize}</strong>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={closeDialog}>取消</button>
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
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
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
                  <p>质量、风格、数量、格式、审核和账号配置</p>
                </div>
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
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
                <label>
                  <span>{fieldLabel.output_format}</span>
                  <select value={form.output_format} onChange={(event) => updateForm('output_format', event.target.value)}>
                    {outputFormatOptions.map((format) => <option key={format} value={format}>{format}</option>)}
                  </select>
                </label>
                <label>
                  <span>{fieldLabel.moderation}</span>
                  <select value={form.moderation} onChange={(event) => updateForm('moderation', event.target.value)}>
                    {moderationOptions.map((moderation) => <option key={moderation} value={moderation}>{moderation}</option>)}
                  </select>
                </label>
                <label className="full-field">
                  <span>反向提示词</span>
                  <textarea value={form.negative_prompt} onChange={(event) => updateForm('negative_prompt', event.target.value)} placeholder="不想出现的元素，可留空" rows={3} />
                </label>
                <label className="full-field">
                  <span>保存到账号的 API Key</span>
                  <input value={settingsApiKey} onChange={(event) => setSettingsApiKey(event.target.value)} placeholder={settingsMeta?.hasApiKey ? `已保存：${settingsMeta.apiKeyHint}` : '可选，保存前会再次确认'} />
                </label>
              </div>

              <div className="modal-actions three-actions">
                <button type="button" className="secondary-action" onClick={() => setForm(defaultForm)}>重置</button>
                <button type="button" className="secondary-action" onClick={saveAccountSettings}>保存配置</button>
                <button type="button" className="primary-action" onClick={closeDialog}>完成</button>
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
                <button type="button" className="close-button" onClick={closeDialog}>×</button>
              </div>

              <div className="history-list modal-history-list">
                {history.length ? (
                  history.map((item) => (
                    <button type="button" className="history-item" key={item.id} onClick={() => selectHistory(item)}>
                      <span>{item.form.prompt}</span>
                      <small>{item.form.size || '自动'} · {formatDate(item.createdAt)}</small>
                    </button>
                  ))
                ) : (
                  <div className="empty-history">暂无生成记录</div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={clearHistory} disabled={!history.length}>清空</button>
                <button type="button" className="primary-action" onClick={closeDialog}>完成</button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export default App;