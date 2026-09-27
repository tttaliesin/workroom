// Public presentation shared by the desktop preview and HTML export.
// Design references: RyanFitzgerald/devportfolio and BartoszJarocki/cv (MIT).
export const portfolioTemplates = ['studio', 'editorial', 'resume'];
export const normalizeTemplate = (value) => (portfolioTemplates.includes(value) ? value : 'studio');
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function portfolioMarkup(
  snapshot,
  { language = 'ko', preview = false, currentTaskId } = {},
) {
  const english = language === 'en';
  const e = escapeHTML;
  const template = normalizeTemplate(snapshot.templateId);
  const heading = preview ? 'h2' : 'h1';
  const entryHeading = preview ? 'h3' : 'h2';
  const count = String(snapshot.entries.length).padStart(2, '0');
  const label = english ? 'Selected work' : '주요 작업';
  return `<article class="folio-document folio-${template}${preview ? ' paper' : ''}" aria-label="${english ? 'Portfolio preview' : '포트폴리오 미리보기'}">
    <div class="folio-masthead"><span class="folio-brand">PORTFOLIO<span class="folio-dot" aria-hidden="true">●</span></span><span class="folio-edition">${label} / ${count}</span></div>
    <div class="folio-layout"><header class="folio-hero">
      <p class="folio-kicker">${english ? 'Ideas. Decisions. Results.' : '생각에서 결과까지.'}</p>
      <${heading} class="folio-intro">${e(snapshot.intro || (english ? 'Add an introduction to your work.' : '나의 작업을 소개하는 문장을 적어보세요.'))}</${heading}>
      <div class="folio-hero-caption"><span class="folio-rule" aria-hidden="true"></span><span>${english ? 'A selection of work & contributions' : '직접 만든 변화와 그 안에서의 역할'}</span></div>
    </header>
    <div class="folio-work"><div class="folio-section-label"><span>${label}</span><span>${count}</span></div>
    <div class="folio-entries">${
      snapshot.entries
        .map(
          (
            entry,
            index,
          ) => `<section class="folio-entry${preview && currentTaskId && entry.taskId === currentTaskId ? ' current-entry' : ''}">
      <span class="folio-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <div class="folio-entry-body"><${entryHeading} class="folio-title">${e(entry.title)}</${entryHeading}>
      <p class="folio-description">${e(entry.description)}</p>
      <div class="folio-contribution"><span>${english ? 'Contribution:' : '기여 범위:'}</span><p>${e(entry.contribution)}</p></div></div>
    </section>`,
        )
        .join('') ||
      `<p class="folio-empty">${english ? 'Add a work example to see it here.' : '기록된 작업에서 사례를 추가하면 여기에 표시됩니다.'}</p>`
    }</div></div></div>
    <footer class="folio-footer"><span>SELECTED WORK</span><span>${english ? 'End of portfolio' : '포트폴리오 끝'} <span aria-hidden="true">↗</span></span></footer>
  </article>`;
}
