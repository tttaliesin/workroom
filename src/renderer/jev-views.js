import { t as tr } from '../shared/i18n.mjs';
import { html, button, e, header, date } from './html.js';
import { data, product, ui } from './state.js';

export function jevPage() {
  const p = product();
  if (!p) return header(tr('Jev 기억 연결'), tr('먼저 제품 폴더를 등록하세요.'));
  const connection = data.jev?.connections.find((x) => x.productId === p.id);
  const candidate = ui.jevCandidate?.productId === p.id ? ui.jevCandidate.descriptor : null;
  const descriptor = candidate || connection?.descriptor;
  const preview = ui.jevPreview?.payload.productId === p.id ? ui.jevPreview : null;
  const result =
    ui.jevResult?.productId === p.id && ui.jevResult.workspaceId === connection?.workspaceId
      ? ui.jevResult
      : null;
  const reports = data.tasks.filter((x) => x.productId === p.id && x.kind === 'work');
  const receipts = (data.jev?.receipts || []).filter((x) => x.productId === p.id);
  return (
    header(tr('Jev 기억 연결'), tr('독립 앱 · 선택적 연결 · 자동 전송 없음')) +
    html`
    <p class="muted">확인한 작업 결과를 Jev에 보관하고 다음 작업에 참고할 기억을 찾아보세요. 기존 Workroom 검색과 에이전트 문맥은 그대로 유지됩니다.</p>
    <div class="form gap"><label for="jev-product">연결할 제품</label><select id="jev-product">${data.products.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>
    <section class="jev-section"><div class="row between"><h2>1. 연결 설정</h2><span class="small">${connection?.enabled ? tr('연결 사용 중') : tr('연결 꺼짐')}</span></div>
      <p class="small muted gap">Jev 앱에서 내보낸 연결 JSON 파일을 선택하세요. 아래 명령은 연결 검사 후 저장을 누를 때 실행됩니다.</p>
      <div class="actions">${button(tr('연결 파일 선택'), 'jev-select')}${connection?.enabled ? button(tr('연결 해제'), 'jev-disable') : ''}</div>
      ${descriptor ? html`<dl class="jev-command"><dt>실행 파일</dt><dd>${e(descriptor.command)}</dd><dt>인수</dt><dd>${e(JSON.stringify(descriptor.args))}</dd><dt>프로젝트 폴더</dt><dd>${e(descriptor.cwd)}</dd></dl><div class="actions">${button(tr('연결 검사 후 저장'), 'jev-connect', 'class="primary"')}</div>` : ''}
      ${connection?.verifiedAt ? html`<p class="small muted gap">마지막 연결 확인: ${date(connection.verifiedAt)}</p>` : ''}
    </section>
    ${
      connection?.enabled
        ? html`<section class="jev-section"><h2>2. 결과 검토 후 보내기</h2>
      <p class="small muted gap">제목·요약·기여·한계만 전송합니다. 내부 근거 원문, 파일 목록, 검사 로그와 비공개 포트폴리오 강조점은 제외합니다.</p>
      ${reports.length ? html`<form data-form="jev-prepare" class="form gap"><label for="jev-report">보낼 작업 결과</label><select id="jev-report" name="reportId">${reports.map((x) => `<option value="${x.id}">${e(x.title)}</option>`).join('')}</select><div><button type="submit">전송 내용 검토</button></div></form>` : html`<p class="muted gap">아직 보낼 작업 결과가 없습니다.</p>`}
      ${preview ? html`<article class="notice jev-preview"><h3>${e(preview.payload.title)}</h3><p class="small muted">보고 버전 ${preview.payload.revision} · 보고된 내용, 독립 검증 없음</p><dl><dt>요약</dt><dd>${e(preview.payload.summary)}</dd><dt>기여 범위</dt><dd>${e(preview.payload.contribution)}</dd><dt>한계</dt><dd>${e(preview.payload.limitations)}</dd></dl><div class="actions">${button(tr('이 내용 Jev에 보내기'), 'jev-publish', 'class="primary"')}${button(tr('취소'), 'jev-cancel')}</div></article>` : ''}
      ${receipts.length ? html`<details class="gap"><summary>최근 전송 이력</summary>${receipts.map((x) => html`<p class="small gap">${e(data.tasks.find((t) => t.id === x.reportId)?.title || x.reportId)} · ${tr('보고 버전')} ${x.reportRevision} · ${date(x.sentAt)}</p>`).join('')}<p class="small muted gap">이력은 전송 당시의 확인 결과입니다. Jev에서 이후 삭제한 상태는 반영하지 않습니다.</p></details>` : ''}
    </section><section class="jev-section"><h2>3. Jev 기억 검색</h2><p class="small muted gap">이 Workroom에서 현재 제품으로 보낸 기억만 검색합니다. 결과는 자동으로 작업이나 포트폴리오에 반영되지 않습니다.</p>
      <form data-form="jev-search" class="form gap"><label for="jev-query">다음 작업에 참고할 내용</label><input id="jev-query" name="query" required maxlength="500" value="${e(result?.query || '')}"><div><button type="submit">Jev에서 검색</button></div></form>
      ${result ? html`<div class="jev-results">${result.items.length ? result.items.map((x) => html`<article class="record"><h3>${e(x.title)}</h3><p class="preserve-lines gap">${e(x.summary)}</p><p class="small preserve-lines gap">기여 범위: ${e(x.contribution)}</p><p class="small preserve-lines gap">한계: ${e(x.limitations)}</p><p class="small muted gap">Jev · ${e(x.memoryId)} · ${tr('보고 버전')} ${x.revision}</p></article>`).join('') : html`<p class="muted gap">검색 결과가 없습니다.</p>`}${result.truncated ? html`<p class="small muted gap">일부 결과만 표시했습니다. 검색어를 구체적으로 입력하세요.</p>` : ''}</div>` : ''}
    </section>`
        : ''
    }
    <p class="small muted gap">연결을 해제해도 양쪽 기록은 삭제되지 않습니다. Jev가 없어도 Workroom의 작업·검색·포트폴리오는 사용할 수 있습니다.</p>`
  );
}
