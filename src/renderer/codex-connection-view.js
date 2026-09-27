import { html, button, e, header } from './html.js';
import { data, product, ui } from './state.js';

export function codexConnectionView(capture) {
  const p = product(),
    status = ui.codexStatus?.productId === p?.id ? ui.codexStatus : null;
  const runtime = status?.runtime,
    plan = ui.mcpPlan;
  const trusted =
    status?.hooks?.length === 3 &&
    status.hooks.every((h) => h.enabled && ['trusted', 'managed'].includes(h.trust));
  return (
    header('Codex 연결', '기록을 읽는 연결과 작업 결과 수집을 여기서 설정하고 확인합니다.') +
    html`
    <div class="form codex-connection">
      <section class="note">
        <h2>연결할 제품</h2>
        <div class="actions">${data.products.map((item) => button(e(item.name), `connection-product:${item.id}`, item.id === p?.id ? 'class="primary" aria-pressed="true"' : 'aria-pressed="false"')).join('')}
        ${button('제품 등록', 'nav:new-product', 'class="plain"')}</div>
        ${p ? `<p class="small muted product-folder">${e(p.folder)}</p>` : '<p>작업 폴더를 제품으로 등록하면 자동 수집도 연결할 수 있습니다.</p>'}
      </section>
      <section>
        <h2>1. 실행 환경 확인</h2>
        <p class="small muted gap">설치된 Codex와 Node.js 24 이상을 자동으로 찾습니다. 찾지 못하면 실행 파일을 직접 선택하세요.</p>
        ${['codex', 'node'].map((kind) => `<p class="small gap"><strong>${kind === 'codex' ? 'Codex' : 'Node.js'}</strong> · ${runtime?.[kind] ? `${e(runtime[kind].version)}<br><span class="muted product-folder">${e(runtime[kind].path)}</span>` : '확인 필요'}</p>`).join('')}
        <div class="actions">${button('환경·연결 상태 확인', 'connection-status')}${button('Codex 실행 파일 선택', 'connection-select:codex', 'class="plain"')}${button('Node.js 실행 파일 선택', 'connection-select:node', 'class="plain"')}</div>
      </section>
      <section>
        <h2>2. Codex에서 작업실 기록 읽기</h2>
        <p class="small muted gap">${status?.configured ? '현재 제품에 작업실 MCP 설정이 적용되어 있습니다.' : 'Codex 사용자 설정에 작업실 MCP 서버를 등록합니다. 같은 컴퓨터의 Codex에서 공유하는 설정입니다.'}</p>
        <div class="actions">${button('MCP 등록 내용 확인', 'connection-prepare')}${button('실제 연결 검사', 'connection-probe', status?.configured ? '' : 'disabled')}</div>
        ${
          plan
            ? html`<div class="note gap">
          <h3>저장할 연결 설정</h3>
          <p class="small muted product-folder">${e(plan.filename)}</p>
          <p class="small gap">${plan.previous ? '기존 workroom 서버 항목을 아래 내용으로 교체합니다.' : 'workroom 서버 항목을 추가합니다.'} 다른 설정은 유지하며 기존 파일은 백업합니다.</p>
          ${plan.previous ? `<details><summary>기존 workroom 항목</summary><pre>${e(JSON.stringify(plan.previous, null, 2))}</pre></details>` : ''}
          <pre>${e(JSON.stringify(plan.server, null, 2))}</pre>
          <div class="actions">${button('Codex에 MCP 등록', 'connection-install', 'class="primary"')}${button('취소', 'connection-cancel', 'class="plain"')}</div>
        </div>`
            : ''
        }
        ${ui.mcpBackup ? `<p class="small muted product-folder">마지막 백업: ${e(ui.mcpBackup)}</p>` : ''}
        ${status?.probe ? `<p class="gap">✓ 서버 응답 · 도구 ${status.probe.toolCount}개 · 작업실 데이터 조회 확인</p><p class="small muted">${e(status.probe.at)}에 검사했습니다. 이 검사는 이미 열려 있는 다른 Codex 대화의 연결 상태를 보증하지 않습니다.</p>` : ''}
      </section>
      ${p ? capture(p) : ''}
      ${
        p
          ? html`<section>
        <h2>4. 앱 안에서 Codex 승인</h2>
        <p class="small muted gap">Codex 화면을 열어 로그인·프로젝트 신뢰 안내를 마친 뒤, 훅 승인 화면에서 ‘작업실 수집’ 항목 3개를 검토·승인하세요. 설정 파일을 직접 편집할 필요가 없습니다.</p>
        <div class="actions">${button('Codex 승인 화면 열기', 'connection-terminal', 'class="primary"')}${button('승인 상태 다시 확인', 'connection-status')}</div>
        <p class="gap">${trusted ? '✓ 작업실 훅 3개 신뢰·활성화 확인' : '작업실 훅 승인 확인 필요'}</p>
        ${(status?.hooks || []).map((h) => `<p class="small muted">${e(h.event)} · ${{ trusted: '신뢰됨', managed: '관리 정책 승인', modified: '변경되어 재승인 필요', untrusted: '승인 대기' }[h.trust] || e(h.trust)} · ${h.enabled ? '활성' : '비활성'}</p>`).join('')}
        ${(status?.warnings || []).map((warning) => `<p class="small muted">${e(warning)}</p>`).join('')}
        <p class="small muted gap">연결 후에는 여기서 연 Codex에서도 작업할 수 있습니다. 기존 Codex 대화에는 새 설정이 즉시 적용되지 않을 수 있으므로 새 작업에서 확인하세요. 파일 변경·검사가 포함된 작업이 끝나면 위 수집 상태에 최근 수신 시각이 표시됩니다.</p>
      </section>`
          : ''
      }
    </div>`
  );
}
