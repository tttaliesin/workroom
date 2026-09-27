import { z } from 'zod';
import { createRequire } from 'node:module';
import path from 'node:path';
import { access, mkdtemp } from 'node:fs/promises';
import { sourceTree, copyTree } from './change-files.mjs';
import { runNode } from './node-process.mjs';

export class VerificationProfiles {
  constructor(store) {
    this.store = store;
  }
  current(productId) {
    return this.store.list('verification-profile').find((p) => p.productId === productId);
  }
  save(input) {
    const value = z
      .object({
        productId: z.string().uuid(),
        version: z.number().int().min(0),
        enabled: z.boolean(),
        scripts: z
          .array(z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/))
          .min(1)
          .max(3),
        allowExecution: z.boolean(),
        timeoutSeconds: z.number().int().min(10).max(120),
      })
      .strict()
      .parse(input);
    this.store.get('product', value.productId);
    const old = this.current(value.productId);
    if ((old?.version || 0) !== value.version) throw new Error('검사 설정이 바뀌었습니다.');
    if (value.enabled && !value.allowExecution)
      throw new Error('의존성 다운로드와 제품 스크립트 실행을 허용하세요.');
    const body = { ...value, version: value.version + 1, scripts: [...new Set(value.scripts)] };
    const saved = old
      ? this.store.update('verification-profile', old.id, old.revision, body)
      : this.store.create('verification-profile', body);
    this.store.log('검사 환경 저장', saved.id, `v${saved.version}`);
    return saved;
  }
  assert(task) {
    if (
      task.verificationProfile &&
      this.current(task.productId)?.version !== task.verificationProfile.version
    )
      throw new Error('검사 환경이 바뀌었습니다. 새 작업에서 검증하세요.');
  }
}

export async function verifyProfile({ change, node, signal, npmCLI }) {
  const p = change.verificationProfile,
    checks = [];
  if (!p?.enabled) return checks;
  const missing = (output) => [
    { name: 'npm 검사 환경', target: 'candidate', result: 'unconfirmed', output },
  ];
  const version = await runNode(node, ['-p', 'process.execPath'], change.directory, signal);
  const executable = version.output.trim();
  const candidates = npmCLI
    ? [npmCLI]
    : [
        path.join(path.dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
        path.join(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js'),
      ];
  if (!npmCLI) {
    try {
      candidates.push(
        path.join(
          path.dirname(createRequire(import.meta.url).resolve('npm/package.json')),
          'bin/npm-cli.js',
        ),
      );
    } catch {}
  }
  let cli;
  for (const file of candidates) {
    try {
      await access(file);
      cli = file;
      break;
    } catch {}
  }
  if (!cli)
    return missing(
      'Node.js 설치의 npm-cli.js를 찾지 못했습니다. npm을 포함한 Node.js를 선택하세요.',
    );
  for (const target of ['baseline', 'candidate']) {
    if (signal?.aborted) break;
    const tree = await sourceTree(change[target]);
    if (!tree.manifest['package-lock.json'])
      return missing('npm ci에는 package-lock.json이 필요합니다.');
    const root = await mkdtemp(path.join(change.directory, `verify-${target}-`));
    await copyTree(tree, root);
    const options = { timeoutMs: p.timeoutSeconds * 1000 };
    const install = await runNode(
      node,
      [
        cli,
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--cache',
        path.join(root, '.npm-cache'),
      ],
      root,
      signal,
      options,
    );
    checks.push({ name: `npm ci · v${p.version}`, target, ...install });
    if (install.result !== 'passed') continue;
    for (const script of p.scripts) {
      if (signal?.aborted) break;
      checks.push({
        name: `npm run ${script} · v${p.version}`,
        target,
        ...(await runNode(node, [cli, 'run', '--ignore-scripts', script], root, signal, options)),
      });
    }
  }
  return checks;
}
