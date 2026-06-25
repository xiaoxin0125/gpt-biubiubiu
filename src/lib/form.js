import {
  backgroundOptions,
  defaultForm,
  MAX_OUTPUT_IMAGES,
  moderationOptions,
  outputFormatOptions,
  qualityOptions,
  responseFormatOptions,
} from '../constants/options';
import { clampNumber } from './math';

export const normalizeQuality = (value) => (qualityOptions.some((item) => item.value === value) ? value : 'auto');
export const normalizeBackground = (value) => (backgroundOptions.includes(value) ? value : 'auto');
export const normalizeResponseFormat = (value) => (responseFormatOptions.some((item) => item.value === value) ? value : 'b64_json');
export const normalizeOutputFormat = (value) => (outputFormatOptions.includes(value) ? value : 'png');
export const normalizeModeration = (value) => (moderationOptions.includes(value) ? value : 'auto');
export const normalizeOutputCount = (value) => clampNumber(Math.round(Number(value) || defaultForm.n), 1, MAX_OUTPUT_IMAGES);

export const getQualityLabel = (value) => qualityOptions.find((item) => item.value === value)?.label || '自动';
export const getResponseFormatLabel = (value) => responseFormatOptions.find((item) => item.value === value)?.label || 'Base64';

export const normalizeRevisedPrompt = (...values) => values.map((value) => String(value || '').trim()).find(Boolean) || '';

const comparablePromptText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeVisibleRevisedPrompt = (inputPrompt, ...values) => {
  const revisedPrompt = normalizeRevisedPrompt(...values);
  if (!revisedPrompt) return '';

  const inputText = comparablePromptText(inputPrompt);
  return inputText && comparablePromptText(revisedPrompt) === inputText ? '' : revisedPrompt;
};

export const normalizeForm = (value = {}) => {
  const nextForm = { ...defaultForm, ...value };

  return {
    model: String(nextForm.model || defaultForm.model).trim() || defaultForm.model,
    prompt: String(nextForm.prompt || ''),
    size: String(nextForm.size || ''),
    n: normalizeOutputCount(nextForm.n),
    quality: normalizeQuality(nextForm.quality),
    background: normalizeBackground(nextForm.background),
    response_format: normalizeResponseFormat(nextForm.response_format),
    output_format: normalizeOutputFormat(nextForm.output_format),
    moderation: normalizeModeration(nextForm.moderation),
  };
};