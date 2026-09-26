import { z } from 'zod';
const text = n => z.string().trim().min(1).max(n);
const refs = z.array(z.string().uuid()).min(1).max(20);
export const investigationSchema = z.object({ summary: text(6000), findings: z.array(z.object({ title: text(180), detail: text(3000), evidenceIds: refs }).strict()).max(12), limitations: text(3000), nextStep: text(1500) }).strict();
export const reviewSchema = z.object({ verdict: z.enum(['supported','needs_work']), assessment: text(5000), evidenceIds: refs, limitations: text(2500) }).strict();
export const knowledgeSchema = z.object({ records: z.array(z.object({ title: text(180), content: text(3000), scope: text(1000), evidenceIds: refs }).strict()).max(5) }).strict();
export const developmentSchema=z.object({summary:text(6000),evidenceIds:refs,limitations:text(3000)}).strict();
export const checkSchema=z.object({status:z.enum(['passed','failed','unconfirmed','cancelled']),artifactHash:text(64),baselineHash:text(64),checks:z.array(z.object({name:text(1000),target:z.enum(['baseline','candidate']).optional(),result:z.enum(['passed','failed','unconfirmed','cancelled','timeout','output_limit']),output:z.string().max(20000),exitCode:z.number().nullable().optional()}).strict()).max(30)}).strict();
export const operationSchema=z.object({summary:text(3000),issues:z.array(z.object({key:z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),title:text(160),priority:z.enum(['high','normal','low']),reason:text(2000),goal:text(1800),action:z.enum(['investigate','prepare_change']),evidenceIds:refs}).strict()).max(3),limitations:text(2000)}).strict();
const citation=z.object({taskId:z.string().uuid(),revision:z.number().int().positive(),quote:text(1200)}).strict();
export const portfolioSchema=z.object({intro:text(2000),introCitations:z.array(citation).min(1).max(8),entries:z.array(z.object({taskId:z.string().uuid(),title:text(200),description:text(5000),contribution:text(3000),reason:text(1000),citations:z.array(citation).min(1).max(8)}).strict()).min(1).max(12),limitations:text(2000)}).strict();
export const portfolioReviewSchema=z.object({verdict:z.enum(['supported','needs_work']),assessment:text(4000),sourceTaskIds:z.array(z.string().uuid()).min(1).max(30),limitations:text(2000)}).strict();
export const resultSchemas = { investigate: investigationSchema, review: reviewSchema, knowledge: knowledgeSchema,develop:developmentSchema,check:checkSchema,change_review:reviewSchema,coordinate:operationSchema,curate:portfolioSchema,curate_review:portfolioReviewSchema };
export const roles = { investigate: '제품 조사', review: '근거 확인', knowledge: '재사용 기록 정리',develop:'수정안 작성',check:'수정본 검사',change_review:'변경 검토',coordinate:'운영 판단',curate:'대상별 초안 편집',curate_review:'초안 근거 검토' };
export function jsonSchema(schema) { const { $schema, ...rest } = z.toJSONSchema(schema); return rest; }
export function parseResult(role, value) { return resultSchemas[role].parse(value); }
export function evidenceRefs(role, value) { return ['check','curate','curate_review'].includes(role)?[]:role==='coordinate'?value.issues.flatMap(i=>i.evidenceIds):role === 'investigate' ? value.findings.flatMap(f => f.evidenceIds) : ['review','develop','change_review'].includes(role) ? value.evidenceIds : value.records.flatMap(r => r.evidenceIds); }
