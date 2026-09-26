import { html, button, date, e, empty, field, header } from './html.js';
import { newProduct, productSelect } from './setup-views.js';
import { data, product, provenance, ui } from './state.js';
export function recordsPage() {
  return (
    header(
      '기록',
      product()?.name || '등록한 제품이 없습니다.',
      button('기록 추가', 'nav:new-record'),
    ) +
    `${field('record-query', '내용 검색', ui.query)}<div id="record-results">${recordResults()}</div>`
  );
}
export function recordResults() {
  const rows = data.records.filter(
    (r) =>
      r.productId === product()?.id &&
      `${r.title} ${r.content} ${r.scope}`.toLowerCase().includes(ui.query.toLowerCase()),
  );
  return rows.length
    ? rows
        .map(
          (r) =>
            html`<article class="record">
                <div class="row between">
                  <h2>${e(r.title)}</h2>
                  <span class="badge">${provenance[r.provenance]}</span>
                </div>
                <p class="gap record-excerpt">${e(r.content)}</p>${recordUseLine(r)}<p class="small muted
                gap">적용: ${e(r.scope)}<br>출처: ${e(r.source)}<br>마지막
                변경: ${date(r.updated)} · ${r.validity === 'needs_review' ? '절차 재확인 중 · 조회 보류' : r.active ? '자동 참조 대상' : '자동 참조에서 제외'}
                </p>
                <div class="row gap">
                  ${button('조건·유효성 보기', `record-detail:${r.id}`, 'class="plain"')}
                  ${r.sourceTaskId ? button('출처 작업', `task:${r.sourceTaskId}`, 'class="link"') : ''}
                  ${button(r.active ? '자동 참조에서 제외' : '다시 포함', `record-toggle:${r.id}`, 'class="plain"')}
                </div>
              </article>`,
        )
        .join('')
    : empty(
        '일치하는 기록이 없습니다.',
        '제품을 점검하거나 작업 결과를 기록하면 근거가 여기에 쌓입니다.',
      );
}
function recordUseLine(record) {
  const contexts = (data.agentContexts || []).filter((c) =>
    c.context.records.some((r) => r.id === record.id),
  );
  const latest = contexts[0],
    task = latest && data.tasks.find((t) => t.id === latest.taskId);
  return html`<div class="usage-line">
      ${task ? `최근 제공: ${button(e(task.title), `task:${task.id}`, 'class="link"')} · ${contexts.length}회 실행에 제공` : '아직 내장 실행에 제공되지 않은 기록'}
      <br>제공 이력이며 실제 활용 여부는 별도입니다.</div>`;
}
export function newRecord() {
  if (!data.products.length) return newProduct();
  return (
    header('기록 추가', '언제 다시 써야 하는 정보인지 함께 남깁니다.') +
    html`<form data-form="record" class="form">${productSelect()}
        ${field('title', '제목', '', 'input', 'required maxlength="200"')}
        ${field('content', '내용', '', 'textarea', 'required maxlength="8000"')}
        ${field('scope', '적용 조건', '', 'textarea', 'required maxlength="1000"')}
        ${field('source', '출처', '', 'input', 'required maxlength="1000"')}
        <div>
          <button type="submit" class="primary">기록 저장</button>
        </div>
      </form>`
  );
}
export function recordDetailPage() {
  const r = data.records.find((r) => r.id === ui.recordId);
  if (!r) return empty('기록을 찾을 수 없습니다.', '다시 선택해 주세요.');
  const uses = (data.contextUses || []).filter((u) => u.records.some((x) => x.id === r.id));
  const history = (data.recordHistory || []).filter((h) => h.recordId === r.id);
  return (
    header(
      r.title,
      r.validity === 'needs_review'
        ? '절차 재확인 중 · MCP 조회 제공 보류'
        : r.active
          ? '같은 제품의 활성 기록'
          : '자동 참조에서 제외',
    ) +
    (ui.recordEditing
      ? html`<form data-form="record-review" data-id="${r.id}" class="form">
          ${field('content', '재사용할 내용', r.content, 'textarea', 'required maxlength="8000"')}
          ${field('scope', '어떤 변경에 적용하는가', r.scope, 'textarea', 'required maxlength="1000"')}
          <div>
            <label for="validity">현재 유효성</label>
            <select id="validity" name="validity">
              <option value="valid" ${r.validity !== 'needs_review' ? 'selected' : ''}>조건을 확인함 · 조회에 제공
              가능</option>
              <option value="needs_review" ${r.validity === 'needs_review' ? 'selected' : ''}>절차 재확인 필요 · 조회
              제공 보류</option>
            </select>
          </div>
          ${field('reason', '수정 또는 보류 이유', r.validityReason || '', 'textarea', 'required maxlength="1000"')}
          <div class="actions">
            <button type="submit" class="primary">조건 저장</button>${button('취소', 'record-cancel')}</div>
          <p class="small muted">별도로 제외한 기록은 유효성을 확인해도 자동으로 다시 포함하지 않습니다.</p>
        </form>`
      : html`<p class="record-content">${e(r.content)}</p>${recordUseLine(r)}<section class="section">
          <dl>
            <div class="fact">
              <dt>적용 조건</dt>
              <dd>${e(r.scope)}</dd>
            </div>
            <div class="fact">
              <dt>출처</dt>
              <dd>${e(r.source)}</dd>
            </div>
            <div class="fact">
              <dt>유효성</dt>
              <dd>
                ${e(r.validityReason || '출처와 적용 조건을 확인한 뒤 사용하세요. 자동으로 관련성을 판정한 결과가 아닙니다.')}
              </dd>
            </div>
          </dl>
        </section>
        <div class="actions">${button('조건과 유효성 수정', 'record-edit')}
          ${r.sourceTaskId ? button('원본 경험 보기', `record-source:${r.sourceTaskId}`, 'class="plain"') : ''}
          ${button(r.active ? '다음 조회부터 제외' : '조회에 다시 포함', `record-toggle:${r.id}`, 'class="plain"')}
        </div>`) +
    html`<details>
        <summary>이전에 조회에 제공한 버전 · ${uses.length}건</summary>
        <p class="small muted gap">조회에 반환한 내용이며 실제 에이전트가 활용했다는 확인은 아닙니다.</p>
        ${uses
          .map((u) => {
            const v = u.records.find((x) => x.id === r.id);
            return html`<article class="record">
            <h3>${date(u.created)} · 기록 v${v.revision}</h3>
            <p class="small muted gap">조회: ${e(u.query || '제품 기록 조회')}</p>
            <p class="gap">${e(v.content)}</p>
            <p class="small muted gap">당시 조건: ${e(v.scope)}</p>
          </article>`;
          })
          .join('')}
      </details>
      <details>
        <summary>이전 기록 버전 · ${history.length}건</summary>
        ${history
          .map(
            (h) => html`<article class="record">
            <h3>v${h.snapshot.revision} · ${date(h.created)}</h3>
            <p class="gap">${e(h.snapshot.content)}</p>
            <p class="small muted gap">${e(h.snapshot.scope)}</p>
          </article>`,
          )
          .join('')}
      </details>`
  );
}
