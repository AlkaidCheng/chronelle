-- A user keeps when each workspace was last opened: `workspace_recency` is
-- an object keyed by workspace id whose value is the instant (ISO 8601, as
-- the client wrote it) the workspace was last switched to, so the switcher
-- lists the workspaces shared with the user by recency on every device. The
-- user row is serialized whole by every identity, session, and credential
-- function, so the column reaches sign-in, session, and account responses on
-- the rpc path as it does through Drizzle.
--
-- chronelle_user_preferences_update (0053) is redefined with
-- `workspace_recency` among the keys it merges: the request's map merges one
-- workspace at a time (an instant replaces that workspace's entry, a JSON
-- null drops it), any other shape is refused, and the fifty most recent
-- entries are kept. The other keys keep 0053's rules.
ALTER TABLE users ADD COLUMN workspace_recency jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD CONSTRAINT users_workspace_recency_is_instants_per_workspace
  CHECK (
    jsonb_typeof(workspace_recency) = 'object'
    AND NOT jsonb_path_exists(workspace_recency, '$.keyvalue() ? (!(@.key like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')
    AND NOT jsonb_path_exists(workspace_recency, '$.* ? (@.type() != "string")')
  );

DROP FUNCTION chronelle_user_preferences_update(uuid, jsonb);

CREATE FUNCTION chronelle_user_preferences_update(user_id uuid, preferences jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current users%ROWTYPE;
  updated users%ROWTYPE;
  next_locale text;
  next_time_zone text;
  next_hour_cycle text;
  next_week_start smallint;
  next_rail jsonb;
  next_event_tabs jsonb;
  next_workspace_recency jsonb;
  tab_entry record;
  recency_entry record;
BEGIN
  IF preferences IS NULL OR jsonb_typeof(preferences) <> 'object' THEN
    RAISE EXCEPTION 'preferences is an object.' USING ERRCODE = 'PT422';
  END IF;
  SELECT * INTO current FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;

  next_locale := current.locale;
  IF preferences ? 'locale' THEN
    IF jsonb_typeof(preferences->'locale') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'locale is a language tag.' USING ERRCODE = 'PT422';
    END IF;
    next_locale := preferences->>'locale';
    IF next_locale IS NOT NULL AND next_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' THEN
      RAISE EXCEPTION 'locale is a language tag.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_time_zone := current.time_zone;
  IF preferences ? 'time_zone' THEN
    IF jsonb_typeof(preferences->'time_zone') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'time_zone is an IANA zone name.' USING ERRCODE = 'PT422';
    END IF;
    next_time_zone := preferences->>'time_zone';
    IF next_time_zone IS NOT NULL AND next_time_zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' THEN
      RAISE EXCEPTION 'time_zone is an IANA zone name.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_hour_cycle := current.hour_cycle;
  IF preferences ? 'hour_cycle' THEN
    IF jsonb_typeof(preferences->'hour_cycle') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'hour_cycle is h12 or h23.' USING ERRCODE = 'PT422';
    END IF;
    next_hour_cycle := preferences->>'hour_cycle';
    IF next_hour_cycle IS NOT NULL AND next_hour_cycle NOT IN ('h12', 'h23') THEN
      RAISE EXCEPTION 'hour_cycle is h12 or h23.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_week_start := current.week_start;
  IF preferences ? 'week_start' THEN
    IF jsonb_typeof(preferences->'week_start') NOT IN ('null', 'number') THEN
      RAISE EXCEPTION 'week_start is 1 (Monday) or 7 (Sunday).' USING ERRCODE = 'PT422';
    END IF;
    IF jsonb_typeof(preferences->'week_start') = 'null' THEN
      next_week_start := NULL;
    ELSIF (preferences->>'week_start') IN ('1', '7') THEN
      next_week_start := (preferences->>'week_start')::smallint;
    ELSE
      RAISE EXCEPTION 'week_start is 1 (Monday) or 7 (Sunday).' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_rail := current.rail;
  IF preferences ? 'rail' THEN
    IF jsonb_typeof(preferences->'rail') = 'null' THEN
      next_rail := '{}'::jsonb;
    ELSIF jsonb_typeof(preferences->'rail') = 'object'
      AND (NOT (preferences->'rail') ? 'order' OR jsonb_typeof(preferences->'rail'->'order') = 'array')
      AND (NOT (preferences->'rail') ? 'hidden' OR jsonb_typeof(preferences->'rail'->'hidden') = 'array')
      AND NOT jsonb_path_exists(preferences->'rail', '$.order[*] ? (@.type() != "string")')
      AND NOT jsonb_path_exists(preferences->'rail', '$.hidden[*] ? (@.type() != "string")')
      AND NOT jsonb_path_exists(preferences->'rail', '$.order[50]')
      AND NOT jsonb_path_exists(preferences->'rail', '$.hidden[50]')
    THEN
      next_rail := preferences->'rail';
    ELSE
      RAISE EXCEPTION 'rail is an object with order and hidden lists of collection keys.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_event_tabs := current.event_tabs;
  IF preferences ? 'event_tabs' THEN
    IF jsonb_typeof(preferences->'event_tabs') <> 'object' THEN
      RAISE EXCEPTION 'event_tabs is an object keyed by event id.' USING ERRCODE = 'PT422';
    END IF;
    FOR tab_entry IN SELECT key, value FROM jsonb_each(preferences->'event_tabs') LOOP
      IF tab_entry.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'event_tabs is keyed by event id.' USING ERRCODE = 'PT422';
      END IF;
      IF jsonb_typeof(tab_entry.value) = 'null' THEN
        next_event_tabs := next_event_tabs - tab_entry.key;
      ELSIF jsonb_typeof(tab_entry.value) = 'object'
        AND (NOT tab_entry.value ? 'order' OR jsonb_typeof(tab_entry.value->'order') = 'array')
        AND (NOT tab_entry.value ? 'hidden' OR jsonb_typeof(tab_entry.value->'hidden') = 'array')
        AND (NOT tab_entry.value ? 'removed' OR jsonb_typeof(tab_entry.value->'removed') = 'array')
        AND NOT jsonb_path_exists(tab_entry.value, '$.order[*] ? (@.type() != "string")')
        AND NOT jsonb_path_exists(tab_entry.value, '$.hidden[*] ? (@.type() != "string")')
        AND NOT jsonb_path_exists(tab_entry.value, '$.removed[*] ? (@.type() != "string")')
        AND NOT jsonb_path_exists(tab_entry.value, '$.order[40]')
        AND NOT jsonb_path_exists(tab_entry.value, '$.hidden[40]')
        AND NOT jsonb_path_exists(tab_entry.value, '$.removed[40]')
      THEN
        next_event_tabs := jsonb_set(next_event_tabs, ARRAY[tab_entry.key], tab_entry.value, true);
      ELSE
        RAISE EXCEPTION 'An event''s tabs are an object with order, hidden, and removed lists of keys.' USING ERRCODE = 'PT422';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM jsonb_object_keys(next_event_tabs)) > 200 THEN
      RAISE EXCEPTION 'Tabs are kept for up to 200 events.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  next_workspace_recency := current.workspace_recency;
  IF preferences ? 'workspace_recency' THEN
    IF jsonb_typeof(preferences->'workspace_recency') <> 'object' THEN
      RAISE EXCEPTION 'workspace_recency is an object keyed by workspace id.' USING ERRCODE = 'PT422';
    END IF;
    FOR recency_entry IN SELECT key, value FROM jsonb_each(preferences->'workspace_recency') LOOP
      IF recency_entry.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'workspace_recency is keyed by workspace id.' USING ERRCODE = 'PT422';
      END IF;
      IF jsonb_typeof(recency_entry.value) = 'null' THEN
        next_workspace_recency := next_workspace_recency - recency_entry.key;
      ELSIF jsonb_typeof(recency_entry.value) = 'string'
        AND (recency_entry.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$'
      THEN
        next_workspace_recency := jsonb_set(next_workspace_recency, ARRAY[recency_entry.key], recency_entry.value, true);
      ELSE
        RAISE EXCEPTION 'A workspace''s opened-at is an ISO 8601 instant.' USING ERRCODE = 'PT422';
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM jsonb_object_keys(next_workspace_recency)) > 50 THEN
      SELECT coalesce(jsonb_object_agg(kept.key, kept.value), '{}'::jsonb)
      INTO next_workspace_recency
      FROM (
        SELECT key, value
        FROM jsonb_each(next_workspace_recency)
        ORDER BY (value #>> '{}')::timestamptz DESC, key
        LIMIT 50
      ) AS kept;
    END IF;
  END IF;

  UPDATE users u
  SET locale = next_locale,
      time_zone = next_time_zone,
      hour_cycle = next_hour_cycle,
      week_start = next_week_start,
      rail = next_rail,
      event_tabs = next_event_tabs,
      workspace_recency = next_workspace_recency,
      updated_at = GREATEST(now(), u.created_at)
  WHERE u.id = user_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END
$$;
