import { html, button, e } from './html.js';
import { t as tr } from '../shared/i18n.mjs';
export async function publicationCall(method, args) {
  const result = await window.workroom.publication(method, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export function publicationPanel(p, data) {
  const destination = data.publicationDestinations?.find((d) => d.portfolioId === p.id);
  const versions = (data.publications || []).filter((v) => v.portfolioId === p.id);
  const job = data.jobSources?.find((s) => s.id === p.jobSourceId);
  const states = {
    prepared: tr('공개 전 검토'),
    submitting: tr('전송 중'),
    uncertain: tr('전송 결과 확인 필요'),
    building: tr('배포 준비 중'),
    published: tr('공개 내용 확인됨'),
    unverified: tr('공개 내용 미확인'),
    failed: tr('공개 실패'),
  };
  return html`<details class="section"><summary>공고 원문과 공개 버전</summary>
    <form class="form gap" data-form="job-source" data-id="${p.id}" data-revision="${p.revision}">
      <h3>공고 원문 보관</h3><p class="small muted">공고 주소와 읽은 원문을 붙여 넣으면 버전별로 보관하고 대상 요구에 반영합니다.</p>
      <label>공고 주소<input name="url" type="url" required value="${e(job?.url || '')}"></label>
      <label>공고 원문<textarea name="description" required maxlength="12000">${e(job?.description || '')}</textarea></label>
      ${job ? `<p>v${job.version} · ${e(job.capturedAt)}</p>` : ''}<button type="submit">공고 버전 저장</button>
    </form>
    <form class="form gap" data-form="publication-credentials"><h3>Vercel 계정</h3>
      <label>Vercel 접근 토큰<input name="token" type="password" autocomplete="off" required></label>
      <p class="small muted">토큰은 운영체제 보호 저장소에 저장합니다. 공개 전용 프로젝트를 사용하세요.</p>
      <div class="actions"><button type="submit">토큰 저장</button>${button(tr('토큰 삭제'), 'publication-disconnect')}</div>
    </form>
    <form class="form gap" data-form="publication-destination" data-id="${p.id}" data-version="${destination?.version || 0}">
      <label>공개 전용 프로젝트 이름<input name="project" required pattern="[a-z0-9][a-z0-9-]{1,99}" value="${e(destination?.project || '')}"></label>
      <label>Vercel 팀 ID · 선택<input name="teamId" value="${e(destination?.teamId || '')}"></label>
      <p class="small muted">검토 후 공개하면 이 프로젝트의 프로덕션 배포를 바꿉니다. 별도 프로젝트를 사용해 다른 사이트와 구분하세요.</p>
      <button type="submit">공개 대상 저장</button>
    </form>
    <div class="actions gap">${button(tr('저장한 초안으로 공개 버전 준비'), `publication-prepare:${p.id}`)}</div>
    ${versions
      .slice(0, 10)
      .map(
        (v) => html`<article class="record">
      <strong>${e(states[v.status] || v.status)}</strong> · ${e(v.destination.project)}
      <p class="small muted">${e(v.created)} · ${e(v.artifactHash.slice(0, 12))}</p>
      ${v.restoreId ? html`<p>이전 공개 내용으로 복원하는 버전입니다. 최신 근거를 반영한 초안과 다를 수 있습니다.</p>` : ''}
      ${v.message ? `<p>${e(tr(v.message))}</p>` : ''}
      <details class="gap" ${v.status === 'prepared' ? 'open' : ''}><summary>전송할 공개 내용</summary>
      <p>${e(v.snapshot.intro)}</p>${v.snapshot.entries.map((x) => `<article><h4>${e(x.title)}</h4><p>${e(x.description)}</p><p>${e(x.contribution)}</p></article>`).join('')}</details>
      <div class="actions">
        ${v.status === 'prepared' ? button(tr('이 내용과 대상으로 공개'), `publication-publish:${v.id}`, 'class="primary"') : button(tr('공개 상태 조회'), `publication-reconcile:${v.id}`)}
        ${v.url ? button(tr('공개 주소 열기'), `publication-open:${v.id}`) : ''}
        ${v.verifiedAt ? button(tr('이 버전 복원 준비'), `publication-restore:${v.id}`) : ''}
      </div>
    </article>`,
      )
      .join('')}
  </details>`;
}
