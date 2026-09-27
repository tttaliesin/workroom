import { t as tr } from '../shared/i18n.mjs';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fields = ['title', 'description', 'contribution'];

// Rebase in-progress editing over incoming reports without replacing typed text.
// Concurrent manual changes to the same field remain an explicit conflict.
export function mergeDraft(base, local, remote, preferLocal = false) {
  if (base.revision === remote.revision) return local;
  const next = structuredClone(remote);
  function mergeValue(before, ours, theirs, automatic = false) {
    if (equal(ours, before)) return theirs;
    if (equal(theirs, before) || equal(ours, theirs) || automatic || preferLocal) return ours;
    throw new Error(
      tr(
        '다른 창에서 같은 내용을 수정했습니다. 현재 입력은 보존했습니다. 저장된 초안과 비교한 뒤 다시 저장하세요.',
      ),
    );
  }
  for (const field of ['intro', 'requirements', 'autoProductIds'])
    next[field] = mergeValue(
      base[field] ?? (field === 'autoProductIds' ? [] : ''),
      local[field] ?? (field === 'autoProductIds' ? [] : ''),
      remote[field] ?? (field === 'autoProductIds' ? [] : ''),
    );
  next.entries = [];
  const baseIds = new Set(base.entries.map((e) => e.taskId));
  const localIds = new Set(local.entries.map((e) => e.taskId));
  for (const ours of local.entries) {
    const before = base.entries.find((e) => e.taskId === ours.taskId);
    const theirs = remote.entries.find((e) => e.taskId === ours.taskId);
    if (!before) {
      if (theirs && !equal(ours, theirs) && !preferLocal)
        throw new Error(tr('다른 창에서 같은 사례를 추가했습니다. 현재 입력은 보존했습니다.'));
      next.entries.push(ours);
      continue;
    }
    if (!theirs) {
      if (preferLocal && !equal(ours, before)) {
        next.entries.push(ours);
        continue;
      }
      if (!equal(ours, before))
        throw new Error(tr('다른 창에서 편집 중인 사례를 제외했습니다. 현재 입력은 보존했습니다.'));
      continue;
    }
    const entry = { taskId: ours.taskId };
    for (const field of fields) {
      const source = remote.entrySources?.[ours.taskId];
      const automatic = source?.automatic && !source.editedFields.includes(field);
      entry[field] = mergeValue(before[field], ours[field], theirs[field], automatic);
    }
    next.entries.push(entry);
  }
  for (const entry of remote.entries)
    if (!baseIds.has(entry.taskId) && !localIds.has(entry.taskId)) next.entries.push(entry);
  if (next.entries.length > 20)
    throw new Error(
      tr(
        '새 보고와 편집 중인 사례를 합치면 20개를 넘습니다. 현재 입력은 보존했습니다. 사례를 제외한 뒤 저장하세요.',
      ),
    );
  return next;
}
