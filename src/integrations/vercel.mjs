import { digest } from '../runtime/files.mjs';
export class VercelPublisher {
  constructor(vault, request = fetch) {
    this.vault = vault;
    this.request = request;
  }
  assertReady() {
    if (!this.vault.read()?.access) throw new Error('Vercel 토큰을 먼저 저장하세요.');
  }
  async api(endpoint, destination, body) {
    this.assertReady();
    const url = new URL(endpoint, 'https://api.vercel.com');
    if (destination.teamId) url.searchParams.set('teamId', destination.teamId);
    const response = await this.request(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${this.vault.read().access}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const e = new Error(`Vercel HTTP ${response.status}`);
      e.definitive = response.status >= 400 && response.status < 500 && response.status !== 408;
      throw e;
    }
    return response.json();
  }
  async deploy(p) {
    const d = await this.api('/v13/deployments', p.destination, {
      name: p.destination.project,
      project: p.destination.project,
      target: 'production',
      files: [
        { file: 'index.html', data: Buffer.from(p.html).toString('base64'), encoding: 'base64' },
      ],
      projectSettings: {
        framework: null,
        buildCommand: '',
        installCommand: '',
        outputDirectory: null,
      },
      meta: { workroomPublication: p.id, workroomHash: p.artifactHash },
    });
    if (!d.id) throw new Error('Deployment id missing');
    return d;
  }
  async find(p) {
    if (p.deploymentId)
      return this.api(`/v13/deployments/${encodeURIComponent(p.deploymentId)}`, p.destination);
    const project = await this.api(
      `/v9/projects/${encodeURIComponent(p.destination.project)}`,
      p.destination,
    );
    let until;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({
        projectId: project.id,
        limit: '100',
        since: String(Date.parse(p.created) - 60000),
      });
      if (until) query.set('until', String(until));
      const list = await this.api(`/v7/deployments?${query}`, p.destination);
      const found = list.deployments?.find(
        (d) => d.meta?.workroomPublication === p.id && d.meta?.workroomHash === p.artifactHash,
      );
      if (found) return found;
      until = list.pagination?.next;
      if (!until) break;
    }
    return null;
  }
  url(d) {
    if (!/^[a-zA-Z0-9-]+\.vercel\.app$/.test(d.url)) throw new Error('Invalid deployment URL');
    return `https://${d.url}`;
  }
  async verify(d, hash) {
    const response = await this.request(this.url(d), {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 1000000) return false;
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 1000000) return false;
        chunks.push(value);
      }
      return digest(Buffer.concat(chunks).toString('utf8')) === hash;
    } finally {
      await reader.cancel();
    }
  }
}
