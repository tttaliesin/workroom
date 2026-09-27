export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function portfolioHTML(snapshot, { language = 'ko' } = {}) {
  const english = language === 'en';
  const e = escapeHTML;
  return `<!doctype html><html lang="${english ? 'en' : 'ko'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${english ? 'Portfolio' : '포트폴리오'}</title><style>body{margin:0;background:#faf9f6;color:#242724;font:16px/1.9 system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}main{max-width:760px;padding:70px 24px;margin:auto}header{padding-bottom:44px}h1{font-size:clamp(28px,5vw,44px);line-height:1.5;font-weight:550;white-space:pre-wrap}h2{font-size:25px;font-weight:550}p{white-space:pre-wrap}section{padding:28px 0;border-top:1px solid #d8d8d2}.byline{font-size:14px;color:#545b54}small{letter-spacing:.1em}</style></head><body><main><header><small>SELECTED WORK</small><h1>${e(snapshot.intro)}</h1></header>${snapshot.entries.map((x) => `<section><h2>${e(x.title)}</h2><p>${e(x.description)}</p><p class="byline">${english ? 'Contribution:' : '기여 범위:'} ${e(x.contribution)}</p></section>`).join('')}</main></body></html>`;
}
