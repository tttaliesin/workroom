import { readdir, lstat, realpath, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { allowed, sourceFile, relativeFile, digest } from './files.mjs';
import { redact } from './errors.mjs';

export const treeHash = (manifest) =>
  digest(
    JSON.stringify(
      Object.keys(manifest)
        .sort()
        .map((p) => [p, manifest[p]]),
    ),
  );
export async function sourceTree(root) {
  const base = await realpath(root),
    files = {},
    omitted = [];
  let size = 0,
    visited = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > 12000)
        throw new Error(
          '파일 항목이 많아 복사 범위를 확정하지 못했습니다. 더 작은 제품 폴더를 연결하세요.',
        );
      const relative = prefix + entry.name;
      if (!allowed(relative)) continue;
      if (entry.isSymbolicLink()) {
        omitted.push(relative + ' · 링크 제외');
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative + '/');
        continue;
      }
      if (!entry.isFile() || !sourceFile(relative)) continue;
      relativeFile(relative);
      const filename = path.join(base, relative),
        before = await lstat(filename);
      if (before.size > 256000) {
        omitted.push(relative + ' · 크기 초과');
        continue;
      }
      const resolved = await realpath(filename);
      if (
        path.relative(base, resolved).startsWith('..') ||
        (await lstat(filename)).isSymbolicLink()
      )
        throw new Error('복사 중 파일 위치가 바뀌었습니다.');
      const bytes = await readFile(resolved),
        text = bytes.toString('utf8');
      if (bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes) || redact(text) !== text) {
        omitted.push(relative + ' · 비공개 값 또는 비텍스트');
        continue;
      }
      size += bytes.length;
      if (size > 16 * 1024 * 1024 || Object.keys(files).length >= 1200)
        throw new Error('수정 작업의 복사 범위(1,200개 파일·16 MB)를 초과했습니다.');
      files[relative] = { hash: digest(bytes), content: text };
    }
  }
  await walk(base);
  const manifest = Object.fromEntries(
    Object.entries(files).map(([key, value]) => [key, value.hash]),
  );
  return { files, manifest, hash: treeHash(manifest), omitted: omitted.slice(0, 100) };
}
export async function copyTree(tree, directory) {
  await mkdir(directory, { recursive: true });
  for (const [relative, file] of Object.entries(tree.files)) {
    const filename = path.join(directory, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, file.content, { flag: 'wx' });
  }
}
export async function checkedDestination(root, relative, { createParents = false } = {}) {
  const normalized = relativeFile(relative),
    base = await realpath(root),
    parts = normalized.split('/');
  let directory = base;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    if (createParents) await mkdir(directory, { recursive: true });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('링크나 다른 위치에는 쓸 수 없습니다.');
  }
  const filename = path.join(base, normalized);
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('일반 소스 파일만 수정할 수 있습니다.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return filename;
}
export async function replaceCandidate(root, relative, content, expectedHash) {
  const filename = await checkedDestination(root, relative, { createParents: true });
  let before = null;
  try {
    before = await readFile(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((before === null ? null : digest(before)) !== expectedHash)
    throw new Error('복사본이 바뀌었습니다. 파일을 다시 읽고 수정하세요.');
  const temporary = filename + '.workroom-' + randomUUID() + '.tmp';
  await writeFile(temporary, content, { flag: 'wx' });
  await rename(temporary, filename);
  return digest(content);
}
// The journal is persisted before this short synchronous compare/replace section.
// External editors cannot participate in SQLite transactions; both versions remain in the change set.
export function applyOne(root, entry) {
  const relative = relativeFile(entry.path),
    base = realpathSync(root),
    parts = relative.split('/');
  let directory = base;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    mkdirSync(directory, { recursive: true });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('적용 경로가 링크로 바뀌었습니다.');
  }
  const filename = path.join(base, relative);
  if (existsSync(filename)) {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('적용할 파일 위치가 바뀌었습니다.');
  }
  const existing = existsSync(filename) ? digest(readFileSync(filename)) : null;
  if (existing === entry.afterHash) return 'already_applied';
  if (existing !== entry.beforeHash)
    throw new Error('원본 변경을 발견했습니다. 기존 입력을 보존하고 적용을 멈췄습니다.');
  const temporary = filename + '.workroom-' + randomUUID() + '.tmp';
  writeFileSync(temporary, entry.after, { flag: 'wx' });
  const current = existsSync(filename) ? digest(readFileSync(filename)) : null;
  if (current !== entry.beforeHash) throw new Error('적용 직전에 원본이 바뀌었습니다.');
  if (entry.beforeHash === null) {
    writeFileSync(filename, entry.after, { flag: 'wx' });
    unlinkSync(temporary);
  } else renameSync(temporary, filename);
  return 'applied';
}
