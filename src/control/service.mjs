import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { catalog, entityKinds, schemaHash } from './catalog.mjs';
import {
  commandSchemas,
  reviewCommands,
  secretCommands,
  secretResultSchemas,
  commandContracts,
  contractVersion,
  ControlError,
  failure,
} from './contracts.mjs';
import { Reviews, fingerprint, publicEntity } from './reviews.mjs';
import { getLanguage, setLanguage } from '../shared/i18n.mjs';
import { portfolioHTML } from '../core/export.mjs';
import { redact } from '../runtime/errors.mjs';
import { sourceTree } from '../runtime/change-files.mjs';
import { loadedBuild } from '../core/build-info.mjs';
export { fingerprint } from './reviews.mjs';

const envelope = z
  .object({
    command: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
    requestId: z.string().uuid(),
    reviewHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    reviewId: z.string().uuid().optional(),
    decisionId: z.string().uuid().optional(),
    protocol: z.literal(2).optional(),
  })
  .strict();
const callerSchema = z
  .object({ channel: z.enum(['mcp', 'app', 'scheduler']), sessionId: z.string().min(1).max(200) })
  .strict();

export class ControlService {
  constructor({ room, commands, getEngine, languageFile, dataDirectory }) {
    Object.assign(this, { room, commands, getEngine, languageFile, dataDirectory });
    this.instanceId = randomUUID();
    this.startedAt = new Date().toISOString();
    this.persistenceFailures = new Map();
    this.pending = new Map();
    this.reviews = new Reviews(room);
    for (const op of room.store
      .list('control-operation')
      .filter((o) => ['accepted', 'running'].includes(o.status)))
      this.save(op, {
        status: op.status === 'accepted' ? 'cancelled' : 'uncertain',
        error: 'Executor stopped. Inspect recorded effects before issuing a new request.',
        errorCode: 'EXECUTOR_INTERRUPTED',
        failure: failure(
          new ControlError('EXECUTOR_INTERRUPTED', 'Executor stopped. Inspect recorded effects.'),
          {
            phase: 'execution',
            effectMayHaveOccurred: op.status === 'running',
            requestId: op.requestId,
          },
        ),
        effectMayHaveOccurred: op.status === 'running',
      });
  }
  caller(value) {
    return callerSchema.parse(value || { channel: 'mcp', sessionId: this.instanceId });
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
      protocol: 2,
      contractVersion,
      schemaHash,
      build: loadedBuild,
      startedAt: this.startedAt,
      pid: process.pid,
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
    const { command, args = {} } = z
      .object({ command: z.string(), args: z.record(z.string(), z.unknown()).optional() })
      .strict()
      .parse(input);
    if (!Object.hasOwn(commandSchemas, command))
      throw new ControlError(
        'UNKNOWN_COMMAND',
        'Unknown control command. Read the command catalog.',
      );
    const parsed = commandContracts[command].input.parse(args);
    if (!secretCommands.has(command) && redact(JSON.stringify(parsed)) !== JSON.stringify(parsed))
      throw new ControlError(
        'SECRET_IN_INPUT',
        'Remove credential values from ordinary command arguments.',
      );
    return { command, args: parsed };
  }
  review(input, caller) {
    const { command, args } = this.validate(input);
    if (secretCommands.has(command))
      return { command, args: { redacted: true }, reviewRequired: false };
    return {
      ...this.reviews.prepare(command, args, this.caller(caller)),
      reviewRequired: reviewCommands.has(command),
      approval:
        'This package fixes content. Submit review.submit and review.decide; a hash is not consent.',
    };
  }
  async invoke(command, args, context) {
    if (command === 'review.submit') return this.reviews.submit(args, context.caller);
    if (command === 'review.decide') return this.reviews.decide(args, context.caller);
    if (command === 'operation.reconcile') return this.reconcile(args.requestId, context.caller);
    if (command === 'operation.cancel') {
      const op = this.room.store.operation(args.requestId);
      if (!op || op.status !== 'accepted')
        throw new ControlError(
          'NOT_CANCELLABLE',
          'Only an accepted command can be cancelled; stop the underlying task separately.',
        );
      this.save(op, { status: 'cancelled' });
      return this.operation(args.requestId);
    }
    if (command === 'artifact.export') return this.export(args);
    if (command === 'artifact.recordExport') {
      const a = this.room.store.get('export-artifact', args.artifactId);
      return this.room.recordExport(a.portfolioId, a.snapshot, args.filename);
    }
    if (command === 'settings.language') {
      await writeFile(this.languageFile, JSON.stringify(args.language), 'utf8');
      setLanguage(args.language);
      this.room.store.log('앱 언어 변경', 'settings', args.language);
      return args;
    }
    const [domain, method] = command.split('.');
    return this.commands[domain](
      method,
      args,
      context.caller.channel === 'app' ? 'user' : context.caller.channel,
      context,
    );
  }
  execute(input, callerValue) {
    const {
      requestId,
      reviewHash,
      reviewId,
      decisionId,
      protocol: ignored,
      ...request
    } = envelope.parse(input);
    const caller = this.caller(callerValue),
      { command, args } = this.validate(request);
    if (command === 'runtime.tick' && caller.channel !== 'scheduler')
      throw new ControlError(
        'FORBIDDEN_COMMAND',
        'Scheduler commands cannot be invoked by clients.',
      );
    const hash = fingerprint({ command, args, reviewHash, reviewId, decisionId });
    const previous = this.room.store.operation(requestId);
    if (previous) {
      if (previous.fingerprint !== hash)
        throw new ControlError(
          'REQUEST_ID_CONFLICT',
          'Request ID was already used for different content.',
        );
      return this.operation(requestId);
    }
    const authorize = () => {
      const auth =
        reviewCommands.has(command) || reviewId || decisionId
          ? this.reviews.authorize(command, args, reviewId, decisionId)
          : {};
      if (
        reviewHash &&
        (auth.package?.packageHash || this.reviews.snapshot(command, args).packageHash) !==
          reviewHash
      )
        throw new ControlError('REVIEW_STALE', 'Reviewed content or state changed.');
      return auth;
    };
    authorize();
    const targets = Object.fromEntries(
      ['id', 'productId', 'portfolioId', 'revision', 'artifactHash']
        .filter((k) => args[k] !== undefined)
        .map((k) => [k, args[k]]),
    );
    const op = this.room.store.create('control-operation', {
      requestId,
      command,
      fingerprint: hash,
      status: 'accepted',
      instanceId: this.instanceId,
      contractVersion,
      schemaHash,
      caller,
      targets,
      reviewId,
      decisionId,
    });
    const promise = Promise.resolve().then(async () => {
      if (this.room.store.operation(requestId).status !== 'accepted') {
        this.pending.delete(requestId);
        return;
      }
      let invoked = false,
        phase = 'admission';
      try {
        const authorization = authorize();
        this.save(op, { status: 'running' });
        invoked = true;
        phase = 'execution';
        const result = await this.invoke(command, args, {
          ...authorization,
          assertCurrent: authorize,
          caller,
          requestId,
          onTarget: (patch) => this.save(op, { targets: { ...targets, ...patch } }),
        });
        phase = 'result';
        const safeResult = this.result(command, result ?? null);
        phase = 'persistence';
        this.save(op, { status: 'completed', result: safeResult });
      } catch (error) {
        const problem =
          phase === 'persistence'
            ? new ControlError(
                'RESULT_PERSISTENCE_FAILED',
                'Result could not be saved. Inspect the same request before further action.',
              )
            : secretCommands.has(command) && phase !== 'result'
              ? new ControlError(
                  'CREDENTIAL_FAILURE',
                  'Credential operation failed. Check protected storage or account status.',
                )
              : error;
        const info = failure(problem, { phase, effectMayHaveOccurred: invoked, requestId });
        const patch = {
          status: ['result', 'persistence'].includes(phase) ? 'uncertain' : 'failed',
          effectMayHaveOccurred: invoked,
          error: info.message,
          errorCode: info.code,
          failure: info,
        };
        try {
          this.save(op, patch);
        } catch {
          // The durable row remains running and becomes uncertain on restart.
          // Keep current callers informed even while the database cannot save diagnostics.
          this.persistenceFailures.set(requestId, patch);
        }
      } finally {
        this.pending.delete(requestId);
      }
    });
    this.pending.set(requestId, promise);
    return this.operation(requestId);
  }
  result(command, value) {
    try {
      if (secretResultSchemas[command]) {
        secretResultSchemas[command].parse(value);
        value = { saved: true };
      }
      return commandContracts[command].output.parse(JSON.parse(JSON.stringify(value)));
    } catch {
      throw new ControlError(
        'RESULT_CONTRACT_INVALID',
        `Result does not satisfy the ${command} contract. Inspect recorded effects; do not repeat the command.`,
      );
    }
  }
  async run(command, args, { caller, requestId = randomUUID(), reviewId, decisionId } = {}) {
    this.execute({ command, args, requestId, reviewId, decisionId }, caller);
    await this.pending.get(requestId);
    const op = this.operation(requestId);
    if (op.status !== 'completed') {
      const error = new ControlError(
        op.errorCode || 'OPERATION_UNRESOLVED',
        op.error || op.status,
        {
          requestId,
          status: op.status,
        },
      );
      error.controlFailure = op.failure;
      throw error;
    }
    return op.result;
  }
  async fromApp(command, args, requestId = randomUUID()) {
    const caller = { channel: 'app', sessionId: this.instanceId };
    const previous = this.room.store.operation(requestId);
    let reviewId = previous?.reviewId,
      decisionId = previous?.decisionId;
    if (reviewCommands.has(command) && !previous) {
      const p = this.review({ command, args }, caller);
      const changes = p.evidence.find((e) => e.kind === 'change-set')?.changes || [];
      const review = await this.run(
        'review.submit',
        {
          packageId: p.id,
          verdict: 'supported',
          assessment: '사용자가 앱에서 표시된 내용의 실행 액션을 선택했습니다.',
          limitations: '앱 액션 기록이며 독립적인 AI 검사 결과가 아닙니다.',
          files: changes.map((f) => ({ path: f.path, hash: f.afterHash })),
        },
        { caller },
      );
      const decision = await this.run(
        'review.decide',
        {
          reviewId: review.id,
          choice: 'execute',
          authority: { basis: 'user_instruction', reference: 'Workroom 앱의 명시적 실행 액션' },
        },
        { caller },
      );
      reviewId = review.id;
      decisionId = decision.id;
    }
    return this.run(command, args, { caller, requestId, reviewId, decisionId });
  }
  operation(requestId) {
    z.string().uuid().parse(requestId);
    const found = this.room.store.operation(requestId);
    if (!found) throw new ControlError('REQUEST_NOT_FOUND', 'Unknown request ID.');
    const { fingerprint: ignored, ...result } = found;
    return {
      ...result,
      ...this.persistenceFailures.get(requestId),
      contractVersion: found.contractVersion ?? 0,
    };
  }
  async reconcile(requestId, caller) {
    const op = this.operation(requestId);
    if (!['uncertain', 'failed'].includes(op.status)) return this.operation(requestId);
    let result, evidence;
    if (op.command === 'runtime.applyChange') {
      const t = this.room.store.get('task', op.targets.id);
      const journal = this.room.store
        .list('apply-journal')
        .find(
          (j) =>
            j.taskId === t.id &&
            j.artifactHash === op.targets.artifactHash &&
            j.state === 'applied',
        );
      const product = this.room.store.get('product', t.productId);
      if (
        journal &&
        t.appliedAt &&
        (await sourceTree(product.folder)).hash === op.targets.artifactHash
      ) {
        result = t;
        evidence = { kind: 'apply-journal', id: journal.id, revision: journal.revision };
      }
    } else if (op.command === 'publication.publish') {
      const p = await this.commands.publication('reconcile', { id: op.targets.id });
      if (p.deploymentId) {
        result = p;
        evidence = { kind: 'publication', id: p.id, revision: p.revision };
      }
    } else if (op.command === 'external.submit' && op.targets.taskId) {
      const t = this.room.store.get('task', op.targets.taskId);
      if (['awaiting_review', 'check_failed', 'accepted'].includes(t.status)) {
        result = t;
        evidence = { kind: 'task', id: t.id, revision: t.revision };
      }
    }
    let validationError;
    if (evidence) {
      try {
        result = this.result(op.command, result);
      } catch (error) {
        evidence = null;
        validationError = error.code;
      }
    }
    const resolution = this.room.store.create('operation-resolution', {
      requestId,
      operationId: op.id,
      caller,
      outcome: evidence ? 'confirmed' : 'unresolved',
      evidence: evidence || null,
      ...(validationError ? { validationError } : {}),
    });
    this.room.store.log('중단 요청 대조', op.id, resolution.outcome);
    if (evidence) {
      this.save(op, {
        status: 'completed',
        result,
        resolutionId: resolution.id,
        recovered: true,
        failure: null,
        error: null,
        errorCode: null,
      });
      this.persistenceFailures.delete(requestId);
    }
    return { operation: this.operation(requestId), resolution };
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
    const { id, revision, language } = commandSchemas['artifact.export'].parse(input);
    const snapshot = this.room.prepareExport(id, revision),
      html = portfolioHTML(snapshot, { language });
    const artifactHash = createHash('sha256').update(html).digest('hex');
    const artifact = this.room.store.create('export-artifact', {
      portfolioId: id,
      revision,
      language,
      snapshot,
      artifactHash,
    });
    return {
      id,
      artifactId: artifact.id,
      revision,
      language,
      html,
      artifactHash,
      savedToFile: false,
    };
  }
  handle({ action, input = {} }, caller) {
    if (action === 'status') return this.status();
    if (action === 'catalog')
      return { protocol: 2, contractVersion, schemaHash, commands: catalog, entityKinds };
    if (action === 'read') return this.read(input);
    if (action === 'prepare') return this.review(input, caller);
    if (action === 'execute') return this.execute(input, caller);
    if (action === 'operation') return this.operation(input.requestId);
    if (action === 'export') return this.run('artifact.export', input, { caller });
    if (action === 'legacy') {
      const { command, args, requestId } = input;
      if (
        ![
          'core.context',
          'core.inspect',
          'core.requestDecision',
          'core.reportWork',
          'core.addRecord',
        ].includes(command)
      )
        throw new ControlError('FORBIDDEN_COMMAND', 'Unknown legacy command.');
      return this.run(command, args, { caller, requestId });
    }
    throw new ControlError('UNKNOWN_ACTION', 'Unknown control action.');
  }
}
