import { z } from 'zod';

// Required public fields are validated; additive domain fields remain intact.
const object = (shape) => z.object(shape).catchall(z.json());
const id = z.string().uuid(),
  revision = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entity = (shape) =>
  object({ id, revision, created: z.iso.datetime(), updated: z.iso.datetime(), ...shape });
const product = entity({ name: z.string(), folder: z.string(), goal: z.string() });
const record = entity({
  productId: id,
  title: z.string(),
  content: z.string(),
  scope: z.string(),
  source: z.string(),
  active: z.boolean(),
});
const task = entity({
  kind: z.enum(['agent', 'inspection', 'decision', 'work']),
  status: z.enum([
    'queued',
    'running',
    'stopping',
    'stopped',
    'interrupted',
    'waiting_auth',
    'waiting_decision',
    'accepted',
    'needs_review',
    'discarded',
    'check_failed',
    'changes_requested',
    'awaiting_review',
    'awaiting_apply',
    'applying',
    'apply_partial',
    'failed',
    'partial',
    'completed',
    'needs_decision',
    'decided',
    'deferred',
    'reported',
  ]),
  title: z.string(),
  productId: id.optional(),
  portfolioId: id.optional(),
});
const agentTask = task.extend({
  kind: z.literal('agent'),
  mode: z.enum(['investigation', 'change', 'operation', 'portfolio']),
  stage: z.enum([
    'investigate',
    'review',
    'knowledge',
    'develop',
    'check',
    'change_review',
    'coordinate',
    'curate',
    'curate_review',
    'done',
  ]),
  goal: z.string(),
  outputs: z.record(z.string(), z.json()),
});
const checkedChange = agentTask.extend({
  productId: id,
  productRevision: revision,
  mode: z.literal('change'),
  changeSetId: id,
  outputs: object({
    check: object({
      runId: id,
      result: object({
        artifactHash: hash,
        baselineHash: hash,
        status: z.enum(['passed', 'failed', 'unconfirmed', 'cancelled']),
        checks: z.array(
          object({
            name: z.string(),
            target: z.enum(['baseline', 'candidate']),
            result: z.enum([
              'passed',
              'failed',
              'unconfirmed',
              'cancelled',
              'timeout',
              'output_limit',
            ]),
            output: z.string(),
          }),
        ),
      }),
    }),
  }),
});
const portfolio = entity({
  target: z.string(),
  intro: z.string(),
  entries: z.array(
    object({ taskId: id, title: z.string(), description: z.string(), contribution: z.string() }),
  ),
  exports: z.array(z.json()),
});
const destination = entity({
  portfolioId: id,
  version: revision,
  provider: z.literal('vercel'),
  project: z.string(),
  teamId: z.string(),
});
const publication = entity({
  portfolioId: id,
  portfolioRevision: revision,
  artifactHash: hash,
  destination,
  status: z.enum([
    'prepared',
    'submitting',
    'uncertain',
    'building',
    'failed',
    'unverified',
    'published',
  ]),
  sourceVersions: z.array(object({ id, revision })),
  snapshot: object({ target: z.string(), intro: z.string(), entries: z.array(z.json()) }),
});
const runtime = object({
  state: z.enum([
    'starting',
    'ready',
    'connected',
    'disconnected',
    'offline',
    'error',
    'storage_error',
    'logging_in',
    'checking',
    'needs_login',
    'limited',
    'access_denied',
    'network_error',
  ]),
  connected: z.boolean(),
  models: z.array(object({ id: z.string(), name: z.string() })),
});
const engineInfo = runtime.extend({
  paused: z.boolean(),
  background: z.boolean(),
  modelId: z.string().nullable(),
  active: z.number().int().nonnegative(),
  maxConcurrent: revision,
});
const executable = object({ path: z.string(), version: z.string() });
const executables = object({ node: executable.optional(), codex: executable.optional() });
const connection = object({
  runtime: executables,
  configured: z.boolean().optional(),
  hooks: z.array(z.json()).optional(),
  warnings: z.array(z.string()).optional(),
  checkedAt: z.iso.datetime().optional(),
});
const caller = object({ channel: z.enum(['app', 'mcp', 'scheduler']), sessionId: z.string() });
const review = entity({
  packageId: id,
  packageHash: hash,
  command: z.string(),
  caller,
  verdict: z.enum(['supported', 'changes_requested', 'inconclusive']),
  assessment: z.string().min(1),
  limitations: z.string().min(1),
  files: z.array(object({ path: z.string(), hash })),
});
const decision = entity({
  reviewId: id,
  packageId: id,
  packageHash: hash,
  caller,
  choice: z.enum(['execute', 'revise', 'reject']),
  authorityVerified: z.literal(false),
  authority: object({
    basis: z.enum(['user_instruction', 'delegated']),
    reference: z.string().min(1),
  }),
});
export const operationResultSchema = entity({
  requestId: id,
  command: z.string(),
  status: z.enum(['accepted', 'running', 'completed', 'failed', 'cancelled', 'uncertain']),
});
const resolution = entity({
  requestId: id,
  operationId: id,
  caller,
  outcome: z.enum(['confirmed', 'unresolved']),
  evidence: object({ kind: z.string(), id, revision }).nullable(),
});
const observation = entity({
  productId: id,
  productRevision: revision,
  policyVersion: z.number().int().nonnegative(),
  fingerprint: hash,
  status: z.enum(['unchanged', 'observed', 'evaluating', 'completed']),
  at: z.iso.datetime(),
});
const saved = z.object({ saved: z.boolean() }).strict();
const hooksPlan = object({
  filename: z.string(),
  revision: hash,
  existing: z.boolean(),
  config: object({ hooks: z.record(z.string(), z.array(z.json())) }),
  node: z.string(),
  script: z.string(),
  productId: id,
  projectFolder: z.string(),
});

export const commandResultSchemas = {
  'core.updateProjectStatus': product.extend({
    management: object({
      lead: z.string(),
      targetDate: z.union([z.iso.date(), z.literal('')]),
      phase: z.enum(['planned', 'active', 'paused', 'completed']),
      health: z.enum(['not_set', 'on_track', 'at_risk', 'off_track']),
      summary: z.string(),
      risks: z.string(),
      nextStep: z.string(),
      updatedAt: z.iso.datetime(),
    }),
  }),
  'core.saveMilestone': entity({
    productId: id,
    title: z.string(),
    assignee: z.string(),
    targetDate: z.union([z.iso.date(), z.literal('')]),
    status: z.enum(['planned', 'in_progress', 'blocked', 'done', 'cancelled']),
    note: z.string(),
    taskIds: z.array(id),
  }),
  'core.projectReport': object({
    projectId: id,
    projectRevision: revision,
    generatedAt: z.iso.datetime(),
    days: z.union([z.literal(0), z.literal(7), z.literal(30)]),
    language: z.enum(['ko', 'en']),
    markdown: z.string(),
    html: z.string(),
    sections: z.array(z.tuple([z.string(), z.array(z.string())])),
    note: z.string(),
    sourceVersions: z.array(object({ id, revision })),
  }),
  'capture.event': z.union([
    object({
      status: z.enum([
        'disabled',
        'outside-product',
        'interrupted',
        'ignored',
        'limit',
        'observed',
      ]),
    }),
    object({ status: z.enum(['duplicate', 'collected']), taskId: id }),
  ]),
  'core.createProduct': product,
  'core.updateProduct': product,
  'core.setCodexCapture': product,
  'core.inspect': task.extend({
    kind: z.literal('inspection'),
    productId: id,
    result: object({ observations: z.array(z.json()), unconfirmed: z.array(z.string()) }),
  }),
  'core.addRecord': record,
  'core.toggleRecord': record,
  'core.reviewRecord': record,
  'core.requestDecision': task.extend({
    kind: z.literal('decision'),
    productId: id,
    options: z.array(object({ label: z.string(), effect: z.string() })),
  }),
  'core.resolveDecision': task.extend({
    kind: z.literal('decision'),
    productId: id,
    status: z.literal('decided'),
  }),
  'core.deferDecision': task.extend({
    kind: z.literal('decision'),
    productId: id,
    status: z.literal('deferred'),
  }),
  'core.reportWork': task.extend({
    kind: z.literal('work'),
    productId: id,
    summary: z.string(),
    evidence: z.string(),
    limitations: z.string(),
    contribution: z.string(),
  }),
  'core.createPortfolio': portfolio,
  'core.savePortfolio': portfolio,
  'core.reviewPortfolioSource': portfolio,
  'core.context': object({
    product,
    records: z.array(record),
    retrieval: object({ mode: z.enum(['lexical', 'hybrid']), reranked: z.boolean() }),
    note: z.string(),
  }),
  'core.changeWorkLink': object({
    task,
    change: entity({
      taskId: id,
      productId: id,
      fromTaskId: id.nullable(),
      toTaskId: id.nullable(),
      reason: z.string(),
    }),
  }),
  'core.saveJobSource': entity({
    portfolioId: id,
    version: revision,
    hash,
    url: z.url(),
    description: z.string(),
    provenance: z.literal('user-pasted'),
  }),
  'runtime.configure': engineInfo,
  'runtime.restart': engineInfo,
  'runtime.start': agentTask,
  'runtime.resume': agentTask,
  'runtime.stop': z.null(),
  'runtime.applyChange': checkedChange.extend({ appliedAt: z.iso.datetime() }),
  'runtime.configureOperations': entity({
    productId: id,
    version: revision,
    enabled: z.boolean(),
    allowChanges: z.boolean(),
    intervalMinutes: revision,
    maxDailyStarts: revision,
    maxRepairs: z.number().int().nonnegative(),
    testFiles: z.array(z.string()),
  }),
  'runtime.configureVerification': entity({
    productId: id,
    version: revision,
    enabled: z.boolean(),
    scripts: z.array(z.string()),
    timeoutSeconds: revision,
  }),
  'runtime.checkOperations': z.union([task, observation, z.null()]),
  'runtime.issueAction': task.nullable(),
  'runtime.editPortfolio': agentTask.nullable(),
  'runtime.configurePortfolioEditor': portfolio,
  'runtime.applyPortfolioEdit': entity({
    portfolioId: id,
    portfolioRevision: revision,
    status: z.literal('applied'),
    appliedPortfolioRevision: revision,
    appliedAt: z.iso.datetime(),
  }),
  'runtime.login': runtime,
  'runtime.cancelLogin': runtime,
  'runtime.logout': z.union([engineInfo, runtime]),
  'runtime.verify': runtime,
  'runtime.manualCode': saved,
  'runtime.tick': z.null(),
  'external.submit': checkedChange.extend({
    executor: z.literal('external'),
    reviewMode: z.literal('external'),
  }),
  'publication.configure': destination,
  'publication.prepare': publication,
  'publication.publish': publication,
  'publication.reconcile': publication,
  'publication.credentials': saved,
  'publication.disconnect': saved,
  'settings.language': z.object({ language: z.enum(['ko', 'en']) }).strict(),
  'connection.select': executables,
  'connection.status': connection,
  'connection.probe': connection.extend({
    probe: object({ toolCount: z.number().int().nonnegative(), at: z.iso.datetime() }),
  }),
  'connection.prepare': object({
    id,
    cwd: z.string(),
    filename: z.string(),
    version: z.string(),
    server: object({
      command: z.string(),
      args: z.array(z.string()),
      env: object({ WORKROOM_DATA_DIR: z.string() }),
    }),
    previous: z.json().nullable(),
  }),
  'connection.install': object({ backup: z.string().nullable(), status: z.string() }),
  'connection.prepareHooks': hooksPlan,
  'connection.installHooks': object({
    filename: z.string(),
    backup: z.string().nullable(),
    state: z.literal('awaiting-trust'),
  }),
  'review.submit': review,
  'review.decide': decision,
  'operation.cancel': operationResultSchema,
  'operation.reconcile': z.union([
    operationResultSchema,
    object({ operation: operationResultSchema, resolution }),
  ]),
  'artifact.export': object({
    id,
    artifactId: id,
    revision,
    language: z.enum(['ko', 'en']),
    html: z.string(),
    artifactHash: hash,
    savedToFile: z.literal(false),
  }),
  'artifact.recordExport': portfolio,
};
