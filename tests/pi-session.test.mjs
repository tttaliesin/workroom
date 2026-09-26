import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BrokerCredentials } from '../src/runtime/vault.mjs';
import { createRoleSession } from '../src/runtime/pi-session.mjs';
import { jsonSchema, resultSchemas } from '../src/runtime/contracts.mjs';

test('real Pi SDK executes explicit tools with a deterministic model stream and ignores surrounding instructions', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-pi-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'AGENTS.md'), 'AUTODISCOVERY_MUST_NOT_LOAD');
  const runtime = await ModelRuntime.create({
    credentials: new BrokerCredentials(null, async () => {}),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const model = runtime.getModels('openai-codex')[0];
  runtime.hasConfiguredAuth = () => true;
  runtime.checkAuth = async () => ({ type: 'oauth', source: 'unit test' });
  runtime.getAuth = async () => ({ auth: { apiKey: 'unit-test-only' } });
  let requests = 0,
    result;
  const expected = {
    summary: 'fixture summary',
    findings: [],
    limitations: 'fixture only',
    nextStep: 'fixture next',
  };
  runtime.streamSimple = (_model, context) => {
    assert.equal(JSON.stringify(context).includes('AUTODISCOVERY_MUST_NOT_LOAD'), false);
    assert.equal(JSON.stringify(context).includes('submit_result'), true);
    const stream = new AssistantMessageEventStream();
    const message = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content:
        requests++ === 0
          ? [{ type: 'toolCall', id: 'submit-1', name: 'submit_result', arguments: expected }]
          : [{ type: 'text', text: 'Complete.' }],
      stopReason: requests === 1 ? 'toolUse' : 'stop',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: message.stopReason, message });
    return stream;
  };
  const { session } = await createRoleSession({
    directory,
    modelRuntime: runtime,
    model,
    systemPrompt: 'Explicit product investigator.',
    tools: [
      {
        name: 'submit_result',
        label: 'submit',
        description: 'submit',
        parameters: jsonSchema(resultSchemas.investigate),
        execute: async (_id, args) => {
          result = args;
          return { content: [{ type: 'text', text: 'stored' }], details: {} };
        },
      },
    ],
  });
  try {
    assert.deepEqual(session.getActiveToolNames(), ['submit_result']);
    await session.prompt('Run fixture.');
    await session.waitForIdle();
    assert.deepEqual(result, expected, JSON.stringify(session.messages));
    assert.equal(requests, 2);
  } finally {
    session.dispose();
  }
});
