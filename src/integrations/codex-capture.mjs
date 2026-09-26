import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { z } from 'zod';

const eventSchema = z.object({
  hook_event_name: z.enum(['PostToolUse', 'Stop', 'Interrupt']),
  session_id: z.string().min(1).max(300),
  turn_id: z.string().min(1).max(300),
  cwd: z.string().min(1).max(2048),
  tool_name: z.string().max(200).optional(),
  tool_use_id: z.string().max(300).optional(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
  last_assistant_message: z.string().max(200000).nullable().optional(),
});
const digest = (value) => createHash('sha256').update(value).digest('hex');
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};
const canonical = (value) => realpathSync(value);
const textResponse = (response) =>
  typeof response === 'string' ? response : JSON.stringify(response ?? {});

function commandObservation(command, response) {
  // Recognize test invocations, not arbitrary shell commands or their output.
  const match = command.match(
    /(?:^|[\n;&|])\s*(node\s+--test\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|pytest\b|python(?:3)?\s+-m\s+pytest\b|cargo\s+test\b|go\s+test\b|dotnet\s+test\b)/,
  );
  if (!match) return null;
  let code = typeof response?.exit_code === 'number' ? response.exit_code : null;
  const body = textResponse(response);
  if (code === null) {
    const found = body.match(/(?:Process exited with code|exit_code["']?\s*:)\s*(-?\d+)/i);
    if (found) code = Number(found[1]);
  }
  return {
    name: `${match[1]} · 명령 종료 상태`,
    result: code === 0 ? 'passed' : code === null ? 'unconfirmed' : 'failed',
    detail:
      code === null
        ? '완료 이벤트에서 종료 코드를 확인하지 못했습니다. 테스트 통과로 판단하지 않습니다.'
        : `전체 도구 호출의 종료 코드 ${code}. 복합 명령의 개별 검사 결과와 코드 수정본의 일치는 별도로 검증하지 않았습니다.`,
  };
}

function observations(event, root) {
  const command =
    typeof event.tool_input?.command === 'string'
      ? event.tool_input.command
      : typeof event.tool_input?.cmd === 'string'
        ? event.tool_input.cmd
        : typeof event.tool_input === 'string'
          ? event.tool_input
          : '';
  if (/^(apply_patch|Edit|Write)$/.test(event.tool_name || '')) {
    const response = textResponse(event.tool_response);
    if (event.tool_response?.isError || /(?:failed to|error:|patch rejected)/i.test(response))
      return null;
    const files = [];
    for (const match of command.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
    )) {
      const candidate = path.resolve(event.cwd, match[1].trim());
      if (inside(root, candidate))
        files.push({
          path: path.relative(root, candidate).replaceAll('\\', '/'),
          summary:
            'Codex의 파일 변경 도구 호출에서 수집. 실제 diff와 변경 성공 여부는 별도 검증하지 않았습니다.',
        });
    }
    return files.length ? { files: files.slice(0, 100), checks: [] } : null;
  }
  if (event.tool_name === 'Bash') {
    const check = commandObservation(command, event.tool_response);
    return check ? { files: [], checks: [check] } : null;
  }
  return null;
}

export function captureCodexEvent(room, productId, input) {
  const event = eventSchema.parse(input);
  const product = room.store.get('product', productId);
  if (!product.codexCaptureEnabled) return { status: 'disabled' };
  const root = canonical(product.folder),
    cwd = canonical(event.cwd);
  if (!inside(root, cwd)) return { status: 'outside-product' };
  // A nested registered product owns its own events, even if a parent hook fires.
  if (
    room.store
      .list('product')
      .some(
        (p) =>
          p.id !== productId &&
          p.folder.length > product.folder.length &&
          inside(root, p.folder) &&
          inside(p.folder, cwd),
      )
  )
    return { status: 'outside-product' };
  const key = digest(`${productId}\0${event.session_id}\0${event.turn_id}`);
  const state = room.store.transaction(() => {
    const old = room.store.list('capture').find((c) => c.key === key);
    if (event.hook_event_name === 'Interrupt') {
      if (old) room.store.update('capture', old.id, old.revision, { ...old, interrupted: true });
      return { status: 'interrupted' };
    }
    if (event.hook_event_name === 'PostToolUse') {
      const observed = observations(event, root);
      if (!observed) return { status: 'ignored' };
      if (!event.tool_use_id)
        throw new Error('도구 호출 ID가 없어 중복 수집을 방지할 수 없습니다.');
      const data = old || { key, productId, tools: {}, interrupted: false };
      // Keep a bounded set of observations; never store prompts, full tool output, or transcripts.
      if (!data.tools[event.tool_use_id] && Object.keys(data.tools).length >= 200)
        return { status: 'limit' };
      const next = {
        ...data,
        interrupted: false,
        tools: { ...data.tools, [event.tool_use_id]: observed },
      };
      if (old) room.store.update('capture', old.id, old.revision, next);
      else room.store.create('capture', next);
      return { status: 'observed' };
    }
    if (!old || old.interrupted || !event.last_assistant_message?.trim())
      return { status: 'ignored' };
    const files = [
      ...new Map(
        Object.values(old.tools)
          .flatMap((o) => o.files)
          .map((f) => [f.path, f]),
      ).values(),
    ].slice(0, 100);
    const checks = Object.values(old.tools)
      .flatMap((o) => o.checks)
      .slice(0, 100);
    const answer = event.last_assistant_message.trim().slice(0, 7800);
    const fingerprint = digest(JSON.stringify({ files, checks, answer }));
    if (old.deliveredFingerprint === fingerprint)
      return { status: 'duplicate', taskId: old.taskId };
    const version =
      old.fingerprint === fingerprint ? old.sourceVersion : (old.sourceVersion || 0) + 1;
    // Reserve the version before delivery. Replaying Stop retries the same version after a crash.
    const next = { ...old, fingerprint, sourceVersion: version, answer, files, checks };
    room.store.update('capture', old.id, old.revision, next);
    return { status: 'ready', ...next };
  });
  if (state.status !== 'ready') return state;
  const firstLine = state.answer
    .split('\n')
    .find((line) => line.trim())
    ?.replace(/^[#>*\s]+|[*`]/g, '')
    .slice(0, 140);
  const task = room.reportWork(
    {
      productId,
      externalId: `codex:${key}`,
      sourceVersion: state.sourceVersion,
      title: firstLine || `Codex 작업 · ${state.files.length}개 파일`,
      summary: `${state.files.length}개 파일의 변경 도구 호출과 ${state.checks.length}건의 검사 명령이 포함된 작업입니다. Codex의 완료 응답과 수집한 항목을 근거에서 확인할 수 있습니다.`,
      evidence: `Codex 응답 종료 시점에 수집한 마지막 응답:\n${state.answer}`,
      limitations:
        'Stop은 응답 종료 신호이며 제품 완성이나 테스트 통과의 증명이 아닙니다. 도구 훅이 제공한 호출만 수집했습니다. 직접 실행한 터미널 명령, 다른 도구의 변경, 전체 diff와 수정본 일치는 확인하지 않았습니다.',
      contribution:
        '에이전트의 도구 호출과 완료 응답을 수집했습니다. 사용자의 구체적인 기여 범위는 별도로 작성해야 합니다.',
      changedFiles: state.files,
      checks: state.checks,
    },
    'codex-hook',
  );
  room.store.transaction(() => {
    const capture = room.store.get('capture', state.id);
    room.store.update('capture', capture.id, capture.revision, {
      ...capture,
      deliveredFingerprint: state.fingerprint,
      taskId: task.id,
    });
    const current = room.store.list('capture-connection').find((c) => c.productId === productId);
    const connection = { productId, lastReceivedAt: new Date().toISOString(), lastTaskId: task.id };
    if (current)
      room.store.update('capture-connection', current.id, current.revision, {
        ...current,
        ...connection,
      });
    else room.store.create('capture-connection', connection);
    room.store.log('Codex 작업 수집', task.id, product.name);
  });
  return { status: 'collected', taskId: task.id };
}
