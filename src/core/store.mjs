import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeKnowledgeIndex } from './knowledge-index-schema.mjs';

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
      );
      CREATE TABLE IF NOT EXISTS wakeups (
        operation_key TEXT PRIMARY KEY, type TEXT NOT NULL, target_id TEXT NOT NULL,
        payload TEXT NOT NULL, not_before INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS wakeups_due ON wakeups(status, not_before);`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS control_request_id
      ON entities(json_extract(body, '$.requestId')) WHERE kind='control-operation'`);
    initializeKnowledgeIndex(this.db);
  }
  decode(row) {
    return row
      ? {
          ...JSON.parse(row.body),
          id: row.id,
          revision: row.revision,
          created: row.created,
          updated: row.updated,
        }
      : null;
  }
  get(kind, id) {
    const found = this.find(kind, id);
    if (!found) throw new Error('항목을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');
    return found;
  }
  find(kind, id) {
    return this.decode(
      this.db.prepare('SELECT * FROM entities WHERE kind=? AND id=?').get(kind, id),
    );
  }
  list(kind) {
    return this.db
      .prepare('SELECT * FROM entities WHERE kind=? ORDER BY updated DESC, rowid DESC')
      .all(kind)
      .map((r) => this.decode(r));
  }
  operation(requestId) {
    return this.decode(
      this.db
        .prepare(
          "SELECT * FROM entities WHERE kind='control-operation' AND json_extract(body, '$.requestId')=?",
        )
        .get(requestId),
    );
  }
  create(kind, body) {
    const id = randomUUID(),
      at = new Date().toISOString();
    this.db
      .prepare('INSERT INTO entities VALUES (?,?,1,?,?,?)')
      .run(id, kind, JSON.stringify(body), at, at);
    return this.get(kind, id);
  }
  update(kind, id, revision, body) {
    const { id: ignoredId, revision: ignoredRevision, created, updated, ...clean } = body;
    const result = this.db
      .prepare(
        'UPDATE entities SET body=?, revision=revision+1, updated=? WHERE kind=? AND id=? AND revision=?',
      )
      .run(JSON.stringify(clean), new Date().toISOString(), kind, id, revision);
    if (result.changes !== 1)
      throw new Error('다른 창이나 MCP에서 먼저 수정했습니다. 새로고침 후 다시 저장하세요.');
    return this.get(kind, id);
  }
  log(action, subject, detail = '') {
    this.db
      .prepare('INSERT INTO audit(at,action,subject,detail) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), action, subject, detail);
  }
  history() {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 80').all();
  }
  queueWake(key, type, targetId, payload, notBefore = Date.now()) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO wakeups(operation_key,type,target_id,payload,not_before) VALUES (?,?,?,?,?)',
      )
      .run(key, type, targetId, JSON.stringify(payload), notBefore);
  }
  pendingWakes(now = Date.now()) {
    return this.db
      .prepare(
        "SELECT * FROM wakeups WHERE status='pending' AND not_before<=? ORDER BY not_before, rowid LIMIT 100",
      )
      .all(now)
      .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  finishWake(key, status = 'completed') {
    this.db
      .prepare("UPDATE wakeups SET status=? WHERE operation_key=? AND status='pending'")
      .run(status, key);
  }
  changeToken() {
    return this.db.prepare('SELECT COALESCE(MAX(id), 0) AS token FROM audit').get().token;
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
