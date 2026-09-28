import { randomUUID } from 'node:crypto';

export class RuntimeBroker {
  constructor({ fork, vault, onChange = () => {}, openBrowser = async () => {} }) {
    this.fork = fork;
    this.vault = vault;
    this.onChange = onChange;
    this.openBrowser = openBrowser;
    this.pending = new Map();
    this.status = { state: 'starting', connected: false, models: [] };
    this.child = null;
  }
  publish(patch) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }
  async start() {
    if (this.child) return;
    let credential;
    try {
      credential = this.vault.read();
    } catch (error) {
      this.publish({
        state: 'storage_error',
        failure: {
          code: 'storage',
          message: error.message,
          unreadable: error.code === 'unreadable',
        },
      });
      return;
    }
    this.publish({ state: 'starting', failure: null });
    const child = this.fork();
    this.child = child;
    let settle;
    this.ready = new Promise((resolve) => (settle = resolve));
    child.on('message', (message) => {
      if (this.child !== child) return;
      if (message.event === 'booted')
        void this.request('init', { credential }).then(settle, () => {
          this.publish({
            state: 'error',
            failure: {
              code: 'runtime',
              message: 'Pi 초기화에 실패했습니다. 실행기를 다시 연결하세요.',
            },
          });
          settle();
        });
      else void this.receive(message);
    });
    child.on('exit', () => {
      settle();
      if (this.child !== child) return;
      this.child = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Pi 프로세스와 연결이 끊겼습니다.'));
      }
      this.pending.clear();
      this.publish({
        state: 'offline',
        connected: false,
        failure: {
          code: 'runtime',
          message: 'Pi 실행기가 종료되었습니다. 다시 연결한 뒤 중단된 작업을 재개하세요.',
        },
      });
    });
  }
  // Starts the runner when it is not running and waits until it has finished initializing.
  async ensure() {
    if (!this.child) await this.start();
    await this.ready;
    if (!this.child)
      throw new Error(this.status.failure?.message || 'Pi 실행기를 시작하지 못했습니다.');
  }
  request(method, payload = {}) {
    if (!this.child)
      return Promise.reject(
        new Error('Pi 실행기가 꺼져 있습니다. 설정 → AI 실행에서 실행기를 다시 연결하세요.'),
      );
    const child = this.child,
      id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error('Pi 실행기 응답 시간이 초과되었습니다.'));
          // A timed-out run never releases ownership while an old process can continue.
          child.kill();
        },
        method === 'run' ? 300000 : method === 'verify' ? 60000 : 30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      child.postMessage({ id, method, payload });
    });
  }
  async receive(message) {
    if (message.reply) {
      const pending = this.pending.get(message.reply);
      if (!pending) return;
      this.pending.delete(message.reply);
      clearTimeout(pending.timer);
      message.ok
        ? pending.resolve(message.value)
        : pending.reject(new Error(message.error?.message || 'Pi 요청을 처리하지 못했습니다.'));
      return;
    }
    if (message.event === 'status') this.publish(message.value);
    else if (message.event === 'progress') this.onProgress?.(message);
    else if (message.event === 'browser' && this.status.state === 'logging_in') {
      try {
        const url = new URL(message.url);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'auth.openai.com' ||
          url.username ||
          url.password
        )
          throw new Error('invalid login URL');
        await this.openBrowser(url.href);
      } catch {
        this.publish({
          failure: {
            code: 'browser',
            message: '로그인 브라우저를 열지 못했습니다. 취소한 뒤 기기 코드 로그인을 시도하세요.',
          },
        });
      }
    } else if (message.event === 'request') {
      const child = this.child;
      try {
        let value;
        if (message.method === 'credential') {
          this.vault.write(message.payload);
          value = true;
        } else if (message.method === 'tool') value = await this.onTool(message.payload);
        else throw new Error('허용하지 않은 요청입니다.');
        if (child === this.child) child.postMessage({ reply: message.id, ok: true, value });
      } catch (error) {
        if (child === this.child)
          child.postMessage({
            reply: message.id,
            ok: false,
            error: message.method === 'credential' ? 'credential storage failed' : error.message,
          });
      }
    }
  }
  close() {
    this.child?.kill();
  }
}
