import { e } from './html.js';
const b = (label, action, extra = '') =>
  `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const date = (x) =>
  x
    ? new Date(x).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '아직 없음';
const policy = (p, data) =>
  data.operationPolicies?.find((x) => x.productId === p.id) || {
    version: 0,
    enabled: false,
    intervalMinutes: 60,
    maxDailyStarts: 4,
    allowChanges: false,
    testFiles: [],
    maxRepairs: 0,
  };
const issueLabels = {
  proposed: '조사 예정',
  investigating: '조사 중',
  awaiting_scope: '수정 범위 확인',
  preparing_change: '수정안 준비',
  awaiting_apply: '원본 반영 검토',
  completed: '처리 완료',
  deferred: '보류',
};
export function operationStatus(p, data) {
  const s = policy(p, data);
  return s.enabled
    ? `지속 운영 켜짐 · 다음 확인 ${date(s.nextAt)}`
    : '지속 운영 꺼짐 · 직접 맡긴 작업만 실행';
}
export function operationOverview(p, data) {
  const s = policy(p, data);
  return `<section class="overview-section operation-overview"><div class="section-title"><h2>지속 운영</h2>${b('설정', 'nav:scope', 'class="link"')}</div><p class="small muted">${e(operationStatus(p, data))}</p><p class="small muted">최근 확인 ${date(s.lastAt)}${s.enabled ? ` · 오늘 ${data.tasks.filter((t) => t.productId === p.id && t.automation?.day === new Date().toLocaleDateString('sv-SE')).length}/${s.maxDailyStarts}개 시작` : ''}</p>${s.lastReason ? `<p class="small muted">${e(s.lastReason)}</p>` : ''}<div class="actions">${b('지금 확인', `operation-check:${p.id}`)}</div></section>`;
}
export function operationIssues(p, data) {
  const issues = (data.operationIssues || [])
    .filter((x) => x.productId === p.id && !['completed', 'deferred'].includes(x.status))
    .sort(
      (a, b) =>
        ({ high: 0, normal: 1, low: 2 })[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority],
    );
  if (!issues.length) return '';
  return `<section class="overview-section"><div class="section-title"><h2>발견된 문제 <span>${issues.length}</span></h2></div><div class="operation-issues">${issues.map((i) => `<article class="operation-issue"><div class="row between"><strong>${e(i.title)}</strong><span class="small muted">${i.priority === 'high' ? '우선' : i.priority === 'low' ? '낮음' : '보통'} · ${e(issueLabels[i.status])}</span></div><p class="small muted gap">${e(i.reason)}</p><div class="actions">${b('발견 근거', `task:${i.operationTaskId}`, 'class="link"')}${i.changeTaskId || i.investigationId ? b('연결된 작업', `task:${i.changeTaskId || i.investigationId}`, 'class="link"') : b('조사 시작', `issue-start:${i.id}`, 'class="plain"')}${b('보류', `issue-defer:${i.id}`, 'class="link"')}</div></article>`).join('')}</div></section>`;
}
export function operationSettings(p, data) {
  const s = policy(p, data);
  return `<section class="section"><h2>지속 운영</h2><p class="small muted gap">앱 실행 중 정해진 간격으로 소스와 목표의 변화를 확인합니다. 변화가 없으면 모델을 호출하지 않습니다. 놓친 일정은 다음 실행에 한 번으로 합칩니다.</p><form class="form gap" data-form="operation-policy" data-id="${p.id}" data-version="${s.version}"><label class="check-option"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}>이 제품의 지속 운영 켜기</label><div class="formgrid"><div><label for="operation-interval">확인 간격</label><select id="operation-interval" name="intervalMinutes">${[
    [15, '15분'],
    [60, '1시간'],
    [360, '6시간'],
    [1440, '하루'],
  ]
    .map(
      ([v, l]) => `<option value="${v}" ${s.intervalMinutes === v ? 'selected' : ''}>${l}</option>`,
    )
    .join(
      '',
    )}</select></div><div><label for="operation-limit">하루 새 작업 한도</label><input id="operation-limit" name="maxDailyStarts" type="number" min="1" max="12" value="${s.maxDailyStarts}" required></div></div><p class="small muted">운영 판단·후속 조사·수정안이 각각 1개로 계산됩니다. 단계별 시간·턴 한도와 전체 2개 병렬 한도도 적용합니다.</p><label class="check-option"><input type="checkbox" name="allowChanges" ${s.allowChanges ? 'checked' : ''}>근거 검토를 마친 구체적인 문제는 수정안까지 자동으로 작성</label><p class="small muted">원본 반영은 변경과 검사 결과를 보고 결정합니다.</p><details ${s.testFiles.length ? 'open' : ''}><summary>자동 수정안의 테스트와 보완</summary><label for="operation-tests" class="gap">Node 테스트 경로 · 한 줄에 하나</label><textarea id="operation-tests" name="testFiles" placeholder="tests/input.test.mjs">${e(s.testFiles.join('\n'))}</textarea><label class="check-option"><input type="checkbox" name="allowTests" ${s.allowChanges && s.testFiles.length ? 'checked' : ''}>지정 테스트에서 제품 코드를 실행하도록 허용</label><p class="small muted">별도 복사본에서 실행하며 테스트를 수정하지 않습니다. 완전한 OS·네트워크 격리는 아닙니다.</p><label class="check-option"><input type="checkbox" name="repairOnce" ${s.maxRepairs ? 'checked' : ''}>검사 실패·검토 보완은 같은 작업에서 최대 1회 다시 작성</label></details><div class="actions"><button type="submit" class="primary">운영 범위 저장</button>${b('지금 확인', `operation-check:${p.id}`, 'class="plain"')}</div><p class="small muted">설정을 바꾸면 이전 범위의 자동 작업을 중지합니다. 직접 맡긴 작업은 유지합니다.<br>${e(s.lastReason || '아직 운영 범위를 저장하지 않았습니다.')}</p></form></section>`;
}
export function managedDetail(task, data) {
  const op = task.mode === 'operation',
    result = task.outputs?.coordinate?.result,
    edit = data.portfolioEdits?.find((e) => e.id === task.editId);
  const runs = (data.agentRuns || []).filter((r) => r.taskId === task.id),
    evidence = (data.agentEvidence || []).filter((r) => r.taskId === task.id);
  return `<header class="heading"><div><p class="eyebrow">${op ? '제품 운영 판단' : '대상별 포트폴리오 편집'}</p><h1>${e(task.title)}</h1><p>${e(task.status === 'accepted' ? '결과 저장 완료' : task.status === 'running' ? '진행 중' : task.status)}</p></div></header><p>${e(task.message || task.goal)}</p><div class="actions">${['running', 'queued', 'waiting_auth'].includes(task.status) ? b('이 작업 중지', `agent-stop:${task.id}`) : ''}${op ? b('제품 개요', 'nav:home') : b('대상 초안 보기', `target:${task.portfolioId}`)}</div>${result ? `<section class="section"><h2>다음 작업 판단</h2><p class="gap">${e(result.summary)}</p>${result.issues.map((i) => `<article class="record"><h3>${e(i.title)}</h3><p class="gap">${e(i.reason)}</p><p class="small muted gap">${e(i.goal)}<br>근거: ${i.evidenceIds.map((id) => e(evidence.find((f) => f.id === id)?.path || id)).join(' · ')}</p></article>`).join('') || '<p class="small muted gap">이번 관측에서 새로 맡길 문제를 제안하지 않았습니다.</p>'}<p class="small muted gap">${e(result.limitations)}</p></section>` : ''}${edit ? portfolioEditResult(edit) : ''}<details class="section"><summary>실행과 근거 · ${runs.length}회</summary>${runs.map((r) => `<p class="small gap">${e(r.role)} · ${e(r.status)} · ${r.turns || 0}턴 · ${Number(r.tokens || 0).toLocaleString()} 토큰</p>`).join('')}${evidence.map((f) => `<details class="record"><summary>${e(f.path)}</summary><pre>${e(f.content)}</pre></details>`).join('')}</details>`;
}
export function automationOrigin(task, data) {
  if (!task.automation) return '';
  const issue = data.operationIssues?.find((i) => i.id === task.automation.issueId);
  return `<div class="operation-origin"><strong>운영에서 이어진 작업</strong><p>${e(task.reason || '정해진 운영 범위에서 시작했습니다.')} · 보완 ${task.automation.repairs || 0}회</p>${issue ? b('문제를 발견한 근거', `task:${issue.operationTaskId}`, 'class="link"') : ''}</div>`;
}
function portfolioEditResult(edit) {
  const labels = {
    writing: '초안 작성 중',
    reviewing: '근거 검토 중',
    proposed: '검토를 통과한 제안',
    applied: '초안에 반영됨',
    needs_review: '주장 보완 필요',
    stale: '기준 변경으로 보류',
    failed: '실행 중단',
    stopped: '중지됨',
  };
  return `<section class="section portfolio-agent-result"><h2>${e(labels[edit.status] || edit.status)}</h2>${edit.message ? `<p class="small muted gap">${e(edit.message)}</p>` : ''}${edit.proposal ? `<details class="gap"><summary>제안 문장과 선정 근거</summary><p class="gap">${e(edit.proposal.intro)}</p>${edit.proposal.entries.map((x) => `<article class="record"><h3>${e(x.title)}</h3><p class="gap">${e(x.description)}</p><p class="small muted gap">기여: ${e(x.contribution)}<br>선정: ${e(x.reason)}</p>${x.citations.map((c) => `<blockquote>${e(c.quote)} ${b('출처 보기', `task:${c.taskId}`, 'class="link"')}</blockquote>`).join('')}</article>`).join('')}<p class="small muted gap">${e(edit.proposal.limitations)}</p></details>` : ''}${edit.review ? `<p class="small muted gap">별도 검토: ${e(edit.review.assessment)}<br>${e(edit.review.limitations)}</p>` : ''}${edit.status === 'proposed' ? `<div class="actions">${b('검토한 제안 반영', `portfolio-apply:${edit.id}`)}</div><p class="small muted">직접 쓴 문장·순서·제외는 보존하고 자동으로 관리되는 부분을 반영합니다.</p>` : ''}</section>`;
}
export function portfolioAgentPanel(p, data) {
  const edit = (data.portfolioEdits || []).find((x) => x.portfolioId === p.id);
  return `<section class="portfolio-agent-panel"><div class="section-title"><h2>이 대상에게 맞는 경험 정리</h2><span class="small muted">${p.autoEdit ? '새 근거에서 자동 편집 · 하루 최대 2회' : '직접 요청할 때 편집'}</span></div><p class="small muted">저장한 대상 요구와 작업 결과에서 사례를 선택하고 별도로 근거를 검토합니다. 자동 편집도 직접 쓴 문장과 제외한 사례를 보존합니다.</p><div class="actions">${b('대상에 맞게 정리', `portfolio-edit:${p.id}`)}${b(p.autoEdit ? '자동 편집 끄기' : '새 결과 자동 편집 켜기', `portfolio-auto:${p.id}`, 'class="plain"')}</div>${edit ? portfolioEditResult(edit) : ''}</section>`;
}
