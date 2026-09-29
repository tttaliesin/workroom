import { t as tr } from '../shared/i18n.mjs';
import { projectWork, workReports, executionEvidence } from '../core/work-projection.mjs';
import { html, button, date, e, empty, field, header, icon } from './html.js';
import { productHome } from './product-overview.js';
import { agentDetail } from './runtime-ui.js';
import {
  actorLabel,
  data,
  labels,
  portfolioArea,
  product,
  provenance,
  requestDraft,
  rootTasks,
  shortStatus,
  ui,
} from './state.js';
export function taskNav(p) {
  return button(
    `${icon('product')}<span>${e(p.name)}</span>`,
    `product:${p.id}`,
    `class="product-button" title="${e(p.name)}" ${ui.productId === p.id && !portfolioArea() && !['dashboard', 'new-product', 'settings', 'account', 'connection', 'publish-account'].includes(ui.view) ? 'aria-current="page"' : ''}`,
  );
}
export function observation(p) {
  const connection = (data.captureConnections || []).find((c) => c.productId === p.id);
  const received = data.tasks
    .filter((t) => t.productId === p.id && ['work', 'inspection'].includes(t.kind))
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (connection?.lastReceivedAt && (!received || connection.lastReceivedAt >= received.created))
    return tr`마지막 자동 수집 · ${date(connection.lastReceivedAt)}`;
  if (received)
    return `${received.kind === 'work' ? tr('최근 보고 등록') : tr('마지막 폴더 점검')} · ${date(received.created)}`;
  return p.codexCaptureEnabled ? tr('설정됨 · 첫 수집 미확인') : tr('아직 받은 작업 보고 없음');
}
export function taskRows() {
  const tasks = rootTasks().filter(
    (t) =>
      t.productId === ui.productId && t.title.toLowerCase().includes(ui.taskQuery.toLowerCase()),
  );
  const row = (t) =>
    button(
      html`<span class="task-line">
          ${icon(t.status === 'needs_decision' || (t.kind === 'agent' && t.status !== 'accepted') ? 'pending' : t.kind === 'work' ? 'file' : 'check')}
          <span class="task-name">${e(t.title)}</span>
        </span>
        <span class="task-meta">
          <span>
            ${e(t.mode === 'change' && t.status === 'accepted' ? tr('반영·기록 완료') : shortStatus[t.status] || t.status)}
          </span>
          <time>${e(date(t.updated || t.created))}</time>
        </span>`,
      `task:${t.id}`,
      ui.taskId === t.id && ui.view === 'ops' ? 'aria-current="page"' : '',
    );
  if (!tasks.length)
    return `<p class="navempty">${ui.taskQuery ? tr('일치하는 작업이 없습니다.') : tr('아직 작업이 없습니다.')}</p>`;
  return [
    [tr('진행 중'), (t) => ['running', 'queued', 'stopping', 'applying'].includes(t.status)],
    [
      tr('판단·복구 대기'),
      (t) =>
        [
          'needs_decision',
          'waiting_auth',
          'waiting_quota',
          'interrupted',
          'failed',
          'needs_review',
          'check_failed',
          'changes_requested',
          'awaiting_apply',
          'awaiting_review',
          'apply_conflict',
          'apply_partial',
        ].includes(t.status),
    ],
    [tr('보류한 판단'), (t) => t.status === 'deferred'],
    [
      tr('작업과 결과'),
      (t) =>
        ![
          'running',
          'queued',
          'stopping',
          'applying',
          'needs_decision',
          'waiting_auth',
          'waiting_quota',
          'interrupted',
          'failed',
          'needs_review',
          'check_failed',
          'changes_requested',
          'awaiting_apply',
          'awaiting_review',
          'apply_conflict',
          'apply_partial',
          'deferred',
        ].includes(t.status),
    ],
  ]
    .map(([label, matches]) => {
      const group = tasks.filter(matches);
      return group.length
        ? html`<div class="task-group">
            <h3>${label}<span>${group.length}</span>
            </h3>${group.map(row).join('')}</div>`
        : '';
    })
    .join('');
}
export function taskPane() {
  if (portfolioArea())
    return html`<section class="taskpane" aria-label="대상 탐색">
        <div class="pane-heading">
          <h2>포트폴리오 대상</h2>
          ${button(tr('상세로 돌아가기'), 'toggle-list', 'class="plain list-toggle"')}
        </div>
        <nav class="tasknav" aria-label="포트폴리오 대상">
          ${
            data.portfolios
              .map((p) =>
                button(
                  html`<span class="task-name">${e(p.target)}</span>
            <span class="task-meta">${p.entries.length}개 사례 · 로컬 초안</span>`,
                  `target:${p.id}`,
                  ui.portfolioId === p.id ? 'aria-current="page"' : '',
                ),
              )
              .join('') || tr('<p class="navempty">아직 대상이 없습니다.</p>')
          }
        </nav>
        <div class="pane-footer">
          ${button(tr('대상 추가'), 'nav:new-target', 'class="plain"')}
        </div>
      </section>`;
  return html`<section class="taskpane" aria-label="작업 탐색">
      <div class="pane-heading">
        <h2>모든 작업</h2>
      </div>
      <div class="task-search">
        <input id="task-query" aria-label="작업 검색" placeholder="작업 검색…" value="${e(ui.taskQuery)}">
      </div>
      <nav class="tasknav" aria-label="작업 목록">${taskRows()}</nav>
      <div class="pane-footer">
        <div class="actions work-record-actions">${button(tr('작업 결과 기록'), 'nav:new-work', 'class="plain"')}${button(tr('판단 요청 만들기'), 'nav:new-decision', 'class="plain"')}</div>
        <p class="observation small muted">
          ${product() ? e(observation(product())) : ''}
        </p>
      </div>
    </section>`;
}
function artifact(t) {
  const targets = data.portfolios.filter((p) => p.entries.some((x) => x.taskId === t.id));
  return html`<section class="artifact-section">
      <h2>포트폴리오</h2>
      <div class="artifact-row">${icon('page')}<div>
          <strong>
            ${e(targets.map((p) => p.target).join(', ') || tr('이 작업을 사례로 활용'))}
          </strong>
          <p>
            ${targets.length ? tr('대상별 초안에 포함됨 · 공개 버전은 대상 화면에서 확인') : tr('저장한 작업에서 대상별 소개를 작성합니다.')}
          </p>
        </div>
        ${button(tr('초안 열기 →'), `task-portfolio:${t.id}`, tr('class="plain artifact-open" aria-label="포트폴리오 초안 보기"'))}
      </div>
    </section>`;
}
function relatedRecords(t) {
  const records = data.records.filter((r) => r.sourceTaskId === t.id);
  return html`<details class="related" data-related ${ui.relatedOpen ? 'open' : ''}>
      <summary>관련 기록${records.length ? ` · ${records.length}` : ''}
      </summary>
      ${
        records.length
          ? records
              .map(
                (r) => html`<article class="record">
          <h3>${e(r.title)}</h3>
          <p class="small muted gap">적용: ${e(r.scope)} · ${e(provenance[r.provenance])}</p>
          <p class="gap">${e(r.content)}</p>
          <div class="row gap">
            ${button(r.active ? tr('자동 참조에서 제외') : tr('다시 포함'), `record-toggle:${r.id}`)}
            <span class="small muted">${r.active ? tr('MCP 조회에 포함') : tr('MCP 조회에서 제외')}</span>
          </div>
        </article>`,
              )
              .join('')
          : tr('<p class="muted gap">이 작업에 연결된 기록이 없습니다.</p>')
      }
    </details>`;
}
export function operations() {
  if (!data.products.length)
    return html`<div class="empty">
        <h1>제품 등록</h1>
        <p class="muted gap">개발 중인 제품의 폴더를 선택하세요. 점검과 에이전트가 보고한 작업을 제품별로 모아 볼 수 있습니다.</p>
        <div class="actions">
          ${button(tr('첫 제품 등록'), 'nav:new-product', 'class="primary"')}
        </div>
      </div>`;
  const selected = data.tasks.find((t) => t.id === ui.taskId && t.productId === ui.productId);
  return selected
    ? tr`<section class="detail" aria-label="작업 상세">${taskDetail(selected)}</section>`
    : productWelcome();
}
function taskDetail(t) {
  if (t.kind === 'agent') return agentDetail(t, data);
  const base = header(t.title, `${labels[t.status]} · ${date(t.created)}`, '');
  if (t.kind === 'decision')
    return (
      base +
      html`<p>${e(t.reason)}</p>
        ${
          t.status === 'decided'
            ? html`<div class="note">
            <h2>${e(t.options[t.selected].label)}</h2>
            <p>${e(t.options[t.selected].effect)}</p>
          </div>
          <p class="muted small gap">${t.targetTaskId ? tr('답변을 저장하고 연결된 작업의 재개를 예약했습니다.') : tr('결정이 기록되었습니다. 연결 작업이 없는 판단은 다음 조회에서 참고할 기록으로 보관합니다.')}</p>
          ${t.targetTaskId ? button(tr('연결된 작업'), `task:${t.targetTaskId}`) : ''}${relatedRecords(t)}`
            : html`<form data-form="decision" data-id="${t.id}">
            <fieldset>
              <legend>적용할 방침</legend>
              ${t.options
                .map(
                  (o, i) => html`<label class="choice">
            <input type="radio" name="option" value="${i}" required>
            <span>${e(o.label)}<span class="small muted">${e(o.effect)}</span>
            </span>
          </label>`,
                )
                .join('')}
            </fieldset>
            <div class="actions">
              <button type="submit" class="primary">결정 저장</button>
              ${button(t.status === 'deferred' ? tr('보류 해제') : tr('보류'), `defer:${t.id}`)}
            </div>
          </form>`
        }`
    );
  if (t.kind === 'inspection')
    return (
      base +
      html`<p>폴더에서 직접 확인한 내용입니다. 코드 수정과 테스트 실행은 포함하지 않습니다.</p>
        <section class="section">
          <h2>점검 결과</h2>
          <dl>
            ${t.result.observations.map((x) => `<div class="fact"><dt>${e(x.label)}</dt><dd>${e(x.value)}</dd></div>`).join('')}
          </dl>${inspectionSummary(t.result)}</section>
        <details>
          <summary>점검 범위와 한계</summary>
          ${t.result.limits.map((x) => `<p class="small muted gap">${e(x)}</p>`).join('')}
        </details>${relatedRecords(t)}`
    );
  if (ui.source) {
    t = projectWork(t, data.tasks);
    const file = ui.source === 'evidence' ? null : (t.changedFiles || [])[Number(ui.source)];
    // 'route' returns to the location pushed before opening the evidence, so name that screen.
    const origin = ui.evidenceReturn === 'route' ? ui.history.at(-1)?.view : 'ops';
    const back =
      {
        ops: tr('← 작업으로 돌아가기'),
        portfolio: tr('← 포트폴리오 초안'),
        'record-detail': tr('← 기록으로 돌아가기'),
      }[origin] || tr('← 이전 화면으로 돌아가기');
    return `${button(back, 'source-close', 'class="link back"')}${header(file ? tr('변경 내용') : tr('실행 근거'), t.title)}${
      file
        ? html`<div class="note">
        <code>${e(file.path)}</code>
        <p class="gap">${e(file.summary)}</p>
      </div>
      <p class="small muted gap">보고자가 제공한 변경 설명입니다. 원본 diff를 자동 수집한 결과는 아닙니다.</p>`
        : html`<section class="section">
        <h2>보고된 근거</h2>
        <p class="gap">${e(t.evidence)}</p>
      </section>
      <section class="section">
        <h2>확인하지 못한 범위</h2>
        <p class="gap">${e(t.limitations)}</p>
      </section>
      <section class="section">
        <h2>기여 범위</h2>
        <p class="gap">${e(t.contribution)}</p>
      </section>
      <p class="small muted gap">출처: ${actorLabel(t.actor)} · 앱의 독립 검증 없음</p>
      <section class="section">
        <h2>연결된 실행</h2>
        ${executionList(data.tasks.find((r) => r.id === t.id))}
      </section>`
    }`;
  }
  return workDetail(t);
}
function inspectionSummary(result) {
  const pending = result.unconfirmed || [];
  const findings = result.findings.length
    ? html`<div class="note">
        <h3>확인이 필요한 점</h3>
        ${result.findings.map((x) => `<p>${e(x)}</p>`).join('')}
      </div>`
    : '';
  const unavailable = pending.length
    ? html`<div class="note">
        <h3 class="warn">확인하지 못한 항목</h3>
        ${pending.map((x) => `<p>${e(x)}</p>`).join('')}
        <p class="small muted">이 항목은 정상 여부를 판단하지 않았습니다.</p>
      </div>`
    : '';
  return (
    findings + unavailable ||
    tr('<p class="status">확인한 기본 항목에서 추가 확인 사항이 없었습니다.</p>')
  );
}
function productWelcome() {
  return productHome(
    product(),
    data,
    requestDraft(),
    Object.entries(ui.requests).filter(([key]) => key.startsWith(ui.productId + '@')),
  );
}
function reportDetails(t) {
  return html`<section class="section">
      <div class="row between sectionhead">
        <h2>변경 파일 <span class="count">${(t.changedFiles || []).length}</span>
        </h2>
        <span class="small muted">변경 설명</span>
      </div>
      ${
        t.changedFiles?.length
          ? html`<div class="files">
          ${t.changedFiles
            .map((f, i) => {
              const parts = f.path.replaceAll('\\', '/').split('/');
              const name = parts.pop();
              return button(
                html`${icon('file')}<span class="file-info">
          <span class="file-name">${e(name)} <span class="file-dir">${e(parts.join('/'))}</span>
          </span>
          <span class="file-description">${e(f.summary || tr('변경 설명 없음'))}</span>
        </span>${icon('arrow')}`,
                `source:${i}`,
                `class="file-row" aria-label="${e(f.path)}"`,
              );
            })
            .join('')}
        </div>`
          : tr('<p class="muted small gap">변경 파일 목록이 첨부되지 않았습니다.</p>')
      }
    </section>
    <section class="section">
      <div class="row between sectionhead">
        <h2>실행 결과</h2>
        ${button(tr('실행 근거 보기'), 'source:evidence', 'class="link"')}
      </div>
      ${
        t.checks?.length
          ? html`<ul class="checks">
          ${t.checks
            .map(
              (c) => html`<li>
          <details class="check-detail">
            <summary>
              ${icon(c.result === 'passed' ? 'check' : c.result === 'failed' ? 'failed' : 'pending')}
              <span class="check-name">${e(c.name)}</span>
              <span class="check-status ${c.result}">
                ${{ passed: tr('통과 보고'), failed: tr('실패 보고'), unconfirmed: tr('미확인') }[c.result]}
              </span>${icon('arrow')}</summary>
            <p>${e(c.detail || tr('상세 보고 없음'))}</p>
          </details>
        </li>`,
            )
            .join('')}
        </ul>`
          : html`<p class="gap">${e(t.evidence)}</p>
        <p class="small muted gap">개별 검사 결과는 첨부되지 않았습니다.</p>`
      }
      <details class="verification">
        <summary>검증 범위 · 앱의 독립 검증 없음</summary>
        <p class="small muted gap">${e(t.limitations)}</p>
        <p class="small muted gap">출처: ${actorLabel(t.actor)}</p>
      </details>
    </section>`;
}
function executionList(t) {
  const observations = executionEvidence(t, data.tasks)
    .map(
      (r) => html`<details class="verification">
    <summary>${e(tr('공통 실행 근거 · Codex 훅'))} · ${date(r.created)}</summary>
    <p class="gap">${e(r.evidence)}</p><p class="small muted gap">${e(r.limitations)}</p>
    ${button(r.title, `task:${r.id}`, 'class="link"')}
  </details>`,
    )
    .join('');
  return (
    observations +
    workReports(t, data.tasks)
      .map(
        (r) =>
          html`<article class="execution-row">
            <div class="row between">
              <div>
                <h3>${e(r.title)}</h3>
                <p class="small muted gap">${actorLabel(r.actor)} · 보고
                v${r.sourceVersion || 1} · ${date(r.created)}</p>
              </div>
              ${button(r.parentTaskId ? tr('연결 바로잡기') : tr('다른 작업에 연결'), `link-work:${r.id}`, 'class="plain"')}
            </div>
            <p class="gap">${e(r.summary)}</p>
            <p class="small muted gap">
              ${e(r.linkReason || (r.parentTaskId ? tr('보고자가 명시한 작업 ID로 연결') : tr('이 문제의 기준 보고')))}
            </p>
            <details>
              <summary>원문과 보고 버전 보기</summary>
              <p class="gap">${e(r.evidence)}</p>
              <p class="small muted gap">한계: ${e(r.limitations)}</p>
              ${(data.reports || [])
                .filter((v) => v.taskId === r.id)
                .sort((a, b) => b.sourceVersion - a.sourceVersion)
                .map(
                  (v) =>
                    html`<details>
                  <summary>보고 v${v.sourceVersion} · ${date(v.created)}</summary>
                  <p class="gap">${e(v.snapshot.summary)}</p>
                  <p class="small muted gap">${e(v.snapshot.evidence)}</p>
                  <p class="small muted gap">${e(v.snapshot.limitations)}</p>
                </details>`,
                )
                .join('')}
            </details>
          </article>`,
      )
      .join('')
  );
}
function workFollowup(reports) {
  const checks = reports.flatMap((r) =>
    (r.checks || []).filter((c) => c.result !== 'passed').map((c) => ({ ...c, report: r.title })),
  );
  const limits = [...new Set(reports.map((r) => r.limitations).filter(Boolean))];
  return html`<section class="task-outcome work-followup">
      <h2>보고에서 확인할 사항</h2>
    ${
      checks.length
        ? html`<p>실행 근거에 실패·미확인 항목 ${checks.length}건이 있습니다. 후속 보고에서 해결됐는지는 각 근거를 함께 확인하세요.</p>
          <ul>
            ${checks
              .slice(0, 3)
              .map(
                (c) =>
                  html`<li>
                <strong>${e(c.name)}</strong>
                <span>${c.result === 'failed' ? tr('실패 보고') : tr('미확인')} · ${e(c.report)}</span>
              </li>`,
              )
              .join('')}
          </ul>`
        : tr('<p>현재 제품의 정상 동작 여부는 이 보고만으로 판단하지 않습니다.</p>')
    }
    ${limits
      .slice(0, 2)
      .map((l) => `<p class="reported-limit">${e(l)}</p>`)
      .join('')}
    <div class="actions">
        ${button(tr('보고와 실행 근거 확인'), 'open-executions', 'class="link"')}
        ${limits.length > 2 || checks.length > 3 ? tr('<span class="small muted">나머지 항목은 실행 근거에 보관되어 있습니다.</span>') : ''}
      </div>
    </section>`;
}
function workDetail(t) {
  const reports = workReports(t, data.tasks);
  const ids = new Set(reports.map((r) => r.id));
  const records = data.records.filter((r) => ids.has(r.sourceTaskId));
  return (
    header(t.title, `${labels[t.status]} · ${date(t.created)}`) +
    html`<p class="task-summary">${e(t.summary)}</p>
      <p class="small muted gap">운영 배포 미확인 · 보고된 결과와 앱의 독립 검증은 구분합니다.</p>
    ${
      t.parentTaskId
        ? html`<div class="task-outcome">
        <h2>다른 문제에 연결된 실행입니다</h2>
        ${button(data.tasks.find((x) => x.id === t.parentTaskId)?.title || tr('상위 작업'), `task:${t.parentTaskId}`, 'class="link"')}
      </div>`
        : `${workFollowup(reports)}`
    }
    ${artifact(t)}<section class="section">
        <h2>재사용할 기록</h2>
        ${
          records.length
            ? records
                .map((r) =>
                  button(
                    html`<span>
        <strong>${e(r.title)}</strong>
        <small>
          ${r.validity === 'needs_review' ? tr('절차 재확인 중 · MCP 제공 보류') : !r.active ? tr('자동 참조에서 제외') : e(r.scope)}
        </small>
      </span>${icon('arrow')}`,
                    `record-detail:${r.id}`,
                    'class="related-link"',
                  ),
                )
                .join('')
            : tr('<p class="small muted gap">연결된 기록이 없습니다.</p>')
        }
      </section>
    <details class="execution-group">
        <summary>실행 근거 ${reports.length}건</summary>${executionList(t)}
        ${reportDetails(projectWork(t, data.tasks))}
      </details>
    ${
      (data.workLinks || []).some(
        (l) => l.taskId === t.id || l.fromTaskId === t.id || l.toTaskId === t.id,
      )
        ? html`<details>
            <summary>연결 정정 이력</summary>
            ${(data.workLinks || [])
              .filter((l) => l.taskId === t.id || l.fromTaskId === t.id || l.toTaskId === t.id)
              .map(
                (l) =>
                  html`<p class="small muted gap">${date(l.created)} · ${e(l.reason)}<br>
                ${e(data.tasks.find((t) => t.id === l.taskId)?.title)} → ${e(data.tasks.find((t) => t.id === l.toTaskId)?.title || tr('별도 작업'))}
              </p>`,
              )
              .join('')}
          </details>`
        : ''
    }`
  );
}
// What correcting this link does to a portfolio case built from the affected reports.
function impactNote(source, isMovedReport) {
  if (!source?.automatic || source.editedFields.length)
    return tr('직접 쓴 문장 보존 · 근거 재확인 표시');
  if (isMovedReport && ui.linkParent)
    return tr('자동 생성한 별도 사례 제외 · 원문은 연결한 작업에서 보존');
  return tr('자동 생성한 문장을 현재 연결로 갱신');
}
export function linkPage() {
  const report = data.tasks.find((t) => t.id === ui.linkTaskId);
  if (!report) return empty(tr('보고를 찾을 수 없습니다.'), tr('목록에서 다시 선택하세요.'));
  const affected = new Set([report.id, report.parentTaskId, ui.linkParent].filter(Boolean));
  const impacts = data.portfolios.filter((p) => p.entries.some((e) => affected.has(e.taskId)));
  const candidates = rootTasks().filter(
    (t) => t.kind === 'work' && t.id !== report.id && t.productId === report.productId,
  );
  const hasChildren = data.tasks.some((t) => t.parentTaskId === report.id);
  return (
    header(tr('실행 연결 바로잡기'), report.title) +
    html`<p>원문과 보고 버전은 보존하고 어떤 문제에 속하는지만 바꿉니다. 다른 작업에 연결하면 이 보고는 그 작업의 실행 근거에서 볼 수 있습니다.</p>
    ${hasChildren ? tr('<p class="notice">이 작업에 연결된 실행이 있습니다. 먼저 해당 실행의 연결을 정리하세요.</p>') : ''}
    <form data-form="work-link" data-id="${report.id}" class="form gap">
        <div>
          <label for="link-parent">연결할 문제</label>
          <select id="link-parent" name="parentTaskId">
            <option value="" ${!ui.linkParent ? 'selected' : ''}>별도 작업으로 분리</option>
            ${candidates.map((t) => `<option value="${t.id}" ${ui.linkParent === t.id ? 'selected' : ''}>${e(t.title)}</option>`).join('')}
          </select>
        </div>
    ${field('reason', tr('연결을 바꾸는 이유'), '', 'textarea', 'required maxlength="1000"')}
    <section>
          <h2>함께 영향을 받는 초안</h2>
          ${
            impacts.length
              ? impacts
                  .map(
                    (p) =>
                      html`<div class="record">
                    <h3>${e(p.target)}</h3>
                    ${p.entries
                      .filter((x) => affected.has(x.taskId))
                      .map((x) => {
                        const source = p.entrySources?.[x.taskId];
                        return html`<p class="small muted gap">
                          ${e(x.title)} · ${impactNote(source, x.taskId === report.id)}
                        </p>`;
                      })
                      .join('')}
                  </div>`,
                  )
                  .join('')
              : tr('<p class="small muted gap">이 연결을 사용하는 초안이 없습니다.</p>')
          }
          <p class="small muted gap">내보낸 HTML과 기존 버전은 바뀌지 않습니다. 분리한 기록을 새 사례로 자동 추가하지 않습니다.</p>
        </section>
    <div class="actions">
          <button type="submit" class="primary" ${hasChildren ? 'disabled' : ''}>연결 정정
          저장</button>${button(tr('취소'), 'link-cancel')}</div>
      </form>`
  );
}
