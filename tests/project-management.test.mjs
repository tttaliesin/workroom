import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { ControlService } from '../src/control/service.mjs';
import { commandResultSchemas } from '../src/control/contracts.mjs';
import { projectSummary, projectReport } from '../src/shared/project-status.mjs';

test('project planning uses shared versioned commands without an AI account', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-planning-'));
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  t.after(async () => {
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  const folder = path.join(directory, 'product');
  await mkdir(folder);
  const product = await room.createProduct({
    name: 'Example project',
    folder,
    goal: 'Ship useful work',
  });
  const control = new ControlService({
    room,
    commands: createCommands({ room, getEngine: () => null }),
    getEngine: () => null,
    dataDirectory: directory,
  });
  const args = {
    id: product.id,
    revision: product.revision,
    lead: 'Team',
    targetDate: '2026-10-01',
    phase: 'active',
    health: 'at_risk',
    summary: 'Review pending',
    risks: 'Need a decision',
    nextStep: 'Review results',
  };
  const updated = await control.fromApp('core.updateProjectStatus', args);
  assert.equal(updated.management.lead, 'Team');
  await assert.rejects(control.run('core.updateProjectStatus', args));
  const item = {
    productId: product.id,
    title: 'Review',
    assignee: 'PM',
    targetDate: '2026-10-01',
    status: 'planned',
    note: '',
    taskIds: [],
  };
  const milestone = await control.run('core.saveMilestone', item);
  assert(commandResultSchemas['core.saveMilestone'].safeParse(milestone).success);
  await assert.rejects(
    control.fromApp('core.saveMilestone', {
      ...item,
      id: milestone.id,
      revision: milestone.revision,
      status: 'done',
    }),
    /근거/,
  );
  const done = await control.fromApp('core.saveMilestone', {
    ...item,
    id: milestone.id,
    revision: milestone.revision,
    status: 'done',
    note: 'Reviewed the specification',
  });
  await assert.rejects(
    control.run('core.saveMilestone', { ...item, id: milestone.id, revision: milestone.revision }),
  );
  const foreign = room.store.create('task', {
    productId: crypto.randomUUID(),
    kind: 'work',
    title: 'Foreign',
  });
  await assert.rejects(
    control.run('core.saveMilestone', { ...item, taskIds: [foreign.id] }),
    /같은 제품/,
  );
  const report = await control.run('core.projectReport', {
    productId: product.id,
    language: 'en',
    days: 7,
  });
  assert(commandResultSchemas['core.projectReport'].safeParse(report).success);
  assert.match(report.markdown, /author-reported/);
  assert.equal(report.sourceVersions.find((x) => x.id === done.id).revision, done.revision);
  assert(!report.html.includes(folder));
  assert.equal(room.snapshot().milestones.length, 1);
});

test('dashboard deduplicates execution results and uses explicit local-calendar milestone scope', () => {
  const now = new Date(2026, 8, 29, 12);
  const product = {
    id: 'p',
    revision: 1,
    name: '<script>alert(1)</script>',
    goal: '[link](https://example.com)',
    management: { summary: '<img src=x onerror=alert(1)>' },
  };
  const task = (id, extra) => ({
    id,
    revision: 1,
    productId: 'p',
    created: now.toISOString(),
    status: 'reported',
    title: id,
    ...extra,
  });
  const milestone = (id, status, targetDate) => ({
    id,
    revision: 1,
    productId: 'p',
    created: now.toISOString(),
    title: id,
    status,
    targetDate,
  });
  const data = {
    tasks: [
      task('agent', { kind: 'agent', status: 'accepted', resultTaskId: 'result' }),
      task('result'),
      task('child', { parentTaskId: 'agent' }),
      task('waiting', { status: 'awaiting_review' }),
    ],
    milestones: [
      milestone('done', 'done', '2026-09-27'),
      milestone('due', 'planned', '2026-09-29'),
      milestone('late', 'blocked', '2026-09-28'),
      milestone('excluded', 'cancelled', '2026-09-01'),
    ],
  };
  const p = projectSummary(data, product, { now });
  assert.equal(p.tasks.length, 2);
  assert.equal(p.recentResults.length, 1);
  assert.equal(p.attention.length, 1);
  assert.equal(p.scope.length, 3);
  assert.equal(p.ratio, 33);
  assert.deepEqual(
    p.overdue.map((x) => x.id),
    ['late'],
  );
  assert.equal(projectSummary({ ...data, milestones: [] }, product, { now }).ratio, null);
  const report = projectReport(data, product, { now, language: 'en' });
  assert(!report.html.includes('<script>'));
  assert(!report.html.includes('<img src'));
  assert(!report.markdown.includes('<script>'));
  assert(report.markdown.includes('\\[link\\]'));
  assert(report.sections.some(([title]) => title === 'Risks and support needed'));
});
