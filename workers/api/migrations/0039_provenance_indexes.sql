CREATE INDEX IF NOT EXISTS idx_fetch_events_content_hash
  ON fetch_events(content_hash, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_fetch_events_dataset_product_collection
  ON fetch_events(dataset_kind, source_type, product_id, collection_date, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_replay_queue_updated
  ON ingest_replay_queue(updated_at DESC, status, collection_date);
