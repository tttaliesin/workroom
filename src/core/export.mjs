import { readFileSync } from 'node:fs';
import { portfolioMarkup, normalizeTemplate } from '../shared/portfolio.mjs';
export { escapeHTML } from '../shared/portfolio.mjs';

const styles = readFileSync(new URL('../shared/portfolio.css', import.meta.url), 'utf8');
export function portfolioHTML(snapshot, { language = 'ko' } = {}) {
  const english = language === 'en';
  const background = { studio: '#171c1b', editorial: '#f3eee4', resume: '#fcfcfc' }[
    normalizeTemplate(snapshot.templateId)
  ];
  return `<!doctype html><html lang="${english ? 'en' : 'ko'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${english ? 'Portfolio' : '포트폴리오'}</title><style>body{margin:0;background:${background}}main{max-width:1100px;margin:auto;padding:32px 24px}@media(max-width:480px){main{padding:0}}@media print{body{background:#fff}main{padding:0}}${styles}</style></head><body><main>${portfolioMarkup(snapshot, { language })}</main></body></html>`;
}
