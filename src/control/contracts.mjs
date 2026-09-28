import { z } from 'zod';
import { schemas } from '../core/service.mjs';
import { eventSchema } from '../integrations/codex-capture.mjs';
import { linkSchema, recordReviewSchema, sourceReviewSchema } from '../core/work-links.mjs';

export const id = z.string().uuid();
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
const text = (max = 4000) => z.string().trim().min(1).max(max);
const object = (shape = {}) => z.object(shape).strict();
const product = { productId: id };
const target = { id };
const versioned = { id, revision };
export const commandSchemas = {
  'capture.event': object({ ...product, event: eventSchema }),
  ...Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [`core.${name}`, schema])),
  'core.setCodexCapture': object({ ...product, enabled: z.boolean() }),
  'core.changeWorkLink': linkSchema,
  'core.reviewRecord': recordReviewSchema,
  'core.reviewPortfolioSource': sourceReviewSchema,
  'core.saveJobSource': object({
    portfolioId: id,
    revision,
    url: z.string().url().max(2000),
    description: text(12000),
  }),
  'runtime.configure': object({
    paused: z.boolean().optional(),
    modelId: z.string().max(100).optional(),
    background: z.boolean().optional(),
  }),
  'runtime.start': object({
    ...product,
    goal: text(2000),
    mode: z.enum(['investigation', 'change']).optional(),
    testFiles: z.array(z.string().max(1024)).max(8).optional(),
    allowTests: z.boolean().optional(),
    sourceTaskId: id.optional(),
    reviewMode: z.enum(['builtin', 'external']).optional(),
  }),
  'runtime.resume': object(versioned),
  'runtime.stop': object(target),
  'runtime.applyChange': object({
    ...versioned,
    artifactHash: hash,
    acceptUnconfirmed: z.boolean().optional(),
  }),
  'runtime.configureOperations': object({
    ...product,
    version: z.number().int().min(0),
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(15).max(10080),
    maxDailyStarts: z.number().int().min(1).max(12),
    allowChanges: z.boolean(),
    testFiles: z.array(z.string().max(1024)).max(8),
    allowTests: z.boolean().optional(),
    maxRepairs: z.number().int().min(0).max(1),
  }),
  'runtime.configureVerification': object({
    ...product,
    version: z.number().int().min(0),
    enabled: z.boolean(),
    scripts: z
      .array(z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/))
      .min(1)
      .max(3),
    allowExecution: z.boolean(),
    timeoutSeconds: z.number().int().min(10).max(120),
  }),
  'runtime.checkOperations': object(product),
  'runtime.issueAction': object({ ...target, action: z.enum(['investigate', 'defer']) }),
  'runtime.editPortfolio': object({ portfolioId: id }),
  'runtime.configurePortfolioEditor': object({ ...versioned, enabled: z.boolean() }),
  'runtime.applyPortfolioEdit': object(target),
  'runtime.login': object({ mode: z.enum(['browser', 'device_code']) }),
  'runtime.manualCode': object({ value: text(8000) }),
  'runtime.cancelLogin': object(),
  'runtime.logout': object(),
  'runtime.verify': object(),
  'runtime.restart': object(),
  'runtime.tick': object(),
  'external.submit': object({
    ...product,
    productRevision: revision,
    goal: text(2000),
    source: text(200),
    limitations: text(4000),
    sourceTaskId: id.optional(),
    testFiles: z.array(z.string().max(1024)).max(8).default([]),
    allowTests: z.boolean().default(false),
    files: z
      .array(
        object({ path: text(1024), beforeHash: hash.nullable(), content: z.string().max(48000) }),
      )
      .min(1)
      .max(16),
  }),
  'publication.configure': object({
    portfolioId: id,
    version: z.number().int().min(0),
    project: z.string().regex(/^[a-z0-9][a-z0-9-]{1,99}$/),
    teamId: z.string().regex(/^(team_[a-zA-Z0-9]+)?$/),
  }),
  'publication.prepare': object({ portfolioId: id, revision, restoreId: id.optional() }),
  'publication.publish': object({ ...target, artifactHash: hash }),
  'publication.reconcile': object(target),
  'publication.credentials': object({ token: z.string().min(10).max(1000) }),
  'publication.disconnect': object(),
  'settings.language': object({ language: z.enum(['ko', 'en']) }),
  'connection.status': object({ productId: id.optional() }),
  'connection.prepare': object({ productId: id.optional() }),
  'connection.install': object({ planId: id, productId: id.optional() }),
  'connection.probe': object({ productId: id.optional() }),
  'connection.select': object({ kind: z.enum(['node', 'codex']), path: text(2048) }),
  'connection.prepareHooks': object(product),
  'connection.installHooks': object({ ...product, revision: hash }),
  'review.submit': object({
    packageId: id,
    verdict: z.enum(['supported', 'changes_requested', 'inconclusive']),
    assessment: text(8000),
    limitations: text(4000),
    files: z
      .array(object({ path: text(1024), hash }))
      .max(16)
      .default([]),
  }),
  'review.decide': object({
    reviewId: id,
    choice: z.enum(['execute', 'revise', 'reject']),
    authority: object({ basis: z.enum(['user_instruction', 'delegated']), reference: text(2000) }),
  }),
  'operation.reconcile': object({ requestId: id }),
  'operation.cancel': object({ requestId: id }),
  'artifact.export': object({ ...versioned, language: z.enum(['ko', 'en']).default('ko') }),
  'artifact.recordExport': object({ artifactId: id, filename: text(2048) }),
};
export const reviewCommands = new Set([
  'core.createProduct',
  'runtime.applyChange',
  'publication.publish',
  'runtime.configureOperations',
  'runtime.configureVerification',
  'connection.install',
  'connection.installHooks',
  'connection.select',
  'external.submit',
]);
export const secretCommands = new Set(['publication.credentials', 'runtime.manualCode']);
export const commandResultSchema = z.json().nullable();
export const errorSchema = object({
  code: z.string(),
  message: z.string(),
  details: z.json().optional(),
});
export class ControlError extends Error {
  constructor(code, message, details) {
    super(message);
    Object.assign(this, { code, details });
  }
}
export function failure(error) {
  return {
    code: error instanceof z.ZodError ? 'INVALID_INPUT' : error.code || 'DOMAIN_REJECTED',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}
