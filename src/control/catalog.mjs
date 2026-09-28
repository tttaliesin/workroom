import { z } from 'zod';
import { schemas } from '../core/service.mjs';
import { coreMethods } from './commands.mjs';

const fields = {
  'runtime.configure': 'paused?: boolean, modelId?: string, background?: boolean',
  'runtime.start':
    'productId: UUID, goal: string, mode?: investigation|change, testFiles?: string[], allowTests?: boolean, sourceTaskId?: UUID',
  'runtime.resume': 'id: task UUID, revision: integer',
  'runtime.stop': 'id: task UUID',
  'runtime.applyChange':
    'id: task UUID, revision: integer, artifactHash: SHA256, acceptUnconfirmed?: boolean',
  'runtime.configureOperations':
    'productId: UUID, version: integer, enabled: boolean, intervalMinutes: 15..10080, maxDailyStarts: 1..12, allowChanges: boolean, testFiles: string[], allowTests?: boolean, maxRepairs: 0|1',
  'runtime.configureVerification':
    'productId: UUID, version: integer, enabled: boolean, scripts: string[], timeoutSeconds: 10..120, allowExecution: boolean',
  'runtime.checkOperations': 'productId: UUID',
  'runtime.issueAction': 'id: issue UUID, action: investigate|defer',
  'runtime.editPortfolio': 'portfolioId: UUID',
  'runtime.configurePortfolioEditor': 'id: portfolio UUID, revision: integer, enabled: boolean',
  'runtime.applyPortfolioEdit': 'id: portfolio-edit UUID',
  'runtime.login': 'mode: browser|device_code',
  'runtime.manualCode': 'value: string (never retained in command history)',
  'runtime.cancelLogin': '{}',
  'runtime.logout': '{}',
  'runtime.verify': '{}',
  'runtime.restart': '{}',
  'publication.configure':
    'portfolioId: UUID, version: integer, project: string, teamId: string (empty for personal account)',
  'publication.prepare': 'portfolioId: UUID, revision: integer, restoreId?: publication UUID',
  'publication.publish': 'id: publication UUID, artifactHash: SHA256',
  'publication.reconcile': 'id: publication UUID',
  'publication.credentials': 'token: string (never retained in command history)',
  'publication.disconnect': '{}',
  'core.setCodexCapture': 'productId: UUID, enabled: boolean',
  'core.changeWorkLink':
    'id: work UUID, revision: integer, parentTaskId: UUID|null, parentRevision?: integer, reason: string',
  'core.reviewRecord':
    'id: record UUID, revision: integer, content: string, scope: string, validity: valid|needs_review, reason: string',
  'core.reviewPortfolioSource':
    'id: portfolio UUID, revision: integer, taskId: UUID, mode: keep|regenerate',
  'core.saveJobSource': 'portfolioId: UUID, revision: integer, url: HTTPS URL, description: string',
  'settings.language': 'language: ko|en',
  'connection.status': 'productId?: UUID',
  'connection.prepare': 'productId?: UUID',
  'connection.install': 'planId: UUID returned by connection.prepare',
  'connection.probe': 'productId?: UUID',
  'connection.select': 'kind: node|codex, path: absolute executable path',
  'connection.prepareHooks': 'productId: UUID',
  'connection.installHooks':
    'productId: UUID, revision: SHA256 returned by connection.prepareHooks',
};
const review = new Set([
  'connection.install',
  'connection.installHooks',
  'connection.select',
  'core.createProduct',
  'runtime.applyChange',
  'publication.publish',
  'runtime.configureOperations',
  'runtime.configureVerification',
]);
export const catalog = Object.fromEntries([
  ...[...coreMethods]
    .filter((m) => !['snapshot', 'changes'].includes(m))
    .map((m) => [
      `core.${m}`,
      {
        input: schemas[m] ? z.toJSONSchema(schemas[m]) : fields[`core.${m}`],
        reviewRequired: review.has(`core.${m}`),
      },
    ]),
  ...Object.entries(fields)
    .filter(([name]) => !name.startsWith('core.'))
    .map(([name, input]) => [name, { input, reviewRequired: review.has(name) }]),
]);
export const secretCommands = new Set(['publication.credentials', 'runtime.manualCode']);
export const entityKinds = [
  'product',
  'task',
  'record',
  'portfolio',
  'portfolio-edit',
  'job-source',
  'operation-policy',
  'operation-issue',
  'verification-profile',
  'agent-run',
  'agent-evidence',
  'agent-context',
  'change-set',
  'apply-journal',
  'publication',
  'publication-destination',
  'capture-connection',
];
