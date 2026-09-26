import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, lstat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';

const hash = value => createHash('sha256').update(value).digest('hex');
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const shQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
async function assertRegular(filename, directory = false) {
  try {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('연결 경로가 일반 폴더/파일이 아닙니다. 기존 설정은 변경하지 않았습니다.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function currentConfig(folder) {
  const directory = path.join(folder, '.codex'), filename = path.join(directory, 'hooks.json');
  await assertRegular(directory, true); await assertRegular(filename);
  let original = null;
  try { original = await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config;
  try { config = original === null ? {} : JSON.parse(original.replace(/^\uFEFF/, '')); } catch { throw new Error('기존 hooks.json을 읽을 수 없습니다. 파일을 덮어쓰지 않았습니다.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) throw new Error('기존 hooks.json 구조를 확인하세요. 파일을 덮어쓰지 않았습니다.');
  return { filename, directory, original, config, revision: hash(original ?? '<absent>') };
}

export async function prepareCodexSetup(room, productId, { database, node, script }) {
  const product = room.store.get('product', productId);
  const current = await currentConfig(product.folder);
  const binding = Buffer.from(JSON.stringify({ database, productId })).toString('base64url');
  const ps = `$ProgressPreference='SilentlyContinue';[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[System.Text.UTF8Encoding]::new($false);$eventJson=[Console]::In.ReadToEnd();$eventJson | & ${psQuote(node)} ${psQuote(script)} --binding ${psQuote(binding)}`;
  const commandWindows = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`;
  const command = process.platform === 'win32' ? commandWindows : `${shQuote(node)} ${shQuote(script)} --binding ${shQuote(binding)}`;
  const tag = `작업실 수집 · ${productId}`;
  const config = structuredClone(current.config); config.hooks ||= {};
  for (const event of ['PostToolUse', 'Stop', 'Interrupt']) {
    const groups = config.hooks[event] || [];
    if (!Array.isArray(groups) || groups.some(g => !g || !Array.isArray(g.hooks))) throw new Error(`기존 ${event} 훅 구조를 확인하세요. 파일을 변경하지 않았습니다.`);
    const kept = groups.map(g => ({ ...g, hooks: g.hooks.filter(h => h.statusMessage !== tag) })).filter(g => g.hooks.length);
    config.hooks[event] = [...kept, { ...(event === 'PostToolUse' ? { matcher: '^(Bash|apply_patch|Edit|Write)$' } : {}), hooks: [{ type: 'command', command, commandWindows, timeout: event === 'Interrupt' ? 3 : 10, statusMessage: tag }] }];
  }
  return { filename: current.filename, revision: current.revision, existing: current.original !== null, config, node, script, productId, projectFolder: product.folder };
}

export async function installCodexSetup(room, productId, revision, runtime) {
  const plan = await prepareCodexSetup(room, productId, runtime);
  if (plan.revision !== revision) throw new Error('연결 설정을 검토한 뒤 다른 프로그램이 hooks.json을 바꿨습니다. 설정을 다시 확인하세요.');
  const current = await currentConfig(plan.projectFolder);
  if (current.revision !== revision) throw new Error('훅 설정이 변경되었습니다. 다시 확인하세요.');
  await mkdir(current.directory, { recursive: true });
  await assertRegular(current.directory, true);
  const backup = current.original === null ? null : path.join(current.directory, `hooks.workroom-backup-${randomUUID()}.json`);
  if (backup) await writeFile(backup, current.original, { flag: 'wx' });
  const temporary = path.join(current.directory, `hooks.workroom-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(plan.config, null, 2) + '\n', { flag: 'wx' });
    const rechecked = await currentConfig(plan.projectFolder);
    if (rechecked.revision !== revision) throw new Error('저장 직전에 훅 설정이 변경되었습니다. 다시 확인하세요.');
    await rename(temporary, current.filename);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  room.setCodexCapture({ productId, enabled: true });
  return { filename: plan.filename, backup, state: 'awaiting-trust' };
}
