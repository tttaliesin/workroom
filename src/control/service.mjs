import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { catalog, entityKinds, secretCommands } from './catalog.mjs';
import { getLanguage, setLanguage } from '../shared/i18n.mjs';
import { portfolioHTML } from '../core/export.mjs';
import { redact } from '../runtime/errors.mjs';

const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );
export const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const commandSchema = z
  .object({ command: z.string(), args: z.record(z.string(), z.unknown()).default({}) })
  .strict();
const publicEntity = ({ owner, html, manifest, ...value }) => value;

export class ControlService {
  constructor({ room, commands, getEngine, languageFile, dataDirectory }) {
    Object.assign(this, { room, commands, getEngine, languageFile, dataDirectory });
    this.instanceId = randomUUID();
    this.pending = new Map();
    for (const op of room.store.list('control-operation').filter((o) => o.status === 'running'))
      this.save(op, {
        status: 'uncertain',
        error:
          'Executor stopped before a durable result. Inspect task, apply journal or publication before creating a new request.',
      });
  }
  save(op, patch) {
    const current = this.room.store.get('control-operation', op.id);
    return this.room.store.update('control-operation', op.id, current.revision, {
      ...current,
      ...patch,
    });
  }
  status() {
    return {
      protocol: 1,
      liveConnection: true,
      instanceId: this.instanceId,
      dataDirectory: this.dataDirectory,
      runtime: this.getEngine()?.info() || { state: 'starting' },
      settingsRevision: this.getEngine()?.settings.revision || null,
      language: getLanguage(),
      pendingOperations: [...this.pending.keys()],
    };
  }
  validate(input) {
    const parsed = commandSchema.parse(input);
    if (!Object.hasOwn(catalog, parsed.command))
      throw new Error('Unknown control command. Read the command catalog.');
    return parsed;
  }
  review(input) {
    const { command, args } = this.validate(input);
    const references = new Set(
      Object.entries(args)
        .filter(([key, value]) => /(?:^id$|Id$)/.test(key) && typeof value === 'string')
        .map(([, value]) => value),
    );
    const rows = [];
    // Follow source identities so reviewed changes bind their target, tests and destination too.
    for (let pass = 0; pass < 3; pass++) {
      for (const kind of entityKinds) {
        for (const item of this.room.store.list(kind)) {
          if (!references.has(item.id) || rows.some((r) => r.id === item.id)) continue;
          rows.push({ kind, ...publicEntity(item) });
          for (const [key, value] of Object.entries(item))
            if (/(?:Id)$/.test(key) && typeof value === 'string') references.add(value);
          for (const source of item.sourceVersions || []) references.add(source.id);
        }
      }
    }
    const guards = rows
      .map(({ id, revision }) => ({ id, revision }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const runtimeRevision = this.getEngine()?.settings.revision || 0;
    const hash = fingerprint({ command, args, guards, runtimeRevision });
    return {
      command,
      args: secretCommands.has(command) ? { redacted: true } : args,
      reviewHash: hash,
      guards,
      reviewRequired: catalog[command].reviewRequired,
      effects:
        command === 'publication.publish'
          ? 'Publishes the frozen HTML to the reviewed production project.'
          : command === 'runtime.applyChange'
            ? 'Writes reviewed changes to the original product files.'
            : command === 'core.createProduct'
              ? 'Registers the specified folder for Workroom access.'
              : command.startsWith('runtime.configure')
                ? 'Changes execution scope, schedule or code execution settings.'
                : 'Runs the requested Workroom command.',
      evidence: rows,
      approval:
        'The caller applies user instructions or delegated review authority. This hash binds content; it is not proof of user consent.',
    };
  }
  async invoke(command, args) {
    if (command === 'settings.language') {
      const { language } = z
        .object({ language: z.enum(['ko', 'en']) })
        .strict()
        .parse(args);
      await writeFile(this.languageFile, JSON.stringify(language), 'utf8');
      setLanguage(language);
      this.room.store.log('앱 언어 변경', 'settings', language);
      return { language };
    }
    const [domain, method] = command.split('.');
    return this.commands[domain](method, args, 'mcp');
  }
  execute(input) {
    const { requestId, reviewHash, ...request } = z
      .object({
        command: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
        requestId: z.string().uuid(),
        reviewHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    const { command, args } = this.validate(request);
    const hash = fingerprint({ command, args, reviewHash });
    const previous = this.room.store
      .list('control-operation')
      .find((op) => op.requestId === requestId);
    if (previous) {
      if (previous.fingerprint !== hash)
        throw new Error('Request ID was already used for different content.');
      return this.operation(requestId);
    }
    if (catalog[command].reviewRequired && !reviewHash)
      throw new Error('Prepare and review this command first, then supply reviewHash.');
    if (reviewHash && this.review(request).reviewHash !== reviewHash)
      throw new Error('Reviewed content or state changed. Prepare and review again.');
    const op = this.room.store.create('control-operation', {
      requestId,
      command,
      fingerprint: hash,
      status: 'running',
      instanceId: this.instanceId,
    });
    // No command arguments are persisted: in particular no OAuth codes or provider tokens.
    const promise = Promise.resolve().then(async () => {
      let invoked = false;
      try {
        // A prior queued command may have changed the review after admission.
        if (reviewHash && this.review(request).reviewHash !== reviewHash)
          throw new Error('Reviewed state changed before execution. Prepare again.');
        invoked = true;
        const result = await this.invoke(command, args);
        this.save(op, {
          status: 'completed',
          result: secretCommands.has(command) ? { saved: true } : (result ?? null),
        });
      } catch (error) {
        this.save(op, {
          status: 'failed',
          effectMayHaveOccurred: invoked,
          error: secretCommands.has(command)
            ? 'Credential operation failed. Check protected storage or account status.'
            : redact(error.message),
        });
      } finally {
        this.pending.delete(requestId);
      }
    });
    this.pending.set(requestId, promise);
    return this.operation(requestId);
  }
  operation(requestId) {
    z.string().uuid().parse(requestId);
    const found = this.room.store
      .list('control-operation')
      .find((op) => op.requestId === requestId);
    if (!found) throw new Error('Unknown request ID.');
    const { fingerprint: ignored, ...result } = found;
    return result;
  }
  read(input) {
    const { kind, id, productId, offset, limit } = z
      .object({
        kind: z.enum(entityKinds),
        id: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(input);
    if (id) {
      const item = this.room.store.get(kind, id);
      return kind === 'portfolio'
        ? { ...publicEntity(item), execution: this.getEngine()?.editor.readiness(item) }
        : publicEntity(item);
    }
    const all = this.room.store.list(kind).filter((r) => !productId || r.productId === productId);
    return {
      items: all.slice(offset, offset + limit).map(publicEntity),
      total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
    };
  }
  export(input) {
    const { id, revision, language } = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int(),
        language: z.enum(['ko', 'en']).default('ko'),
      })
      .strict()
      .parse(input);
    const snapshot = this.room.prepareExport(id, revision);
    const html = portfolioHTML(snapshot, { language });
    return {
      id,
      revision,
      language,
      html,
      artifactHash: createHash('sha256').update(html).digest('hex'),
      savedToFile: false,
    };
  }
  handle({ action, input = {} }) {
    if (action === 'status') return this.status();
    if (action === 'catalog') return { protocol: 1, commands: catalog, entityKinds };
    if (action === 'read') return this.read(input);
    if (action === 'prepare') return this.review(input);
    if (action === 'execute') return this.execute(input);
    if (action === 'operation') return this.operation(input.requestId);
    if (action === 'export') return this.export(input);
    throw new Error('Unknown control action.');
  }
}
