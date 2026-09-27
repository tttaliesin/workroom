import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Workroom, schemas } from '../core/service.mjs';
import { databaseFile, dataDirectory } from '../core/paths.mjs';
import { runtimeEmbeddings } from '../runtime/local-embeddings.mjs';

const room = new Workroom(databaseFile, { embedding: runtimeEmbeddings(dataDirectory) });
const server = new McpServer({ name: 'workroom-local', version: '0.1.0' });
function tool(name, description, schema, readOnly, handler) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema.shape,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: false,
        idempotentHint: readOnly,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await handler(args)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    },
  );
}
tool(
  'workroom_operation_status',
  '제품의 저장된 운영 정책·최근 관측·발견 문제를 조회합니다. 실행 권한 변경이나 자동화 시작은 앱에서만 합니다.',
  z.object({ productId: z.string().uuid() }),
  true,
  ({ productId }) => {
    room.store.get('product', productId);
    return {
      liveConnection: false,
      policy: room.store.list('operation-policy').find((p) => p.productId === productId) || null,
      observations: room.store
        .list('operation-observation')
        .filter((o) => o.productId === productId)
        .slice(0, 10)
        .map(({ manifest, ...rest }) => rest),
      issues: room.store.list('operation-issue').filter((i) => i.productId === productId),
    };
  },
);
tool(
  'workroom_list_products',
  '앱에서 사용자가 등록한 제품을 나열합니다. 새 폴더 접근 권한은 앱에서만 등록할 수 있습니다.',
  z.object({}),
  true,
  () => room.store.list('product'),
);
tool(
  'workroom_agent_status',
  '앱의 내장 조사와 역할별 마지막 저장 상태를 조회합니다. liveConnection은 false이며 실행 프로세스의 실시간 상태 확인이 아닙니다. 완료 결과는 resultTaskId로 연결됩니다. 외부 작업 보고로 내장 실행을 완료시키거나 계정·범위를 변경할 수 없습니다.',
  z.object({ productId: z.string().uuid() }),
  true,
  (args) => room.agentWork(args),
);
tool(
  'workroom_product_context',
  'Pi와 같은 검색·근거 검증으로 한 제품의 활성 기록을 최대 8개 조회하고 제공 버전을 기록합니다. 준비된 로컬 의미 색인과 단어 검색을 결합하며, 준비·실패 시 단어 검색을 사용합니다. 실제 검색 방식은 retrieval.mode에 표시됩니다. 변경·삭제된 파일 근거와 제외·재확인 보류 기록은 반환하지 않습니다. 파일 근거 없는 보고는 독립 검증된 사실이 아니며 조회 이력은 실제 활용 확인이 아닙니다.',
  schemas.context,
  false,
  (args) => room.context(args),
);
tool(
  'workroom_list_work',
  '제품의 문제별 작업과 후속 보고를 조회합니다. 같은 문제의 후속 보고에는 workroom_report_work의 workTaskId에 독립된 작업 ID를 지정할 수 있습니다. 같은 파일이나 시간만으로 관계를 추정하지 마세요.',
  z.object({ productId: z.string().uuid() }),
  true,
  ({ productId }) => {
    room.store.get('product', productId);
    return room.store.list('task').filter((t) => t.productId === productId && t.kind === 'work');
  },
);
tool(
  'workroom_inspect_repository',
  '등록된 폴더의 Git 상태, README 유무, package.json 스크립트 이름을 읽고 점검 결과를 저장합니다. 코드를 실행하거나 수정하지 않습니다.',
  schemas.inspect,
  false,
  (args) => room.inspect(args),
);
tool(
  'workroom_request_decision',
  '제품 방침이 없어 진행할 수 없을 때만 판단 요청을 만듭니다. 이유와 선택별 영향을 적으세요. 사용자의 선택은 앱에서 이루어집니다.',
  schemas.requestDecision,
  false,
  (args) => room.requestDecision(args, 'mcp'),
);
tool(
  'workroom_list_decisions',
  '사용자의 판단 요청과 결정 상태를 조회합니다. 결정만으로 실행이 재개되거나 코드가 바뀐 것은 아닙니다.',
  z.object({ productId: z.string().uuid() }),
  true,
  ({ productId }) => {
    room.store.get('product', productId);
    return room.store
      .list('task')
      .filter((t) => t.productId === productId && t.kind === 'decision');
  },
);
tool(
  'workroom_report_work',
  '같은 문제의 새 실행은 workTaskId에 workroom_list_work의 독립 작업 ID를 지정해 연결합니다. 별개 실행은 별개 externalId를 사용합니다. 사용자가 정정한 연결은 수정 보고로 되돌리지 않습니다. 수행한 작업의 결과·근거·한계·기여를 기록하고 앱에서 구독한 로컬 초안에 반영합니다. externalId에 제품 안에서 안정적인 작업 식별자(예: 세션 ID+작업 ID)를 넣으세요. 동일 externalId와 sourceVersion(기본 1)의 같은 보고는 중복 생성하지 않습니다. 수정 보고는 같은 externalId에 sourceVersion을 높여 전체 내용을 보내세요. 누락하거나 비운 선택 필드도 해당 버전의 전체 내용으로 처리됩니다. changedFiles는 파일·설명, checks는 이름·결과(passed/failed/unconfirmed)·근거입니다. 독립 검증이 아닌 에이전트 보고입니다. 비공개 근거를 공개용 요약에 넣지 마세요. 웹 공개는 하지 않습니다.',
  schemas.reportWork,
  false,
  (args) => room.reportWork(args, 'mcp'),
);
tool(
  'workroom_add_knowledge',
  '다음 작업에 재사용할 지식을 출처와 적용 조건과 함께 저장합니다. 비밀값은 넣지 마세요. MCP 보고라는 출처가 유지됩니다.',
  schemas.addRecord,
  false,
  (args) => room.addRecord(args, 'mcp'),
);

const transport = new StdioServerTransport();
await server.connect(transport);
room.knowledge.index?.start();
process.stdin.on('end', async () => {
  await server.close();
  room.close();
});
process.on('SIGINT', async () => {
  await server.close();
  room.close();
  process.exit(0);
});
