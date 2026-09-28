import { t as tr, localizedLabels, getLocale } from '../shared/i18n.mjs';
import { managedDetail, automationOrigin } from './operations-ui.js';
import { changeDetail } from './change-ui.js';
import { taskJourney, connectedOutcome } from './product-overview.js';
import { html, e } from './html.js';
const runStates = localizedLabels({
  completed: '결과 저장',
  running: '진행 중',
  failed: '미완료',
  stopping: '종료 확인 중',
  interrupted: '중단됨',
  discarded: '현재 결과에 미반영',
});
const button = (label, action, extra = '') =>
  `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const heading = (title, subtitle) =>
  html`<header class="heading">
      <div>
        <h1>${e(title)}</h1>
        <p>${e(subtitle)}</p>
      </div>
    </header>`;
const stageLabels = localizedLabels({
  investigate: '제품 조사',
  review: '근거 확인',
  knowledge: '재사용 기록 정리',
});
export const agentLabels = localizedLabels({
  queued: '실행 대기',
  running: '진행 중',
  stopping: '종료 확인 중',
  stopped: '중지됨',
  interrupted: '중단 후 복원',
  waiting_auth: '계정 연결 대기',
  waiting_quota: '사용 한도 대기',
  waiting_decision: '판단 답변 대기',
  failed: '재개 필요',
  needs_review: '최신 근거 확인 필요',
  accepted: '결과 정리 완료',
});
Object.assign(agentLabels, {
  check_failed: '검사 실패',
  changes_requested: '보완 필요',
  awaiting_apply: '반영 검토 대기',
  applying: '반영 중',
  apply_conflict: '원본 변경 확인',
  apply_partial: '반영 상태 확인',
});
const accountLabels = localizedLabels({
  starting: '실행기 준비 중',
  disconnected: '계정 연결 전',
  logging_in: '로그인 대기',
  connected: '연결됨 · 실행 미확인',
  checking: '모델 사용 확인 중',
  ready: '실행 가능',
  needs_login: '재로그인 필요',
  limited: '사용 한도 대기',
  access_denied: '모델 접근 확인 필요',
  network_error: '네트워크 확인 필요',
  storage_error: '보호 저장소 확인 필요',
  offline: '실행기 연결 끊김',
  error: '연결 확인 필요',
});
export const accountLabel = (runtime) => accountLabels[runtime?.state] || tr('계정 연결');
function accountMessage(runtime) {
  if (runtime.failure?.message) return runtime.failure.message;
  if (runtime.state === 'ready')
    return tr`${runtime.verifiedModel}의 실제 모델 응답을 확인했습니다.`;
  if (runtime.connected)
    return tr(
      '로그인을 저장했습니다. 모델 확인 또는 첫 조사 요청으로 실제 사용 가능 여부를 확인합니다.',
    );
  return tr('ChatGPT 로그인은 시스템 브라우저에서 진행됩니다.');
}
function stageMessage(task) {
  if (task.message) return task.message;
  if (task.status === 'queued') return tr('차례가 되면 이 단계를 시작합니다.');
  if (task.status === 'running') return tr('소스와 기록을 확인하고 있습니다.');
  if (task.status === 'accepted')
    return tr('인용 파일의 버전을 확인하고 관련 기록에 연결했습니다.');
  return task.reason;
}
function nextStage(task) {
  if (task.retryAt)
    return tr`자동 재시도 예정: ${new Date(task.retryAt).toLocaleString(getLocale())}. 지금 재개를 누르면 예약을 앞당깁니다.`;
  if (task.status === 'waiting_auth')
    return tr('먼저 계정을 연결하세요. 연결이 복구되면 대기 중인 작업을 이어갑니다.');
  if (task.status === 'waiting_quota')
    return tr('계정의 사용 한도를 확인한 뒤 이 단계부터 재개하세요.');
  if (['failed', 'stopped', 'interrupted'].includes(task.status))
    return tr(
      '위 중단 원인을 해결한 뒤 이 단계부터 재개하세요. 연결 오류라면 계정과 모델을 먼저 확인하세요.',
    );
  if (task.status === 'needs_review')
    return tr('변경된 근거를 확인한 뒤 최신 상태로 다시 조사하세요.');
  if (task.status === 'waiting_decision') return tr('판단 요청에 답하면 연결된 작업을 이어갑니다.');
  if (task.status === 'accepted') return tr('저장된 결과를 확인하고 필요한 후속 작업을 맡기세요.');
  if (task.stage === 'investigate') return tr('다음: 별도 세션에서 근거 확인');
  if (task.stage === 'review') return tr('다음: 조건부 기록 정리');
  return tr('개발 결과와 별개로 재사용 기록을 정리합니다.');
}
export function accountPage(runtime = {}) {
  const logging = runtime.state === 'logging_in',
    models = runtime.models || [];
  return (
    heading(
      tr('내장 에이전트 연결'),
      tr('Workroom AI가 제품 조사·수정·검토와 포트폴리오 초안을 작성하는 연결입니다.'),
    ) +
    html`<p class="small muted">외부 Codex에서 기록을 읽고 결과를 보내려면 사이드바의 Codex 연결을 사용하세요.</p>` +
    html`
    <section class="task-outcome">
        <h2>${e(accountLabel(runtime))}</h2>
        <p>
          ${e(accountMessage(runtime))}
        </p>
      </section>
    ${
      logging
        ? html`<section class="section">
        <h2>브라우저에서 로그인을 마쳐주세요</h2>
        <p class="muted gap">완료하면 이 화면이 자동으로 갱신됩니다.</p>
        ${
          runtime.device
            ? html`<div class="note">
            <strong>${e(runtime.device.code)}</strong>
            <p>${e(runtime.device.url)}</p>
          </div>`
            : ''
        }
        <div class="actions">${button(tr('로그인 취소'), 'runtime-cancel-login')}</div>
        ${
          runtime.manual
            ? html`<details>
            <summary>브라우저 완료 후 앱으로 돌아오지 않는 경우</summary>
            <form data-form="runtime-manual" class="form gap">
              <label for="oauth-code">완료된 브라우저의 주소 또는 코드</label>
              <input id="oauth-code" name="value" type="password" autocomplete="off" maxlength="4096"
              required>
              <button type="submit">로그인 완료 연결</button>
            </form>
          </details>`
            : ''
        }
      </section>`
        : html`<div class="actions">
        ${button(runtime.connected ? tr('다른 계정으로 로그인') : tr('ChatGPT 계정으로 로그인'), 'runtime-login', 'class="primary"')}
          ${button(tr('기기 코드로 로그인'), 'runtime-device', 'class="plain"')}
          ${runtime.connected || runtime.state === 'storage_error' ? button(tr('이 앱의 연결 해제'), 'runtime-logout', 'class="plain"') : ''}
          ${['offline', 'error'].includes(runtime.state) ? button(tr('실행기 다시 연결'), 'runtime-restart') : ''}
      </div>`
    }
    <section class="section">
        <h2>작업에 사용할 모델</h2>
        <p class="muted gap">Pi가 제공하는 목록입니다. 계정의 실제 사용 권한은 요청 시 확인합니다.</p>
        ${
          models.length
            ? html`<form data-form="runtime-model" class="form gap">
        <label for="runtime-model">모델</label>
        <select id="runtime-model" name="modelId" required>
          <option value="">선택하세요</option>
          ${models.map((m) => `<option value="${e(m.id)}" ${runtime.modelId === m.id ? 'selected' : ''}>${e(m.name || m.id)}</option>`).join('')}
        </select>
        <div class="actions">
          <button type="submit">모델 저장</button>
          ${runtime.connected && runtime.modelId ? button(tr('짧은 요청으로 연결 확인'), 'runtime-verify') : ''}
        </div>
      </form>`
            : tr('<p class="small muted gap">실행기가 연결되면 모델 목록이 나타납니다.</p>')
        }
      </section>
    <section class="section">
        <h2>실행 관리</h2>
        <p class="gap">현재 ${runtime.active || 0}개 실행 중 · 최대 ${runtime.maxConcurrent || 2}개 병렬 실행</p>
        <div class="actions">
          ${button(runtime.paused ? tr('대기 작업 계속 실행') : tr('새 실행 일시 정지'), 'runtime-pause')}
        </div>
        <p class="small muted gap">일시 정지는 다음 단계와 새 작업의 시작을 막습니다. 현재 실행은 작업 상세에서 중지할 수 있습니다. 앱을 종료하면 실행도 끝나며
        다음
        시작 때 중단된 작업으로 복원합니다.</p>
      </section>
    <details>
        <summary>연결과 자료 사용 범위</summary>
        <p class="small muted gap">이 앱의 인증 정보는 운영체제 보호 저장소로 암호화해 보관합니다. 기존 Codex·Pi의 로그인을 가져오지 않습니다. 연결 해제는 이
        앱에 저장한 정보만 제거합니다.</p>
        <p class="small muted gap">맡긴 작업 목표, 관련 기록, 도구로 읽은 소스·문서 일부가 선택한 OpenAI 모델에 전달됩니다. 계정의 사용 한도를 모든 역할이
        함께 사용합니다. 역할을 늘려도 한도가 늘지 않습니다.</p>
      </details>`
  );
}
export function agentDetail(task, data) {
  if (['operation', 'portfolio'].includes(task.mode)) return managedDetail(task, data);
  if (task.mode === 'change') return changeDetail(task, data);
  const runs = (data.agentRuns || [])
    .filter((r) => r.taskId === task.id)
    .sort((a, b) => a.created.localeCompare(b.created));
  const evidence = (data.agentEvidence || []).filter((r) => r.taskId === task.id);
  const contexts = (data.agentContexts || []).filter((r) => r.taskId === task.id);
  const result = task.outputs?.investigate?.result,
    review = task.outputs?.review?.result;
  const canResume = ['stopped', 'interrupted', 'failed', 'waiting_quota', 'needs_review'].includes(
    task.status,
  );
  return (
    heading(task.title, tr`${agentLabels[task.status] || task.status} · 읽기 전용 조사`) +
    html`
    ${automationOrigin(task, data)}${taskJourney(task)}
    ${
      result && review?.verdict === 'supported'
        ? html`<section class="next-work">
        <div>
          <h2>조사에서 다음 작업으로</h2>
          <p>${e(result.nextStep)}</p>
        </div>
        ${button(tr('이 조사로 수정안 맡기기'), `agent-followup:${task.id}`, 'class="primary"')}
      </section>`
        : ''
    }
    <section class="task-outcome">
        <h2>
          ${task.status === 'accepted' ? tr('조사 결과를 저장했습니다') : e(stageLabels[task.stage])}
        </h2>
        <p>
          ${e(stageMessage(task))}
        </p>
        <p class="small muted gap">
          ${nextStage(task)}
        </p>
      </section>
    <div class="actions">
        ${task.retryAt || ['running', 'queued', 'waiting_auth', 'waiting_decision'].includes(task.status) ? button(tr('이 작업 중지'), `agent-stop:${task.id}`) : ''}
        ${canResume ? button(task.status === 'needs_review' ? tr('최신 상태로 다시 조사') : tr('이 단계부터 재개'), `agent-resume:${task.id}`) : ''}
        ${task.status === 'waiting_decision' ? button(tr('판단 요청 보기'), `task:${task.decisionId}`) : ''}
        ${['waiting_auth', 'waiting_quota', 'failed'].includes(task.status) ? button(tr('계정 연결 보기'), 'nav:account', 'class="plain"') : ''}
        ${task.resultTaskId ? button(tr('저장된 결과와 기록'), `task:${task.resultTaskId}`) : ''}
      </div>
    ${
      result
        ? html`<section class="section">
        <h2>조사 내용</h2>
        <p class="gap preserve-lines">${e(result.summary)}</p>
        ${result.findings
          .map(
            (f) => html`<article class="record">
            <h3>${e(f.title)}</h3>
            <p class="gap preserve-lines">${e(f.detail)}</p>
            <p class="small muted gap">
              ${f.evidenceIds.map((id) => e(evidence.find((x) => x.id === id)?.path || tr('근거 기록'))).join(' · ')}
            </p>
          </article>`,
          )
          .join('')}
        <p class="small muted gap">확인하지 못한 범위: ${e(result.limitations)}</p>
        <p class="gap">다음 제안: ${e(result.nextStep)}</p>
      </section>`
        : ''
    }
    ${
      review
        ? html`<section class="section">
        <h2>별도 세션의 근거 확인</h2>
        <p class="gap preserve-lines">${e(review.assessment)}</p>
        <p class="small muted gap">${e(review.limitations)} · 소스 검토이며 기능 테스트 통과를 의미하지 않습니다.</p>
      </section>`
        : ''
    }
    ${connectedOutcome(task, data)}
    <details class="section">
        <summary>역할별 실행 · ${runs.length}회</summary>
        ${runs
          .map(
            (r) => html`<article class="record">
        <h3>${e(stageLabels[r.role])} · ${e(runStates[r.status] || r.status)}
        </h3>
        <p class="small muted gap">${e(r.modelId)} · ${r.turns || 0}턴 ·
        관측 ${Number(r.tokens || 0).toLocaleString(getLocale())} 토큰 · 파일 도구 ${r.toolCalls || 0}회</p>
        <p class="small muted gap">실행 ID ${e(r.id)}</p>
        ${r.failure ? `<p class="gap">${e(r.failure.message)}</p>` : ''}
      </article>`,
          )
          .join('')}
      </details>
    <details class="section">
        <summary>읽은 파일 근거 · ${evidence.length}건</summary>
        ${evidence
          .map(
            (x) => html`<details class="record">
        <summary>${e(x.path)}${x.truncated ? tr(' · 일부 발췌') : ''}</summary>
        <p class="small muted gap">SHA256 ${e(x.hash)}</p>
        <pre>${e(x.content)}</pre>
      </details>`,
          )
          .join('')}
      </details>
    <details class="section">
        <summary>역할에 제공한 이전 기록</summary>
        <p class="small muted gap">같은 제품에서 목표 검색어와 일치하고 유효한 기록을 제공합니다. 제공했다는 사실이며 모델의 실제 활용 확인은 아닙니다.</p>
        ${contexts
          .map(
            (c) => html`<article class="record">
        <h3>
          ${e(stageLabels[runs.find((r) => r.id === c.runId)?.role])} · ${c.context.records.length}건</h3>
        ${c.context.records
          .map(
            (r) => html`<details class="gap">
            <summary>${e(r.title)} · v${r.revision}</summary>
            <p class="gap preserve-lines">${e(r.content)}</p>
            <p class="small muted gap">적용 조건: ${e(r.scope)}</p>
            ${button(tr('현재 기록 보기'), `record-detail:${r.id}`, 'class="plain"')}
          </details>`,
          )
          .join('')}
      </article>`,
          )
          .join('')}
      </details>`
  );
}
