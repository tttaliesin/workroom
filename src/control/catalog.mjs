import { z } from 'zod';
import { commandContracts, contractVersion } from './contracts.mjs';
import { createHash } from 'node:crypto';
export { secretCommands } from './contracts.mjs';
export const catalog = Object.fromEntries(
  Object.entries(commandContracts)
    .filter(([name]) => name !== 'runtime.tick')
    .map(([name, contract]) => [
      name,
      {
        contractVersion,
        input: z.toJSONSchema(contract.input),
        output: z.toJSONSchema(contract.output),
        error: z.toJSONSchema(contract.error),
        reviewRequired: contract.reviewRequired,
      },
    ]),
);
export const schemaHash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
export const entityKinds = [
  'milestone',
  'product',
  'task',
  'record',
  'portfolio',
  'portfolio-edit',
  'job-source',
  'operation-policy',
  'operation-issue',
  'verification-profile',
  'verification-observation',
  'agent-run',
  'agent-evidence',
  'agent-context',
  'change-set',
  'apply-journal',
  'publication',
  'publication-destination',
  'capture-connection',
  'execution-link',
  'review-package',
  'review-record',
  'execution-decision',
  'operation-resolution',
];
