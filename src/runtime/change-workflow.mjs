import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { sourceTree, copyTree, treeHash, replaceCandidate, applyOne } from './change-files.mjs';
import { readProductFile, relativeFile, allowed } from './files.mjs';
import { verifyChange } from './change-checks.mjs';
import { evidenceRefs } from './contracts.mjs';
import { redact } from './errors.mjs';

export class ChangeWorkflow {
  constructor(engine, { node = 'node' } = {}) {
    this.engine = engine;
    this.store = engine.store;
    this.node = node;
    this.locks = new Map();
    this.applying = new Set();
  }
  get(task) {
    return this.store.get('change-set', task.changeSetId);
  }
  save(change, patch) {
    return this.store.update('change-set', change.id, change.revision, { ...change, ...patch });
  }
  async prepare(task, run) {
    if (task.stage !== 'develop') return this.get(task);
    const product = this.store.get('product', task.productId);
    const directory = path.resolve(this.engine.agentDirectory, 'changes', randomUUID());
    const inside = path.relative(product.folder, directory);
    if (!inside.startsWith('..') && !path.isAbsolute(inside) && allowed(inside))
      throw new Error(
        '앱의 수정 복사본 경로가 제품 소스 안에 있습니다. 앱 데이터를 제품 밖으로 옮겨주세요.',
      );
    const source = await sourceTree(product.folder);
    let repair,
      candidateSource = source;
    if (task.repairFrom) {
      repair = this.store.get('change-set', task.repairFrom);
      if (repair.baselineHash !== source.hash || repair.productId !== task.productId)
        throw new Error('보완 도중 원본이 바뀌었습니다. 새 수정 작업을 시작하세요.');
      candidateSource = await sourceTree(repair.candidate);
      if (candidateSource.hash !== treeHash(repair.candidateManifest))
        throw new Error('이전 수정본이 바뀌어 보완을 이어갈 수 없습니다.');
    }
    this.engine.owned(run.id);
    for (const test of task.testFiles)
      if (!source.manifest[test]) throw new Error(`선택한 테스트를 복사할 수 없습니다: ${test}`);
    const baseline = path.join(directory, 'baseline'),
      candidate = path.join(directory, 'candidate');
    await copyTree(source, baseline);
    await copyTree(candidateSource, candidate);
    this.engine.owned(run.id);
    const change = this.store.create('change-set', {
      taskId: task.id,
      runId: run.id,
      productId: task.productId,
      productRevision: task.productRevision,
      directory,
      baseline,
      candidate,
      baselineManifest: source.manifest,
      candidateManifest: candidateSource.manifest,
      baselineHash: source.hash,
      omitted: source.omitted,
      changes: repair?.changes || [],
      repairFrom: repair?.id || null,
      testFiles: task.testFiles,
      verificationProfile: task.verificationProfile,
      status: 'draft',
      artifactHash: null,
    });
    this.engine.updateTask(
      this.store.get('task', task.id),
      { changeSetId: change.id },
      '수정 복사본 준비',
    );
    return change;
  }
  async write(runId, args) {
    const input = z
      .object({
        path: z.string().max(1024),
        expectedHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        content: z.string().max(48000),
      })
      .strict()
      .parse(args);
    const { task, run } = this.engine.owned(runId);
    if (task.mode !== 'change' || run.role !== 'develop')
      throw new Error('수정 역할에서만 복사본에 쓸 수 있습니다.');
    const relative = relativeFile(input.path),
      id = task.changeSetId;
    const before = this.locks.get(id) || Promise.resolve();
    const operation = before
      .catch(() => {})
      .then(async () => {
        this.engine.owned(runId);
        let change = this.get(this.store.get('task', task.id));
        if (change.runId !== runId || change.status !== 'draft')
          throw new Error('이 수정본은 더 이상 편집할 수 없습니다.');
        if (
          change.testFiles.some((p) => p.toLowerCase() === relative.toLowerCase()) ||
          (change.verificationProfile &&
            (['package.json', 'package-lock.json', '.npmrc'].includes(relative.toLowerCase()) ||
              /(^|\/)(tests?|__tests__|scripts)\/|\.(test|spec)\.[^/]+$/i.test(relative)))
        )
          throw new Error('선택한 검증 테스트는 수정할 수 없습니다. 구현 파일을 수정하세요.');
        const alias = Object.keys(change.candidateManifest).find(
          (p) => p.toLowerCase() === relative.toLowerCase(),
        );
        if (alias && alias !== relative)
          throw new Error('파일 이름의 대소문자를 실제 경로와 일치시켜 주세요.');
        if (redact(input.content) !== input.content || input.content.includes('\0'))
          throw new Error('인증값이나 비텍스트를 포함한 수정안은 저장하지 않습니다.');
        if (!change.changes.some((c) => c.path === relative) && change.changes.length >= 16)
          throw new Error('한 수정안은 최대 16개 파일까지 변경할 수 있습니다.');
        const current = change.candidateManifest[relative] || null;
        if (current !== input.expectedHash)
          throw new Error('현재 수정본의 파일 버전과 일치하지 않습니다.');
        if (
          current &&
          !this.store
            .list('agent-evidence')
            .some(
              (e) =>
                e.runId === runId &&
                e.changeSetId === change.id &&
                e.path === relative &&
                e.hash === current &&
                !e.truncated,
            )
        )
          throw new Error(
            '현재 파일 전체를 읽은 뒤 수정하세요. 일부만 읽은 파일은 교체할 수 없습니다.',
          );
        const afterHash = await replaceCandidate(
          change.candidate,
          relative,
          input.content,
          current,
        );
        this.engine.owned(runId);
        const old = change.changes.find((c) => c.path === relative);
        const baselineContent =
          old?.before ??
          (change.baselineManifest[relative]
            ? await readFile(path.join(change.baseline, relative), 'utf8')
            : null);
        const entry = {
          path: relative,
          before: baselineContent,
          beforeHash: change.baselineManifest[relative] || null,
          after: input.content,
          afterHash,
        };
        const changes = change.changes.filter((c) => c.path !== relative);
        if (entry.beforeHash !== afterHash) changes.push(entry);
        change = this.save(change, {
          changes,
          candidateManifest: { ...change.candidateManifest, [relative]: afterHash },
        });
        const evidence = this.store.create('agent-evidence', {
          taskId: task.id,
          productId: task.productId,
          runId,
          path: relative,
          hash: afterHash,
          content: input.content.slice(0, 24000),
          truncated: input.content.length > 24000,
          changeSetId: change.id,
        });
        this.store.log('수정 복사본 변경', task.id, relative);
        return { evidenceId: evidence.id, path: relative, hash: afterHash, changeSetId: change.id };
      });
    this.locks.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.locks.get(id) === operation) this.locks.delete(id);
    }
  }
  async seal(task) {
    let change = this.get(task);
    const tree = await sourceTree(change.candidate);
    if (tree.hash !== treeHash(change.candidateManifest) || !change.changes.length)
      throw new Error('등록된 변경과 실제 복사본이 일치하지 않거나 변경이 없습니다.');
    change = this.save(change, { artifactHash: tree.hash, status: 'sealed' });
    return change;
  }
  async assertArtifact(change) {
    if (
      !change.artifactHash ||
      (await sourceTree(change.candidate)).hash !== change.artifactHash ||
      (await sourceTree(change.baseline)).hash !== change.baselineHash
    )
      throw new Error('수정본이나 기준 복사본이 바뀌었습니다. 새 검증이 필요합니다.');
  }
  async checks(task, signal) {
    const change = this.get(task);
    await this.assertArtifact(change);
    const timeout = new AbortController(),
      timer = setTimeout(() => timeout.abort(), 240000);
    try {
      const result = await verifyChange({
        change,
        node: this.node,
        signal: AbortSignal.any([signal, timeout.signal]),
      });
      await this.assertArtifact(change);
      if (timeout.signal.aborted && !signal.aborted) {
        result.status = 'failed';
        result.checks.push({
          name: '검사 단계 한도',
          target: 'candidate',
          result: 'timeout',
          output: '검사 단계의 4분 한도에 도달했습니다.',
        });
      }
      this.store.create('verification-observation', {
        taskId: task.id,
        productId: task.productId,
        profileVersion: change.verificationProfile?.version || null,
        artifactHash: change.artifactHash,
        baselineHash: change.baselineHash,
        at: new Date().toISOString(),
        ...result,
      });
      return {
        result: { ...result, artifactHash: change.artifactHash, baselineHash: change.baselineHash },
      };
    } finally {
      clearTimeout(timer);
    }
  }
  async validate(task, run, result) {
    const change = this.get(task);
    if (run.role === 'check') {
      if (result.artifactHash !== change.artifactHash) throw new Error('검사 수정본 버전 불일치');
      return;
    }
    if (run.role === 'develop') await this.seal(task);
    else await this.assertArtifact(change);
    const all = this.store
      .list('agent-evidence')
      .filter((e) => e.taskId === task.id && e.changeSetId === change.id);
    const allowedRuns = new Set([run.id, ...Object.values(task.outputs).map((o) => o.runId)]);
    for (const id of new Set(evidenceRefs(run.role, result))) {
      const evidence = all.find((e) => e.id === id && allowedRuns.has(e.runId));
      if (!evidence) throw new Error('수정본에 속하지 않은 근거입니다.');
      const root =
        run.role === 'knowledge' && task.appliedAt
          ? this.store.get('product', task.productId).folder
          : change.candidate;
      if ((await readProductFile(root, evidence.path)).hash !== evidence.hash)
        throw new Error('인용한 파일이 현재 수정본과 다릅니다.');
    }
    if (['develop', 'change_review'].includes(run.role) && !all.some((e) => e.runId === run.id))
      throw new Error('현재 역할의 파일 근거가 없습니다.');
    if (run.role === 'change_review')
      for (const file of change.changes)
        if (
          !all.some(
            (e) =>
              e.runId === run.id &&
              e.path === file.path &&
              e.hash === file.afterHash &&
              !e.truncated &&
              result.evidenceIds.includes(e.id),
          )
        )
          throw new Error('별도 검토에서 변경한 파일 전체를 읽고 인용해야 합니다.');
  }
  transition(task, role, result) {
    if (role === 'develop') return { stage: 'check', status: 'queued', verification: 'none' };
    if (role === 'check')
      return result.status === 'cancelled'
        ? { status: 'stopped', stage: 'check' }
        : result.status === 'failed'
          ? {
              status: 'check_failed',
              stage: 'develop',
              message:
                '수정 후 검사에서 실패했습니다. 수정 전후 결과를 확인한 뒤 보완할 수 있습니다.',
            }
          : {
              stage: 'change_review',
              status: 'queued',
              verification: result.status === 'passed' ? 'checks_passed' : 'partial_checks',
            };
    if (role === 'change_review')
      return result.verdict === 'supported'
        ? {
            stage: 'change_review',
            status: 'awaiting_apply',
            message:
              '수정본과 검사 결과를 확인했습니다. 변경 전후를 검토하고 작업 폴더에 반영할 수 있습니다.',
          }
        : {
            stage: 'develop',
            status: 'changes_requested',
            message: '별도 검토에서 보완이 필요합니다. 의견과 수정안을 보존했습니다.',
          };
    return {
      stage: 'knowledge',
      status: 'accepted',
      message: '수정본 반영과 재사용 기록 정리를 마쳤습니다.',
    };
  }
  async apply(input) {
    const {
      id,
      revision,
      artifactHash,
      acceptUnconfirmed = false,
    } = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int(),
        artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
        acceptUnconfirmed: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    let task = this.store.get('task', id);
    this.engine.profiles.assert(task);
    const change = this.get(task);
    if (
      task.revision !== revision ||
      task.mode !== 'change' ||
      !['awaiting_apply', 'apply_partial', 'apply_conflict'].includes(task.status) ||
      task.appliedAt ||
      this.applying.size ||
      this.engine.activeHasProduct(task.productId)
    )
      throw new Error('현재 버전에서는 적용할 수 없습니다. 최신 작업 상태를 확인하세요.');
    if (
      change.artifactHash !== artifactHash ||
      task.outputs.check?.result.artifactHash !== artifactHash ||
      task.outputs.change_review?.result.verdict !== 'supported'
    )
      throw new Error('검토한 수정본과 적용할 버전이 일치하지 않습니다.');
    if (task.outputs.check.result.status !== 'passed' && !acceptUnconfirmed)
      throw new Error('미확인 검사 범위를 읽고 적용 여부를 선택하세요.');
    const product = this.store.get('product', task.productId);
    if (product.revision !== task.productRevision)
      throw new Error('제품 목표나 범위가 바뀌었습니다.');
    this.applying.add(id);
    try {
      await this.assertArtifact(change);
      const current = await sourceTree(product.folder),
        expected = { ...change.baselineManifest };
      for (const entry of change.changes)
        if (current.manifest[entry.path] === entry.afterHash)
          expected[entry.path] = entry.afterHash;
      if (current.hash !== treeHash(expected))
        throw new Error(
          '원본 코드가 조사 기준과 달라졌습니다. 수정안을 보존하고 적용을 멈췄습니다.',
        );
      task = this.store.get('task', id);
      if (task.revision !== revision) throw new Error('검토 중 작업 상태가 바뀌었습니다.');
      let journal = this.store
        .list('apply-journal')
        .find((j) => j.changeSetId === change.id && j.taskId === id);
      if (!journal)
        journal = this.store.create('apply-journal', {
          taskId: id,
          productId: task.productId,
          changeSetId: change.id,
          artifactHash,
          state: 'prepared',
          appliedPaths: [],
        });
      task = this.engine.updateTask(
        task,
        { status: 'applying', message: '검토한 파일 버전을 작업 폴더에 반영하고 있습니다.' },
        '수정안 적용 시작',
      );
      for (const entry of change.changes) {
        applyOne(product.folder, entry);
        journal = this.store.update('apply-journal', journal.id, journal.revision, {
          ...journal,
          state: 'applying',
          appliedPaths: [...new Set([...journal.appliedPaths, entry.path])],
        });
      }
      if ((await sourceTree(product.folder)).hash !== change.artifactHash)
        throw new Error('반영 중 추가 변경이 발생했습니다. 현재 파일을 확인해야 합니다.');
      this.store.transaction(() => {
        this.store.update('apply-journal', journal.id, journal.revision, {
          ...journal,
          state: 'applied',
        });
        task = this.engine.updateTask(
          this.store.get('task', id),
          {
            status: 'queued',
            stage: 'knowledge',
            appliedAt: new Date().toISOString(),
            message: '검토한 수정본을 반영했습니다. 재사용 기록을 정리합니다.',
          },
          '수정안 반영 확인',
        );
      });
      this.materialize(task.id);
      queueMicrotask(() => this.engine.pump());
      return task;
    } catch (error) {
      const current = this.store.get('task', id);
      if (!current.appliedAt)
        this.engine.updateTask(
          current,
          {
            status: current.status === 'applying' ? 'apply_partial' : 'apply_conflict',
            message: error.message,
          },
          '수정안 적용 보류',
        );
      throw error;
    } finally {
      this.applying.delete(id);
      queueMicrotask(() => this.engine.pump());
    }
  }
  materialize(id) {
    let task = this.store.get('task', id);
    if (!task.appliedAt) return;
    const change = this.get(task),
      checks = task.outputs.check.result;
    if (!task.resultTaskId) {
      const report = this.engine.room.reportWork(
        {
          productId: task.productId,
          externalId: `pi-change:${task.id}:${change.artifactHash}`,
          title: task.title,
          summary: task.outputs.develop.result.summary,
          evidence: `수정본 ${change.artifactHash}\n${task.outputs.change_review.result.assessment}`,
          limitations:
            `${task.outputs.develop.result.limitations}\n${task.outputs.change_review.result.limitations}\n${checks.status === 'passed' ? '선택한 검사만 통과했습니다.' : '일부 검사 범위는 미확인입니다.'} 실제 서비스 배포는 수행하지 않았습니다.`.slice(
              0,
              4000,
            ),
          contribution:
            '사용자가 수정 목표·검사 범위를 지정하고 변경본을 검토해 반영했습니다. Pi의 별도 세션이 수정안 작성과 검토를 맡았고 앱이 기록된 검사를 실행했습니다.',
          changedFiles: change.changes.map((c) => ({
            path: c.path,
            summary: c.beforeHash ? '검토한 수정본 적용' : '검토한 파일 추가',
          })),
          checks: checks.checks.map((c) => ({
            name: c.name,
            result: ['passed', 'failed'].includes(c.result) ? c.result : 'unconfirmed',
            detail: (c.output || '정상 종료').slice(0, 2000),
          })),
        },
        'pi',
      );
      task = this.engine.updateTask(task, { resultTaskId: report.id }, '반영 결과 연결');
    }
    const record = this.store
      .list('record')
      .find((r) => r.sourceTaskId === task.resultTaskId && !r.runtimeTaskId);
    if (record && !record.edited)
      this.store.update('record', record.id, record.revision, {
        ...record,
        runtimeTaskId: task.id,
        evidenceIds: [
          ...new Set([
            ...task.outputs.develop.result.evidenceIds,
            ...task.outputs.change_review.result.evidenceIds,
          ]),
        ],
      });
    if (task.outputs.knowledge && !task.knowledgeSaved)
      this.store.transaction(() => {
        for (const record of task.outputs.knowledge.result.records)
          this.store.create('record', {
            productId: task.productId,
            ...record,
            source: '내장 Pi · 수정본 반영 후 기록',
            sourceTaskId: task.resultTaskId,
            runtimeTaskId: task.id,
            sourceRunId: task.outputs.knowledge.runId,
            sourceHash: change.artifactHash,
            provenance: 'reported',
            active: true,
            validity: 'current',
          });
        this.engine.updateTask(
          this.store.get('task', id),
          { knowledgeSaved: true },
          '반영 결과 지식 저장',
        );
      });
  }
}
