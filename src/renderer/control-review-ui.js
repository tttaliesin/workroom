import { html, e } from './html.js';
import { t as tr } from '../shared/i18n.mjs';
export function controlReviewHistory(data, command, targetId) {
  const packages = (data.reviewPackages || []).filter(
    (p) => p.command === command && p.targetId === targetId,
  );
  const ids = new Set(packages.map((p) => p.id));
  const reviews = (data.reviewRecords || []).filter((r) => ids.has(r.packageId));
  if (!reviews.length) return '';
  const verdicts = {
    supported: tr('반영 가능 의견'),
    changes_requested: tr('보완 요청'),
    inconclusive: tr('판단 유보'),
  };
  const choices = { execute: tr('실행 결정'), revise: tr('보완 결정'), reject: tr('실행 거절') };
  return html`<section class="section control-reviews"><h2>${tr('검토 의견과 실행 결정')}</h2>
    ${reviews
      .slice(0, 8)
      .map((r) => {
        const decision = (data.executionDecisions || []).find((d) => d.reviewId === r.id);
        return html`<article class="record"><h3>${e(verdicts[r.verdict])} · ${e(r.caller.channel === 'app' ? tr('앱 사용자 액션') : tr('연결 클라이언트'))}</h3><p class="preserve-lines">${e(r.assessment)}</p><p class="small muted">${e(r.limitations)}</p>${decision ? html`<p>${e(choices[decision.choice])} · ${e(decision.authority.reference)}</p>` : ''}<p class="small muted">${e(r.created)} · ${e(r.packageHash.slice(0, 12))}</p></article>`;
      })
      .join('')}</section>`;
}
