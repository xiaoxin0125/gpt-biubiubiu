import { useEffect, useState } from 'react';
import { imageCaptionRules, promptOptimizeRules, promptToolLanguageOptions } from '../constants/options';
import { requestImageCaption, requestPromptOptimize } from '../lib/api';

const copyText = async (text) => {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

export default function PromptTools({
  user,
  siteFlags,
  renderSelect,
  setView,
  updateForm,
  setError,
}) {
  const [captionFile, setCaptionFile] = useState(null);
  const [captionPreview, setCaptionPreview] = useState('');
  const [captionRule, setCaptionRule] = useState(imageCaptionRules[0].value);
  const [captionLanguage, setCaptionLanguage] = useState(promptToolLanguageOptions[0].value);
  const [captionCustomRule, setCaptionCustomRule] = useState('');
  const [captionExtraPrompt, setCaptionExtraPrompt] = useState('');
  const [captionResult, setCaptionResult] = useState('');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [optimizeInput, setOptimizeInput] = useState('');
  const [optimizeRule, setOptimizeRule] = useState(promptOptimizeRules[0].value);
  const [optimizeLanguage, setOptimizeLanguage] = useState(promptToolLanguageOptions[0].value);
  const [optimizeCustomRule, setOptimizeCustomRule] = useState('');
  const [optimizeResult, setOptimizeResult] = useState('');
  const [optimizeLoading, setOptimizeLoading] = useState(false);

  const enabled = siteFlags?.promptToolsEnabled !== false;

  useEffect(() => () => {
    if (captionPreview) URL.revokeObjectURL(captionPreview);
  }, [captionPreview]);

  const selectImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件。');
      event.target.value = '';
      return;
    }
    if (captionPreview) URL.revokeObjectURL(captionPreview);
    setCaptionFile(file);
    setCaptionPreview(URL.createObjectURL(file));
    setCaptionResult('');
    event.target.value = '';
  };

  const clearCaption = () => {
    if (captionPreview) URL.revokeObjectURL(captionPreview);
    setCaptionFile(null);
    setCaptionPreview('');
    setCaptionResult('');
    setCaptionExtraPrompt('');
    setCaptionCustomRule('');
  };

  const runCaption = async () => {
    if (!user) {
      setError('请先登录后再使用提示词助手。');
      return;
    }
    if (!enabled) {
      setError('提示词助手已关闭。');
      return;
    }
    if (!captionFile) {
      setError('请先上传一张图片。');
      return;
    }

    const payload = new FormData();
    payload.append('image', captionFile);
    payload.append('rule', captionRule);
    payload.append('outputLanguage', captionLanguage);
    payload.append('customRule', captionCustomRule);
    payload.append('extraPrompt', captionExtraPrompt);

    setCaptionLoading(true);
    setError('');
    try {
      const data = await requestImageCaption(payload);
      setCaptionResult(String(data.result || '').trim());
    } catch (captionError) {
      setError(captionError instanceof Error ? captionError.message : '图片反推失败');
    } finally {
      setCaptionLoading(false);
    }
  };

  const runOptimize = async () => {
    if (!user) {
      setError('请先登录后再使用提示词助手。');
      return;
    }
    if (!enabled) {
      setError('提示词助手已关闭。');
      return;
    }
    if (!optimizeInput.trim()) {
      setError('请输入需要优化的提示词。');
      return;
    }

    setOptimizeLoading(true);
    setError('');
    try {
      const data = await requestPromptOptimize({
        prompt: optimizeInput,
        rule: optimizeRule,
        outputLanguage: optimizeLanguage,
        customRule: optimizeCustomRule,
      });
      setOptimizeResult(String(data.result || '').trim());
    } catch (optimizeError) {
      setError(optimizeError instanceof Error ? optimizeError.message : '提示词优化失败');
    } finally {
      setOptimizeLoading(false);
    }
  };

  const useAsPrompt = (text) => {
    if (!text) return;
    updateForm('prompt', text);
    setView('generate');
  };

  const resultActions = (result, clear) => (
    <div className="prompt-result-actions">
      <button type="button" className="secondary-action" onClick={() => copyText(result)} disabled={!result}>复制</button>
      <button type="button" className="secondary-action" onClick={() => useAsPrompt(result)} disabled={!result}>填入生图</button>
      <button type="button" className="secondary-action" onClick={clear} disabled={!result}>清空</button>
    </div>
  );

  if (!enabled) {
    return (
      <section className="prompt-tools-page is-disabled">
        <div className="prompt-tools-empty api-config-card">
          <strong>提示词助手已关闭</strong>
          <span>管理员关闭了图片反推和提示词优化入口。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="prompt-tools-page">
      <div className="prompt-tools-grid">
        <section className="prompt-tool-card api-config-card">
          <div className="api-config-card-head">
            <div>
              <strong>图片反推提示词</strong>
              <span>上传图片，使用视觉模型提取可复用提示词。</span>
            </div>
          </div>

          <div className="prompt-tool-fields">
            <label className={captionPreview ? 'tool-upload-zone has-image' : 'tool-upload-zone'}>
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={selectImage} />
              {captionPreview ? (
                <img src={captionPreview} alt="反推预览" />
              ) : (
                <span>点击上传图片</span>
              )}
            </label>

            <div className="prompt-tool-select-row">
              {renderSelect({
                id: 'caption-rule-select',
                label: '反推规则',
                value: captionRule,
                options: imageCaptionRules,
                onChange: setCaptionRule,
                className: 'prompt-tool-select',
                menuDirection: 'down',
              })}

              {renderSelect({
                id: 'caption-language-select',
                label: '输出语言',
                value: captionLanguage,
                options: promptToolLanguageOptions,
                onChange: setCaptionLanguage,
                className: 'prompt-tool-select',
                menuDirection: 'down',
              })}
            </div>

            <label>
              <span>额外要求</span>
              <textarea value={captionExtraPrompt} onChange={(event) => setCaptionExtraPrompt(event.target.value)} rows={3} placeholder="例如：更偏摄影感、输出英文、强调主体细节" />
            </label>
            <label>
              <span>自定义规则</span>
              <textarea value={captionCustomRule} onChange={(event) => setCaptionCustomRule(event.target.value)} rows={3} placeholder="留空则使用预设规则" />
            </label>
          </div>

          <div className="prompt-tool-actions">
            <button type="button" className="primary-action" onClick={runCaption} disabled={captionLoading || !captionFile || !user}>{captionLoading ? '反推中' : '开始反推'}</button>
            <button type="button" className="secondary-action" onClick={clearCaption}>清空图片</button>
          </div>

          <div className="prompt-result-panel">
            <span>反推结果</span>
            <textarea value={captionResult} onChange={(event) => setCaptionResult(event.target.value)} rows={8} placeholder="结果会显示在这里" />
            {resultActions(captionResult, () => setCaptionResult(''))}
          </div>
        </section>

        <section className="prompt-tool-card api-config-card">
          <div className="api-config-card-head">
            <div>
              <strong>提示词优化 / 润色</strong>
              <span>输入原提示词，使用文本模型扩写、润色或转换成 Tags 风格。</span>
            </div>
          </div>

          <div className="prompt-tool-fields">
            <label>
              <span>原始提示词</span>
              <textarea value={optimizeInput} onChange={(event) => setOptimizeInput(event.target.value)} rows={7} placeholder="输入需要优化的提示词" />
            </label>

            <div className="prompt-tool-select-row">
              {renderSelect({
                id: 'optimize-rule-select',
                label: '优化规则',
                value: optimizeRule,
                options: promptOptimizeRules,
                onChange: setOptimizeRule,
                className: 'prompt-tool-select',
                menuDirection: 'down',
              })}

              {renderSelect({
                id: 'optimize-language-select',
                label: '输出语言',
                value: optimizeLanguage,
                options: promptToolLanguageOptions,
                onChange: setOptimizeLanguage,
                className: 'prompt-tool-select',
                menuDirection: 'down',
              })}
            </div>

            <label>
              <span>自定义规则</span>
              <textarea value={optimizeCustomRule} onChange={(event) => setOptimizeCustomRule(event.target.value)} rows={3} placeholder="例如：更写实、保留中文、减少风格词" />
            </label>
          </div>

          <div className="prompt-tool-actions">
            <button type="button" className="primary-action" onClick={runOptimize} disabled={optimizeLoading || !optimizeInput.trim() || !user}>{optimizeLoading ? '优化中' : '开始优化'}</button>
            <button type="button" className="secondary-action" onClick={() => { setOptimizeInput(''); setOptimizeResult(''); setOptimizeCustomRule(''); }}>清空文本</button>
          </div>

          <div className="prompt-result-panel">
            <span>优化结果</span>
            <textarea value={optimizeResult} onChange={(event) => setOptimizeResult(event.target.value)} rows={8} placeholder="结果会显示在这里" />
            {resultActions(optimizeResult, () => setOptimizeResult(''))}
          </div>
        </section>
      </div>
    </section>
  );
}