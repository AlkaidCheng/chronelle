CREATE INDEX objects_display_name_search_idx
  ON objects
  USING gin (to_tsvector('simple', display_name))
  WHERE deleted_at IS NULL;
