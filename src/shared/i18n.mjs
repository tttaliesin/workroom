import english from './locales/en.mjs';

let language = 'ko';
export const getLanguage = () => language;
export const getLocale = () => (language === 'en' ? 'en-US' : 'ko-KR');
export function setLanguage(value) {
  if (!['ko', 'en'].includes(value)) throw new Error('Unsupported language');
  language = value;
}
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
function phrase(text) {
  if (language === 'ko') return text;
  const key = normalize(text);
  if (typeof english[key] !== 'string') return text;
  return text.match(/^\s*/)[0] + english[key] + text.match(/\s*$/)[0];
}
// Only source-code literals pass through this function. Interpolated values,
// user content, paths, code and saved reports never pass through the dictionary.
export function translateSource(source) {
  if (language === 'ko') return source;
  const attributes = source.replace(
    /(placeholder|title|aria-label|alt)=(['"])(.*?)\2/g,
    (_, name, quote, text) =>
      `${name}=${quote}${phrase(text).replaceAll(quote, quote === '"' ? '&quot;' : '&#39;')}${quote}`,
  );
  if (!/[<>]/.test(attributes))
    return /\w+=['"]/.test(attributes) ? attributes : phrase(attributes);
  return attributes.replace(/(^|>)([^<>]*)(?=<|$)/g, (_, prefix, text) => prefix + phrase(text));
}
export function t(source, ...values) {
  if (typeof source === 'string') return translateSource(source);
  if (language === 'en') {
    const key = normalize(
      source.reduce((text, part, i) => text + (i ? `{${i - 1}}` : '') + part, ''),
    );
    let message = english[key];
    if (message && typeof message === 'object') {
      const count = values.find((value) => typeof value === 'number');
      message = message[new Intl.PluralRules('en').select(count)] || message.other;
    }
    if (typeof message === 'string')
      return message.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
  }
  return interpolateSource(source, values);
}
export function interpolateSource(parts, values) {
  let output = translateSource(parts[0]);
  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]),
      next = translateSource(parts[i + 1]);
    if (
      language === 'en' &&
      /[가-힣]$/.test(parts[i]) &&
      /[A-Za-z0-9]$/.test(output) &&
      /^[A-Za-z0-9]/.test(value)
    )
      output += ' ';
    output += value;
    if (
      language === 'en' &&
      /^[가-힣]/.test(parts[i + 1]) &&
      /[A-Za-z0-9]$/.test(value) &&
      /^[A-Za-z0-9]/.test(next)
    )
      output += ' ';
    output += next;
  }
  return output;
}
const raw = new WeakMap();
export function localizedLabels(labels) {
  const proxy = new Proxy(labels, {
    get: (target, key) => (typeof target[key] === 'string' ? t(target[key]) : target[key]),
  });
  raw.set(proxy, labels);
  return proxy;
}
export const rawLabels = (labels) => raw.get(labels) || labels;
