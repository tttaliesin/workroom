// SQLite triggers keep source writes and durable index work in the same transaction,
// including writes made by another app/MCP connection. Derived vectors are disposable.
export function initializeKnowledgeIndex(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_index_state (
      id INTEGER PRIMARY KEY CHECK (id=1), model_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_jobs (
      source_id TEXT PRIMARY KEY, product_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
      operation TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
      owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS knowledge_jobs_ready ON knowledge_jobs(state,next_attempt);
    CREATE TABLE IF NOT EXISTS knowledge_vectors (
      source_id TEXT NOT NULL, product_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
      model_id TEXT NOT NULL, chunk INTEGER NOT NULL, vector TEXT NOT NULL,
      PRIMARY KEY(source_id,model_id,chunk)
    );
    CREATE INDEX IF NOT EXISTS knowledge_vectors_product ON knowledge_vectors(product_id,model_id);
    CREATE TRIGGER IF NOT EXISTS knowledge_record_insert AFTER INSERT ON entities
    WHEN NEW.kind='record' BEGIN
      INSERT INTO knowledge_jobs(source_id,product_id,source_revision,operation)
      VALUES(NEW.id,json_extract(NEW.body,'$.productId'),NEW.revision,
        CASE WHEN json_extract(NEW.body,'$.active')=1 AND
          COALESCE(json_extract(NEW.body,'$.validity'),'')!='needs_review' THEN 'upsert' ELSE 'delete' END)
      ON CONFLICT(source_id) DO UPDATE SET product_id=excluded.product_id,
        source_revision=excluded.source_revision,operation=excluded.operation,
        state='pending',attempts=0,next_attempt=0,owner=NULL,lease_until=0,last_error=NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS knowledge_record_update AFTER UPDATE ON entities
    WHEN NEW.kind='record' BEGIN
      DELETE FROM knowledge_vectors WHERE source_id=NEW.id;
      INSERT INTO knowledge_jobs(source_id,product_id,source_revision,operation)
      VALUES(NEW.id,json_extract(NEW.body,'$.productId'),NEW.revision,
        CASE WHEN json_extract(NEW.body,'$.active')=1 AND
          COALESCE(json_extract(NEW.body,'$.validity'),'')!='needs_review' THEN 'upsert' ELSE 'delete' END)
      ON CONFLICT(source_id) DO UPDATE SET product_id=excluded.product_id,
        source_revision=excluded.source_revision,operation=excluded.operation,
        state='pending',attempts=0,next_attempt=0,owner=NULL,lease_until=0,last_error=NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS knowledge_record_delete AFTER DELETE ON entities
    WHEN OLD.kind='record' BEGIN
      DELETE FROM knowledge_vectors WHERE source_id=OLD.id;
      INSERT INTO knowledge_jobs(source_id,product_id,source_revision,operation)
      VALUES(OLD.id,json_extract(OLD.body,'$.productId'),OLD.revision+1,'delete')
      ON CONFLICT(source_id) DO UPDATE SET source_revision=excluded.source_revision,operation='delete',
        state='pending',attempts=0,next_attempt=0,owner=NULL,lease_until=0,last_error=NULL;
    END;
    INSERT OR IGNORE INTO knowledge_jobs(source_id,product_id,source_revision,operation)
    SELECT id,json_extract(body,'$.productId'),revision,
      CASE WHEN json_extract(body,'$.active')=1 AND
        COALESCE(json_extract(body,'$.validity'),'')!='needs_review' THEN 'upsert' ELSE 'delete' END
    FROM entities WHERE kind='record';
  `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
