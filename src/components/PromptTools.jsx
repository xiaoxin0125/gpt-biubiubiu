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

const PromptTextarea = ({ label, value, onChange, rows, placeholder, className = '' }) => (
  <label className={className}>
    <span>{label}</span>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} />
  </label>
);

const RuleControls = ({
  renderSelect,
  idPrefix,
  ruleLabel,
  rule,
  onRuleChange,
  ruleOptions,
  language,
  onLanguageChange,
}) => (
  <div className="prompt-tool-select-row">
    {renderSelect({
      id: `${idPrefix}-rule-select`,
      label: ruleLabel,
      value: rule,
      options: ruleOptions,
      onChange: onRuleChange,
      className: 'prompt-tool-select',
      menuDirection: 'up',
    })}

    {renderSelect({
      id: `${idPrefix}-language-select`,
      label: '输出语言',
      value: language,
      options: promptToolLanguageOptions,
      onChange: onLanguageChange,
      className: 'prompt-tool-select',
      menuDirection: 'up',
    })}
  </div>
);

const RequirementFields = ({
  extraPrompt,
  onExtraPromptChange,
  extraPlaceholder,
  customRule,
  onCustomRuleChange,
  customPlaceholder,
}) => (
  <>
    <PromptTextarea
      label="额外要求"
      value={extraPrompt}
      onChange={onExtraPromptChange}
      rows={3}
      placeholder={extraPlaceholder}
    />
    <PromptTextarea
      label="自定义规则"
      value={customRule}
      onChange={onCustomRuleChange}
      rows={3}
      placeholder={customPlaceholder}
    />
  </>
);

const ToolCard = ({ title, description, mainLabel, inputSlot, ruleSlot, controlsSlot, actionSlot, resultLabel, result, onResultChange, resultActions }) => (
  <section className="prompt-tool-card api-config-card">
    <div className="api-config-card-head">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>

    <div className="prompt-tool-body">
      <div className="prompt-tool-primary">
        <div className="prompt-tool-main">
          <span className="prompt-tool-main-title">{mainLabel}</span>
          {inputSlot}
        </div>
        <div className="prompt-tool-rule">{ruleSlot}</div>
      </div>
      <div className="prompt-tool-controls">
        {controlsSlot}
        <div className="prompt-tool-actions">{actionSlot}</div>
      </div>
      <div className="prompt-result-panel">
        <span>{resultLabel}</span>
        <textarea value={result} onChange={(event) => onResultChange(event.target.value)} rows={8} placeholder="结果会显示在这里" />
        {resultActions}
      </div>
    </div>
  </section>
);

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
  const [captionExtraPrompt, setCaptionExtraPrompt] = useState('');
  const [captionCustomRule, setCaptionCustomRule] = useState('');
  const [captionResult, setCaptionResult] = useState('');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [optimizeInput, setOptimizeInput] = useState('');
  const [optimizeRule, setOptimizeRule] = useState(promptOptimizeRules[0].value);
  const [optimizeLanguage, setOptimizeLanguage] = useState(promptToolLanguageOptions[0].value);
  const [optimizeExtraPrompt, setOptimizeExtraPrompt] = useState('');
  const [optimizeCustomRule, setOptimizeCustomRule] = useState('');
  const [optimizeResult, setOptimizeResult] = useState('');
  const [optimizeLoading, setOptimizeLoading] = useState(false);

  const enabled = siteFlags?.promptToolsEnabled !== false;

  useEffect(() => () => {
    if (captionPreview) URL.revokeObjectURL(captionPreview);
  }, [captionPreview]);

  const ensureReady = () => {
    if (!user) {
      setError('请先登录后再使用提示词助手。');
      return false;
    }
    if (!enabled) {
      setError('提示词助手已关闭。');
      return false;
    }
    return true;
  };

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
    setCaptionExtraPrompt('');
    setCaptionCustomRule('');
    setCaptionResult('');
  };

  const clearOptimize = () => {
    setOptimizeInput('');
    setOptimizeExtraPrompt('');
    setOptimizeCustomRule('');
    setOptimizeResult('');
  };

  const runCaption = async () => {
    if (!ensureReady()) return;
    if (!captionFile) {
      setError('请先上传一张图片。');
      return;
    }

    const payload = new FormData();
    payload.append('image', captionFile);
    payload.append('rule', captionRule);
    payload.append('outputLanguage', captionLanguage);
    payload.append('extraPrompt', captionExtraPrompt);
    payload.append('customRule', captionCustomRule);

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
    if (!ensureReady()) return;
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
        extraPrompt: optimizeExtraPrompt,
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

  const promptTools = [
    {
      key: 'caption',
      title: '图片反推提示词',
      description: '上传图片，提取可直接复用的生图提示词。',
      mainLabel: '上传图片',
      inputSlot: (
        <label className={captionPreview ? 'tool-upload-zone has-image' : 'tool-upload-zone'}>
          <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={selectImage} />
          {captionPreview ? (
            <img src={captionPreview} alt="反推预览" />
          ) : (
            <span>点击上传图片</span>
          )}
        </label>
      ),
      ruleSlot: (
        <RuleControls
          renderSelect={renderSelect}
          idPrefix="caption"
          ruleLabel="反推规则"
          rule={captionRule}
          onRuleChange={setCaptionRule}
          ruleOptions={imageCaptionRules}
          language={captionLanguage}
          onLanguageChange={setCaptionLanguage}
        />
      ),
      controlsSlot: (
        <RequirementFields
          extraPrompt={captionExtraPrompt}
          onExtraPromptChange={setCaptionExtraPrompt}
          extraPlaceholder="例如：更偏摄影感、强调主体细节、保留服装颜色"
          customRule={captionCustomRule}
          onCustomRuleChange={setCaptionCustomRule}
          customPlaceholder="留空则使用预设规则"
        />
      ),
      actionSlot: (
        <>
          <button type="button" className="primary-action" onClick={runCaption} disabled={captionLoading || !captionFile || !user}>{captionLoading ? '反推中' : '开始反推'}</button>
          <button type="button" className="secondary-action" onClick={clearCaption}>清空图片</button>
        </>
      ),
      resultLabel: '反推结果',
      result: captionResult,
      onResultChange: setCaptionResult,
      resultActions: resultActions(captionResult, () => setCaptionResult('')),
    },
    {
      key: 'optimize',
      title: '提示词优化 / 润色',
      description: '输入原提示词，扩写、润色或转换成 Tags 风格。',
      mainLabel: '原始提示词',
      inputSlot: (
        <textarea
          className="prompt-tool-main-textarea"
          value={optimizeInput}
          onChange={(event) => setOptimizeInput(event.target.value)}
          rows={10}
          placeholder="输入需要优化的提示词"
        />
      ),
      ruleSlot: (
        <RuleControls
          renderSelect={renderSelect}
          idPrefix="optimize"
          ruleLabel="优化规则"
          rule={optimizeRule}
          onRuleChange={setOptimizeRule}
          ruleOptions={promptOptimizeRules}
          language={optimizeLanguage}
          onLanguageChange={setOptimizeLanguage}
        />
      ),
      controlsSlot: (
        <RequirementFields
          extraPrompt={optimizeExtraPrompt}
          onExtraPromptChange={setOptimizeExtraPrompt}
          extraPlaceholder="例如：更短、更写实、保留原关键词、不要人物"
          customRule={optimizeCustomRule}
          onCustomRuleChange={setOptimizeCustomRule}
          customPlaceholder="留空则使用预设规则"
        />
      ),
      actionSlot: (
        <>
          <button type="button" className="primary-action" onClick={runOptimize} disabled={optimizeLoading || !optimizeInput.trim() || !user}>{optimizeLoading ? '优化中' : '开始优化'}</button>
          <button type="button" className="secondary-action" onClick={clearOptimize}>清空文本</button>
        </>
      ),
      resultLabel: '优化结果',
      result: optimizeResult,
      onResultChange: setOptimizeResult,
      resultActions: resultActions(optimizeResult, () => setOptimizeResult('')),
    },
  ];

  return (
    <section className="prompt-tools-page">
      <div className="prompt-tools-grid">
        {promptTools.map(({ key, ...tool }) => (
          <ToolCard key={key} {...tool} />
        ))}
      </div>
    </section>
  );
}