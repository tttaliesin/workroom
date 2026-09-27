import { t as tr } from '../shared/i18n.mjs';
import { html, button, date, e, empty, field, header } from './html.js';
import { operationSettings } from './operations-ui.js';
import { data, product, ui } from './state.js';
import { observation } from './work-views.js';
import { codexConnectionView } from './codex-connection-view.js';
const unconfirmedCapture =
  () => html`<p class="small muted gap">설정 저장만으로 실행이 확인된 것은 아닙니다.
  Codex 연결 화면의 승인 화면에서 작업실 훅을 검토·신뢰하면 다음 작업부터 수집합니다.</p>`;
export function accountReturnNotice() {
  const pending = ui.accountReturn && data.products.find((p) => p.id === ui.accountReturn),
    draft = pending && ui.requests[pending.id];
  if (!pending || !draft) return '';
  return html`<section class="connection-return">
      <p class="eyebrow">작성하던 요청으로 이어집니다</p>
      <strong>
        ${e(draft.goal.slice(0, 150) || pending.name)}
      </strong>
      <p class="small muted gap">계정 연결과 모델 저장을 마치면 이 요청으로 돌아갑니다. 실행은 요청 화면에서 결정합니다.</p>
      <div class="setup-progress">
        <span class="${data.runtime?.connected ? 'done' : ''}">${data.runtime?.connected ? '✓' : '1'} 계정
        연결</span>
        <span class="${data.runtime?.modelId ? 'done' : ''}">${data.runtime?.modelId ? '✓' : '2'} 모델 저장</span>
      </div>
      ${button(tr('요청으로 돌아가기'), 'delegate-return', 'class="plain"')}
    </section>`;
}
export function productSelect(name = 'productId') {
  return html`<div>
      <label for="${name}">제품</label>
      <select name="${name}" id="${name}">
        ${data.products.map((p) => `<option value="${p.id}" ${p.id === ui.productId ? 'selected' : ''}>${e(p.name)}</option>`).join('')}
      </select>
    </div>`;
}
export function newProduct() {
  return (
    header(tr('함께 관리할 제품'), tr('개발 폴더와 이루려는 목표를 연결합니다.')) +
    html`<form data-form="product" class="form">
        ${field('name', tr('제품 이름'), '', 'input', 'required maxlength="100"')}
        ${field('folder', tr('제품 폴더'), '', 'input', tr('required readonly placeholder="폴더 선택 버튼으로 연결"'))}
        <div>${button(tr('폴더 선택'), 'folder')}</div>
        ${field('goal', tr('지금 이 제품에서 이루고 싶은 것'), '', 'textarea', tr('maxlength="2000" placeholder="예: 가져오기와 검색 기능 안정화"'))}
        <div class="actions">
          <button class="primary" type="submit">제품 등록</button>
          ${button(tr('돌아가기'), 'nav:ops', 'class="plain"')}
        </div>
      </form>`
  );
}
export function productPage() {
  const p = product();
  if (!p) return empty(tr('등록한 제품이 없습니다.'), button(tr('제품 등록'), 'nav:new-product'));
  return (
    header(tr('폴더·수집 연결'), p.name, button(tr('설정으로'), 'nav:scope')) +
    html`<section>
        <h2>제품 폴더</h2>
        <p class="gap product-folder">${e(p.folder)}</p>
        <p class="small muted gap">${e(observation(p))}</p>
        <div class="actions">
          ${button(ui.busy ? tr('점검 중…') : tr('지금 기본 점검'), `inspect:${p.id}`)}
        </div>
      </section>${captureSetup(p)}<details>
        <summary>결과를 직접 기록</summary>
        <div class="actions">${button(tr('작업 결과 기록'), 'nav:new-work')}${button(tr('판단 요청 만들기'), 'nav:new-decision')}</div>
      </details>`
  );
}
function captureSetup(p) {
  const connection = (data.captureConnections || []).find((c) => c.productId === p.id);
  const plan = ui.hookPlan?.productId === p.id ? ui.hookPlan : null;
  return html`<section class="capture-setup section">
      <div class="row between">
        <h2>${ui.view === 'connection' ? '3. ' : ''}Codex 작업 자동 수집</h2>
        <span class="small muted">
          ${!p.codexCaptureEnabled ? tr('꺼짐') : connection ? tr`최근 수집 ${date(connection.lastReceivedAt)}` : tr('첫 이벤트 수신 대기')}
        </span>
      </div>
      <p class="small muted gap">이 제품에서 파일 변경·검사 명령이 있었던 응답을 기록합니다. 일반 대화, 사용자 프롬프트와 전체 대화 로그는 수집하지 않습니다.</p>
      <div class="actions">
        ${button(tr('연결 설정 확인'), `codex-prepare:${p.id}`)}
        ${ui.view !== 'connection' ? button(tr('Codex 연결·승인'), 'nav:connection', 'class="plain"') : ''}
        ${
          typeof p.codexCaptureEnabled === 'boolean'
            ? button(
                p.codexCaptureEnabled ? tr('수집 끄기') : tr('수집 다시 켜기'),
                `codex-toggle:${p.id}`,
                'class="plain"',
              )
            : ''
        }
        ${connection?.lastTaskId ? button(tr('최근 수집 작업'), `task:${connection.lastTaskId}`, 'class="link"') : ''}
      </div>
      ${p.codexCaptureEnabled && !connection ? unconfirmedCapture() : ''}
      ${
        plan
          ? html`<div class="hook-plan note">
          <h3>이 제품의 연결 설정</h3>
          <p class="small muted gap">설정 파일: ${e(plan.filename)}</p>
          <p class="small muted gap">
            ${plan.existing ? tr('기존 훅을 유지하고 작업실 항목만 추가·갱신합니다. 원본을 백업합니다.') : tr('새 프로젝트 훅 파일을 만듭니다.')} 코드와 전역 설정은
            변경하지 않습니다.</p>
          <p class="small muted gap">실행: ${e(plan.node)}<br>${e(plan.script)}</p>
          <p class="small muted gap">수집기는 로컬에만 저장하며 개발 작업을 차단하거나 에이전트에 추가 지시를 보내지 않습니다. 전체 완료 응답은 내부 근거에
          보관합니다.</p>
          <details>
            <summary>작성할 훅 JSON 보기</summary>
            <pre>${e(JSON.stringify(plan.config, null, 2))}</pre>
          </details>
          <div class="actions">
            ${button(tr('이 제품에 연결 설정 저장'), `codex-install:${p.id}`, 'class="primary"')}
            ${button(tr('닫기'), 'codex-close', 'class="plain"')}
          </div>
        </div>`
          : ''
      }
    </section>`;
}
export function newDecision() {
  if (!data.products.length) return newProduct();
  return (
    header(tr('판단 요청 만들기'), tr('자동으로 정할 수 없는 방침과 선택별 영향을 기록합니다.')) +
    html`<form data-form="new-decision" class="form">${productSelect()}
        ${field('title', tr('요청 제목'), '', 'input', 'required maxlength="200"')}
        ${field('reason', tr('왜 이 결정이 필요한가요?'), '', 'textarea', 'required maxlength="4000"')}
        <div class="formgrid">
          ${field('label1', tr('선택 1'), '', 'input', 'required maxlength="160"')}
          ${field('label2', tr('선택 2'), '', 'input', 'required maxlength="160"')}
          ${field('effect1', tr('선택 1의 영향'), '', 'textarea', 'required maxlength="1200"')}
          ${field('effect2', tr('선택 2의 영향'), '', 'textarea', 'required maxlength="1200"')}
        </div>
        <div>
          <button type="submit" class="primary">판단 요청 저장</button>
        </div>
      </form>`
  );
}
export function newWork() {
  if (!data.products.length) return newProduct();
  return (
    header(tr('작업 결과 기록'), tr('확인한 사실과 확인하지 못한 범위를 함께 남깁니다.')) +
    html`<form data-form="work" class="form">${productSelect()}
        ${field('title', tr('작업 제목'), '', 'input', 'required maxlength="200"')}
        ${field('summary', tr('무엇이 달라졌나요?'), '', 'textarea', 'required maxlength="8000"')}
        ${field('evidence', tr('확인한 근거'), '', 'textarea', tr('required maxlength="8000" placeholder="예: 수정 커밋, 테스트 결과, 재현 방법"'))}
        ${field('limitations', tr('아직 확인하지 못한 것'), '', 'textarea', 'required maxlength="4000"')}
        ${field('contribution', tr('나와 에이전트의 기여 범위'), '', 'textarea', 'required maxlength="3000"')}
        <div>
          <button type="submit" class="primary">결과와 근거 저장</button>
        </div>
      </form>`
  );
}
export function connectionPage() {
  return (
    codexConnectionView(captureSetup) +
    tr('<details class="section"><summary>다른 MCP 클라이언트 연결 · 최근 기록 변경</summary>') +
    html`<div class="form">
        <div class="note">
          <h3>연결하면 가능한 것</h3>
          <p>제품 조회 · 적용할 기록 검색 · 저장소 기본 점검 · 판단 요청 · 작업 결과와 지식 기록</p>
          <p class="small muted">등록 폴더 변경, 사용자 대신 결정, 실제 코드 수정과 배포 기능은 MCP에 노출하지 않았습니다.</p>
        </div>
        ${
          ui.connection
            ? html`<h2>stdio 연결 설정</h2>
          <p class="muted">Node.js 24 이상이 필요합니다. 아래 형식을 지원하는 MCP 클라이언트에 등록하세요. 제품별 연결 방식은 클라이언트에 따라 다릅니다.</p>
          <pre>
            ${e(JSON.stringify(ui.connection.config, null, 2))}
          </pre>
          <p class="small muted">앱 데이터 위치<br>${e(ui.connection.dataDirectory)}</p>`
            : button(tr('연결 설정 보기'), 'connection-load', 'class="primary"')
        }
        <details>
          <summary>최근 기록 변경</summary>
          ${data.audit
            .slice(0, 15)
            .map(
              (a) =>
                `<p class="small muted gap">${date(a.at)} · ${e(a.action)}<br>${e(a.detail)}</p>`,
            )
            .join('')}
        </details>
      </div></details>`
  );
}
export function scopePage() {
  const p = product();
  if (!p) return newProduct();
  return (
    header(tr('제품 설정'), p.name) +
    html`<section class="settings-connection">
        <div>
          <h2>제품 폴더와 결과 수집</h2>
          <p class="small muted">${e(observation(p))}</p>
        </div>${button(tr('연결 관리'), 'nav:product')}</section>
      <section class="section">
        <h2>제품 목표</h2>
        <form data-form="goal" data-id="${p.id}" class="form gap">
          ${field('goal', tr('이 제품에서 이루고 싶은 것'), p.goal, 'textarea', 'maxlength="2000"')}
          <div>
            <button type="submit">목표 저장</button>
          </div>
        </form>
      </section>${operationSettings(p, data)}`
  );
}
