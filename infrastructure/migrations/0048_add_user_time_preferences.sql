-- A user keeps how dates and times are shown beside the language from 0047:
-- `time_zone`, an IANA zone name or NULL for the device's zone; `hour_cycle`,
-- 'h12' or 'h23' or NULL to follow the language; `week_start`, 1 (Monday) or
-- 7 (Sunday) or NULL to follow the language. The user row is serialized whole
-- by every identity, session, and credential function, so the columns reach
-- sign-in, session, and account responses on the rpc path as they do through
-- Drizzle.
--
-- chronelle_user_preferences_update replaces chronelle_user_locale_update as
-- the one rpc write for account preferences: it merges the keys present in
-- `preferences` (locale, time_zone, hour_cycle, week_start; a JSON null
-- clears the key) into the row, validates each one the way the constraints
-- do, and returns the updated row. Absent keys keep their values.
ALTER TABLE users ADD COLUMN time_zone text;
ALTER TABLE users ADD COLUMN hour_cycle text;
ALTER TABLE users ADD COLUMN week_start smallint;
ALTER TABLE users ADD CONSTRAINT users_time_zone_is_iana_name
  CHECK (time_zone IS NULL OR time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$');
ALTER TABLE users ADD CONSTRAINT users_hour_cycle_is_known
  CHECK (hour_cycle IS NULL OR hour_cycle IN ('h12', 'h23'));
ALTER TABLE users ADD CONSTRAINT users_week_start_is_monday_or_sunday
  CHECK (week_start IS NULL OR week_start IN (1, 7));

DROP FUNCTION chronelle_user_locale_update(uuid, text);

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

  UPDATE users u
  SET locale = next_locale,
      time_zone = next_time_zone,
      hour_cycle = next_hour_cycle,
      week_start = next_week_start,
      updated_at = GREATEST(now(), u.created_at)
  WHERE u.id = user_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END
$$;
