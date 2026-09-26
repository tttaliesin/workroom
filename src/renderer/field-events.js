import { closeRequest, rememberRequest, render } from './controller.js';
import { preview } from './portfolio-views.js';
import { recordResults } from './record-views.js';
import { data, ui } from './state.js';
import { taskRows } from './work-views.js';
export function handleInput(event) {
  if (ui.rendering || !event.target.isConnected) return;
  const el = event.target;
  if (el.closest('form[data-form="delegation"]')) {
    rememberRequest(el.closest('form'));
    return;
  }
  if (el.closest('form[data-form]')) ui.formDirty = true;
  if (el.id === 'task-query') {
    ui.taskQuery = el.value;
    document.querySelector('.tasknav').innerHTML = taskRows();
  }
  if (el.id === 'record-query') {
    ui.query = el.value;
    document.getElementById('record-results').innerHTML = recordResults();
  }
  if (el.dataset.draft) {
    ui.draft[el.dataset.draft] = el.value;
    ui.dirty = true;
  }
  if (el.dataset.entry !== undefined) {
    ui.draft.entries[Number(el.dataset.entry)][el.dataset.key] = el.value;
    ui.dirty = true;
  }
  if (ui.dirty && ui.view === 'portfolio') {
    const previewNode = document.getElementById('folio-preview');
    if (previewNode) previewNode.innerHTML = preview(ui.draft);
    document.getElementById('save-state').textContent = '저장하지 않은 변경';
  }
}
export function handleChange(event) {
  if (ui.rendering || !event.target.isConnected) return;
  if (event.target.dataset.subscription) {
    const ids = new Set(ui.draft.autoProductIds || []);
    event.target.checked
      ? ids.add(event.target.dataset.subscription)
      : ids.delete(event.target.dataset.subscription);
    ui.draft.autoProductIds = [...ids];
    ui.dirty = true;
    document.getElementById('save-state').textContent = '저장하지 않은 변경';
  }
  if (event.target.closest('form[data-form="delegation"]')) {
    rememberRequest(event.target.closest('form'));
    if (event.target.name === 'mode') {
      ui.resetForm = true;
      render();
    }
    return;
  }
  if (event.target.closest('form[data-form]')) ui.formDirty = true;
  if (event.target.id === 'link-parent') {
    ui.linkParent = event.target.value;
    render();
  }
  if (event.target.id === 'record-product') {
    ui.productId = event.target.value;
    render();
  }
  if (event.target.id === 'add-task' && event.target.value) {
    const t = data.tasks.find((t) => t.id === event.target.value);
    if (!t || ui.draft.entries.some((x) => x.taskId === t.id)) return;
    ui.draft.entries.push({
      taskId: t.id,
      title: t.title,
      description: t.summary.slice(0, 5000),
      contribution: t.contribution,
    });
    ui.dirty = true;
    render();
  }
}
export function handleToggle(event) {
  if (event.target.matches('[data-related]')) ui.relatedOpen = event.target.open;
}
export function handleCancel(event) {
  if (event.target.matches('.request-dialog')) {
    event.preventDefault();
    closeRequest();
  }
}
export function handleBeforeUnload(event) {
  if (ui.dirty || ui.formDirty) {
    event.preventDefault();
    event.returnValue = '';
  }
}
