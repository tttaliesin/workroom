import { z } from 'zod';
import { catalog, entityKinds } from '../control/catalog.mjs';
import { controlRequest } from '../control/transport.mjs';
import { connectControl } from '../control/client.mjs';
export function registerControlTools(server, { directory, root }) {
  const args = z.record(z.string(), z.unknown()).default({});
  const command = { command: z.enum(Object.keys(catalog)), args };
  function register(name, description, inputSchema, readOnly, handler, external = false) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly || name === 'workroom_control_execute',
          openWorldHint: external,
        },
      },
      async (input) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await handler(input)) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
      },
    );
  }
  register(
    'workroom_control_catalog',
    '앱과 공유하는 제어 명령·입력 계약을 조회합니다. core=제품/판단/기록/초안, runtime=작업/계정/자동화, publication=공개. 먼저 계약을 읽으세요. MCP에서 검토·실행하며 앱 승인 화면은 필요 없습니다.',
    {},
    true,
    () => ({ protocol: 1, commands: catalog, entityKinds }),
  );
  register(
    'workroom_control_connect',
    '실행기 실시간 연결과 AI 준비 상태를 확인합니다. start:true면 앱 창 없이 같은 단일 실행기를 시작합니다. 기존 구버전 앱은 정상 종료 후 다시 연결해야 합니다. DB 조회 성공과 실행기 연결은 다릅니다.',
    { start: z.boolean().default(false) },
    false,
    (input) => connectControl(directory, root, input),
  );
  register(
    'workroom_control_read',
    '실시간 실행기가 사용하는 제품·작업·초안·검사·diff·공개 버전을 조회합니다. kind=change-set과 연결 task에서 변경 전후 내용과 검사/검토 결과를 확인하세요. id 또는 페이지 단위 조회를 사용합니다.',
    {
      kind: z.enum(entityKinds),
      id: z.string().uuid().optional(),
      productId: z.string().uuid().optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(25),
    },
    true,
    (input) => controlRequest(directory, 'read', input),
  );
  register(
    'workroom_control_prepare',
    '명령 인수·현재 버전·변경/공개 근거를 검토용으로 반환합니다. 사용자 지시나 위임 범위에 맞춰 Codex에서 검토하고 execute에 같은 인수와 reviewHash를 전달하세요. 이 호출은 실행하거나 승인하지 않습니다.',
    command,
    true,
    (input) => controlRequest(directory, 'prepare', input),
  );
  register(
    'workroom_control_execute',
    '제어 명령을 단일 실행기에 접수합니다. UUID requestId를 먼저 정하고 연결이 끊겨도 같은 ID를 재사용하세요. 같은 ID에 다른 내용은 거절합니다. 응답 running은 완료가 아니며 operation으로 확인합니다. 검토 필수 명령은 prepare의 reviewHash를 전달합니다. 계정 로그인은 여기서 시작하되 브라우저 인증은 사용자가 마칩니다. 공개·원본 반영·코드 실행은 사용자 승인 또는 명시적 위임 범위 안에서만 요청하세요.',
    {
      ...command,
      requestId: z.string().uuid(),
      reviewHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    },
    false,
    (input) => controlRequest(directory, 'execute', input),
    true,
  );
  register(
    'workroom_control_operation',
    'requestId의 접수/완료/실패/결과 불확실 상태를 조회합니다. uncertain은 재실행하지 말고 task, apply-journal, publication을 확인하세요. 실행기 재시작 후에도 ID를 조회할 수 있습니다.',
    { requestId: z.string().uuid() },
    true,
    (input) => controlRequest(directory, 'operation', input),
  );
  register(
    'workroom_control_export',
    '검토 가능한 고정 포트폴리오 HTML과 해시를 반환합니다. 파일 저장·웹 공개는 하지 않습니다. Codex에서 내용을 확인하고 사용자가 지정한 파일로 저장할 수 있습니다.',
    {
      id: z.string().uuid(),
      revision: z.number().int(),
      language: z.enum(['ko', 'en']).default('ko'),
    },
    true,
    (input) => controlRequest(directory, 'export', input),
  );
}
