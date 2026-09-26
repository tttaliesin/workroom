// Renders every reachable screen of src/renderer to HTML so a refactor can prove it changed
// nothing. Uses the example databases that `pnpm check:app` leaves under work/.
//
//   node scripts/render-snapshot.mjs save before.json            # newest DB of each check
//   node scripts/render-snapshot.mjs save after.json --same-as before.json
//   node scripts/render-snapshot.mjs compare before.json after.json
//
// compare exits 1 on any difference and also reports how many states differ only by
// line-break indentation (whitespace between block elements).
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  copyFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);

function newestDatabases() {
  const work = path.join(root, 'work');
  const newest = new Map();
  for (const name of existsSync(work) ? readdirSync(work) : []) {
    const db = path.join(work, name, 'workroom.sqlite');
    const kind = name.replace(/-[A-Za-z0-9]{6}$/, '');
    if (kind === name || !existsSync(db)) continue;
    const time = statSync(db).mtimeMs;
    if (!newest.has(kind) || newest.get(kind).time < time) newest.set(kind, { db, time });
  }
  return [...newest.values()].map((x) => path.relative(root, x.db));
}

async function save(outFile, databases) {
  const memory = () => {
    const m = new Map();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  };
  globalThis.window = globalThis;
  globalThis.document = { getElementById: () => ({}) };
  globalThis.localStorage = memory();
  globalThis.sessionStorage = memory();
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const state = await load('src/renderer/state.js');
  const { shellHTML } = await load('src/renderer/shell.js');
  const { Workroom } = await load('src/core/service.mjs');
  const { ui, setData, loadDraft } = state;
  const initial = structuredClone(ui);
  const states = {};
  const runtimes = {
    offline: {
      state: 'disconnected',
      connected: false,
      models: [{ id: 'fixture', name: 'Fixture' }],
    },
    ready: {
      state: 'ready',
      connected: true,
      modelId: 'fixture',
      paused: false,
      models: [{ id: 'fixture', name: 'Fixture' }],
    },
  };
  const render = (key, patch, before) => {
    for (const k of Object.keys(ui)) delete ui[k];
    Object.assign(
      ui,
      structuredClone(initial),
      { requests: {}, history: [], locations: {}, lastTasks: {}, lastQueries: {} },
      patch,
    );
    before?.();
    try {
      states[key] = shellHTML();
    } catch (error) {
      states[key] = 'THROWS ' + error.message;
    }
  };
  for (const database of databases) {
    // Work on a copy so opening the database never changes the check's data.
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'render-snapshot-'));
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(path.join(root, database) + suffix))
        copyFileSync(path.join(root, database) + suffix, path.join(tmp, 'w.sqlite' + suffix));
    const room = new Workroom(path.join(tmp, 'w.sqlite'));
    const tag = path.basename(path.dirname(database));
    for (const [runtimeName, runtime] of Object.entries(runtimes)) {
      const s = room.store;
      setData({
        ...room.snapshot(),
        runtime,
        agentRuns: s.list('agent-run'),
        agentEvidence: s.list('agent-evidence'),
        agentContexts: s.list('agent-context'),
        agentChanges: s.list('change-set'),
        applyJournals: s.list('apply-journal'),
      });
      const data = state.data;
      const key = (...parts) => [tag, runtimeName, ...parts].join('|');
      render(key('empty-product'), { view: 'home', productId: null });
      for (const view of ['account', 'connection', 'new-product', 'new-target'])
        render(key(view), { view, productId: data.products[0]?.id });
      for (const p of data.products) {
        const base = { productId: p.id };
        for (const view of [
          'home',
          'records',
          'scope',
          'product',
          'new-record',
          'new-work',
          'new-decision',
          'ops',
        ])
          render(key(p.id, view), { ...base, view });
        render(key(p.id, 'product-busy'), {
          ...base,
          view: 'product',
          busy: true,
          message: '오류 메시지',
          error: true,
        });
        render(key(p.id, 'records-query'), { ...base, view: 'records', query: '수정' });
        render(key(p.id, 'ops-list-open'), {
          ...base,
          view: 'ops',
          listOpen: true,
          taskQuery: '수',
        });
        const sourceTaskId = data.tasks.find((t) => t.kind === 'agent')?.id;
        for (const mode of ['investigation', 'change'])
          render(key(p.id, 'request', mode), {
            ...base,
            view: 'home',
            requestOpen: true,
            requests: {
              [p.id]: {
                mode,
                goal: '목표',
                testFiles: 'a.test.mjs',
                allowTests: true,
                sourceTaskId,
              },
            },
          });
        for (const t of data.tasks.filter((t) => t.productId === p.id)) {
          render(key(p.id, 'task', t.id), { ...base, view: 'ops', taskId: t.id });
          if (t.kind !== 'work') continue;
          render(key(p.id, 'evidence', t.id), {
            ...base,
            view: 'ops',
            taskId: t.id,
            source: 'evidence',
            evidenceReturn: 'ops',
          });
          render(key(p.id, 'file', t.id), {
            ...base,
            view: 'ops',
            taskId: t.id,
            source: '0',
            evidenceReturn: 'route',
            history: [{ view: 'portfolio' }],
          });
          render(key(p.id, 'link', t.id), {
            ...base,
            view: 'work-link',
            linkTaskId: t.id,
            linkParent: t.parentTaskId || '',
          });
        }
        for (const r of data.records.filter((r) => r.productId === p.id))
          for (const recordEditing of [false, true])
            render(key(p.id, 'record', r.id, recordEditing), {
              ...base,
              view: 'record-detail',
              recordId: r.id,
              recordEditing,
            });
      }
      const fromTaskId = data.tasks.find((t) => t.kind === 'work')?.id;
      for (const f of data.portfolios)
        for (const [mode, extra] of Object.entries({
          view: {},
          editing: { editing: true },
          review: { review: true },
          from: { fromTaskId },
        }))
          render(
            key('portfolio', f.id, mode),
            { view: 'portfolio', productId: data.products[0]?.id, ...extra },
            () => loadDraft(f.id),
          );
    }
    room.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(outFile, JSON.stringify({ databases, states }));
  const values = Object.values(states);
  console.log(
    `${databases.length} databases, ${values.length} screen states, ${values.filter((v) => v.startsWith('THROWS')).length} threw`,
  );
}

function compare(beforeFile, afterFile) {
  const [a, b] = [beforeFile, afterFile].map((f) => JSON.parse(readFileSync(f, 'utf8')));
  if (JSON.stringify(a.databases) !== JSON.stringify(b.databases))
    throw new Error('The snapshots used different databases; save the second one with --same-as.');
  const flatten = (s) => s.replace(/\n */g, '');
  let strict = 0,
    layout = 0;
  for (const [key, html] of Object.entries(a.states)) {
    const other = b.states[key];
    if (other === html) continue;
    strict++;
    if (other !== undefined && flatten(other) === flatten(html)) continue;
    layout++;
    if (layout <= 3) {
      const x = flatten(html),
        y = flatten(other ?? '');
      let i = 0;
      while (x[i] === y[i]) i++;
      console.log(
        `DIFF ${key}\n  before: ${x.slice(Math.max(0, i - 60), i + 80)}\n  after:  ${y.slice(Math.max(0, i - 60), i + 80)}`,
      );
    }
  }
  const total = Object.keys(a.states).length;
  console.log(
    `${total} states: ${total - strict} identical, ${strict - layout} differ only in line-break indentation, ${layout} differ in content`,
  );
  if (strict) process.exitCode = 1;
}

if (command === 'save' && args[0]) {
  const sameAs = args.indexOf('--same-as');
  const databases =
    sameAs > 0 ? JSON.parse(readFileSync(args[sameAs + 1], 'utf8')).databases : newestDatabases();
  if (!databases.length)
    throw new Error('No check databases under work/. Run `pnpm check:app` first.');
  await save(args[0], databases);
} else if (command === 'compare' && args.length === 2) compare(args[0], args[1]);
else {
  console.error(
    'Usage: render-snapshot.mjs save <out.json> [--same-as <snapshot.json>] | compare <before.json> <after.json>',
  );
  process.exitCode = 2;
}
