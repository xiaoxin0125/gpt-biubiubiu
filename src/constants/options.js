export const HISTORY_KEY = 'gpt-biubiubiu:image-history';
export const DEFAULT_DIRECT_API_BASE_URL = 'https://api.openai.com';
export const MAX_REFERENCE_IMAGES = 16;
export const MAX_REQUEST_TIMEOUT_SECONDS = 999;
export const MAX_MASK_SIZE_BYTES = 4 * 1024 * 1024;
export const BOARD_PAGE_SIZE = 20;
export const BOARD_LOAD_DELAY_MS = 280;
export const MASONRY_CARD_TEXT_HEIGHT_RATIO = 0.22;
export const MASONRY_CARD_GAP_RATIO = 0.08;
export const MAX_OUTPUT_IMAGES = 10;

export const SHARED_API_CONFIG_ID = 'shared';

export const defaultSiteFlags = {
  wallRequireLogin: false,
  registrationEnabled: true,
  sharedApiEnabled: true,
  promptToolsEnabled: true,
};

export const promptOptimizeRules = [
  { label: '扩写-通用', value: 'general' },
  { label: '扩写-Tags风格', value: 'tags' },
  { label: 'Qwen-Image-Edit指令优化', value: 'qwen-edit' },
  { label: 'Kontext指令优化并翻译', value: 'kontext' },
];

export const imageCaptionRules = [
  { label: '反推-自然语言', value: 'natural' },
  { label: '反推-Tags风格', value: 'tags' },
  { label: '反推-编辑指令', value: 'edit' },
];

export const qualityOptions = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
];

export const outputFormatOptions = ['png', 'jpeg', 'webp'];

export const responseFormatOptions = [
  { label: 'URL', value: 'url' },
  { label: 'Base64', value: 'b64_json' },
];

export const backgroundOptions = ['auto', 'opaque'];
export const moderationOptions = ['auto', 'low'];

export const boardScopeOptions = [
  { label: '全部作品', value: 'all' },
  { label: '本次生成', value: 'generate' },
  { label: '历史记录', value: 'history' },
];

export const boardFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已上墙', value: 'on-wall' },
  { label: '未上墙', value: 'off-wall' },
  { label: '文生图', value: 'generation' },
  { label: '图生图', value: 'edit' },
];

export const wallFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '文生图', value: 'generation' },
  { label: '图生图', value: 'edit' },
];

export const resolutionGroups = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

export const ratioOptions = [
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

export const ratioToSize = {
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

export const sizeLimits = {
  step: 16,
  maxEdge: 3840,
  maxRatio: 3,
  minPixels: 655360,
  maxPixels: 8294400,
};

export const resolutionMaxEdges = {
  '1k': 1280,
  '2k': 2560,
  '4k': 3840,
};

export const defaultForm = {
  model: 'gpt-image-2',
  prompt: '',
  size: '',
  n: 1,
  quality: 'auto',
  background: 'auto',
  response_format: 'url',
  output_format: 'png',
  moderation: 'auto',
};

export const defaultSizeDraft = {
  mode: 'auto',
  resolution: '1k',
  ratio: '1:1',
  customRatioWidth: 1,
  customRatioHeight: 1,
  customWidth: 1024,
  customHeight: 1024,
};

export const emptyAuthForm = {
  username: '',
  displayName: '',
  password: '',
};

export const emptyProfileForm = {
  displayName: '',
};

export const emptyPasswordForm = {
  currentPassword: '',
  newPassword: '',
};

export const defaultApiConfigItem = {
  id: 'default-api-config',
  apiName: 'OpenAI gpt-image-2',
  apiBaseUrl: DEFAULT_DIRECT_API_BASE_URL,
  model: defaultForm.model,
  promptModel: '',
  visionModel: '',
  apiKey: '',
  hasApiKey: false,
  apiKeyHint: '',
  requestTimeout: MAX_REQUEST_TIMEOUT_SECONDS,
};

export const defaultApiConfigForm = {
  ...defaultApiConfigItem,
  stream: false,
  activeApiConfigId: defaultApiConfigItem.id,
  apiConfigs: [defaultApiConfigItem],
};