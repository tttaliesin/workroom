import { z } from 'zod';
import { Workroom } from '../core/service.mjs';
import { captureCodexEvent } from './codex-capture.mjs';

let room;
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
  room = new Workroom(binding.database);
  captureCodexEvent(room, binding.productId, JSON.parse(input));
  process.stdout.write('{}\n');
} catch (error) {
  // Never block, resume, or inject instructions into the user's development turn.
  process.stdout.write(
    JSON.stringify({
      systemMessage: `작업실에 결과를 수집하지 못했습니다: ${error.message.slice(0, 300)}`,
    }) + '\n',
  );
} finally {
  room?.close();
}
