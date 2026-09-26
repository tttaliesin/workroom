export const e = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const date = (value) =>
  new Date(value).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export const button = (label, action, options = '') =>
  `<button type="button" data-action="${action}" ${options}>${label}</button>`;
export const header = (title, subtitle, action = '') =>
  `<header class="heading row between"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action}</header>`;
export const field = (id, label, value = '', type = 'input', extra = '') =>
  `<div><label for="${id}">${label}</label>${type === 'textarea' ? `<textarea id="${id}" name="${id}" ${extra}>${e(value)}</textarea>` : `<input id="${id}" name="${id}" value="${e(value)}" ${extra}>`}</div>`;
export const empty = (heading, content) =>
  `<div class="empty"><h2>${heading}</h2><p class="muted gap">${content}</p></div>`;
const icons = {
  product: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 10v10"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8M8 17h5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  failed: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h5M7 16h9"/>',
  connection: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
};
export const icon = (name) =>
  `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.pending}</svg>`;
