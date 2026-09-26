// Builds the whole screen as HTML from state; no DOM access or side effects.
import { html, button, e, icon } from './html.js';
import { newTarget, portfolioPage } from './portfolio-views.js';
import { delegationPage, productHome } from './product-overview.js';
import { newRecord, recordDetailPage, recordsPage } from './record-views.js';
import { accountLabel, accountPage } from './runtime-ui.js';
import {
  accountReturnNotice,
  connectionPage,
  newDecision,
  newProduct,
  newWork,
  productPage,
  scopePage,
} from './setup-views.js';
import { data, hasTaskPane, portfolioArea, product, requestDraft, ui } from './state.js';
import { linkPage, operations, taskNav, taskPane } from './work-views.js';
const shellClass = () =>
  [
    'shell',
    hasTaskPane() ? 'with-taskpane' : 'overview-shell',
    ui.listOpen ? 'show-list' : '',
    data.products.length ? '' : 'no-products',
  ].join(' ');
function workspaceNavigation() {
  if (['account', 'connection', 'new-product'].includes(ui.view))
    return html`<span class="view-label">
        ${{ account: '계정과 실행', connection: '외부 도구 연결', 'new-product': '제품 연결' }[ui.view]}
      </span>`;
  if (portfolioArea()) return '<span class="view-label">포트폴리오 · 대상별 소개</span>';
  const routes = {
    home: ['home'],
    ops: ['ops', 'new-work', 'new-decision', 'work-link'],
    records: ['records', 'record-detail', 'new-record'],
    scope: ['scope', 'product'],
  };
  return html`<nav class="product-tabs" aria-label="제품 화면">
      ${[
        ['home', '개요'],
        ['ops', '작업'],
        ['records', '기록'],
        ['scope', '설정'],
      ]
        .map(([route, label]) =>
          button(
            label,
            `nav:${route}`,
            `class="plain" ${routes[route].includes(ui.view) ? 'aria-current="page"' : ''}`,
          ),
        )
        .join('')}
    </nav>`;
}
function workspaceToolbar() {
  const canDelegate =
    product() && ['home', 'ops', 'records', 'record-detail', 'scope', 'product'].includes(ui.view);
  return html`<div class="workspace-toolbar">${workspaceNavigation()}<div class="toolbar-actions">
        ${ui.history.length ? button('←', 'return-location', 'class="plain history-back" aria-label="이전 화면으로 돌아가기" title="이전 화면으로 돌아가기"') : ''}
        ${
          hasTaskPane()
            ? button(
                html`${icon('list')}<span>
            ${ui.listOpen ? '상세 보기' : portfolioArea() ? '대상 목록' : '작업 목록'}
          </span>`,
                'toggle-list',
                `class="plain list-toggle" aria-expanded="${!!ui.listOpen}"`,
              )
            : ''
        }
        ${canDelegate ? button('일 맡기기', 'delegate', 'class="primary toolbar-delegate delegate-primary"') : ''}
      </div>
    </div>`;
}
export function pendingMessage() {
  return ui.review
    ? '새 기록이 도착했습니다. 검토 중인 내용은 유지하며, 검토를 닫으면 반영합니다.'
    : '새 기록이 도착했습니다. 입력은 저장 후 함께 반영됩니다.';
}
function view() {
  switch (ui.view) {
    case 'home':
      return productHome(
        product(),
        data,
        requestDraft(),
        Object.entries(ui.requests).filter(([key]) => key.startsWith(ui.productId + '@')),
      );
    case 'account':
      return accountReturnNotice() + accountPage(data.runtime);
    case 'scope':
      return scopePage();
    case 'record-detail':
      return recordDetailPage();
    case 'work-link':
      return linkPage();
    case 'new-product':
      return newProduct();
    case 'product':
      return productPage();
    case 'records':
      return recordsPage();
    case 'new-record':
      return newRecord();
    case 'new-work':
      return newWork();
    case 'new-decision':
      return newDecision();
    case 'new-target':
      return newTarget();
    case 'portfolio':
      return portfolioPage();
    case 'connection':
      return connectionPage();
    default:
      return operations();
  }
}
export function shellHTML() {
  return html`<header class="appbar">
      <strong>
        <img class="app-mark" src="../desktop/assets/workroom.svg" width="18" height="18" alt=""
        aria-hidden="true">작업실</strong>
      <div class="row">
        ${button(e(accountLabel(data.runtime)), 'nav:account', 'class="plain"')}
        ${button('새로고침', 'refresh', `class="plain" ${ui.busy ? 'disabled' : ''}`)}
      </div>
    </header>
    <div class="${shellClass()}">
      <aside class="sidebar">
        <div class="nav-label">내 제품</div>
        <nav class="products" aria-label="등록한 제품">${data.products.map(taskNav).join('')}</nav>
        <nav class="portfolio-nav" aria-label="포트폴리오 탐색">
          ${button(`${icon('page')}<span>포트폴리오</span>`, 'open-portfolio', portfolioArea() ? 'aria-current="page"' : '')}
        </nav>
        <nav class="bottom" aria-label="앱 설정">
          ${button('<span aria-hidden="true">＋</span><span>제품 등록</span>', 'nav:new-product', 'aria-label="+ 제품 등록"')}
          ${button(`${icon('connection')}<span>MCP 연결</span>`, 'nav:connection', ui.view === 'connection' ? 'aria-current="page"' : '')}
        </nav>
      </aside>
      <div class="workspace">${workspaceToolbar()}<div
      class="workspace-body">${hasTaskPane() ? taskPane() : ''}
        <main class="main ${ui.view === 'home' ? 'overview-main' : ui.view === 'delegate' ? 'request-main' : ''}">
            <div class="content ${ui.view === 'home' ? 'overview-content' : ''}">
              <div class="sync-notice small muted" role="status">
                ${ui.externalPending ? pendingMessage() : ''}
              </div>
              <div class="message" role="status" aria-live="polite">
                ${ui.message ? `<div class="notice ${ui.error ? 'error' : ''}">${e(ui.message)}</div>` : ''}
              </div>${view()}</div>
          </main>
      </div>
      </div>
    </div>
    ${
      ui.requestOpen
        ? html`<dialog class="request-dialog" aria-labelledby="request-title">
        ${delegationPage(product(), data.runtime, requestDraft())}
      </dialog>`
        : ''
    }`;
}
