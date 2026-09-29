import { z } from 'zod';
import { catalog, entityKinds, schemaHash } from '../control/catalog.mjs';
import { controlRequest } from '../control/transport.mjs';
import { connectControl } from '../control/client.mjs';
import { failure, contractVersion } from '../control/contracts.mjs';
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
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(failure(error, { requestId: input.requestId })),
              },
            ],
          };
        }
      },
    );
  }
  register(
    'workroom_control_catalog',
    '앱과 공유하는 제어 명령·입력 계약을 조회합니다. core=제품/판단/기록/초안, runtime=작업/계정/자동화, publication=공개. 먼저 계약을 읽으세요. MCP에서 검토·실행하며 앱 승인 화면은 필요 없습니다.',
    {},
    true,
    () => ({
      protocol: 2,
      contractVersion,
      schemaHash,
      source: 'mcp-adapter',
      commands: catalog,
      entityKinds,
    }),
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
    '불변 검토 자료와 packageId를 저장·반환합니다. review.submit으로 판정·이유·한계·파일별 해시를, review.decide로 사용자 지시나 위임 근거와 결정을 기록하세요. prepare나 해시만으로 승인하지 않습니다.',
    command,
    false,
    (input) => controlRequest(directory, 'prepare', input),
  );
  register(
    'workroom_control_execute',
    '공통 제어 명령을 접수합니다. UUID requestId는 재전송 때 유지하세요. accepted/running은 완료가 아니며 operation으로 확인합니다. 검토 필수 명령에는 review.submit 결과 reviewId와 review.decide 결과 decisionId가 필요합니다. 외부 수정안은 external.submit으로 분리 복사본에 제출하고 앱이 검사합니다. reviewHash만으로 실행할 수 없습니다. 공개·반영·코드 실행은 사용자 지시 또는 위임 범위에서만 요청하세요.',
    {
      ...command,
      requestId: z.string().uuid(),
      protocol: z.literal(2).optional(),
      reviewId: z.string().uuid().optional(),
      decisionId: z.string().uuid().optional(),
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
    false,
    (input) => controlRequest(directory, 'export', input),
  );
}
