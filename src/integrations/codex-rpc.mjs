import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// A private, local app-server connection. No model requests or approval bypasses.
export class CodexRPC {
  constructor(executable, { cwd, env = process.env, onNotification = () => {} } = {}) {
    this.pending = new Map();
    this.sequence = 0;
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.resume();
    this.child.stdin.on('error', () => {});
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else onNotification(message);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', () =>
      this.fail(new Error('Codex 연결이 종료되었습니다. 다시 연결하세요.')),
    );
  }
  fail(error) {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'workroom', title: '작업실', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return this;
  }
  request(method, params = {}, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error('Codex 연결이 닫혔습니다.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 응답 시간 초과: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() {
    this.fail(new Error('Codex 연결을 닫았습니다.'));
    this.lines.close();
    this.child.kill();
  }
}
