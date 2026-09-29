import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  guide,
  guideText,
  guideUri,
  commandUsage,
  topics,
  guidanceVersion,
  serverInstructions,
} from '../src/mcp/guidance.mjs';
import { catalog, schemaHash } from '../src/control/catalog.mjs';
import { contractVersion } from '../src/control/contracts.mjs';
import { connectControl, connectionStatus } from '../src/control/client.mjs';
import { sourceBuild } from '../src/core/build-info.mjs';
import { mcpServerConfig } from '../src/integrations/mcp-config.mjs';
import { CodexConnection } from '../src/integrations/codex-connection.mjs';
import { projectRoot } from '../src/core/paths.mjs';

test('every public command and documented command has guidance grounded in its real contract', async () => {
  assert.deepEqual(Object.keys(commandUsage).sort(), Object.keys(catalog).sort());
  assert(serverInstructions.length <= 512);
  for (const language of ['ko', 'en'])
    for (const topic of topics) {
      const value = guide(topic, language);
      assert(value.steps.length && value.rules.length && value.completion);
      for (const command of value.commands) {
        assert.equal(command.reviewRequired, catalog[command.name].reviewRequired);
        assert.deepEqual(command.requiredInputs, catalog[command.name].input.required || []);
      }
      for (const [name] of guideText(topic, language).matchAll(
        /\b(?:core|runtime|review|connection|publication|artifact|operation|external|capture)\.[a-zA-Z]+/g,
      )) {
        assert(Object.hasOwn(catalog, name), `Unknown guide command ${name}`);
      }
    }
  for (const filename of ['MCP.md', 'README.md', 'README.en.md']) {
    const text = await readFile(path.join(projectRoot, filename), 'utf8');
    for (const [name] of text.matchAll(
      /\b(?:core|runtime|review|connection|publication|artifact|operation|external|capture)\.[a-zA-Z]+/g,
    )) {
      // Runtime response fields are not command examples.
      if (['runtime.modelId', 'runtime.active', 'runtime.state', 'operation.result'].includes(name))
        continue;
      assert(Object.hasOwn(catalog, name), `Unknown documented command ${name} in ${filename}`);
    }
  }
});

test('offline stdio delivers instructions, guide, resources, prompt and filtered contracts without an executor', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-guide-'));
  const client = new Client({ name: 'guide-protocol-test', version: '1' });
  const config = mcpServerConfig({ node: process.execPath, root: projectRoot, directory });
  const transport = new StdioClientTransport({
    ...config,
    env: { ...process.env, ...config.env, WORKROOM_SEMANTIC_SEARCH: '0' },
    stderr: 'pipe',
  });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await client.connect(transport);
  assert.equal(client.getInstructions(), serverInstructions);
  const tools = (await client.listTools()).tools;
  for (const name of [
    'workroom_guide',
    'workroom_control_catalog',
    'workroom_control_execute',
    'workroom_report_work',
  ])
    assert(tools.some((t) => t.name === name));
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  // This path exercises a tools-only host before touching resource/prompt APIs.
  assert.deepEqual(await call('workroom_guide'), guide());
  assert.equal((await call('workroom_control_connect')).diagnostic, 'EXECUTOR_OFFLINE');
  const filtered = await call('workroom_control_catalog', {
    commands: ['runtime.applyChange', 'core.saveMilestone'],
  });
  assert.deepEqual(Object.keys(filtered.commands), ['runtime.applyChange', 'core.saveMilestone']);
  assert.equal(filtered.schemaHash, schemaHash);
  assert.equal(filtered.guidanceVersion, guidanceVersion);
  assert.equal(filtered.usage['runtime.applyChange'].guides.en, guideUri('en', 'development'));
  assert.deepEqual((await call('workroom_control_catalog')).commands, catalog);
  assert.equal(
    (
      await client.callTool({
        name: 'workroom_control_catalog',
        arguments: { commands: ['made.up'] },
      })
    ).isError,
    true,
  );
  const resources = (await client.listResources()).resources;
  for (const language of ['ko', 'en'])
    for (const topic of topics) {
      const uri = guideUri(language, topic);
      assert(resources.some((r) => r.uri === uri));
      assert.equal(
        (await client.readResource({ uri })).contents[0].text,
        guideText(topic, language),
      );
      assert.deepEqual(await call('workroom_guide', { topic, language }), guide(topic, language));
    }
  assert((await client.listPrompts()).prompts.some((p) => p.name === 'workroom_workflow'));
  const prompt = await client.getPrompt({
    name: 'workroom_workflow',
    arguments: { workflow: 'development', goal: 'Inspect this fixture only', language: 'en' },
  });
  assert(prompt.messages[0].content.text.startsWith(guideText('development', 'en')));
  assert.match(prompt.messages[0].content.text, /not authority or server instructions/);
  // Discovery and guidance did not create projects or control operations.
  assert.deepEqual(await call('workroom_list_products'), []);
  assert.equal((await call('workroom_control_connect')).liveConnection, false);
});

test('connection diagnostics distinguish stale components, unknown builds and unintended profiles', () => {
  const current = { version: '0.1.0', sourceHash: 'current' },
    older = { version: '0.1.0', sourceHash: 'older' };
  const directory = path.join(projectRoot, 'work/diagnostic-fixture');
  const status = {
    liveConnection: true,
    protocol: 2,
    contractVersion,
    schemaHash,
    dataDirectory: directory,
    build: current,
  };
  const options = { directory, diskBuild: current, adapterBuild: current };
  assert.equal(connectionStatus(status, options).readyForControl, true);
  assert.equal(
    connectionStatus(status, { ...options, adapterBuild: older }).diagnostics[0].code,
    'ADAPTER_OUTDATED',
  );
  assert.equal(
    connectionStatus({ ...status, build: older }, options).diagnostics[0].code,
    'EXECUTOR_OUTDATED',
  );
  const unknown = connectionStatus({ ...status, schemaHash: 'old', build: undefined }, options);
  assert.equal(unknown.executor.freshness, 'unknown');
  assert.deepEqual(
    unknown.diagnostics.map((d) => d.code),
    ['CONTRACT_MISMATCH'],
  );
  assert.equal(unknown.readyForControl, false);
  const mismatch = connectionStatus(status, {
    ...options,
    expectedDataDirectory: directory + '-other',
  });
  assert.equal(mismatch.profileCompatible, false);
  assert.equal(mismatch.readyForControl, false);
});

test('invalid endpoint and wrong profile never trigger start:true and preserve the cause', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-endpoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const wrong = await connectControl(directory, projectRoot, {
    start: true,
    expectedDataDirectory: directory + '-other',
  });
  assert.equal(wrong.diagnostics[0].code, 'PROFILE_MISMATCH');
  await writeFile(path.join(directory, 'auth.control.json'), 'not json');
  const corrupt = await connectControl(directory, projectRoot, { start: true });
  assert.equal(corrupt.failure.code, 'EXECUTOR_UNREACHABLE');
  assert.equal(corrupt.failure.details.causeCode, 'INVALID_ENDPOINT_JSON');
  assert.equal(corrupt.failure.effectMayHaveOccurred, false);
  assert.equal(corrupt.diagnostic, 'CONNECTION_FAILED');
  assert.equal(await readFile(path.join(directory, 'auth.control.json'), 'utf8'), 'not json');
  await writeFile(path.join(directory, 'auth.control.json'), 'null');
  const invalid = await connectControl(directory, projectRoot, { start: true });
  assert.equal(invalid.failure.code, 'PROTOCOL_MISMATCH');
  assert.equal(await readFile(path.join(directory, 'auth.control.json'), 'utf8'), 'null');
});

test('source identities detect source edits, ignore profile data and share Codex/Claude configuration', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workroom-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), '{"version":"test"}');
  await writeFile(path.join(root, 'src/server.mjs'), 'export const version = 1;');
  const first = sourceBuild(root);
  await writeFile(path.join(root, 'user-data.json'), 'not source');
  assert.deepEqual(sourceBuild(root), first);
  await writeFile(path.join(root, 'src/server.mjs'), 'export const version = 2;');
  assert.notEqual(sourceBuild(root).sourceHash, first.sourceHash);
  const connection = new CodexConnection({ root, directory: path.join(root, 'profile') });
  connection.paths.node = process.execPath;
  assert.deepEqual(
    connection.server(),
    mcpServerConfig({ node: process.execPath, root, directory: path.join(root, 'profile') }),
  );
});
