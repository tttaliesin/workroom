import { spawn } from 'node:child_process';
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
      detached: process.platform !== 'win32',
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
      if (reason || settled) return;
      reason = why;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(
          path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/pid', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        killer.on('error', () => child.kill());
        killer.on('exit', (code) => {
          if (code) child.kill();
        });
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill();
      }
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
