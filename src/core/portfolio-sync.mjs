const fields = ['title', 'description', 'contribution'];

export function entryFromTask(task) {
  return { taskId: task.id, title: task.title, description: task.summary.slice(0, 5000), contribution: task.contribution };
}

// Only subscriptions chosen in the desktop app can receive reported work.
export function applyTaskToPortfolio(portfolio, task) {
  if (!(portfolio.autoProductIds || []).includes(task.productId) || (portfolio.excludedTaskIds || []).includes(task.id) || (portfolio.agentOmittedTaskIds || []).includes(task.id)) return portfolio;
  const next = structuredClone(portfolio);
  next.entrySources ||= {};
  next.pendingTaskIds ||= [];
  const index = next.entries.findIndex(entry => entry.taskId === task.id);
  const candidate = entryFromTask(task);
  if (index >= 0) {
    const source = next.entrySources[task.id];
    // Legacy and explicitly added entries are user-owned.
    if (!source?.automatic) return portfolio;
    if(source.agentEdited){source.sourceConflict={reason:'편집의 원본 보고가 변경됐습니다. 대상별 문장을 다시 확인하세요.',at:new Date().toISOString()};return next;}
    for (const field of fields) if (!source.editedFields.includes(field)) next.entries[index][field] = candidate[field];
  } else if (next.entries.length < 20) {
    next.entries.push(candidate);
    next.entrySources[task.id] = { automatic: true, editedFields: [] };
    next.pendingTaskIds = next.pendingTaskIds.filter(id => id !== task.id);
  } else if (!next.pendingTaskIds.includes(task.id)) next.pendingTaskIds.push(task.id);
  return next;
}

export function preserveEntryEdits(old, entries) {
  const entrySources = {};
  for (const entry of entries) {
    const previous = old.entries.find(x => x.taskId === entry.taskId);
    const source = old.entrySources?.[entry.taskId];
    entrySources[entry.taskId] = source?.automatic && previous
      ? { ...source, automatic: true, editedFields: [...new Set([...source.editedFields, ...fields.filter(field => entry[field] !== previous[field])])] }
      : { ...(source || {}), automatic: false, editedFields: fields };
  }
  return entrySources;
}
