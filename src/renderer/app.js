import { handleClick } from './click-actions.js';
import { app, refresh, render, syncExternal } from './controller.js';
import {
  handleBeforeUnload,
  handleCancel,
  handleChange,
  handleInput,
  handleToggle,
} from './field-events.js';
import { handleSubmit } from './form-actions.js';
import { e } from './html.js';
app.addEventListener('click', handleClick);
app.addEventListener('submit', handleSubmit);
app.addEventListener('input', handleInput);
app.addEventListener('change', handleChange);
app.addEventListener('toggle', handleToggle, true);
app.addEventListener('cancel', handleCancel, true);
window.addEventListener('beforeunload', handleBeforeUnload);
try {
  await refresh();
  render();
} catch (error) {
  app.innerHTML = `<main class="main"><h1>저장소를 열 수 없습니다.</h1><p class="gap">${e(error.message)}</p></main>`;
}
setInterval(syncExternal, 2000);
window.addEventListener('focus', syncExternal);
