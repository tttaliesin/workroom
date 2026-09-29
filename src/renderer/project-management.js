import { t as tr } from '../shared/i18n.mjs';
import { projectSummary, projectLabel } from '../shared/project-status.mjs';
import { html, e, button, date } from './html.js';

const unset = () => tr('미지정');
const badge = (key) => `<span class="pm-badge pm-${e(key)}">${e(projectLabel(key))}</span>`;
const metric = (label, value, detail, action) =>
  html`<button class="pm-metric" data-action="${action}"><span>${e(label)}</span><strong>${value}</strong><small>${e(detail)}</small></button>`;
const progress = (p) =>
  html`<div class="pm-progress"><progress max="${p.scope.length || 1}" value="${p.done.length}" aria-label="마일스톤 완료"></progress><span>${p.done.length} / ${p.scope.length}</span></div>`;
function milestoneRow(m, p, data) {
  return html`<div class="pm-milestone-row">
    <span class="pm-step pm-${e(m.status)}" aria-hidden="true">${m.status === 'done' ? '✓' : '◇'}</span>
    <div><button class="link pm-milestone-title" data-action="milestone-edit:${m.id}">${e(m.title)}</button><small>${e(m.assignee || unset())}${m.note ? ` · ${e(m.note)}` : ''}</small>
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
    <div class="pm-milestone-end">${badge(m.status)}<small class="${p.overdue.includes(m) ? 'pm-overdue' : ''}">${e(m.targetDate || tr('기한 미정'))}${p.overdue.includes(m) ? ` · ${tr('기한 경과')}` : ''}</small></div>
  </div>`;
}
export function projectDashboard(product, data) {
  const p = projectSummary(data, product),
    m = p.management;
  return html`<div class="pm-dashboard">
    <header class="pm-heading"><div><p class="pm-eyebrow">프로젝트 브리핑</p><h1>${e(product.name)}</h1><p class="pm-goal">${e(product.goal || tr('프로젝트 목표를 작성하세요.'))}</p></div>
      ${button(tr('현황 보고'), 'nav:report', 'class="primary"')}</header>
    <div class="pm-meta">${badge(m.phase)}${badge(m.health)}<span>담당 <strong>${e(m.lead || unset())}</strong></span><span class="${p.targetOverdue ? 'pm-overdue' : ''}">목표일 <strong>${e(m.targetDate || unset())}</strong></span>${button(tr('현황 편집'), 'nav:plan', 'class="link"')}</div>
    <section class="pm-brief"><div><span class="pm-kicker">지금 어디까지 왔나요?</span><p>${e(m.summary || tr('프로젝트 현황을 작성하면 팀원과 PM이 현재 상황을 바로 파악할 수 있습니다.'))}</p><small>${m.updatedAt ? e(tr`현황 갱신 ${date(m.updatedAt)}`) : tr('아직 현황을 작성하지 않았습니다.')}${p.stale ? ` · ${tr('7일 이상 갱신되지 않음')}` : ''}</small></div>
      <div><span class="pm-kicker">다음 초점</span><p>${e(m.nextStep || p.upcoming[0]?.title || tr('다음 마일스톤과 담당자를 정하세요.'))}</p>${button(tr('계획 관리'), 'nav:plan', 'class="link"')}</div></section>
    <div class="pm-metrics">
      ${metric(tr('마일스톤 완료'), `${p.done.length}<em> / ${p.scope.length}</em>`, p.scope.length ? tr('등록한 계획 기준 · 작성자 보고') : tr('계획을 등록하면 진행률이 표시됩니다.'), 'nav:plan')}
      ${metric(tr('진행 중·대기'), p.progress.length, tr('앱에 저장된 실행 작업'), 'nav:ops')}
      ${metric(tr('확인이 필요한 작업'), p.attention.length, tr('검토·판단·복구 대기'), 'nav:ops')}
      ${metric(tr('기한 지난 계획'), p.overdue.length, tr('완료·범위 제외 항목 제외'), 'nav:plan')}
    </div>
    ${m.risks || p.blocked.length ? html`<section class="pm-risk"><strong>위험·지원 요청</strong><p>${e(m.risks || p.blocked.map((x) => `${x.title}: ${x.note}`).join(' · '))}</p></section>` : ''}
    <section class="pm-roadmap"><div class="section-title"><h2>다음 마일스톤</h2>${button(tr('전체 계획'), 'nav:plan', 'class="link"')}</div>
      ${p.scope.length ? progress(p) : ''}
      ${
        p.upcoming.length
          ? p.upcoming
              .slice(0, 3)
              .map((m) => milestoneRow(m, p, data))
              .join('')
          : html`<div class="pm-empty-inline"><p>${p.scope.length ? tr('등록한 마일스톤을 모두 완료했습니다. 다음 계획을 정하세요.') : tr('목표를 작은 마일스톤으로 나누고 담당자와 기한을 정하세요.')}</p>${button(tr('마일스톤 추가'), 'milestone-new')}</div>`
      }
    </section>
    <div class="pm-section-divider"><span>실행과 근거</span><small>최근 작업과 기록에서 실제 진행 내용을 확인하세요.</small></div>
  </div>`;
}
export function projectDirectory(data) {
  const projects = data.products.map((p) => projectSummary(data, p));
  return html`<div class="pm-directory"><header class="pm-heading"><div><p class="pm-eyebrow">WORKROOM / PROJECTS</p><h1>전체 프로젝트 현황</h1><p>목표와 진행 상황, 다음 판단을 한곳에서 확인하세요.</p></div>${button(tr('제품 등록'), 'nav:new-product', 'class="primary"')}</header>
    <div class="pm-directory-stats"><span><strong>${projects.length}</strong> 등록 프로젝트</span><span><strong>${projects.filter((p) => ['at_risk', 'off_track'].includes(p.management.health)).length}</strong> 주의 보고</span><span><strong>${projects.reduce((n, p) => n + p.overdue.length, 0)}</strong> 기한 지난 계획</span><span><strong>${projects.filter((p) => p.management.health === 'not_set').length}</strong> 현황 미작성</span></div>
    <div class="pm-project-grid">${
      projects
        .map(
          (
            p,
          ) => html`<article class="pm-project-card"><div class="row between">${badge(p.management.health)}<span class="small muted">${e(projectLabel(p.management.phase))}</span></div><h2><button class="link" data-action="product:${p.product.id}">${e(p.product.name)}</button></h2><p class="pm-card-goal">${e(p.management.summary || p.product.goal || tr('프로젝트 목표를 작성하세요.'))}</p>
      ${progress(p)}<div class="pm-card-meta"><span>${e(p.management.lead || tr('담당 미지정'))}</span><span>${e(p.management.targetDate || tr('목표일 미정'))}</span></div><div class="pm-card-signals"><span>${tr`확인할 일 ${p.attention.length}개`}</span><span class="${p.overdue.length ? 'pm-overdue' : ''}">${tr`기한 경과 ${p.overdue.length}개`}</span></div><footer><span>${e(p.management.nextStep || p.upcoming[0]?.title || tr('다음 계획 미작성'))}</span>${button('↗', `product:${p.product.id}`, tr('class="plain" aria-label="프로젝트 열기"'))}</footer></article>`,
        )
        .join('') ||
      html`<div class="empty"><h2>첫 프로젝트를 등록하세요.</h2><p>프로젝트별 목표·진행·계획을 한눈에 비교할 수 있습니다.</p></div>`
    }</div></div>`;
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
  return html`<div class="pm-plan"><header class="pm-heading"><div><p class="pm-eyebrow">${e(product.name)}</p><h1>현황과 계획</h1><p>무엇을 언제까지 할지 정하고 실제 작업 근거를 연결하세요.</p></div>${button(tr('현황 보고'), 'nav:report')}</header>
    <details class="pm-editor" ${!product.management ? 'open' : ''}><summary>프로젝트 현황 편집 <small>${e(m.lead || unset())} · ${e(projectLabel(m.health))}</small></summary>
      <form data-form="project-status" data-id="${product.id}" data-revision="${product.revision}" class="pm-form">
        ${input('lead', tr('프로젝트 담당자'), m.lead, 'text', 'maxlength="120"')}${input('targetDate', tr('목표일'), m.targetDate, 'date')}
        ${select('phase', tr('진행 단계'), m.phase, ['planned', 'active', 'paused', 'completed'])}${select('health', tr('작성자 보고 상태'), m.health, ['not_set', 'on_track', 'at_risk', 'off_track'])}
        ${textarea('summary', tr('현황 요약'), m.summary, 'maxlength="2000"')}${textarea('risks', tr('위험·지원 요청'), m.risks, 'maxlength="2000"')}${textarea('nextStep', tr('다음 초점'), m.nextStep, 'maxlength="2000"')}
        <p class="small muted pm-wide">담당자는 표시용 이름입니다. 현황 보고는 실제 검사나 배포 완료를 증명하지 않습니다.</p><div class="pm-wide actions"><button class="primary" type="submit">현황 저장</button></div>
      </form></details>
    <section class="pm-roadmap"><div class="section-title"><h2>마일스톤 <span>${p.done.length} / ${p.scope.length}</span></h2>${button(tr('마일스톤 추가'), 'milestone-new', 'class="primary"')}</div>
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
      <div class="pm-wide actions"><button class="primary" type="submit">마일스톤 저장</button>${button(tr('닫기'), 'milestone-close')}</div>
    </form></section>`
        : ''
    }
  </div>`;
}
export function reportPage(product, report) {
  if (!product) return '';
  const current = report?.projectId === product.id ? report : null;
  return html`<div class="pm-report-page"><header class="pm-heading"><div><p class="pm-eyebrow">${e(product.name)}</p><h1>프로젝트 현황 보고</h1><p>공유 전에 내용을 확인하세요. 파일 저장과 복사는 외부 발송이 아닙니다.</p></div></header>
    <div class="pm-report-toolbar"><div class="actions">${[7, 30, 0].map((days) => button(days ? tr`최근 ${days}일` : tr('전체 기간'), `report-period:${days}`, `class="${current?.days === days ? 'primary' : ''}"`)).join('')}</div><div class="actions">${button(tr('Markdown 복사'), 'report-copy', current ? '' : 'disabled')}${button(tr('HTML 저장'), 'report-save', current ? '' : 'disabled')}</div></div>
    ${current ? html`<article class="pm-report-paper"><p class="pm-eyebrow">WORKROOM / STATUS REPORT</p><h2>${e(product.name)}</h2><p class="small muted">${e(current.generatedAt)} · ${current.days ? tr`최근 ${current.days}일` : tr('전체 기간')}</p>${current.sections.map(([heading, lines]) => html`<section><h3>${e(heading)}</h3><ul>${lines.map((line) => html`<li>${e(line)}</li>`).join('')}</ul></section>`).join('')}<footer>${e(current.note)}</footer></article>` : html`<div class="empty"><p>보고 기간을 선택하면 현재 저장된 자료로 보고서를 만듭니다.</p></div>`}
  </div>`;
}
