const apiCategorySections = [
  {
    key: 'imageApi',
    title: '生图 API 参数',
    description: '用于文生图、图生图和编辑生成。',
    modelLabel: '生图模型 ID',
    modelPlaceholder: 'gpt-image-2',
    namePlaceholder: 'OpenAI gpt-image-2',
  },
  {
    key: 'promptApi',
    title: '提示词助手 API 参数',
    description: '用于提示词优化、图片反推和视觉理解。',
    modelLabel: '提示词助手模型 ID',
    modelPlaceholder: '例如 gpt-4o-mini',
    namePlaceholder: '提示词助手 API',
  },
  {
    key: 'agnesApi',
    title: 'Agnes API 参数',
    description: '用于 Agnes 生图和视频生成。',
    modelLabel: 'Agnes 默认模型 ID',
    modelPlaceholder: 'agnes-image-2.1-flash',
    namePlaceholder: 'Agnes API',
  },
];

export const userApiCategorySections = apiCategorySections;

export const sharedApiCategorySections = apiCategorySections.map((section) => ({
  ...section,
  title: section.title.replace(/^/, '共享'),
  description: section.description.replace('用于', '提供给'),
  namePlaceholder: section.key === 'imageApi' ? '共享生图 API' : section.key === 'promptApi' ? '共享提示词助手 API' : '共享 Agnes API',
}));

export const applyApiCategoryUpdate = (source, categoryKey, field, value) => {
  const nextCategory = { ...(source[categoryKey] || {}), [field]: value };
  const nextSource = { ...source, [categoryKey]: nextCategory };

  if (categoryKey === 'imageApi') {
    return {
      ...nextSource,
      apiName: nextCategory.apiName,
      apiBaseUrl: nextCategory.apiBaseUrl,
      model: nextCategory.model,
      apiKey: nextCategory.apiKey,
      hasApiKey: nextCategory.hasApiKey,
      apiKeyHint: nextCategory.apiKeyHint,
      requestTimeout: nextCategory.requestTimeout,
    };
  }

  if (categoryKey === 'promptApi') return { ...nextSource, promptModel: nextCategory.model };
  if (categoryKey === 'agnesApi') return { ...nextSource, agnesModel: nextCategory.model };
  return nextSource;
};

export default function ApiCategoryEditor({
  sections,
  configId,
  source,
  onUpdateCategory,
  fetchApiModels,
  apiModelOptionsByConfigId,
  apiModelLoadingByConfigId,
  renderSelect,
  clearKeyLabel = '清除已保存的 Key',
}) {
  const normalizedConfigId = String(configId || 'shared');
  const modelOptionsFor = (categoryKey, currentModel) => {
    const key = `${normalizedConfigId}:${categoryKey}`;
    const options = apiModelOptionsByConfigId[key] || [];
    return options.length ? options : [{ label: currentModel || '暂无模型', value: currentModel || '' }];
  };
  const isModelLoading = (categoryKey) => Boolean(apiModelLoadingByConfigId[`${normalizedConfigId}:${categoryKey}`]);

  return (
    <div className="api-category-stack">
      {sections.map((section) => {
        const category = source[section.key] || {};
        const options = modelOptionsFor(section.key, category.model || '');
        const loading = isModelLoading(section.key);
        return (
          <section className="api-category-card" key={section.key}>
            <div className="api-category-head">
              <div>
                <strong>{section.title}</strong>
                <span>{section.description}</span>
              </div>
            </div>
            <div className="api-config-fields api-config-fields-ordered">
              <label>
                <span>API 名称</span>
                <input value={category.apiName || ''} onChange={(event) => onUpdateCategory(section.key, 'apiName', event.target.value)} placeholder={section.namePlaceholder} />
              </label>
              <label>
                <span>{section.modelLabel}</span>
                <input value={category.model || ''} onChange={(event) => onUpdateCategory(section.key, 'model', event.target.value)} placeholder={section.modelPlaceholder} />
              </label>
              <div className="model-picker-field full-field">
                <span>模型列表</span>
                <div className="model-picker-row single-model-picker-row">
                  {renderSelect({
                    id: `${normalizedConfigId}-${section.key}-model-select`,
                    label: '',
                    value: category.model || '',
                    options,
                    onChange: (value) => onUpdateCategory(section.key, 'model', value),
                    disabled: !options.length || !options[0]?.value,
                    className: 'settings-select-field model-select-field',
                    menuDirection: 'down',
                  })}
                </div>
              </div>
              <label>
                <span>API 地址</span>
                <input value={category.apiBaseUrl || ''} onChange={(event) => onUpdateCategory(section.key, 'apiBaseUrl', event.target.value)} placeholder="https://api.openai.com" />
              </label>
              <div className="model-fetch-field">
                <button type="button" className="secondary-action model-fetch-button" onClick={() => fetchApiModels(normalizedConfigId, section.key)} disabled={loading}>
                  {loading ? '获取中' : '获取模型'}
                </button>
              </div>
              <label className="full-field">
                <span>密钥设置</span>
                <input type="password" value={category.apiKey || ''} onChange={(event) => onUpdateCategory(section.key, 'apiKey', event.target.value)} placeholder={category.hasApiKey ? `已保存：${category.apiKeyHint || '********'}，留空则不修改` : 'sk-...'} autoComplete="off" />
              </label>
              {category.hasApiKey ? (
                <label className="toggle-row full-field compact-toggle-row">
                  <input type="checkbox" checked={Boolean(category.clearApiKey)} onChange={(event) => onUpdateCategory(section.key, 'clearApiKey', event.target.checked)} />
                  <span>{clearKeyLabel}</span>
                </label>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}