import { z } from 'zod';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot } from '../core/paths.mjs';
import { connectControl } from '../control/client.mjs';
import { controlRequest } from '../control/transport.mjs';

try {
  const at = process.argv.indexOf('--binding');
  if (at < 0 || !process.argv[at + 1]) throw new Error('작업실 연결 정보가 없습니다.');
  const binding = z
    .object({ database: z.string().min(1), productId: z.string().uuid() })
    .strict()
    .parse(JSON.parse(Buffer.from(process.argv[at + 1], 'base64url').toString('utf8')));
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input) > 2 * 1024 * 1024)
      throw new Error('수집 이벤트 크기를 초과했습니다.');
  }
  if (path.basename(binding.database) !== 'workroom.sqlite')
    throw new Error('지원하지 않는 작업실 데이터 파일입니다. 연결을 다시 설치하세요.');
  const directory = path.dirname(binding.database);
  const connection = await connectControl(directory, projectRoot, { start: true });
  if (!connection.readyForControl) throw new Error(connection.recovery);
  const requestId = randomUUID();
  let operation = await controlRequest(directory, 'execute', {
    command: 'capture.event',
    args: { productId: binding.productId, event: JSON.parse(input) },
    requestId,
  });
  for (let n = 0; ['accepted', 'running'].includes(operation.status) && n < 100; n++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    operation = await controlRequest(directory, 'operation', { requestId });
  }
  if (operation.status !== 'completed')
    throw new Error(`${operation.error || operation.status} · requestId ${requestId}`);
  process.stdout.write('{}\n');
} catch (error) {
  // Never block, resume, or inject instructions into the user's development turn.
  process.stdout.write(
    JSON.stringify({
      systemMessage: `작업실에 결과를 수집하지 못했습니다: ${error.message.slice(0, 300)}`,
    }) + '\n',
  );
}
