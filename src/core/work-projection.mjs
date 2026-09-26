// A task owns a problem; report tasks retain their original identity and payload.
export function workReports(task, tasks) {
  return [task, ...tasks.filter(t => t.kind === 'work' && t.parentTaskId === task.id)
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))];
}

export function projectWork(task, tasks) {
  const reports = workReports(task, tasks);
  if (reports.length === 1) return task;
  const join = key => reports.map(r => `${r.title}\n${r[key]}`).join('\n\n');
  return { ...task, summary: join('summary'), evidence: join('evidence'),
    limitations: [...new Set(reports.map(r => r.limitations))].join('\n'),
    contribution: [...new Set(reports.map(r => r.contribution))].join('\n').slice(0, 3000),
    changedFiles: reports.flatMap(r => r.changedFiles || []), checks: reports.flatMap(r => r.checks || []) };
}

export function sourceReports(task, tasks) {
  return workReports(task, tasks).map(r => ({ taskId: r.id, sourceVersion: r.sourceVersion || 1, reportHash: r.reportHash || '', title: r.title }));
}
