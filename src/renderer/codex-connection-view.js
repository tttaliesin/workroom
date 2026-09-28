import { t as tr } from '../shared/i18n.mjs';
import { html, button, e } from './html.js';
import { product, ui } from './state.js';

// App-wide Codex setup: find the executables and register the Workroom MCP server once.
// Collecting work from a product and approving its hooks is part of that product's settings.
export function codexConnectionView() {
  const p = product(),
    status = ui.codexStatus?.productId === p?.id ? ui.codexStatus : null;
  const runtime = status?.runtime,
    plan = ui.mcpPlan;
  return html`
    <div class="form codex-connection">
      <section>
        <h2>1. 실행 환경 확인</h2>
        <p class="small muted gap">설치된 Codex와 Node.js 24 이상을 자동으로 찾습니다. 찾지 못하면 실행 파일을 직접 선택하세요.</p>
        ${['codex', 'node'].map((kind) => `<p class="small gap"><strong>${kind === 'codex' ? 'Codex' : 'Node.js'}</strong> · ${runtime?.[kind] ? `${e(runtime[kind].version)}<br><span class="muted product-folder">${e(runtime[kind].path)}</span>` : tr('확인 필요')}</p>`).join('')}
        <div class="actions">${button(tr('환경·연결 상태 확인'), 'connection-status')}${button(tr('Codex 실행 파일 선택'), 'connection-select:codex', 'class="plain"')}${button(tr('Node.js 실행 파일 선택'), 'connection-select:node', 'class="plain"')}</div>
      </section>
      <section>
        <h2>2. Codex에서 작업실 기록 읽기</h2>
        <p class="small muted gap">${status?.configured ? tr('현재 제품에 작업실 MCP 설정이 적용되어 있습니다.') : tr('Codex 사용자 설정에 작업실 MCP 서버를 등록합니다. 같은 컴퓨터의 Codex에서 공유하는 설정입니다.')}</p>
        <div class="actions">${button(tr('MCP 등록 내용 확인'), 'connection-prepare')}${button(tr('실제 연결 검사'), 'connection-probe', status?.configured ? '' : 'disabled')}</div>
        ${
          plan
            ? html`<div class="note gap">
          <h3>저장할 연결 설정</h3>
          <p class="small muted product-folder">${e(plan.filename)}</p>
          <p class="small gap">${plan.previous ? tr('기존 workroom 서버 항목을 아래 내용으로 교체합니다.') : tr('workroom 서버 항목을 추가합니다.')} 다른 설정은 유지하며 기존 파일은 백업합니다.</p>
          ${plan.previous ? tr`<details><summary>기존 workroom 항목</summary><pre>${e(JSON.stringify(plan.previous, null, 2))}</pre></details>` : ''}
          <pre>${e(JSON.stringify(plan.server, null, 2))}</pre>
          <div class="actions">${button(tr('Codex에 MCP 등록'), 'connection-install', 'class="primary"')}${button(tr('취소'), 'connection-cancel', 'class="plain"')}</div>
        </div>`
            : ''
        }
        ${ui.mcpBackup ? tr`<p class="small muted product-folder">마지막 백업: ${e(ui.mcpBackup)}</p>` : ''}
        ${status?.probe ? tr`<p class="gap">✓ 서버 응답 · 도구 ${status.probe.toolCount}개 · 작업실 데이터 조회 확인</p><p class="small muted">${e(status.probe.at)}에 검사했습니다. 이 검사는 이미 열려 있는 다른 Codex 대화의 연결 상태를 보증하지 않습니다.</p>` : ''}
      </section>
      <section>
        <h2>3. 제품별 작업 자동 수집</h2>
        <p class="small muted gap">파일 변경·검사가 있었던 Codex 작업을 기록으로 모으려면 각 제품의 설정에서 수집을 켜고 Codex 훅을 승인하세요.</p>
        ${p ? button(tr('현재 제품 설정 열기'), 'nav:scope', 'class="plain"') : button(tr('제품 등록'), 'nav:new-product', 'class="plain"')}
      </section>
    </div>`;
}
