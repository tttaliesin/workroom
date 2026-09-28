import { z } from 'zod';
import { commandSchemas, reviewCommands, commandResultSchema, errorSchema } from './contracts.mjs';
export { secretCommands } from './contracts.mjs';
export const catalog = Object.fromEntries(
  Object.entries(commandSchemas)
    .filter(([name]) => name !== 'runtime.tick')
    .map(([name, input]) => [
      name,
      {
        input: z.toJSONSchema(input),
        output: z.toJSONSchema(commandResultSchema),
        error: z.toJSONSchema(errorSchema),
        reviewRequired: reviewCommands.has(name),
      },
    ]),
);
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
  'verification-observation',
  'agent-run',
  'agent-evidence',
  'agent-context',
  'change-set',
  'apply-journal',
  'publication',
  'publication-destination',
  'capture-connection',
  'review-package',
  'review-record',
  'execution-decision',
  'operation-resolution',
];
