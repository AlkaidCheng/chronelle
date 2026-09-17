-- A user keeps the language they chose: `locale`, a BCP 47 language tag or
-- NULL for no choice. The shape is checked, not the value, so a language the
-- application adds later needs no migration. The user row is serialized whole
-- by every identity, session, and credential function, so the column reaches
-- sign-in, session, and account responses on the rpc path as it does through
-- Drizzle. chronelle_user_locale_update is the rpc write.
ALTER TABLE users ADD COLUMN locale text;
ALTER TABLE users ADD CONSTRAINT users_locale_is_language_tag
  CHECK (locale IS NULL OR locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

CREATE FUNCTION chronelle_user_locale_update(user_id uuid, locale text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated users%ROWTYPE;
BEGIN
  IF locale IS NOT NULL AND locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' THEN
    RAISE EXCEPTION 'locale is a language tag.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE users u
  SET locale = locale, updated_at = GREATEST(now(), u.created_at)
  WHERE u.id = user_id
  RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  RETURN to_jsonb(updated);
END
$$;
