/* global Terminal, FitAddon */
import { t as tr, setLanguage, getLanguage, translateSource } from '../shared/i18n.mjs';
const preference = await window.codexTerminal.request('language');
if (preference.ok) setLanguage(preference.language);
document.documentElement.lang = getLanguage();
document.title = tr('Codex 연결');
document.getElementById('terminal').setAttribute('aria-label', tr('Codex 터미널'));
// This header is static app markup; no process output or user content is translated.
const header = document.querySelector('header');
header.innerHTML = translateSource(header.innerHTML);
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  scrollback: 3000,
  theme: { background: '#111827' },
});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
const status = document.getElementById('status');
let ready = false;
async function request(action, value) {
  const result = await window.codexTerminal.request(action, value);
  if (!result.ok) {
    status.textContent = result.error;
    throw new Error(result.error);
  }
  return result;
}
window.codexTerminal.onData((value) => {
  if (value.data) terminal.write(Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0)));
  if (value.exit !== undefined) {
    ready = false;
    status.textContent = tr`Codex가 종료되었습니다 (${value.exit}). 창을 닫고 연결 상태를 확인하세요.`;
    document.getElementById('hooks').disabled = document.getElementById('mcp').disabled = true;
  }
});
terminal.onData((text) => {
  if (ready) void request('input', text).catch(() => {});
});
function resize() {
  fit.fit();
  if (ready) void request('resize', { cols: terminal.cols, rows: terminal.rows }).catch(() => {});
}
new ResizeObserver(resize).observe(document.getElementById('terminal'));
for (const command of ['hooks', 'mcp'])
  document.getElementById(command).onclick = () => {
    // Slash commands are explicitly sent by the user, never as an initial model prompt.
    void request('input', `/${command}\r`).catch(() => {});
    terminal.focus();
  };
document.getElementById('close').onclick = () => window.close();
void request('start')
  .then((result) => {
    ready = true;
    status.textContent = tr`제품 폴더: ${result.folder} · 승인이 끝나면 창을 닫고 연결 상태를 확인하세요.`;
    document.getElementById('hooks').disabled = document.getElementById('mcp').disabled = false;
    resize();
    terminal.focus();
  })
  .catch(() => {});
