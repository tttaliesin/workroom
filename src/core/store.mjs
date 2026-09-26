import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL,
        body TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL,
        subject TEXT NOT NULL, detail TEXT NOT NULL
      );`);
  }
  decode(row) { return row ? { ...JSON.parse(row.body), id: row.id, revision: row.revision, created: row.created, updated: row.updated } : null; }
  get(kind, id) {
    const found = this.decode(this.db.prepare('SELECT * FROM entities WHERE kind=? AND id=?').get(kind, id));
    if (!found) throw new Error('항목을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');
    return found;
  }
  list(kind) { return this.db.prepare('SELECT * FROM entities WHERE kind=? ORDER BY updated DESC, rowid DESC').all(kind).map(r => this.decode(r)); }
  create(kind, body) {
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare('INSERT INTO entities VALUES (?,?,1,?,?,?)').run(id, kind, JSON.stringify(body), at, at);
    return this.get(kind, id);
  }
  update(kind, id, revision, body) {
    const { id: ignoredId, revision: ignoredRevision, created, updated, ...clean } = body;
    const result = this.db.prepare('UPDATE entities SET body=?, revision=revision+1, updated=? WHERE kind=? AND id=? AND revision=?')
      .run(JSON.stringify(clean), new Date().toISOString(), kind, id, revision);
    if (result.changes !== 1) throw new Error('다른 창이나 MCP에서 먼저 수정했습니다. 새로고침 후 다시 저장하세요.');
    return this.get(kind, id);
  }
  log(action, subject, detail = '') {
    this.db.prepare('INSERT INTO audit(at,action,subject,detail) VALUES (?,?,?,?)').run(new Date().toISOString(), action, subject, detail);
  }
  history() { return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 80').all(); }
  changeToken() { return this.db.prepare('SELECT COALESCE(MAX(id), 0) AS token FROM audit').get().token; }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
