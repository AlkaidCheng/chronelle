-- A user keeps how the workspace rail lists its collections: `rail` is an
-- object with an optional `order` (collection keys, first to last) and an
-- optional `hidden` (collection keys left out of the rail), both arrays of
-- strings; `{}` is the default order with nothing hidden. Keys the web app
-- does not know are kept as given and ignored on read, so a collection that
-- ships later appends in its default place. The user row is serialized whole
-- by every identity, session, and credential function, so the column reaches
-- sign-in, session, and account responses on the rpc path as it does through
-- Drizzle.
--
-- chronelle_user_preferences_update (0048) is redefined with `rail` among the
-- keys it merges: an object replaces the stored rail, a JSON null resets it
-- to `{}`, and any other shape is refused. The other keys keep 0048's rules.
ALTER TABLE users ADD COLUMN rail jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD CONSTRAINT users_rail_is_order_and_hidden_lists
  CHECK (
    jsonb_typeof(rail) = 'object'
    AND (NOT rail ? 'order' OR jsonb_typeof(rail->'order') = 'array')
    AND (NOT rail ? 'hidden' OR jsonb_typeof(rail->'hidden') = 'array')
    AND NOT jsonb_path_exists(rail, '$.order[*] ? (@.type() != "string")')
    AND NOT jsonb_path_exists(rail, '$.hidden[*] ? (@.type() != "string")')
    AND NOT jsonb_path_exists(rail, '$.order[50]')
    AND NOT jsonb_path_exists(rail, '$.hidden[50]')
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

  UPDATE users u
  SET locale = next_locale,
      time_zone = next_time_zone,
      hour_cycle = next_hour_cycle,
      week_start = next_week_start,
      rail = next_rail,
      updated_at = GREATEST(now(), u.created_at)
  WHERE u.id = user_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END
$$;
