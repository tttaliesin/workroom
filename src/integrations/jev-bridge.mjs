import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const JEV_CONTRACT = 'workroom-jev/1';
const text = (max) => z.string().min(1).max(max);
const contract = z.literal(JEV_CONTRACT);
const absolute = text(4096).refine(path.isAbsolute);
const descriptorSchema = z
  .object({
    contract,
    command: absolute,
    args: z.array(z.string().max(4096)).max(32),
    cwd: absolute,
  })
  .strict();
const statusSchema = z
  .object({
    contract,
    workspaceId: text(200),
    workspaceRoot: absolute,
    capabilities: z.array(text(40)).max(20),
  })
  .strict();
const receiptSchema = z
  .object({
    contract,
    status: z.enum(['created', 'updated', 'unchanged']),
    memoryId: text(200),
    revision: z.number().int().positive(),
  })
  .strict();
const itemSchema = z
  .object({
    memoryId: text(200),
    reportId: z.string().uuid(),
    revision: z.number().int().positive(),
    title: text(200),
    summary: z.string().max(8000),
    contribution: z.string().max(3000),
    limitations: z.string().max(4000),
  })
  .strict();
const searchSchema = z
  .object({ contract, items: z.array(itemSchema).max(8), truncated: z.boolean() })
  .strict();
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

// No shell, command discovery, repository imports, model startup or shared database.
export async function jevSession(descriptor, action, { timeout = 12000 } = {}) {
  const client = new Client({ name: 'workroom-bridge', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: descriptor.command,
    args: descriptor.args,
    cwd: descriptor.cwd,
    stderr: 'pipe',
    maxBufferSize: 1024 * 1024,
  });
  transport.stderr?.resume();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        return await action(async (name, args) => {
          const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
          if (result.isError)
            throw new Error('Jev 요청이 거부되었습니다. 연결과 보고 버전을 확인하세요.');
          const contents = result.content;
          if (
            contents?.length !== 1 ||
            contents[0].type !== 'text' ||
            contents[0].text.length > 160000
          )
            throw new Error('Jev 응답 형식 또는 크기가 올바르지 않습니다.');
          return JSON.parse(contents[0].text);
        });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Jev 연결 시간이 초과되었습니다. 기존 작업은 유지됩니다.')),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export class JevBridge {
  constructor(room, { session = jevSession } = {}) {
    this.room = room;
    this.store = room.store;
    this.session = session;
    this.previews = new Map();
  }
  connection(productId) {
    return this.store.list('jev-connection').find((x) => x.productId === productId);
  }
  summary() {
    return {
      connections: this.store.list('jev-connection'),
      receipts: this.store.list('jev-receipt').slice(0, 100),
    };
  }
  async readDescriptor(filename) {
    if ((await stat(filename)).size > 16384) throw new Error('Jev 연결 파일이 너무 큽니다.');
    return descriptorSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  }
  async checkPaths(productId, descriptor) {
    descriptorSchema.parse(descriptor);
    const product = this.store.get('product', z.string().uuid().parse(productId));
    const root = await realpath(product.folder);
    if (!samePath(root, await realpath(descriptor.cwd)))
      throw new Error('Jev 프로젝트 폴더가 선택한 제품과 다릅니다.');
    if (!(await stat(descriptor.command)).isFile()) throw new Error('Jev 실행 파일을 확인하세요.');
    return root;
  }
  async verify(call, root, workspaceId) {
    const result = statusSchema.parse(await call('bridge_status', { contract: JEV_CONTRACT }));
    if (
      !samePath(root, await realpath(result.workspaceRoot)) ||
      (workspaceId && workspaceId !== result.workspaceId)
    )
      throw new Error('Jev 프로젝트가 연결 당시와 다릅니다. 다시 연결하세요.');
    if (!['publish', 'search'].every((x) => result.capabilities.includes(x)))
      throw new Error('Jev 연동 계약을 지원하지 않는 버전입니다.');
    return result;
  }
  async configure({ productId, descriptor, expectedRevision = 0 }) {
    descriptor = descriptorSchema.parse(descriptor);
    const root = await this.checkPaths(productId, descriptor);
    const status = await this.session(descriptor, (call) => this.verify(call, root));
    return this.store.transaction(() => {
      const old = this.connection(productId);
      if ((old?.revision || 0) !== expectedRevision)
        throw new Error('Jev 연결 설정이 변경되었습니다. 다시 확인하세요.');
      const value = {
        productId,
        descriptor,
        enabled: true,
        workspaceId: status.workspaceId,
        verifiedAt: new Date().toISOString(),
      };
      const saved = old
        ? this.store.update('jev-connection', old.id, old.revision, value)
        : this.store.create('jev-connection', value);
      this.store.log('Jev 연결 저장', productId);
      return saved;
    });
  }
  disable({ productId, expectedRevision }) {
    const old = this.connection(productId);
    if (!old || old.revision !== expectedRevision)
      throw new Error('Jev 연결 설정이 변경되었습니다. 다시 확인하세요.');
    const saved = this.store.update('jev-connection', old.id, old.revision, {
      ...old,
      enabled: false,
    });
    this.store.log('Jev 연결 해제', productId);
    return saved;
  }
  enabled(productId) {
    const connection = this.connection(productId);
    if (!connection?.enabled) throw new Error('이 제품의 Jev 연결을 먼저 설정하세요.');
    return connection;
  }
  assertCurrent(connection) {
    const current = this.enabled(connection.productId);
    if (current.revision !== connection.revision)
      throw new Error('Jev 연결 설정이 변경되었습니다. 다시 확인하세요.');
  }
  origin() {
    return this.store.transaction(
      () => this.store.list('jev-origin')[0]?.id || this.store.create('jev-origin', {}).id,
    );
  }
  prepare({ productId, reportId }) {
    const connection = this.enabled(productId);
    const task = this.store.get('task', z.string().uuid().parse(reportId));
    if (task.kind !== 'work' || task.productId !== productId)
      throw new Error('선택한 제품의 작업 결과만 보낼 수 있습니다.');
    const payload = {
      contract: JEV_CONTRACT,
      originId: this.origin(),
      productId,
      reportId: task.id,
      revision: task.revision,
      title: task.title,
      summary: task.summary,
      contribution: task.contribution,
      limitations: task.limitations,
    };
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value);
    const preview = { id: randomUUID(), connectionRevision: connection.revision, payload };
    this.previews.set(preview.id, preview);
    return preview;
  }
  async publish({ previewId }) {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('보낼 내용을 다시 검토하세요.');
    const { payload } = preview;
    const connection = this.enabled(payload.productId);
    const validate = () => {
      this.assertCurrent(connection);
      if (
        connection.revision !== preview.connectionRevision ||
        this.store.get('task', payload.reportId).revision !== payload.revision
      )
        throw new Error('검토 후 작업 또는 연결이 변경되었습니다. 보낼 내용을 다시 검토하세요.');
    };
    validate();
    const root = await this.checkPaths(payload.productId, connection.descriptor);
    const result = await this.session(connection.descriptor, async (call) => {
      await this.verify(call, root, connection.workspaceId);
      validate();
      return receiptSchema.parse(await call('bridge_publish', payload));
    });
    if (result.revision !== payload.revision)
      throw new Error('Jev가 다른 보고 버전을 반환했습니다.');
    this.store.transaction(() => {
      const old = this.store
        .list('jev-receipt')
        .find(
          (x) =>
            x.productId === payload.productId &&
            x.reportId === payload.reportId &&
            x.workspaceId === connection.workspaceId,
        );
      const value = {
        productId: payload.productId,
        reportId: payload.reportId,
        reportRevision: payload.revision,
        workspaceId: connection.workspaceId,
        memoryId: result.memoryId,
        status: result.status,
        sentAt: new Date().toISOString(),
      };
      // A late response must not roll back a newer acknowledged revision.
      if (!old) this.store.create('jev-receipt', value);
      else if (old.reportRevision <= payload.revision)
        this.store.update('jev-receipt', old.id, old.revision, value);
      this.store.log('Jev 결과 전송', payload.productId, payload.reportId);
    });
    this.previews.delete(previewId);
    return result;
  }
  async search({ productId, query }) {
    query = z.string().trim().min(1).max(500).parse(query);
    const connection = this.enabled(productId);
    const root = await this.checkPaths(productId, connection.descriptor);
    const result = await this.session(connection.descriptor, async (call) => {
      await this.verify(call, root, connection.workspaceId);
      this.assertCurrent(connection);
      return searchSchema.parse(
        await call('bridge_search', {
          contract: JEV_CONTRACT,
          originId: this.origin(),
          productId,
          query,
          limit: 8,
        }),
      );
    });
    this.assertCurrent(connection);
    return { ...result, productId, workspaceId: connection.workspaceId, query };
  }
}
