import { t as tr, setLanguage, getLanguage } from '../shared/i18n.mjs';
import { handleClick } from './click-actions.js';
import { refresh, render, syncExternal } from './controller.js';
import {
  handleBeforeUnload,
  handleCancel,
  handleChange,
  handleInput,
  handleToggle,
} from './field-events.js';
import { handleSubmit } from './form-actions.js';
import { e } from './html.js';
import { app } from './state.js';
app.addEventListener('click', handleClick);
app.addEventListener('submit', handleSubmit);
app.addEventListener('input', handleInput);
app.addEventListener('change', handleChange);
app.addEventListener('toggle', handleToggle, true);
app.addEventListener('cancel', handleCancel, true);
window.addEventListener('beforeunload', handleBeforeUnload);
try {
  const preference = await window.workroom.language();
  if (preference.ok) setLanguage(preference.value);
  document.documentElement.lang = getLanguage();
  document.title = getLanguage() === 'en' ? 'Workroom · Local alpha' : '작업실 · 로컬 알파';
  await refresh();
  render();
} catch (error) {
  app.innerHTML = tr`<main class="main"><h1>저장소를 열 수 없습니다.</h1><p class="gap">${e(error.message)}</p></main>`;
}
setInterval(syncExternal, 2000);
window.addEventListener('focus', syncExternal);
