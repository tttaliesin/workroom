import { t as tr } from '../shared/i18n.mjs';
import { flash, refresh } from './controller.js';
import { data, product, ui } from './state.js';
async function call(action, args) {
  const result = await window.workroom.jev(action, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export async function jevAction(action) {
  const p = product();
  if (!p) return;
  const connection = data.jev?.connections.find((x) => x.productId === p.id);
  if (action === 'jev-select') {
    const descriptor = await call('select');
    if (descriptor) ui.jevCandidate = { productId: p.id, descriptor };
  } else if (action === 'jev-connect') {
    const descriptor =
      ui.jevCandidate?.productId === p.id ? ui.jevCandidate.descriptor : connection?.descriptor;
    await call('configure', {
      productId: p.id,
      descriptor,
      expectedRevision: connection?.revision || 0,
    });
    ui.jevCandidate = ui.jevPreview = ui.jevResult = null;
    await refresh();
    flash(tr('Jev 연결을 확인하고 저장했습니다. 자동 전송은 하지 않습니다.'));
  } else if (action === 'jev-disable') {
    await call('disable', { productId: p.id, expectedRevision: connection.revision });
    ui.jevPreview = ui.jevResult = null;
    await refresh();
    flash(tr('Jev 연결을 해제했습니다. 양쪽 기록은 유지됩니다.'));
  } else if (action === 'jev-cancel') ui.jevPreview = null;
  else if (action === 'jev-publish') {
    if (!ui.jevPreview || ui.jevPreview.payload.productId !== p.id) return;
    await call('publish', { previewId: ui.jevPreview.id });
    ui.jevPreview = null;
    await refresh();
    flash(tr('검토한 결과를 Jev에 보냈습니다. 같은 버전은 중복 저장하지 않습니다.'));
  }
}
export async function jevForm(form, values) {
  const productId = product().id;
  if (form.dataset.form === 'jev-prepare')
    ui.jevPreview = await call('prepare', { productId, reportId: values.reportId });
  else {
    ui.jevResult = null;
    ui.jevResult = await call('search', { productId, query: values.query });
  }
}
