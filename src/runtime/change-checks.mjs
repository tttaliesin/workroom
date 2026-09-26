import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redact } from './errors.mjs';

export function runNode(node, args, cwd, signal, { timeoutMs = 30000, limit = 16000 } = {}) {
  if (signal?.aborted)
    return Promise.resolve({
      result: 'cancelled',
      output: '실행 전에 중지했습니다.',
      exitCode: null,
    });
  return new Promise((resolve) => {
    const env = Object.fromEntries(
      ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    );
    const child = spawn(node, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      reason = null,
      settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const stop = (why) => {
      reason = why;
      child.kill();
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const data = (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > limit) {
        output = output.slice(0, limit);
        stop('output_limit');
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data);
    child.stderr.on('data', data);
    child.on('error', () =>
      finish({
        result: 'unconfirmed',
        output:
          'Node.js 실행 파일을 시작하지 못했습니다. Node.js 24 이상 또는 WORKROOM_NODE 설정을 확인하세요.',
        exitCode: null,
      }),
    );
    child.on('close', (code) => {
      let clean = redact(output);
      for (const prefix of [
        pathToFileURL(cwd).href,
        cwd.replaceAll('\\', '\\\\'),
        cwd.replaceAll('\\', '/'),
        cwd,
      ])
        clean = clean.replaceAll(prefix, '[수정 복사본]');
      finish({
        result: reason || (code === 0 ? 'passed' : 'failed'),
        output: clean,
        exitCode: code,
      });
    });
  });
}
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
  if (!change.testFiles.length)
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
