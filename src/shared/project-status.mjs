import { getLanguage } from './i18n.mjs';

const names = {
  not_set: ['현황 미작성', 'No status update'],
  on_track: ['정상 진행', 'On track'],
  at_risk: ['주의 필요', 'At risk'],
  off_track: ['계획 조정 필요', 'Off track'],
  planned: ['예정', 'Planned'],
  active: ['진행 중', 'In progress'],
  paused: ['보류', 'Paused'],
  completed: ['완료 보고', 'Reported complete'],
  in_progress: ['진행 중', 'In progress'],
  blocked: ['막힘', 'Blocked'],
  done: ['완료', 'Done'],
  cancelled: ['범위 제외', 'Out of scope'],
};
export const projectLabel = (key, language = getLanguage()) =>
  names[key]?.[language === 'en' ? 1 : 0] || key;
export function calendarDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const running = new Set(['queued', 'running', 'stopping', 'applying']);
const attention = new Set([
  'needs_decision',
  'awaiting_apply',
  'awaiting_review',
  'check_failed',
  'changes_requested',
  'apply_partial',
  'apply_conflict',
  'needs_review',
  'failed',
  'interrupted',
  'waiting_quota',
  'waiting_auth',
  'waiting_decision',
]);
const results = new Set(['reported', 'completed', 'partial', 'accepted', 'decided']);
export function projectSummary(data, product, { days = 7, now = new Date() } = {}) {
  const today = calendarDate(now);
  const resultIds = new Set(
    data.tasks.filter((t) => t.kind === 'agent').map((t) => t.resultTaskId),
  );
  const tasks = data.tasks
    .filter((t) => t.productId === product.id && !t.parentTaskId && !resultIds.has(t.id))
    .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
  const milestones = (data.milestones || [])
    .filter((m) => m.productId === product.id)
    .sort(
      (a, b) =>
        (a.targetDate || '9999').localeCompare(b.targetDate || '9999') ||
        a.created.localeCompare(b.created),
    );
  const scope = milestones.filter((m) => m.status !== 'cancelled');
  const done = scope.filter((m) => m.status === 'done');
  const overdue = scope.filter((m) => m.status !== 'done' && m.targetDate && m.targetDate < today);
  const since = days ? now.getTime() - days * 86400000 : 0;
  const recent = tasks.filter((t) => new Date(t.updated || t.created).getTime() >= since);
  const management = {
    lead: '',
    targetDate: '',
    phase: 'planned',
    health: 'not_set',
    summary: '',
    risks: '',
    nextStep: '',
    ...product.management,
  };
  return {
    product,
    management,
    tasks,
    milestones,
    scope,
    done,
    overdue,
    blocked: scope.filter((m) => m.status === 'blocked'),
    progress: tasks.filter((t) => running.has(t.status)),
    attention: tasks.filter((t) => attention.has(t.status)),
    recentResults: recent.filter((t) => results.has(t.status)),
    applied: recent.filter((t) => !!t.appliedAt),
    checked: recent.filter((t) => t.outputs?.check?.result?.status === 'passed'),
    upcoming: scope.filter((m) => !['done', 'cancelled'].includes(m.status)),
    stale:
      !!management.updatedAt &&
      now.getTime() - new Date(management.updatedAt).getTime() > 7 * 86400000,
    targetOverdue:
      !!management.targetDate && management.targetDate < today && management.phase !== 'completed',
    ratio: scope.length ? Math.round((done.length / scope.length) * 100) : null,
  };
}

const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const plain = (value) =>
  escapeHTML(
    String(value ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim(),
  ).replace(/([\\`*_{}\[\]()#!|])/g, '\\$1');
export function projectReport(data, product, { days = 7, language = 'ko', now = new Date() } = {}) {
  const p = projectSummary(data, product, { days, now });
  const en = language === 'en',
    l = (ko, english) => (en ? english : ko);
  const fallback = l('미작성', 'Not provided');
  const displayDate = (value) =>
    new Date(value).toLocaleString(en ? 'en-US' : 'ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const generatedLabel = displayDate(now);
  const title = `${product.name} · ${l('프로젝트 현황 보고', 'Project status report')}`;
  const sections = [
    [
      l('현황 요약', 'Status summary'),
      [
        `${l('목표', 'Goal')}: ${product.goal || fallback}`,
        `${l('담당', 'Lead')}: ${p.management.lead || fallback} · ${l('목표일', 'Target date')}: ${p.management.targetDate || fallback}`,
        `${l('진행 단계', 'Phase')}: ${projectLabel(p.management.phase, language)} · ${l('작성자 보고', 'Author-reported health')}: ${projectLabel(p.management.health, language)}`,
        p.management.summary || fallback,
        `${l('현황 갱신', 'Status updated')}: ${p.management.updatedAt ? displayDate(p.management.updatedAt) : fallback}`,
      ],
    ],
    [
      l('계획과 일정', 'Plan and schedule'),
      p.scope.length
        ? p.scope.map(
            (m) =>
              `${projectLabel(m.status, language)} · ${m.title} · ${m.assignee || fallback} · ${m.targetDate || fallback}${p.overdue.includes(m) ? l(' · 기한 경과', ' · Overdue') : ''}${m.note ? ` — ${m.note}` : ''}`,
          )
        : [
            l(
              '등록된 마일스톤이 없습니다. 진행률을 산정하지 않았습니다.',
              'No milestones registered. Progress is not estimated.',
            ),
          ],
    ],
    [
      l('최근 성과와 근거', 'Recent outcomes and evidence'),
      p.recentResults.length
        ? p.recentResults
            .slice(0, 20)
            .map(
              (t) =>
                `${t.title} — ${t.appliedAt ? l('원본 반영 기록 있음', 'Source application recorded') : t.outputs?.check?.result?.status === 'passed' ? l('검사 통과 기록 있음 · 반영 별도', 'Checks passed; application is separate') : l('보고된 결과 · 독립 검증 아님', 'Reported result; not independently verified')} (${t.id})`,
            )
        : [l('이 기간에 등록된 결과가 없습니다.', 'No recorded outcomes in this period.')],
    ],
    [
      l('위험·지원 요청', 'Risks and support needed'),
      [
        p.management.risks ||
          l('작성된 위험·지원 요청 없음', 'No risks or support requests written'),
        ...p.overdue.map((m) => `${l('기한 경과', 'Overdue')}: ${m.title} (${m.targetDate})`),
        ...p.blocked.map((m) => `${l('막힘', 'Blocked')}: ${m.title} — ${m.note || fallback}`),
        ...p.attention.slice(0, 20).map((t) => `${t.title} — ${t.message || t.reason || t.status}`),
      ],
    ],
    [
      l('다음 단계', 'Next steps'),
      [
        p.management.nextStep || fallback,
        ...p.upcoming
          .slice(0, 8)
          .map((m) => `${m.title} · ${m.assignee || fallback} · ${m.targetDate || fallback}`),
      ],
    ],
  ];
  const period = days ? l(`최근 ${days}일`, `Last ${days} days`) : l('전체 기간', 'All time');
  const note = l(
    '마일스톤 완료는 작성자의 보고입니다. 검사 통과·원본 반영·실제 배포는 서로 다른 상태입니다. 원본 경로·전체 도구 출력·계정 필드는 자동 첨부하지 않습니다. 작성한 메모와 작업 설명은 공유 전에 확인하세요.',
    'Milestone completion is author-reported. Passing checks, applying source changes and deploying are separate states. Source path, full tool output and account fields are not attached automatically. Review written notes and task descriptions before sharing.',
  );
  const markdown = `# ${plain(title)}\n\n${period} · ${generatedLabel}\n\n${sections.map(([heading, lines]) => `## ${heading}\n\n${lines.map((line) => `- ${plain(line)}`).join('\n')}`).join('\n\n')}\n\n---\n${note}\n`;
  const html = `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>${escapeHTML(title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#17212b;background:#f3f5f7;margin:0;padding:48px 24px}main{max-width:880px;margin:auto;background:white;padding:48px;border:1px solid #dce2e7;border-radius:16px}h1{font-size:32px;line-height:1.25}h2{font-size:19px;margin-top:32px;border-top:1px solid #e0e5ea;padding-top:24px}p,footer{color:#5b6776}li{margin:10px 0;overflow-wrap:anywhere;white-space:pre-wrap}footer{font-size:12px;margin-top:40px}@media print{body{padding:0;background:white}main{border:0;padding:0}section{break-inside:avoid}}@media(max-width:600px){body{padding:12px}main{padding:24px}}</style><main><p>Workroom · ${escapeHTML(period)}</p><h1>${escapeHTML(title)}</h1><p>${escapeHTML(generatedLabel)}</p>${sections.map(([heading, lines]) => `<section><h2>${escapeHTML(heading)}</h2><ul>${lines.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ul></section>`).join('')}<footer>${escapeHTML(note)}</footer></main></html>`;
  return {
    projectId: product.id,
    projectRevision: product.revision,
    generatedAt: now.toISOString(),
    days,
    language,
    markdown,
    html,
    sections,
    note,
    sourceVersions: [product, ...p.tasks, ...p.milestones].map(({ id, revision }) => ({
      id,
      revision,
    })),
  };
}
