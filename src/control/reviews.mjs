import { createHash } from 'node:crypto';
import { ControlError } from './contracts.mjs';
export const fingerprint = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((key) => [key, v[key]]),
            )
          : v,
      ),
    )
    .digest('hex');
export const publicEntity = ({ owner, html, manifest, ...value }) => value;

// Dependencies are declared per command; no field-name or recursion-depth heuristics.
export function dependencies(room, command, args) {
  const store = room.store,
    rows = new Map();
  const add = (kind, id) => {
    if (!id) return;
    const row = store.get(kind, id);
    rows.set(`${kind}:${id}`, { kind, ...publicEntity(row) });
    return row;
  };
  const related = (kind, field, id) =>
    store
      .list(kind)
      .filter((r) => r[field] === id)
      .forEach((r) => add(kind, r.id));
  const product = (id) => add('product', id);
  const task = (id) => {
    const t = add('task', id);
    if (t) {
      product(t.productId);
      if (t.changeSetId) add('change-set', t.changeSetId);
    }
    return t;
  };
  const portfolio = (id) => {
    const p = add('portfolio', id);
    if (p) {
      add('job-source', p.jobSourceId);
      for (const e of p.entries || []) task(e.taskId);
      for (const pid of p.autoProductIds || []) product(pid);
    }
    return p;
  };
  if (args.productId) product(args.productId);
  if (args.sourceTaskId) task(args.sourceTaskId);
  if (args.targetTaskId) task(args.targetTaskId);
  if (args.workTaskId) task(args.workTaskId);
  if (args.portfolioId) portfolio(args.portfolioId);
  if (command === 'core.updateProduct') product(args.id);
  if (command === 'core.updateProjectStatus') product(args.id);
  if (command === 'core.saveMilestone') {
    if (args.id) add('milestone', args.id);
    for (const id of args.taskIds || []) task(id);
  }
  if (['core.toggleRecord', 'core.reviewRecord'].includes(command)) {
    const r = add('record', args.id);
    product(r.productId);
  }
  if (
    [
      'core.resolveDecision',
      'core.deferDecision',
      'core.changeWorkLink',
      'runtime.resume',
      'runtime.stop',
      'runtime.applyChange',
    ].includes(command)
  )
    task(args.id);
  if (command === 'core.changeWorkLink') task(args.parentTaskId);
  if (
    [
      'core.savePortfolio',
      'core.reviewPortfolioSource',
      'runtime.configurePortfolioEditor',
      'artifact.export',
    ].includes(command)
  )
    portfolio(args.id);
  if (command === 'core.savePortfolio') {
    for (const e of args.entries) task(e.taskId);
    for (const pid of args.autoProductIds || []) product(pid);
  }
  if (command === 'core.createPortfolio') for (const pid of args.autoProductIds || []) product(pid);
  if (command === 'core.reviewPortfolioSource') task(args.taskId);
  if (command === 'runtime.applyPortfolioEdit') {
    const e = add('portfolio-edit', args.id);
    portfolio(e.portfolioId);
  }
  if (command === 'runtime.issueAction') {
    const i = add('operation-issue', args.id);
    product(i.productId);
    related('operation-policy', 'productId', i.productId);
  }
  if (command === 'runtime.configure')
    store.list('runtime-settings').forEach((r) => add('runtime-settings', r.id));
  if (
    [
      'runtime.configureOperations',
      'runtime.checkOperations',
      'runtime.start',
      'runtime.configureVerification',
      'external.submit',
    ].includes(command)
  ) {
    related('operation-policy', 'productId', args.productId);
    related('verification-profile', 'productId', args.productId);
  }
  if (command === 'runtime.applyChange') {
    const t = store.get('task', args.id);
    related('verification-profile', 'productId', t.productId);
    related('operation-policy', 'productId', t.productId);
  }
  if (['publication.configure', 'publication.prepare'].includes(command)) {
    related('publication-destination', 'portfolioId', args.portfolioId);
    add('publication', args.restoreId);
  }
  if (['publication.publish', 'publication.reconcile'].includes(command)) {
    const p = add('publication', args.id);
    portfolio(p.portfolioId);
    related('publication-destination', 'portfolioId', p.portfolioId);
    for (const s of p.sourceVersions || []) task(s.id);
    add('job-source', p.jobSourceId);
  }
  return [...rows.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

export class Reviews {
  constructor(room) {
    this.room = room;
    this.store = room.store;
  }
  snapshot(command, args) {
    const evidence = dependencies(this.room, command, args);
    const guards = evidence.map(({ kind, id, revision }) => ({ kind, id, revision }));
    return { command, args, guards, evidence, packageHash: fingerprint({ command, args, guards }) };
  }
  prepare(command, args, caller) {
    const data = this.snapshot(command, args);
    const saved = this.store.create('review-package', { ...data, caller });
    this.store.log('검토 자료 고정', saved.id);
    return { ...saved, packageId: saved.id, reviewHash: saved.packageHash };
  }
  fresh(p) {
    if (this.snapshot(p.command, p.args).packageHash !== p.packageHash)
      throw new ControlError(
        'REVIEW_STALE',
        'Reviewed content or state changed. Prepare and review again.',
      );
  }
  submit(args, caller) {
    const p = this.store.get('review-package', args.packageId);
    this.fresh(p);
    if (p.command === 'runtime.applyChange' && args.verdict === 'supported') {
      const t = this.store.get('task', p.args.id),
        c = this.store.get('change-set', t.changeSetId);
      if (
        !c.changes.length ||
        c.changes.some((f) => !args.files.some((e) => e.path === f.path && e.hash === f.afterHash))
      )
        throw new ControlError(
          'REVIEW_INCOMPLETE',
          'Review every changed file and provide its exact resulting hash.',
        );
    }
    const record = this.store.create('review-record', {
      ...args,
      packageHash: p.packageHash,
      command: p.command,
      caller,
    });
    this.store.log('검토 의견 기록', record.id);
    return record;
  }
  decide(args, caller) {
    const review = this.store.get('review-record', args.reviewId),
      p = this.store.get('review-package', review.packageId);
    this.fresh(p);
    if (args.choice === 'execute' && review.verdict !== 'supported')
      throw new ControlError(
        'REVIEW_NOT_SUPPORTED',
        'A changes-requested or inconclusive review cannot authorize execution.',
      );
    const decision = this.store.create('execution-decision', {
      ...args,
      packageId: p.id,
      packageHash: p.packageHash,
      caller,
      authorityVerified: false,
    });
    this.store.log('실행 결정 기록', decision.id);
    return decision;
  }
  authorize(command, args, reviewId, decisionId) {
    if (!reviewId || !decisionId)
      throw new ControlError(
        'DECISION_REQUIRED',
        'Prepare a review package, submit the review and record an execution decision first.',
      );
    const review = this.store.get('review-record', reviewId),
      decision = this.store.get('execution-decision', decisionId),
      p = this.store.get('review-package', review.packageId);
    if (
      decision.reviewId !== review.id ||
      decision.choice !== 'execute' ||
      review.verdict !== 'supported' ||
      decision.packageHash !== p.packageHash ||
      p.command !== command ||
      fingerprint(p.args) !== fingerprint(args)
    )
      throw new ControlError(
        'DECISION_MISMATCH',
        'Decision does not authorize this command and exact content.',
      );
    const latestReview = this.store
      .list('review-record')
      .find((r) => r.packageHash === p.packageHash);
    if (latestReview?.id !== review.id)
      throw new ControlError('REVIEW_SUPERSEDED', 'A newer review replaced this review.');
    const latest = this.store
      .list('execution-decision')
      .find((d) => d.packageHash === p.packageHash);
    if (latest?.id !== decision.id)
      throw new ControlError(
        'DECISION_SUPERSEDED',
        'A newer decision replaced this execution decision.',
      );
    this.fresh(p);
    return { review, decision, package: p };
  }
}
