import { automationOrigin } from './operations-ui.js';
import { taskJourney, connectedOutcome } from './product-overview.js';
const e = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const button = (label, action, extra = '') =>
  `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const header = (title, subtitle) =>
  `<header class="heading"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div></header>`;
const roles = {
  develop: '수정안 작성',
  check: '수정본 검사',
  change_review: '별도 변경 검토',
  knowledge: '재사용 기록 정리',
};
const states = {
  queued: '실행 대기',
  waiting_auth: '계정 연결 대기',
  running: '진행 중',
  stopping: '종료 확인 중',
  stopped: '중지됨',
  interrupted: '중단 후 복원',
  failed: '재개 필요',
  needs_review: '근거 재확인 필요',
  waiting_quota: '사용 한도 대기',
  check_failed: '검사 실패',
  changes_requested: '보완 필요',
  awaiting_apply: '반영 검토 대기',
  applying: '작업 폴더에 반영 중',
  apply_conflict: '원본 변경 확인 필요',
  apply_partial: '반영 상태 확인 필요',
  accepted: '반영·기록 완료',
};
const outcome = {
  passed: '통과',
  failed: '실패',
  unconfirmed: '미확인',
  cancelled: '중지됨',
  timeout: '시간 초과',
  output_limit: '출력 한도 초과',
};

// A bounded line diff keeps long files readable while showing every changed line.
function lines(before, after) {
  const a = before === null ? [] : before.split('\n'),
    b = after.split('\n');
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const output = [];
  if (prefix > 3) output.push({ kind: 'skip', text: `앞의 ${prefix - 3}줄 동일` });
  for (let i = Math.max(0, prefix - 3); i < prefix; i++)
    output.push({ kind: 'same', old: i + 1, new: i + 1, text: a[i] });
  for (let i = prefix; i < a.length - suffix; i++)
    output.push({ kind: 'remove', old: i + 1, text: a[i] });
  for (let i = prefix; i < b.length - suffix; i++)
    output.push({ kind: 'add', new: i + 1, text: b[i] });
  for (let i = 0; i < Math.min(suffix, 3); i++)
    output.push({
      kind: 'same',
      old: a.length - suffix + i + 1,
      new: b.length - suffix + i + 1,
      text: b[b.length - suffix + i],
    });
  if (suffix > 3) output.push({ kind: 'skip', text: `뒤의 ${suffix - 3}줄 동일` });
  return output;
}
function diff(change) {
  return `<details class="change-file" open><summary><code>${e(change.path)}</code><span class="small muted">${change.beforeHash ? '수정' : '새 파일'}</span></summary><pre class="change-diff" aria-label="${e(change.path)} 변경 전후"><code>${lines(
    change.before,
    change.after,
  )
    .map(
      (row) =>
        `<span class="diff-${row.kind}"><span class="diff-number">${row.old || ''}</span><span class="diff-number">${row.new || ''}</span><span class="diff-mark">${row.kind === 'remove' ? '−' : row.kind === 'add' ? '+' : ' '}</span>${e(row.text)}</span>`,
    )
    .join('\n')}</code></pre></details>`;
}
export function changeDetail(task, data) {
  const change = (data.agentChanges || []).find((c) => c.id === task.changeSetId);
  const checks = task.outputs.check?.result,
    review = task.outputs.change_review?.result;
  const runs = (data.agentRuns || [])
    .filter((r) => r.taskId === task.id)
    .sort((a, b) => a.created.localeCompare(b.created));
  const canApply = ['awaiting_apply', 'apply_conflict', 'apply_partial'].includes(task.status);
  const canResume = [
    'stopped',
    'interrupted',
    'failed',
    'needs_review',
    'waiting_quota',
    'check_failed',
    'changes_requested',
  ].includes(task.status);
  return (
    header(
      task.title,
      `${states[task.status] || task.status} · ${task.appliedAt ? '작업 폴더 반영됨' : '분리된 수정안'}`,
    ) +
    `
    ${task.sourceTaskId ? button('← 시작한 조사', `task:${task.sourceTaskId}`, 'class="link back"') : ''}${automationOrigin(task, data)}${taskJourney(task)}
    <section class="task-outcome"><h2>${e(task.status === 'awaiting_apply' ? '반영할 수정안이 준비됐습니다' : roles[task.stage])}</h2><p>${e(task.message || (task.status === 'running' ? '해당 단계의 결과와 근거를 확인하고 있습니다.' : task.reason))}</p><p class="small muted gap">${task.appliedAt ? '이후 기록 정리에 실패해도 반영된 코드와 검사 기록을 보존합니다.' : '아래에서 변경 전후와 실제 검사 범위를 확인할 수 있습니다.'}</p></section>
    <div class="actions">${['queued', 'running', 'waiting_auth'].includes(task.status) ? button('이 작업 중지', `agent-stop:${task.id}`) : ''}${canResume ? button(['check_failed', 'changes_requested', 'needs_review'].includes(task.status) ? '수정안 보완하기' : '이 단계부터 재개', `agent-resume:${task.id}`) : ''}${['waiting_auth', 'waiting_quota'].includes(task.status) ? button('계정 연결 보기', 'nav:account') : ''}${task.status === 'apply_conflict' ? button('최신 원본으로 새 수정안', `agent-replan:${task.id}`) : ''}${task.resultTaskId ? button('반영 결과와 기록', `task:${task.resultTaskId}`) : ''}</div>
    ${task.outputs.develop ? `<section class="section"><h2>수정 의도</h2><p class="gap preserve-lines">${e(task.outputs.develop.result.summary)}</p><p class="small muted gap">${e(task.outputs.develop.result.limitations)}</p></section>` : ''}
    ${change ? `<section class="section"><h2>변경 전후 · ${change.changes.length}개 파일</h2><p class="small muted gap">− 기존 코드 · + 수정 코드. 적용 시 원본과 이 수정본의 버전을 다시 확인합니다.</p><div class="gap">${change.changes.map(diff).join('') || '<p class="muted">아직 저장된 변경이 없습니다.</p>'}</div></section>` : ''}
    ${checks ? `<section class="section"><h2>앱이 실행한 검사</h2><p class="small muted gap">${e(checks.status === 'passed' ? '선택한 검사 범위 통과' : checks.status === 'unconfirmed' ? '일부 검사 범위 미확인' : '수정본 검사 확인 필요')} · 실제 서비스 배포 미실행</p>${checks.checks.map((c) => `<details class="record"><summary><strong>${e(c.name)}</strong> · ${e(outcome[c.result] || c.result)}</summary><pre>${e(c.output || '정상 종료')}</pre></details>`).join('')}<details class="small muted gap"><summary>검사 대상 버전</summary><p class="gap break-id">${e(checks.artifactHash)}</p></details></section>` : ''}
    ${review ? `<section class="section"><h2>별도 세션의 변경 검토</h2><p class="gap preserve-lines">${e(review.assessment)}</p><p class="small muted gap">${e(review.limitations)}</p></section>` : ''}
    ${canApply && change ? `<section class="section apply-review"><h2>이 수정본을 작업 폴더에 반영</h2><p class="gap">${change.changes.length}개 파일의 위 변경을 반영합니다. 원본의 다른 변경을 발견하면 멈춥니다. 반영 전후 내용과 검사 기록은 작업에 남습니다.</p><form data-form="change-apply" data-id="${task.id}" class="form gap">${checks?.status !== 'passed' ? '<label class="check-option"><input type="checkbox" name="acceptUnconfirmed" required>미확인 검사 범위를 읽었으며 이 수정본을 적용합니다.</label>' : ''}<div><button type="submit" class="primary">${task.status === 'apply_partial' ? '현재 파일 확인 후 나머지 반영' : '검토한 수정본 반영'}</button></div></form></section>` : ''}
    ${connectedOutcome(task, data)}
    ${change?.omitted?.length ? `<details class="section"><summary>복사에서 제외한 항목 · ${change.omitted.length}건</summary>${change.omitted.map((p) => `<p class="small muted gap">${e(p)}</p>`).join('')}</details>` : ''}
    <details class="section"><summary>역할별 실행 · ${runs.length}회</summary>${runs.map((r) => `<article class="record"><h3>${e(roles[r.role])} · ${e({ completed: '결과 저장', running: '진행 중', failed: '미완료', interrupted: '중단됨' }[r.status] || r.status)}</h3><p class="small muted gap">${r.role === 'check' ? '앱의 고정 검사' : e(r.modelId)} · ${r.turns || 0} 모델 턴</p>${r.failure ? `<p class="gap">${e(r.failure.message)}</p>` : ''}</article>`).join('')}</details>`
  );
}
