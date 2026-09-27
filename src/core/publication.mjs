import { z } from 'zod';
import { portfolioHTML } from './export.mjs';
import { digest } from '../runtime/files.mjs';

export class Publications {
  constructor(room, provider) {
    this.room = room;
    this.store = room.store;
    this.provider = provider;
    this.busy = new Set();
  }
  destination(portfolioId) {
    return this.store.list('publication-destination').find((d) => d.portfolioId === portfolioId);
  }
  configure(input) {
    const data = z
      .object({
        portfolioId: z.string().uuid(),
        version: z.number().int().min(0),
        project: z.string().regex(/^[a-z0-9][a-z0-9-]{1,99}$/),
        teamId: z.string().regex(/^(team_[a-zA-Z0-9]+)?$/),
      })
      .strict()
      .parse(input);
    this.store.get('portfolio', data.portfolioId);
    const old = this.destination(data.portfolioId);
    if ((old?.version || 0) !== data.version) throw new Error('공개 대상 설정이 바뀌었습니다.');
    const body = { ...data, version: data.version + 1, provider: 'vercel' };
    const saved = old
      ? this.store.update('publication-destination', old.id, old.revision, body)
      : this.store.create('publication-destination', body);
    this.store.log('공개 대상 저장', saved.id);
    return saved;
  }
  prepare({ portfolioId, revision, language = 'ko', restoreId }) {
    z.string().uuid().parse(portfolioId);
    z.enum(['ko', 'en']).parse(language);
    const p = this.store.get('portfolio', portfolioId),
      destination = this.destination(portfolioId);
    if (!destination) throw new Error('공개 대상을 먼저 저장하세요.');
    if (p.revision !== revision) throw new Error('초안이 바뀌었습니다. 다시 확인하세요.');
    const old = restoreId ? this.store.get('publication', restoreId) : null;
    if (old && (old.portfolioId !== p.id || !old.verifiedAt))
      throw new Error('같은 대상의 공개 확인된 버전만 복원할 수 있습니다.');
    const snapshot = old?.snapshot || this.room.prepareExport(p.id, revision);
    const html = old?.html || portfolioHTML(snapshot, { language });
    const publication = this.store.create('publication', {
      portfolioId,
      portfolioRevision: p.revision,
      snapshot,
      html,
      artifactHash: digest(html),
      destination,
      restoreId: old?.id || null,
      status: 'prepared',
      sourceVersions:
        old?.sourceVersions ||
        p.entries.map((e) => ({
          id: e.taskId,
          revision: this.store.get('task', e.taskId).revision,
        })),
      jobSourceId: old?.jobSourceId || p.jobSourceId || null,
    });
    this.store.log('공개 버전 준비', publication.id);
    return publication;
  }
  save(p, patch) {
    const current = this.store.get('publication', p.id);
    const next = this.store.update('publication', p.id, current.revision, { ...current, ...patch });
    this.store.log('공개 진행', p.id, next.status);
    return next;
  }
  async publish({ id, artifactHash }) {
    const p = this.store.get('publication', z.string().uuid().parse(id));
    if (p.artifactHash !== artifactHash || digest(p.html) !== artifactHash)
      throw new Error('검토한 공개 버전과 일치하지 않습니다.');
    if (this.busy.has(id)) return p;
    if (p.status !== 'prepared') return this.reconcile({ id });
    const current = this.store.get('portfolio', p.portfolioId);
    if (
      current.revision !== p.portfolioRevision ||
      this.destination(p.portfolioId)?.version !== p.destination.version
    )
      throw new Error('초안 또는 공개 대상이 바뀌었습니다. 다시 검토하세요.');
    if (
      !p.restoreId &&
      p.sourceVersions.some((s) => this.store.get('task', s.id).revision !== s.revision)
    )
      throw new Error('공개할 사례의 근거가 바뀌었습니다. 다시 검토하세요.');
    if (
      this.store
        .list('publication')
        .some(
          (x) =>
            x.id !== id &&
            x.destination.project === p.destination.project &&
            x.destination.teamId === p.destination.teamId &&
            ['submitting', 'uncertain', 'building'].includes(x.status),
        )
    )
      throw new Error('이 공개 대상의 이전 요청 상태를 먼저 확인하세요.');
    this.busy.add(id);
    let submitting = false;
    try {
      this.provider.assertReady();
      this.store.transaction(() => {
        this.save(p, { status: 'submitting' });
      });
      submitting = true;
      const deployment = await this.provider.deploy(p);
      return this.save(p, { status: 'building', deploymentId: deployment.id });
    } catch (error) {
      if (!submitting) throw error;
      return this.save(p, {
        status: error.definitive ? 'failed' : 'uncertain',
        message: error.definitive
          ? '공개 요청이 거절되었습니다. 계정과 프로젝트 설정을 확인하세요.'
          : '응답이 확인되지 않았습니다. 상태 조회로 기존 요청을 확인하세요.',
      });
    } finally {
      this.busy.delete(id);
    }
  }
  async reconcile({ id }) {
    let p = this.store.get('publication', z.string().uuid().parse(id));
    if (this.busy.has(id) || ['prepared', 'failed'].includes(p.status)) return p;
    this.busy.add(id);
    try {
      // Older versions could persist the deployment ID only on a separate attempt.
      if (!p.deploymentId && p.attemptId) {
        const legacy = this.store
          .list('publication-attempt')
          .find((a) => a.id === p.attemptId && a.publicationId === p.id);
        if (typeof legacy?.deploymentId === 'string' && legacy.deploymentId)
          p = this.save(p, { deploymentId: legacy.deploymentId });
      }
      const deployment = await this.provider.find(p);
      if (!deployment)
        return this.save(p, {
          status: 'uncertain',
          message: '기존 공개 요청을 찾지 못했습니다. 전송을 반복하지 않고 확인을 기다립니다.',
        });
      if (['ERROR', 'CANCELED'].includes(deployment.readyState || deployment.state))
        return this.save(p, { status: 'failed' });
      if ((deployment.readyState || deployment.state) !== 'READY')
        return this.save(p, { status: 'building', deploymentId: deployment.id || deployment.uid });
      const verified = await this.provider.verify(deployment, p.artifactHash);
      return this.save(p, {
        deploymentId: deployment.id || deployment.uid,
        status: verified ? 'published' : 'unverified',
        url: this.provider.url(deployment),
        verifiedAt: verified ? new Date().toISOString() : null,
        message: verified
          ? null
          : '공개 주소의 내용이 검토한 HTML과 일치하는지 확인하지 못했습니다.',
      });
    } catch {
      return this.save(p, {
        message: '공개 상태를 조회하지 못했습니다. 계정과 네트워크를 확인하세요.',
      });
    } finally {
      this.busy.delete(id);
    }
  }
}
