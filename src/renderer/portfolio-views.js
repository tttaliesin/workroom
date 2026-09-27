import { portfolioMarkup, normalizeTemplate, portfolioTemplates } from '../shared/portfolio.mjs';
import { t as tr, getLanguage } from '../shared/i18n.mjs';
import { html, button, date, e, empty, field, header } from './html.js';
import { portfolioAgentPanel } from './operations-ui.js';
import { data, loadDraft, product, productName, ui } from './state.js';
export function newTarget() {
  return (
    header(tr('포트폴리오 대상 추가'), tr('기업별로 강조할 경험과 페이지를 따로 관리합니다.')) +
    html`<form data-form="target" class="form">
        ${field('target', tr('기업 또는 대상 이름'), '', 'input', tr('required maxlength="160" placeholder="예: 기본 포트폴리오, 지원 기업명"'))}
        ${field('requirements', tr('이 대상에게 보여주고 싶은 경험'), '', 'textarea', 'maxlength="5000"')}
        ${
          product()
            ? html`<label class="check-option">
            <input type="checkbox" name="autoSubscribe">${e(product().name)}의 새 작업을 이 초안에 자동 반영</label>
          <p class="small muted">기존 작업은 직접 선택합니다. 자동 반영해도 웹에 공개되지 않습니다.</p>`
            : ''
        }
        <div>
          <button type="submit" class="primary">초안 만들기</button>
        </div>
      </form>`
  );
}
export function preview(d) {
  return portfolioMarkup(d, {
    language: getLanguage(),
    preview: true,
    currentTaskId: ui.fromTaskId,
  });
}
function templatePicker(d) {
  const descriptions = {
    studio: tr('다크 카드 · 작업을 선명하게'),
    editorial: tr('편집지 · 문장과 여백을 크게'),
    resume: tr('이력서 · 한눈에 읽는 두 열'),
  };
  const names = { studio: 'Studio', editorial: 'Editorial', resume: 'Resume' };
  return html`<fieldset class="template-picker"><legend>포트폴리오 템플릿</legend>
    <p class="small muted">디자인을 고르고 초안을 저장하세요. HTML에도 그대로 적용됩니다.</p>
    <div class="template-options">${portfolioTemplates
      .map(
        (id) => html`<label class="template-option">
      <input id="template-${id}" type="radio" name="portfolio-template" value="${id}" ${normalizeTemplate(d.templateId) === id ? 'checked' : ''}>
      <span class="template-card"><span class="template-swatch swatch-${id}" aria-hidden="true"><span class="swatch-heading"></span><span class="swatch-content"><i></i><i></i></span></span>
      <span class="template-name">${names[id]}<span class="template-check" aria-hidden="true">✓</span></span>
      <span class="template-description">${descriptions[id]}</span></span>
    </label>`,
      )
      .join('')}</div>
    ${ui.dirty && !ui.editing ? html`<div class="actions">${button(tr('초안 저장'), 'save-portfolio', 'class="primary"')}${button(tr('수정 취소'), 'discard-draft')}</div>` : ''}
  </fieldset>`;
}
function subscriptions(d) {
  return html`<details class="subscriptions">
      <summary>자동 반영 설정${d.autoProductIds?.length ? tr` · ${d.autoProductIds.length}개 제품` : tr(' · 꺼짐')}
      </summary>
      <p class="small muted gap">선택한 제품의 새 작업 보고와 이후 수정 보고를 이 초안에 반영합니다. 직접 고친 문장과 제외한 사례는 보존합니다.</p>
      ${data.products
        .map(
          (p) => html`<label class="check-option">
          <input type="checkbox"
          data-subscription="${p.id}" ${(d.autoProductIds || []).includes(p.id) ? 'checked' : ''}>${e(p.name)}</label>`,
        )
        .join('')}
      <p class="small muted">설정을 끄면 다음 반영부터 중단하며 기존 사례는 유지합니다. 변경 후 초안을 저장하세요.</p>
    </details>`;
}
function conflictReview() {
  const remote = ui.conflictRemote;
  return remote
    ? html`<section class="conflict-review">
        <h2>저장된 초안에 다른 변경이 있습니다</h2>
        <p class="small muted gap">작성 중인 입력은 아래 편집기에 남아 있습니다. 저장된 내용을 확인한 뒤, 충돌한 부분에 내 변경을 우선 적용할 수 있습니다.</p>
        <details>
          <summary>저장된 초안과 설정 보기</summary>${preview(remote)}<p class="small muted gap">비공개
          강조점: ${e(remote.requirements)}</p>
          <p class="small muted gap">자동
          반영: ${(remote.autoProductIds || []).map(productName).map(e).join(', ') || tr('꺼짐')}
          </p>
        </details>
        <div class="actions">
          ${button(tr('내 변경 우선으로 저장'), 'save-portfolio-overwrite')}
          ${button(tr('저장된 초안으로 돌아가기'), 'discard-draft')}</div>
      </section>`
    : '';
}
export function portfolioPage() {
  const from = data.tasks.find((t) => t.id === ui.fromTaskId);
  const back = ui.history.length
    ? ''
    : from
      ? button(`← ${e(from.title)}`, `task:${from.id}`, 'class="link back"')
      : '';
  if (!data.portfolios.length)
    return (
      back +
      header(tr('포트폴리오 초안'), tr('기업 또는 기본 페이지를 선택해 작업 사례를 보관합니다.')) +
      empty(tr('아직 저장한 대상이 없습니다.'), button(tr('첫 대상 추가'), 'nav:new-target'))
    );
  if (!ui.draft || !data.portfolios.some((p) => p.id === ui.portfolioId))
    loadDraft(data.portfolios.find((p) => p.id === ui.portfolioId)?.id || data.portfolios[0].id);
  const d = ui.draft;
  const autoSummary = d.autoProductIds?.length
    ? tr`${d.autoProductIds.map(productName).map(e).join(', ')}의 새 결과를 받습니다.`
    : tr('새 결과 자동 반영이 꺼져 있습니다.');
  return (
    back +
    header(tr('포트폴리오 초안'), tr('대상별 저장 · 웹 배포 미연결')) +
    html`<div class="targetbar row between">
        <strong>${e(d.target)}</strong>
        <span id="save-state" class="small muted">${ui.dirty ? tr('저장하지 않은 변경') : tr('로컬 초안 저장됨')}</span>
      </div>
      ${
        !ui.editing && !ui.review
          ? html`<div class="folio-context">
          ${e(d.requirements || tr('이 대상에게 강조할 경험을 초안 편집에서 정할 수 있습니다.'))}
          <br>
          <span class="small">
            ${autoSummary} · ${d.entries.length}개 사례 · HTML 저장 가능</span>
        </div>`
          : ''
      }
      ${!ui.editing && !ui.review ? portfolioAgentPanel(d, data) : ''}
      ${!ui.review ? templatePicker(d) : ''}
      ${portfolioSourceNotices(d)}
      ${d.pendingTaskIds?.length ? tr`<p class="notice">사례 20개 한도로 ${d.pendingTaskIds.length}개 작업이 대기 중입니다. 사례를 제외하고 저장하면 빈자리에 반영합니다.</p>` : ''}
      ${
        ui.review
          ? exportReview(d)
          : html`${
              from && !d.entries.some((x) => x.taskId === from.id)
                ? html`<div class="context-entry row between">
          <span>‘${e(from.title)}’은 이 대상에 포함되지 않았습니다.</span>
          ${button(tr('이 작업 추가'), `add-current:${from.id}`)}
        </div>`
                : ''
            }
        ${
          ui.editing
            ? html`${conflictReview()}<section class="editor" aria-label="초안 편집">${subscriptions(d)}
          ${field('folio-intro', tr('페이지 첫 문장'), d.intro, 'textarea', 'maxlength="2000" data-draft="intro"')}
          ${field('folio-requirements', tr('대상별 강조점 · 비공개'), d.requirements, 'textarea', 'maxlength="5000" data-draft="requirements"')}
          <div>
            <label for="add-task">기록된 작업에서 사례 추가</label>
            <select id="add-task">
              <option value="">작업 선택</option>
              ${data.tasks
                .filter(
                  (t) =>
                    t.kind === 'work' &&
                    !t.parentTaskId &&
                    !d.entries.some((x) => x.taskId === t.id),
                )
                .map(
                  (t) =>
                    `<option value="${t.id}">${e(t.title)} / ${e(productName(t.productId))}</option>`,
                )
                .join('')}
            </select>
          </div>
          ${d.entries
            .map(
              (x, i) => html`<section class="entry-editor">
          <div class="row between">
            <h2>${e(x.title)}</h2>
            <div class="toolbar">
              ${i ? button(tr('위로'), `move-entry:${i}`) : ''}
              ${button(tr('제외'), `remove-entry:${i}`)}
            </div>
          </div>
          ${field(`entry-title-${i}`, tr('제목'), x.title, 'input', `data-entry="${i}" data-key="title" maxlength="200"`)}
          ${field(`entry-description-${i}`, tr('사례 설명'), x.description, 'textarea', `data-entry="${i}" data-key="description" maxlength="5000"`)}
          ${field(`entry-contribution-${i}`, tr('기여 범위'), x.contribution, 'textarea', `data-entry="${i}" data-key="contribution" maxlength="3000"`)}
          <details>
            <summary>원본 근거 확인</summary>
            <p class="small muted gap">
              ${e(data.tasks.find((t) => t.id === x.taskId)?.evidence || tr('출처를 확인할 수 없습니다.'))}
            </p>
            <p class="small muted gap">앱의 독립 검증 없음</p>
          </details>
        </section>`,
            )
            .join('')}
          <div class="actions">
            ${button(tr('초안 저장'), 'save-portfolio', 'class="primary"')}
            ${button(tr('수정 취소'), 'discard-draft')}</div>
        </section><div id="folio-preview" class="editor-preview">${preview(d)}</div>`
            : html`<div id="folio-preview">${preview(d)}</div>
        <div class="actions">${button(tr('초안 편집'), 'edit-portfolio')}
          ${from ? button(tr('작업 근거 보기'), `portfolio-evidence:${from.id}`, 'class="plain"') : ''}
          ${entryEvidence(d)}${button(tr('HTML 내보내기 검토'), 'review-export')}</div>`
        }
        <p class="small muted gap">
          ${d.autoProductIds?.length ? tr`자동 반영 중 · ${d.autoProductIds.map(productName).map(e).join(', ')}<br>` : ''}
          ${d.exports.length ? tr`최근 내보내기 ${date(d.exports.at(-1).at)}` : tr('아직 내보낸 버전 없음')}
        </p>`
      }`
  );
}
function exportReview(d) {
  return html`<section class="dialog">
      <p class="eyebrow">내보내기 전 검토</p>
      <h2>${e(d.target)}용 페이지</h2>
      <div class="note">
        <p>포함: 소개 문장, 선택한 사례와 기여 범위</p>
        <p>제외: 기업별 비공개 강조점, 내부 근거 원문, 로컬 경로, 작업 이력</p>
      </div>
      <div class="gap">${preview(d)}</div>
      <div class="actions">
        ${button(tr('HTML 파일로 저장'), 'export', 'class="primary"')}
        ${button(tr('편집으로 돌아가기'), 'cancel-export')}</div>
      <p class="small muted gap">저장 위치는 다음 창에서 선택합니다. 파일을 저장해도 웹에 공개되지는 않습니다.</p>
    </section>`;
}
function portfolioSourceNotices(d) {
  return d.entries
    .filter((x) => d.entrySources?.[x.taskId]?.sourceConflict)
    .map(
      (x) =>
        html`<section class="conflict-review">
            <h2>${e(x.title)} · 연결 근거가 바뀌었습니다</h2>
            <p class="small muted gap">직접 쓴 문장은 보존했습니다. 현재 근거를 확인한 뒤 유지하거나, 이 사례의 제목·설명·기여를 현재 보고로 다시 작성할 수
            있습니다.</p>
            <div class="actions">
              ${button(tr('현재 근거 보기'), `portfolio-evidence:${x.taskId}`)}
              ${button(tr('이 문장 유지 확인'), `source-keep:${x.taskId}`)}
              ${button(tr('현재 보고로 문장 다시 작성'), `source-regenerate:${x.taskId}`)}
            </div>
          </section>`,
    )
    .join('');
}
const taskProduct = (taskId) => data.tasks.find((t) => t.id === taskId)?.productId;
function selectionReason(d, taskId) {
  const source = d.entrySources?.[taskId];
  if (source?.selectionReason) return source.selectionReason;
  return source?.automatic
    ? tr('구독한 제품의 작업 보고에서 연결')
    : tr('사용자가 이 대상의 사례로 선택');
}
function entryEvidence(d) {
  return html`<details class="case-evidence">
      <summary>사례별 근거와 선정 이유</summary>
      <p class="small muted gap">
        ${e(d.requirements || tr('대상별 강조점을 아직 입력하지 않았습니다.'))} · 채용 공고 자동 분석은 미연결입니다.</p>
      ${d.entries
        .map(
          (x) => html`<div class="record">
          <h3>${e(x.title)}</h3>
          <p class="small muted gap">
            ${e(selectionReason(d, x.taskId))} · ${e(productName(taskProduct(x.taskId)))}
          </p>
          ${button(tr('원본 경험 보기'), `portfolio-evidence:${x.taskId}`, 'class="plain"')}
        </div>`,
        )
        .join('')}
    </details>`;
}
