import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CodexRPC } from './codex-rpc.mjs';

const exec = promisify(execFile);
export class CodexConnection {
  constructor({ directory, root, env = process.env }) {
    this.directory = directory;
    this.root = root;
    this.env = env;
    this.paths = {};
  }
  async version(file, kind) {
    const { stdout } = await exec(file, ['--version'], {
      windowsHide: true,
      timeout: 5000,
      env: this.env,
    });
    if (
      kind === 'node' ? !/^v(2[4-9]|[3-9]\d|\d{3,})\./.test(stdout.trim()) : !/codex/i.test(stdout)
    )
      throw new Error(
        kind === 'node' ? 'Node.js 24 이상을 선택하세요.' : 'Codex 실행 파일을 선택하세요.',
      );
    return stdout.trim();
  }
  async candidates(kind) {
    const files = [
      this.paths[kind],
      this.env[kind === 'node' ? 'WORKROOM_NODE' : 'WORKROOM_CODEX'],
    ];
    try {
      const { stdout } = await exec(process.platform === 'win32' ? 'where.exe' : 'which', [kind], {
        windowsHide: true,
        env: this.env,
      });
      files.push(
        ...stdout
          .trim()
          .split(/\r?\n/)
          .filter((f) => !/\.(cmd|ps1|bat)$/i.test(f)),
      );
    } catch {
      /* The file picker is available when PATH discovery fails. */
    }
    if (process.platform === 'win32' && kind === 'codex' && this.env.LOCALAPPDATA) {
      const base = path.join(this.env.LOCALAPPDATA, 'OpenAI/Codex/bin');
      const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
      files.push(
        ...dirs
          .filter((d) => d.isDirectory())
          .reverse()
          .map((d) => path.join(base, d.name, 'codex.exe')),
      );
    }
    if (kind === 'node')
      files.push(
        path.join(
          os.homedir(),
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin',
          process.platform === 'win32' ? 'node.exe' : 'node',
        ),
      );
    return [...new Set(files.filter(Boolean))];
  }
  async detect() {
    if (!this.loaded) {
      this.loaded = true;
      try {
        this.paths = JSON.parse(
          await readFile(path.join(this.directory, 'codex-runtime.json'), 'utf8'),
        );
        if (!this.paths || typeof this.paths !== 'object' || Array.isArray(this.paths))
          this.paths = {};
      } catch (e) {
        if (e.code !== 'ENOENT') this.paths = {};
      }
    }
    const found = {};
    for (const kind of ['node', 'codex']) {
      for (const file of await this.candidates(kind)) {
        try {
          found[kind] = { path: file, version: await this.version(file, kind) };
          this.paths[kind] = file;
          break;
        } catch {
          /* Try the next executable. */
        }
      }
      if (!found[kind]) delete this.paths[kind];
    }
    return found;
  }
  async select(kind, file) {
    if (!['node', 'codex'].includes(kind)) throw new Error('지원하지 않는 실행 파일입니다.');
    await this.version(file, kind);
    this.paths[kind] = file;
    this.plan = null;
    await writeFile(
      path.join(this.directory, 'codex-runtime.json'),
      JSON.stringify(this.paths),
      'utf8',
    );
    return this.detect();
  }
  async connect(cwd, onNotification) {
    const found = await this.detect();
    if (!found.codex)
      throw new Error('Codex를 찾지 못했습니다. Codex 실행 파일 선택 버튼을 사용하세요.');
    const rpc = new CodexRPC(found.codex.path, { cwd, env: this.env, onNotification });
    try {
      return await rpc.initialize();
    } catch (e) {
      rpc.close();
      throw e;
    }
  }
  server() {
    if (!this.paths.node) throw new Error('Node.js 실행 파일을 먼저 선택하세요.');
    return {
      command: this.paths.node,
      args: [path.join(this.root, 'src/mcp/server.mjs')],
      env: { WORKROOM_DATA_DIR: this.directory },
    };
  }
  async prepare(cwd) {
    const rpc = await this.connect(cwd);
    try {
      const read = await rpc.request('config/read', { includeLayers: true, cwd });
      const layer = read.layers?.find((l) => l.name.type === 'user' && !l.name.profile);
      if (!layer) throw new Error('Codex 사용자 설정 위치를 확인할 수 없습니다.');
      this.plan = {
        id: randomUUID(),
        cwd,
        filename: layer.name.file,
        version: layer.version,
        server: this.server(),
      };
      return { ...this.plan, previous: layer.config.mcp_servers?.workroom ?? null };
    } finally {
      rpc.close();
    }
  }
  async install(id) {
    const plan = this.plan;
    if (!plan || plan.id !== id) throw new Error('연결 설정을 다시 확인하세요.');
    const rpc = await this.connect(plan.cwd);
    try {
      const read = await rpc.request('config/read', { includeLayers: true, cwd: plan.cwd });
      const layer = read.layers?.find((l) => l.name.type === 'user' && !l.name.profile);
      if (layer?.version !== plan.version || layer.name.file !== plan.filename)
        throw new Error('다른 프로그램이 Codex 설정을 변경했습니다. 다시 확인하세요.');
      let backup = null;
      try {
        const stat = await lstat(plan.filename);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('Codex 설정이 일반 파일이 아닙니다.');
        backup = `${plan.filename}.workroom-${randomUUID()}.bak`;
        await writeFile(backup, await readFile(plan.filename), { flag: 'wx' });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const result = await rpc.request('config/value/write', {
        keyPath: 'mcp_servers.workroom',
        value: plan.server,
        mergeStrategy: 'replace',
        filePath: plan.filename,
        expectedVersion: plan.version,
      });
      this.plan = null;
      return { backup, status: result.status };
    } finally {
      rpc.close();
    }
  }
  async status(product) {
    const runtime = await this.detect();
    if (!runtime.codex) return { runtime };
    const rpc = await this.connect(product?.folder || this.root);
    try {
      const config = await rpc.request('config/read', {
        includeLayers: false,
        cwd: product?.folder || this.root,
      });
      const actual = config.config.mcp_servers?.workroom;
      const expected = runtime.node ? this.server() : null;
      const configured =
        !!expected &&
        actual?.command === expected.command &&
        JSON.stringify(actual.args) === JSON.stringify(expected.args) &&
        actual.env?.WORKROOM_DATA_DIR === this.directory &&
        actual.enabled !== false;
      let hooks = [],
        warnings = [];
      if (product) {
        const result = await rpc.request('hooks/list', { cwds: [product.folder] });
        const entry = result.data[0];
        hooks = (entry?.hooks || [])
          .filter(
            (h) =>
              h.statusMessage === `작업실 수집 · ${product.id}` &&
              path.resolve(h.sourcePath).toLowerCase() ===
                path.resolve(product.folder, '.codex/hooks.json').toLowerCase(),
          )
          .map((h) => ({ event: h.eventName, trust: h.trustStatus, enabled: h.enabled }));
        warnings = [
          ...(entry?.warnings || []),
          ...(entry?.errors || []).map((e) => e.message || String(e)),
        ];
      }
      return { runtime, configured, hooks, warnings, checkedAt: new Date().toISOString() };
    } finally {
      rpc.close();
    }
  }
  async probe(product) {
    const status = await this.status(product);
    if (!status.configured)
      throw new Error(
        '선택한 제품에 적용되는 MCP 설정이 작업실과 다릅니다. 설정을 등록하고 다시 검사하세요.',
      );
    const client = new Client({ name: 'workroom-connection-check', version: '0.1.0' });
    const server = this.server();
    const transport = new StdioClientTransport({
      ...server,
      env: { ...this.env, ...server.env },
      stderr: 'pipe',
    });
    let timer;
    try {
      const checked = (async () => {
        await client.connect(transport);
        const { tools } = await client.listTools();
        const products = await client.callTool({ name: 'workroom_list_products', arguments: {} });
        if (products.isError) throw new Error('MCP 제품 조회에 실패했습니다.');
        const list = JSON.parse(products.content[0].text);
        if (product && !list.some((p) => p.id === product.id))
          throw new Error('MCP가 다른 작업실 데이터를 보고 있습니다.');
        return { ...status, probe: { toolCount: tools.length, at: new Date().toISOString() } };
      })();
      return await Promise.race([
        checked,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('MCP 연결 검사 시간이 초과되었습니다.')),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      await client.close();
      await transport.close();
    }
  }
}
