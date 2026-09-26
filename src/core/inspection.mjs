import { realpath, lstat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const exec = promisify(execFile);

export async function normalizeFolder(folder) {
  const resolved = await realpath(folder);
  if (!(await lstat(resolved)).isDirectory()) throw new Error('폴더를 선택해주세요.');
  return resolved;
}

async function rootFile(folder, name, contents = false) {
  const filename = path.join(folder, name);
  try {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) return { exists: false, note: `${name}: 일반 파일이 아니므로 읽지 않음` };
    if (contents && stat.size > 256_000) return { exists: true, note: `${name}: 256KB 초과로 읽지 않음` };
    return { exists: true, ...(contents ? { text: await readFile(filename, 'utf8') } : {}) };
  } catch (e) { if (e.code === 'ENOENT') return { exists: false }; throw e; }
}

export async function inspectFolder(folder) {
  const canonical = await normalizeFolder(folder);
  // Do not follow a folder that was replaced with a symlink after registration.
  if (path.resolve(canonical).toLowerCase() !== path.resolve(folder).toLowerCase()) throw new Error('등록한 폴더의 실제 위치가 바뀌었습니다. 제품을 다시 연결하세요.');
  const observations = [], findings = [], unconfirmed = [], limits = ['테스트 실행·코드 수정·외부 네트워크 요청·배포는 하지 않았습니다.'];
  const git = process.env.WORKROOM_GIT || 'git';
  const gitArgs = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', folder];
  try {
    const top = (await exec(git, [...gitArgs, 'rev-parse', '--show-toplevel'], { timeout: 8000, windowsHide: true, maxBuffer: 256_000 })).stdout.trim();
    const realTop = await realpath(top);
    if (path.resolve(realTop).toLowerCase() !== path.resolve(folder).toLowerCase()) {
      observations.push({ label: 'Git', value: '상위 폴더가 저장소 루트입니다. 선택 폴더만 점검했습니다.' });
      unconfirmed.push('상위 저장소의 변경 상태는 수집하지 않았습니다.');
    } else {
      const branch = (await exec(git, [...gitArgs, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 8000, windowsHide: true })).stdout.trim();
      const status = (await exec(git, [...gitArgs, 'status', '--porcelain=v1', '-z', '--untracked-files=no'], { timeout: 8000, windowsHide: true, maxBuffer: 256_000 })).stdout;
      observations.push({ label: 'Git 브랜치', value: branch });
      observations.push({ label: '추적 파일 변경', value: status ? '커밋하지 않은 변경이 있음' : '추적 파일 변경 없음' });
      limits.push('추적되지 않은 파일은 Git 변경 확인에서 제외했습니다.');
    }
  } catch (e) {
    observations.push({ label: 'Git', value: '저장소 상태 확인 불가' });
    unconfirmed.push(e.code === 'ENOENT' ? 'Git 실행 파일을 찾지 못했습니다.' : '저장소가 아니거나, 최초 커밋이 없거나, Git 명령이 실패했습니다.');
  }
  const readmes = await Promise.all(['README.md', 'readme.md', 'README.rst', 'README.txt'].map(n => rootFile(folder, n)));
  const readme = readmes.some(x => x.exists);
  observations.push({ label: '루트 README', value: readme ? '있음' : '찾지 못함' });
  if (!readme) findings.push('제품 목적과 실행 방법을 설명하는 루트 README를 확인하지 못했습니다.');
  const pkg = await rootFile(folder, 'package.json', true);
  if (pkg.text) {
    try {
      const json = JSON.parse(pkg.text);
      const scripts = json.scripts && typeof json.scripts === 'object' ? Object.keys(json.scripts).filter(k => typeof json.scripts[k] === 'string').slice(0, 40) : [];
      observations.push({ label: 'npm 스크립트 이름', value: scripts.join(', ') || '없음' });
      if (!scripts.some(x => /^test(?::|$)/.test(x))) findings.push('package.json에서 test 스크립트를 찾지 못했습니다. 다른 테스트 도구 사용 여부는 확인이 필요합니다.');
    } catch { findings.push('package.json을 JSON으로 읽을 수 없습니다.'); }
  } else {
    observations.push({ label: 'package.json', value: pkg.note || (pkg.exists ? '내용 미확인' : '없음 · 다른 언어의 프로젝트일 수 있음') });
    if (pkg.note) unconfirmed.push(pkg.note);
  }
  return { observations, findings, unconfirmed, limits, checkedAt: new Date().toISOString() };
}
