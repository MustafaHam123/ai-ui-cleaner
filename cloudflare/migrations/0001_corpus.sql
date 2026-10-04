PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ui_references (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  reuse_allowed INTEGER NOT NULL DEFAULT 0,
  code_review TEXT,
  asset_count INTEGER NOT NULL DEFAULT 0,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS references_source_kind ON ui_references(source, kind);
CREATE TABLE IF NOT EXISTS reference_chunks (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES ui_references(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  vector_indexed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS chunks_reference ON reference_chunks(reference_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content, content='reference_chunks', content_rowid='rowid', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON reference_chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON reference_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE OF content ON reference_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
