import { runNode } from './node-process.mjs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { verifyProfile } from './verification-profile.mjs';

export async function verifyChange({ change, node, signal }) {
  const checks = [];
  const version = await runNode(node, ['--version'], change.directory, signal);
  if (version.result !== 'passed' || Number(version.output.match(/v(\d+)/)?.[1] || 0) < 24)
    return {
      checks: [
        {
          name: '검사 런타임',
          result: 'unconfirmed',
          output: '검사에는 Node.js 24 이상이 필요합니다.',
        },
      ],
      status: 'unconfirmed',
    };
  for (const entry of change.changes) {
    if (signal?.aborted) break;
    if (/\.(?:js|mjs|cjs)$/.test(entry.path))
      checks.push({
        name: `문법 · ${entry.path}`,
        target: 'candidate',
        ...(await runNode(
          node,
          [
            '--permission',
            `--allow-fs-read=${change.candidate}`,
            '--check',
            path.join(change.candidate, entry.path),
          ],
          change.candidate,
          signal,
        )),
      });
    else if (/\.json$/.test(entry.path)) {
      try {
        JSON.parse(entry.after);
        checks.push({
          name: `JSON · ${entry.path}`,
          target: 'candidate',
          result: 'passed',
          output: 'JSON 구문을 확인했습니다.',
        });
      } catch {
        checks.push({
          name: `JSON · ${entry.path}`,
          target: 'candidate',
          result: 'failed',
          output: 'JSON 구문 오류입니다.',
        });
      }
    } else
      checks.push({
        name: `자동 검사 범위 · ${entry.path}`,
        target: 'candidate',
        result: 'unconfirmed',
        output: '이 파일 형식의 컴파일러·기능 검사는 연결하지 않았습니다.',
      });
  }
  if (change.testFiles.length && !signal?.aborted)
    for (const target of ['baseline', 'candidate']) {
      const root = change[target],
        scratch = await mkdtemp(path.join(change.directory, `test-${target}-`));
      const execution = await runNode(
        node,
        [
          '--permission',
          `--allow-fs-read=${root}`,
          `--allow-fs-write=${scratch}`,
          '--test',
          '--test-isolation=none',
          '--test-reporter=tap',
          ...change.testFiles.map((p) => './' + p),
        ],
        root,
        signal,
      );
      const passCount = [...execution.output.matchAll(/^# pass (\d+)\s*$/gm)].at(-1)?.[1];
      if (execution.result === 'passed' && (!passCount || Number(passCount) === 0)) {
        execution.result = 'unconfirmed';
        execution.output += '\n실제로 통과한 Node 테스트 사례를 확인하지 못했습니다.';
      }
      checks.push({
        name: target === 'baseline' ? '선택한 테스트 · 수정 전' : '선택한 테스트 · 수정 후',
        target,
        ...execution,
      });
      if (signal?.aborted) break;
    }
  checks.push(...(await verifyProfile({ change, node, signal })));
  if (!change.testFiles.length && !change.verificationProfile?.enabled)
    checks.push({
      name: '기능 테스트',
      target: 'candidate',
      result: 'unconfirmed',
      output: '선택한 테스트가 없어 기능 검사를 실행하지 않았습니다.',
    });
  const candidate = checks.filter((c) => c.target !== 'baseline');
  return {
    checks,
    status: signal?.aborted
      ? 'cancelled'
      : candidate.some((c) => ['failed', 'timeout', 'output_limit'].includes(c.result))
        ? 'failed'
        : candidate.some((c) => c.result === 'unconfirmed')
          ? 'unconfirmed'
          : 'passed',
  };
}
