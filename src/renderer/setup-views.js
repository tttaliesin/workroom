import { t as tr, getLanguage } from '../shared/i18n.mjs';
import { html, button, date, e, field, header } from './html.js';
import { operationSettings } from './operations-ui.js';
import { data, product, ui } from './state.js';
import { observation } from './work-views.js';
import { codexConnectionView } from './codex-connection-view.js';
import { publicationCredentialsForm } from './publication-ui.js';
const unconfirmedCapture =
  () => html`<p class="small muted gap">설정 저장만으로 실행이 확인된 것은 아닙니다.
  아래 Codex 승인 화면에서 작업실 훅을 검토·신뢰하면 다음 작업부터 수집합니다.</p>`;
export function accountReturnNotice() {
  const portfolio = data.portfolios.find((p) => p.id === ui.portfolioAccountReturn);
  if (portfolio)
    return html`<section class="connection-return"><strong>${e(portfolio.target)}</strong><p class="small muted gap">연결과 모델 설정을 마친 뒤 이 대상에서 AI 초안을 요청하세요.</p>${button(tr('포트폴리오로 돌아가기'), 'portfolio-return')}</section>`;
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
function folderSection(p) {
  return html`<section class="section">
      <h2>제품 폴더</h2>
      <p class="gap product-folder">${e(p.folder)}</p>
      <p class="small muted gap">${e(observation(p))}</p>
      <div class="actions">
        ${button(ui.busy ? tr('점검 중…') : tr('지금 기본 점검'), `inspect:${p.id}`)}
      </div>
    </section>`;
}
// Approving the product's Codex hooks happens inside Codex, per product folder.
function codexApproval(p) {
  if (typeof p.codexCaptureEnabled !== 'boolean') return '';
  const status = ui.codexStatus?.productId === p.id ? ui.codexStatus : null;
  const trusted =
    status?.hooks?.length === 3 &&
    status.hooks.every((h) => h.enabled && ['trusted', 'managed'].includes(h.trust));
  return html`<section class="section">
      <h3>Codex에서 수집 훅 승인</h3>
      <p class="small muted gap">Codex 화면을 열어 로그인·프로젝트 신뢰 안내를 마친 뒤, 훅 승인 화면에서 ‘작업실 수집’ 항목 3개를 검토·승인하세요. 설정 파일을 직접 편집할 필요가 없습니다.</p>
      <div class="actions">${button(tr('Codex 승인 화면 열기'), 'connection-terminal', 'class="primary"')}${button(tr('승인 상태 다시 확인'), 'connection-status')}</div>
      <p class="gap">${trusted ? tr('✓ 작업실 훅 3개 신뢰·활성화 확인') : tr('작업실 훅 승인 확인 필요')}</p>
      ${(status?.hooks || []).map((h) => `<p class="small muted">${e(h.event)} · ${{ trusted: tr('신뢰됨'), managed: tr('관리 정책 승인'), modified: tr('변경되어 재승인 필요'), untrusted: tr('승인 대기') }[h.trust] || e(h.trust)} · ${h.enabled ? tr('활성') : tr('비활성')}</p>`).join('')}
      ${(status?.warnings || []).map((warning) => `<p class="small muted">${e(warning)}</p>`).join('')}
      <p class="small muted gap">기존 Codex 대화에는 새 설정이 즉시 적용되지 않을 수 있으므로 새 작업에서 확인하세요. 파일 변경·검사가 포함된 작업이 끝나면 위 수집 상태에 최근 수신 시각이 표시됩니다.</p>
    </section>`;
}
function captureSetup(p) {
  const connection = (data.captureConnections || []).find((c) => c.productId === p.id);
  const plan = ui.hookPlan?.productId === p.id ? ui.hookPlan : null;
  return html`<section class="capture-setup section">
      <div class="row between">
        <h2>Codex 작업 자동 수집</h2>
        <span class="small muted">
          ${!p.codexCaptureEnabled ? tr('꺼짐') : connection ? tr`최근 수집 ${date(connection.lastReceivedAt)}` : tr('첫 이벤트 수신 대기')}
        </span>
      </div>
      <p class="small muted gap">이 제품에서 파일 변경·검사 명령이 있었던 응답을 기록합니다. 일반 대화, 사용자 프롬프트와 전체 대화 로그는 수집하지 않습니다.</p>
      <div class="actions">
        ${button(tr('연결 설정 확인'), `codex-prepare:${p.id}`)}
        ${button(tr('Codex 실행 환경·MCP 설정'), 'nav:connection', 'class="plain"')}
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
        <label>답변 후 재개할 작업
          <select name="targetTaskId"><option value="">기록만 저장</option>
          ${data.tasks
            .filter(
              (t) =>
                t.kind === 'agent' &&
                ['investigation', 'change'].includes(t.mode) &&
                !t.activeRunId &&
                [
                  'stopped',
                  'interrupted',
                  'failed',
                  'needs_review',
                  'check_failed',
                  'changes_requested',
                ].includes(t.status),
            )
            .map((t) => `<option value="${t.id}">${e(t.title)}</option>`)
            .join('')}
          </select>
        </label>
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
    header(
      tr('외부 도구 연결'),
      tr(
        'Codex 등 외부 도구에서 작업실 기록을 읽고 결과를 보내는 연결입니다. 작업실 AI의 계정과 실행은 AI 실행 탭에서 설정합니다.',
      ),
    ) +
    codexConnectionView() +
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
  // Everything that belongs to this product, in one screen: folder, goal, automation, checks,
  // and Codex collection. App-wide settings live under Settings in the sidebar.
  return (
    header(tr('제품 설정'), p.name) +
    folderSection(p) +
    html`<section class="section">
        <h2>제품 목표</h2>
        <form data-form="goal" data-id="${p.id}" class="form gap">
          ${field('goal', tr('이 제품에서 이루고 싶은 것'), p.goal, 'textarea', 'maxlength="2000"')}
          <div>
            <button type="submit">목표 저장</button>
          </div>
        </form>
      </section>` +
    operationSettings(p, data) +
    captureSetup(p) +
    codexApproval(p)
  );
}

export function publishAccountPage() {
  return (
    header(
      tr('공개 계정'),
      tr(
        '검토한 포트폴리오를 웹에 공개할 때 쓰는 계정입니다. 모든 대상이 같은 계정을 사용하고, 공개할 프로젝트는 대상마다 정합니다.',
      ),
    ) + publicationCredentialsForm(data)
  );
}

export function appSettingsPage() {
  return (
    header(tr('일반'), tr('모든 제품에 공통으로 적용되는 화면 언어와 실행 방식입니다.')) +
    html`<section class="section">
      <h2>화면 언어</h2>
      <p id="language-description" class="small muted">메뉴와 안내의 언어를 바꿉니다. 작성한 기록과 모델 응답의 원문은 유지합니다.</p>
      <div class="form gap">
        <label for="app-language">Language / 언어</label>
        <select id="app-language" aria-describedby="language-description" ${ui.busy ? 'disabled' : ''}>
          <option value="ko" ${getLanguage() === 'ko' ? 'selected' : ''}>한국어</option>
          <option value="en" ${getLanguage() === 'en' ? 'selected' : ''}>English</option>
        </select>
        <p class="small muted">선택하면 바로 적용되며 다음 실행에도 유지됩니다.</p>
      </div>
    </section>
    <section class="section">
      <h2>백그라운드 실행</h2>
      <p class="small muted">창을 닫은 뒤의 실행 방식을 정합니다. 컴퓨터와 앱이 실행 중일 때만 작업을 진행합니다.</p>
      <form class="form gap" data-form="background-mode">
        <label class="check-option"><input type="checkbox" name="background" ${data.runtime?.background ? 'checked' : ''}>창을 닫아도 트레이에서 계속 실행</label>
        <div><button type="submit">실행 방식 저장</button></div>
      </form>
    </section>`
  );
}
