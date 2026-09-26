import { realpath, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from './errors.mjs';

const excluded =
  /^(?:\.git|\.pi|\.codex|\.agents|\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.workroom|\.cache|node_modules|vendor|dist|build|coverage|work|auth(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|db|log))$/i;
const readable =
  /\.(?:md|mdx|txt|json|ya?ml|toml|js|jsx|mjs|cjs|ts|tsx|html|css|scss|py|rs|go|java|kt|swift|c|cpp|h|cs|vue|svelte|sql|sh|ps1)$/i;
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function allowed(relative) {
  return relative.split(/[\\/]/).every((part) => !excluded.test(part));
}
export function sourceFile(relative) {
  return readable.test(relative) || path.basename(relative) === 'Dockerfile';
}
export function relativeFile(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length > 1024 ||
    path.isAbsolute(relative) ||
    relative.includes(':') ||
    relative
      .split(/[\\/]/)
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      ) ||
    !allowed(relative) ||
    !sourceFile(relative)
  )
    throw new Error('허용되지 않은 소스 경로입니다.');
  return relative.replaceAll('\\', '/');
}
async function resolveSafe(root, relative) {
  if (
    typeof relative !== 'string' ||
    relative.length > 1024 ||
    path.isAbsolute(relative) ||
    relative.includes(':') ||
    !allowed(relative)
  )
    throw new Error('허용 범위 밖의 경로입니다.');
  const base = await realpath(root),
    target = await realpath(path.resolve(base, relative || '.'));
  const inside = path.relative(base, target);
  if (inside.startsWith('..') || path.isAbsolute(inside) || !allowed(inside))
    throw new Error('제품 폴더 밖이나 제외된 위치는 읽을 수 없습니다.');
  return { base, target, relative: inside.replaceAll('\\', '/') };
}
export async function listProductFiles(root, relative = '.') {
  const safe = await resolveSafe(root, relative);
  const entries = (await readdir(safe.target, { withFileTypes: true })).filter(
    (x) =>
      !x.isSymbolicLink() &&
      allowed(x.name) &&
      (x.isDirectory() || readable.test(x.name) || x.name === 'Dockerfile'),
  );
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    directory: safe.relative || '.',
    entries: entries.slice(0, 120).map((x) => ({ name: x.name, directory: x.isDirectory() })),
    truncated: entries.length > 120,
  };
}
export async function readProductFile(root, relative, { maxChars = 24000 } = {}) {
  const safe = await resolveSafe(root, relative);
  if (!readable.test(safe.relative) && path.basename(safe.relative) !== 'Dockerfile')
    throw new Error('지원하는 소스·문서 파일만 읽을 수 있습니다.');
  const handle = await open(safe.target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256000)
      throw new Error('256 KB 이하의 일반 텍스트 파일만 읽을 수 있습니다.');
    const bytes = await handle.readFile();
    // Check again after opening to reject a path replaced during the operation.
    const checked = await resolveSafe(root, relative);
    if (checked.target !== safe.target || bytes.includes(0))
      throw new Error('파일 위치가 바뀌었거나 텍스트 파일이 아닙니다.');
    return {
      path: safe.relative,
      hash: digest(bytes),
      content: redact(bytes.toString('utf8')).slice(0, maxChars),
      truncated: bytes.toString('utf8').length > maxChars,
    };
  } finally {
    await handle.close();
  }
}
