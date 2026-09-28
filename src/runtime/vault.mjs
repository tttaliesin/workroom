import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

export class CredentialVault {
  constructor(directory, protector, filename = 'openai.credential') {
    this.filename = path.join(directory, filename);
    this.protector = protector;
  }
  assertAvailable() {
    if (
      !this.protector.isEncryptionAvailable() ||
      this.protector.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new Error(
        '운영체제의 보호 저장소를 사용할 수 없습니다. 로그인 정보를 저장하지 않았습니다.',
      );
  }
  read() {
    this.assertAvailable();
    let encrypted;
    try {
      encrypted = readFileSync(this.filename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('계정 보호 저장소를 읽지 못했습니다.');
    }
    try {
      return JSON.parse(this.protector.decryptString(encrypted));
    } catch {
      throw new Error(
        '저장된 계정 정보를 복호화하지 못했습니다. 연결을 해제하고 다시 로그인하세요.',
      );
    }
  }
  status() {
    try {
      const credential = this.read();
      if (!credential) return { state: 'missing' };
      return {
        state:
          credential.type === 'oauth' &&
          typeof credential.access === 'string' &&
          credential.access.length > 0
            ? 'stored'
            : 'unavailable',
      };
    } catch {
      return { state: 'unavailable' };
    }
  }
  write(credential) {
    if (credential === null) {
      rmSync(this.filename, { force: true });
      return;
    }
    this.assertAvailable();
    if (
      credential.type !== 'oauth' ||
      typeof credential.access !== 'string' ||
      typeof credential.refresh !== 'string'
    )
      throw new Error('유효하지 않은 인증 정보입니다.');
    mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = this.filename + '.next';
    writeFileSync(temporary, this.protector.encryptString(JSON.stringify(credential)), {
      mode: 0o600,
    });
    renameSync(temporary, this.filename);
  }
}

// One broker process owns the store. Refresh, login, and logout share this lock.
export class BrokerCredentials {
  constructor(initial, persist) {
    this.value = initial || undefined;
    this.persist = persist;
    this.tail = Promise.resolve();
  }
  async read(id, options) {
    options?.signal?.throwIfAborted();
    return id === 'openai-codex' ? structuredClone(this.value) : undefined;
  }
  async list(options) {
    options?.signal?.throwIfAborted();
    return this.value ? [{ providerId: 'openai-codex', type: 'oauth' }] : [];
  }
  enqueue(fn, options) {
    const pending = this.tail
      .catch(() => {})
      .then(() => {
        options?.signal?.throwIfAborted();
        return fn();
      });
    this.tail = pending.catch(() => {});
    return pending;
  }
  modify(id, fn, options) {
    return this.enqueue(async () => {
      if (id !== 'openai-codex') throw new Error('unsupported provider');
      const next = await fn(structuredClone(this.value));
      options?.signal?.throwIfAborted();
      if (next !== undefined) {
        await this.persist(next);
        this.value = structuredClone(next);
      }
      return structuredClone(this.value);
    }, options);
  }
  delete(id, options) {
    return this.enqueue(async () => {
      if (id === 'openai-codex') {
        await this.persist(null);
        this.value = undefined;
      }
    }, options);
  }
}
