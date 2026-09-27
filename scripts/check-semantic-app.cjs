const { createFixture } = require('./checks/lib/fixture.cjs');
// Opt-in check using the real cached model, Electron and a separate MCP process.
const { _electron } = require('./checks/lib/playwright.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const { Workroom } = await import('../src/core/service.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const directory = createFixture(path.join(root, 'work/semantic-app-'));
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '로컬 의미 검색 검증', folder: directory });
  const record = room.addRecord({
    productId: product.id,
    title: '배포 복구',
    content: '배포에 문제가 생기면 직전 정상 버전으로 되돌린다.',
    scope: '실패한 배포',
    source: '합성 검증 자료',
  });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_SEMANTIC_SEARCH: '1',
    WORKROOM_MODELS_OFFLINE: '1',
    WORKROOM_MODEL_CACHE: path.join(root, 'work/semantic-models'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  const client = new Client({ name: 'semantic-integration-check', version: '1.0.0' });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    let status;
    for (let i = 0; i < 150; i++) {
      const result = await page.evaluate(() => window.workroom.call('snapshot'));
      status = result.value.knowledgeIndex;
      if (status.enabled && !status.pending && !status.retrying) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(status.pending + status.retrying, 0, JSON.stringify(status));
    const desktop = await page.evaluate(
      async (productId) =>
        window.workroom.call('context', {
          productId,
          query: 'How to restore the previous release?',
        }),
      product.id,
    );
    assert.equal(desktop.ok, true);
    assert.equal(desktop.value.retrieval.mode, 'hybrid');
    assert.equal(desktop.value.records[0].id, record.id);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, 'src/mcp/server.mjs')],
        env,
        stderr: 'pipe',
      }),
    );
    const query = () =>
      client.callTool({
        name: 'workroom_product_context',
        arguments: { productId: product.id, query: 'How to restore the previous release?' },
      });
    const mcp = JSON.parse((await query()).content[0].text);
    assert.equal(mcp.retrieval.mode, 'hybrid');
    assert.deepEqual(
      mcp.records.map((r) => r.id),
      desktop.value.records.map((r) => r.id),
    );
    await page.evaluate(
      async (record) =>
        window.workroom.call('toggleRecord', {
          id: record.id,
          revision: record.revision,
          active: false,
        }),
      record,
    );
    assert.deepEqual(JSON.parse((await query()).content[0].text).records, []);
    assert.deepEqual(errors, []);
    const result = {
      directory,
      checks: [
        'real Electron CPU embedding',
        'offline cached model',
        'separate MCP semantic parity',
        'cross-process immediate exclusion',
      ],
      errors,
    };
    await fs.writeFile(path.join(root, 'work/semantic-app-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
