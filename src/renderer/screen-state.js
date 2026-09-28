import { t as tr } from '../shared/i18n.mjs';
// Re-rendering replaces #app wholesale. These helpers carry what the user had on screen
// (scroll, open sections, typed values, focus) from the old DOM to the new one.
import { button, e } from './html.js';
import { app, formKey, locationKey, ui } from './state.js';
const openSections = () =>
  [...app.querySelectorAll('details[open]')].map((d) => d.querySelector('summary')?.textContent);
function openDetails(summaries) {
  app.querySelectorAll('details').forEach((d) => {
    if (summaries.includes(d.querySelector('summary')?.textContent)) d.open = true;
  });
}
const firstForm = () =>
  app.querySelector('form[data-form="delegation"]') || app.querySelector('form[data-form]');

export function captureScreen() {
  const main = app.querySelector('.main');
  const active = document.activeElement;
  return {
    location: main?.dataset.location,
    scrollTop: main?.scrollTop || 0,
    taskScroll: app.querySelector('.tasknav')?.scrollTop || 0,
    expanded: openSections(),
    expandedIndices: [...app.querySelectorAll('details')].flatMap((d, i) => (d.open ? [i] : [])),
    requestScroll: app.querySelector('.request-fields')?.scrollTop || 0,
    forms: [...app.querySelectorAll('form[data-form]:not([data-form="delegation"])')].map(
      (form) => ({
        name: form.dataset.form,
        id: form.dataset.id,
        fields: [...form.elements]
          .filter((field) => field.name && field.type !== 'file')
          .map((field) => ({
            name: field.name,
            type: field.type,
            value: field.value,
            checked: field.checked,
          })),
      }),
    ),
    formName: firstForm()?.dataset.form,
    focusId: app.contains(active) ? active.id : null,
    focusAction: app.contains(active) ? active.dataset.action : null,
  };
}

function restoreForms(snapshots) {
  for (const snapshot of snapshots) {
    const form = [...app.querySelectorAll('form[data-form]')].find(
      (form) => form.dataset.form === snapshot.name && form.dataset.id === snapshot.id,
    );
    if (!form) continue;
    for (const saved of snapshot.fields) {
      const field = [...form.elements].find(
        (field) =>
          field.name === saved.name && (saved.type !== 'radio' || field.value === saved.value),
      );
      if (!field) continue;
      if (['checkbox', 'radio'].includes(saved.type)) field.checked = saved.checked;
      else field.value = saved.value;
    }
  }
}
function markUnsaved(form) {
  const unsaved = document.createElement('div');
  unsaved.className = 'notice row between';
  unsaved.innerHTML =
    tr('<span>저장하지 않은 입력이 있습니다.</span>') + button(tr('수정 취소'), 'discard-form');
  form.before(unsaved);
  return unsaved;
}
function showRequestDialog(requestScroll) {
  const dialog = app.querySelector('.request-dialog');
  dialog.showModal();
  dialog.querySelector('.request-fields').scrollTop = requestScroll;
  const notice = dialog.querySelector('.request-notice');
  if (ui.message)
    notice.innerHTML = `<div class="notice ${ui.error ? 'error' : ''}">${e(ui.message)}</div>`;
}
function disableBusyControls() {
  app
    .querySelectorAll(
      'button[type=submit],button[data-action^="inspect:"],.request-dialog button[data-action]',
    )
    .forEach((b) => {
      b.disabled = true;
    });
}
function restoreFocus({ focusId, focusAction }) {
  if (ui.focusAfterRender) {
    document.getElementById(ui.focusAfterRender)?.focus({ preventScroll: true });
    ui.focusAfterRender = null;
    return;
  }
  if (focusId && document.getElementById(focusId))
    document.getElementById(focusId).focus({ preventScroll: true });
  else if (focusAction)
    [...app.querySelectorAll('[data-action]')]
      .find((b) => b.dataset.action === focusAction)
      ?.focus({ preventScroll: true });
  if (ui.requestJustOpened) {
    document.getElementById('request-goal')?.focus({ preventScroll: true });
    ui.requestJustOpened = false;
  }
}

// Order matters: the same screen keeps its own state, a revisited screen gets what was
// remembered for it, and explicit restore requests (evidence return) apply last.
export function restoreScreen(before) {
  const newForm = firstForm();
  const main = app.querySelector('.main');
  main.dataset.location = locationKey();
  const sameLocation = before.location === main.dataset.location;
  if (sameLocation) {
    openDetails(before.expanded);
    if (ui.languageChanged)
      app.querySelectorAll('details').forEach((d, i) => {
        d.open = before.expandedIndices.includes(i);
      });
    main.scrollTop = before.scrollTop;
  }
  const remembered = !sameLocation && ui.locations[main.dataset.location];
  if (remembered) {
    main.scrollTop = remembered.scroll;
    openDetails(remembered.expanded);
  }
  if (ui.restoreExpanded) {
    openDetails(ui.restoreExpanded);
    ui.restoreExpanded = null;
  }
  if (ui.restoreScroll !== null) {
    main.scrollTop = ui.restoreScroll;
    ui.restoreScroll = null;
  }
  const taskList = app.querySelector('.tasknav');
  if (taskList) taskList.scrollTop = remembered ? remembered.list : before.taskScroll;
  // Keep typed values on the same screen, except for forms that were just saved or discarded.
  if (!ui.resetForm && sameLocation)
    restoreForms(before.forms.filter((f) => !ui.resetForms.includes(`${f.name}|${f.id || ''}`)));
  ui.resetForm = false;
  ui.resetForms = [];
  const notices = markDirtyForms();
  if (!notices.length && ui.formDirty && newForm && before.formName !== 'delegation')
    notices.push(markUnsaved(newForm));
  if (ui.requestOpen) showRequestDialog(before.requestScroll);
  if (ui.busy) disableBusyControls();
  restoreFocus(before);
  // Navigation was refused because of unsaved input: bring the discard control into view.
  if (ui.revealUnsaved && notices[0]) {
    notices[0].scrollIntoView({ block: 'center' });
    notices[0].querySelector('button')?.focus({ preventScroll: true });
  }
  ui.revealUnsaved = false;
  ui.languageChanged = false;
}
// Put the unsaved-input notice right above each form being edited. A tracked form that is no
// longer on screen cannot hold edits any more, so it stops blocking navigation.
function markDirtyForms() {
  const forms = [...app.querySelectorAll('form[data-form]')];
  const present = ui.dirtyForms.filter((key) => forms.some((form) => formKey(form) === key));
  if (present.length !== ui.dirtyForms.length) {
    ui.dirtyForms = present;
    ui.formDirty = present.length > 0 || !!ui.requestSaveFailed;
  }
  return forms.filter((form) => present.includes(formKey(form))).map(markUnsaved);
}

// Only stable screens are remembered; forms and dialogs are transient.
export function saveNavigation() {
  try {
    if (['home', 'ops', 'portfolio', 'scope', 'product', 'records'].includes(ui.view))
      localStorage.setItem(
        'workroom-navigation',
        JSON.stringify({
          productId: ui.productId,
          taskId: ui.taskId,
          portfolioId: ui.portfolioId,
          taskQuery: ui.taskQuery,
          lastTasks: ui.lastTasks,
          lastQueries: ui.lastQueries,
        }),
      );
  } catch {}
}
