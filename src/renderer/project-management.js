import { t as tr } from '../shared/i18n.mjs';
import { projectSummary, projectLabel } from '../shared/project-status.mjs';
import { html, e, button, date } from './html.js';
const unset = () => tr('미지정');
const badge = (key) => `<span class="pm-badge pm-${e(key)}">${e(projectLabel(key))}</span>`;
const progress = (p) =>
  p.scope.length
    ? html`<span class="pm-progress"><progress max="${p.scope.length}" value="${p.done.length}" aria-label="마일스톤 완료"></progress><span>${p.done.length} / ${p.scope.length}</span></span>`
    : html`<span class="muted">계획 미등록</span>`;
function milestoneRow(m, p, data) {
  return html`<div class="pm-milestone-row">
    <div class="pm-milestone-status">${badge(m.status)}</div>
    <div class="pm-milestone-body"><button class="link pm-milestone-title" data-action="milestone-edit:${m.id}">${e(m.title)}</button>
      ${m.note ? html`<small>${e(m.note)}</small>` : ''}
      ${
        m.taskIds?.length
          ? html`<div class="pm-evidence-links">${m.taskIds
              .map((id) => {
                const task = data.tasks.find((t) => t.id === id);
                return task ? button(e(task.title), `task:${id}`, 'class="link"') : '';
              })
              .join('')}</div>`
          : ''
      }</div>
    <span class="pm-assignee">${e(m.assignee || unset())}</span>
    <span class="pm-due ${p.overdue.includes(m) ? 'pm-overdue' : ''}">${e(m.targetDate || tr('기한 미정'))}${p.overdue.includes(m) ? html`<small>기한 경과</small>` : ''}</span>
  </div>`;
}
export function projectDashboard(product, data) {
  const p = projectSummary(data, product),
    m = p.management;
  return html`<div class="pm-dashboard">
    <header class="pm-heading"><div><h1>${e(product.name)}</h1><p>${e(product.goal || tr('프로젝트 목표를 작성하세요.'))}</p></div>${button(tr('현황 보고'), 'nav:report')}</header>
    <div class="pm-overview-grid"><div class="pm-overview-body">
      <section class="pm-update"><div class="section-title"><h2>현황</h2>${badge(m.health)}</div>
      <p>${e(m.summary || tr('아직 현황을 작성하지 않았습니다.'))}</p>
      ${button(tr('현황 편집'), 'project-status-edit', 'class="link"')}</section>
      ${m.risks || p.blocked.length ? html`<section class="pm-risk"><h2>위험·지원 요청</h2>${m.risks ? html`<p>${e(m.risks)}</p>` : ''}${p.blocked.map((x) => html`<p><strong>${e(x.title)}</strong> · ${e(x.note)}</p>`).join('')}</section>` : ''}
      <section class="pm-next"><h2>다음 단계</h2><p>${e(m.nextStep || p.upcoming[0]?.title || tr('다음 계획 미작성'))}</p></section>
      <div class="pm-summary-line">
        ${button(html`진행 중·대기 <strong>${p.progress.length}</strong>`, 'nav:ops', 'class="plain"')}
        ${button(html`확인이 필요한 작업 <strong>${p.attention.length}</strong>`, 'nav:ops', 'class="plain"')}
        ${button(html`기한 지난 계획 <strong>${p.overdue.length}</strong>`, 'nav:plan', 'class="plain"')}
      </div>
    </div><aside class="pm-properties" aria-label="프로젝트 속성"><h2>프로젝트 속성</h2><dl>
      <div><dt>진행 단계</dt><dd>${badge(m.phase)}</dd></div>
      <div><dt>담당자</dt><dd>${e(m.lead || unset())}</dd></div>
      <div><dt>목표일</dt><dd class="${p.targetOverdue ? 'pm-overdue' : ''}">${e(m.targetDate || unset())}${p.targetOverdue ? html`<small>기한 경과</small>` : ''}</dd></div>
      <div><dt>현황 갱신</dt><dd>${m.updatedAt ? e(date(m.updatedAt)) : unset()}${p.stale ? html`<small>7일 이상 갱신되지 않음</small>` : ''}</dd></div>
      <div><dt>마일스톤 완료</dt><dd>${progress(p)}</dd></div>
    </dl><p class="small muted">등록한 계획 기준 · 작성자 보고</p></aside></div>
    <section class="pm-roadmap"><div class="section-title"><h2>다음 마일스톤</h2>${button(tr('전체 계획'), 'nav:plan', 'class="link"')}</div>
    ${
      p.upcoming.length
        ? p.upcoming
            .slice(0, 3)
            .map((m) => milestoneRow(m, p, data))
            .join('')
        : html`<div class="pm-empty-inline"><span>${p.scope.length ? tr('등록한 마일스톤을 모두 완료했습니다. 다음 계획을 정하세요.') : tr('계획 미등록')}</span>${button(tr('마일스톤 추가'), 'milestone-new')}</div>`
    }</section>
  </div>`;
}
export function projectDirectory(data) {
  const projects = data.products.map((p) => projectSummary(data, p));
  return html`<div class="pm-directory"><header class="pm-heading"><div><h1>전체 프로젝트 현황</h1><p>${tr`등록 프로젝트 ${projects.length}개`}</p></div>${button(tr('제품 등록'), 'nav:new-product', 'class="primary"')}</header>
    ${
      projects.length
        ? html`<table class="pm-project-table"><caption class="sr-only">프로젝트별 현황</caption><thead><tr><th>프로젝트</th><th>상태</th><th>담당자</th><th>목표일</th><th>마일스톤 완료</th><th>확인할 일</th></tr></thead><tbody>${projects
            .map(
              (p) => html`<tr>
      <td class="pm-project-name"><button class="link" data-action="product:${p.product.id}">${e(p.product.name)}</button><small>${e(p.management.nextStep || p.upcoming[0]?.title || p.product.goal || tr('다음 계획 미작성'))}</small></td>
      <td data-label="${e(tr('상태'))}">${badge(p.management.health)}<small>${e(projectLabel(p.management.phase))}</small></td>
      <td data-label="${e(tr('담당자'))}">${e(p.management.lead || unset())}</td>
      <td data-label="${e(tr('목표일'))}" class="${p.targetOverdue ? 'pm-overdue' : ''}">${e(p.management.targetDate || unset())}</td>
      <td data-label="${e(tr('마일스톤 완료'))}">${progress(p)}</td>
      <td data-label="${e(tr('확인할 일'))}">${tr`확인할 일 ${p.attention.length}개`}${p.overdue.length ? html`<small class="pm-overdue">${tr`기한 경과 ${p.overdue.length}개`}</small>` : ''}</td>
    </tr>`,
            )
            .join('')}</tbody></table>`
        : html`<div class="pm-empty-inline"><p>첫 프로젝트를 등록하세요.</p></div>`
    }
  </div>`;
}
const input = (name, label, value = '', type = 'text', extra = '') =>
  html`<label class="pm-field">${e(label)}<input id="pm-${name}" name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const textarea = (name, label, value = '', extra = '') =>
  html`<label class="pm-field pm-wide">${e(label)}<textarea id="pm-${name}" name="${name}" rows="3" ${extra}>${e(value)}</textarea></label>`;
const select = (name, label, value, values) =>
  html`<label class="pm-field">${e(label)}<select id="pm-${name}" name="${name}">${values.map((v) => `<option value="${v}" ${v === value ? 'selected' : ''}>${e(projectLabel(v))}</option>`).join('')}</select></label>`;
export function planPage(product, data, ui) {
  if (!product) return projectDirectory(data);
  const p = projectSummary(data, product),
    m = p.management;
  const editing = (data.milestones || []).find(
    (x) => x.id === ui.milestoneId && x.productId === product.id,
  );
  const item = editing || {
    title: '',
    assignee: m.lead,
    targetDate: '',
    status: 'planned',
    note: '',
    taskIds: [],
  };
  return html`<div class="pm-plan"><header class="pm-heading"><div><p class="pm-context">${e(product.name)}</p><h1>현황과 계획</h1><p>무엇을 언제까지 할지 정하고 실제 작업 근거를 연결하세요.</p></div>${button(tr('현황 보고'), 'nav:report')}</header>
    <details class="pm-editor" ${ui.projectStatusEditor ? 'open' : ''}><summary>프로젝트 현황 편집 <small>${e(m.lead || unset())} · ${e(projectLabel(m.health))}</small></summary>
      <form data-form="project-status" data-id="${product.id}" data-revision="${product.revision}" class="pm-form">
        ${input('lead', tr('프로젝트 담당자'), m.lead, 'text', 'maxlength="120"')}${input('targetDate', tr('목표일'), m.targetDate, 'date')}
        ${select('phase', tr('진행 단계'), m.phase, ['planned', 'active', 'paused', 'completed'])}${select('health', tr('작성자 보고 상태'), m.health, ['not_set', 'on_track', 'at_risk', 'off_track'])}
        ${textarea('summary', tr('현황 요약'), m.summary, 'maxlength="2000"')}${textarea('risks', tr('위험·지원 요청'), m.risks, 'maxlength="2000"')}${textarea('nextStep', tr('다음 초점'), m.nextStep, 'maxlength="2000"')}
        <p class="small muted pm-wide">담당자는 표시용 이름입니다. 현황 보고는 실제 검사나 배포 완료를 증명하지 않습니다.</p><div class="pm-wide actions"><button class="primary" type="submit">현황 저장</button>${button(tr('취소'), 'planning-cancel:project-status')}</div>
      </form></details>
    <section class="pm-roadmap"><div class="section-title"><h2>마일스톤 <span>${p.scope.length ? `${p.done.length} / ${p.scope.length}` : tr('계획 미등록')}</span></h2>${button(tr('마일스톤 추가'), 'milestone-new', 'class="primary"')}</div>
      <p class="small muted">완료 수는 등록한 계획 기준입니다. 범위 제외 항목은 분모에 포함하지 않습니다.</p>
      ${p.scope.length ? progress(p) : ''}${p.milestones.map((m) => milestoneRow(m, p, data)).join('') || html`<p class="quiet-state">아직 계획이 없습니다. 첫 마일스톤을 추가하세요.</p>`}
    </section>
    ${
      ui.milestoneEditor
        ? html`<section class="pm-editor pm-milestone-editor"><h2>${editing ? tr('마일스톤 수정') : tr('마일스톤 추가')}</h2><form data-form="milestone" data-id="${editing?.id || ''}" data-revision="${editing?.revision || ''}" data-product="${product.id}" class="pm-form">
      ${input('title', tr('마일스톤 이름'), item.title, 'text', 'required maxlength="200"')}${input('assignee', tr('담당자'), item.assignee, 'text', 'maxlength="120"')}
      ${input('milestoneDate', tr('목표일'), item.targetDate, 'date')}${select('status', tr('진행 상태'), item.status, ['planned', 'in_progress', 'blocked', 'done', 'cancelled'])}
      ${textarea('note', tr('진행 메모 · 완료 근거 · 막힌 이유'), item.note, 'maxlength="2000"')}
      <fieldset class="pm-wide pm-task-picker"><legend>연결할 작업 근거</legend>${
        data.tasks
          .filter(
            (t) =>
              t.productId === product.id &&
              (p.tasks.slice(0, 100).includes(t) || item.taskIds.includes(t.id)),
          )
          .map(
            (t) =>
              html`<label><input type="checkbox" name="taskIds" value="${t.id}" ${item.taskIds.includes(t.id) ? 'checked' : ''}>${e(t.title)}</label>`,
          )
          .join('') ||
        html`<p class="small muted">연결할 작업이 없습니다. 계획은 먼저 등록할 수 있습니다.</p>`
      }</fieldset>
      <div class="pm-wide actions"><button class="primary" type="submit">마일스톤 저장</button>${button(tr('취소'), 'planning-cancel:milestone')}</div>
    </form></section>`
        : ''
    }
  </div>`;
}
export function reportPage(product, report) {
  if (!product) return '';
  const current = report?.projectId === product.id ? report : null;
  return html`<div class="pm-report-page"><header class="pm-heading"><div><p class="pm-context">${e(product.name)}</p><h1>프로젝트 현황 보고</h1><p>공유 전에 내용을 확인하세요. 파일 저장과 복사는 외부 발송이 아닙니다.</p></div></header>
    <div class="pm-report-toolbar"><div class="actions">${[7, 30, 0].map((days) => button(days ? tr`최근 ${days}일` : tr('전체 기간'), `report-period:${days}`, `class="plain" aria-pressed="${current?.days === days}"`)).join('')}</div><div class="actions">${button(tr('Markdown 복사'), 'report-copy', current ? '' : 'disabled')}${button(tr('HTML 저장'), 'report-save', current ? '' : 'disabled')}</div></div>
    ${current ? html`<article class="pm-report-paper"><p class="pm-context">${e(tr('프로젝트 현황 보고'))}</p><h2>${e(product.name)}</h2><p class="small muted">${e(date(current.generatedAt))} · ${current.days ? tr`최근 ${current.days}일` : tr('전체 기간')}</p>${current.sections.map(([heading, lines]) => html`<section><h3>${e(heading)}</h3><ul>${lines.map((line) => html`<li>${e(line)}</li>`).join('')}</ul></section>`).join('')}<footer>${e(current.note)}</footer></article>` : html`<div class="empty"><p>보고 기간을 선택하면 현재 저장된 자료로 보고서를 만듭니다.</p></div>`}
  </div>`;
}
