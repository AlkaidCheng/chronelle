-- A Person carries a nickname (the name shown when present), a description,
-- typed contacts (email, phone, other) in the order kept, and labels from
-- the workspace's label vocabulary. Contacts live in person_contacts;
-- persons.email stays for one release as the first email contact, kept in
-- step by the write functions, so sharing by a Person's email and the
-- account link rules of migration 0037 are unchanged. Labels join through
-- person_labels the way task_labels joins Tasks (migration 0036). The
-- Person step functions are replaced in place; chronelle_person_create and
-- chronelle_person_update keep their signatures, so the runtime role needs
-- only the new tables.
ALTER TABLE persons
  ADD COLUMN nickname text,
  ADD COLUMN description text,
  ADD CONSTRAINT persons_nickname_trimmed
    CHECK (nickname IS NULL OR (nickname = btrim(nickname) AND nickname <> '' AND length(nickname) <= 240)),
  ADD CONSTRAINT persons_description_trimmed
    CHECK (description IS NULL OR (description = btrim(description) AND description <> '' AND length(description) <= 2000));

CREATE TABLE person_contacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(object_id) ON DELETE CASCADE,
  kind text NOT NULL,
  value text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT person_contacts_kind_valid CHECK (kind IN ('email', 'phone', 'other')),
  CONSTRAINT person_contacts_value_trimmed
    CHECK (value = btrim(value) AND value <> '' AND length(value) <= 254),
  CONSTRAINT person_contacts_position_valid CHECK (position >= 0),
  CONSTRAINT person_contacts_position_unique UNIQUE (person_id, position)
);
CREATE INDEX person_contacts_person_idx ON person_contacts (workspace_id, person_id);

CREATE TABLE person_labels (
  workspace_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(object_id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, label_id)
);
CREATE INDEX person_labels_label_idx ON person_labels (workspace_id, label_id);

INSERT INTO person_contacts (id, workspace_id, person_id, kind, value, position)
SELECT chronelle_uuidv7(), p.workspace_id, p.object_id, 'email', p.email, 0
FROM persons p
WHERE p.email IS NOT NULL;

-- The service's assertPersonContacts(), with the same messages: a list of
-- at most twenty {kind, value} entries, each value trimmed and non-empty,
-- an email entry a valid address.
CREATE FUNCTION chronelle_assert_person_contacts(contacts jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  entry jsonb;
  kind text;
  value text;
BEGIN
  IF contacts IS NULL OR jsonb_typeof(contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts must be a list of {kind, value} entries.' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_array_length(contacts) > 20 THEN
    RAISE EXCEPTION 'contacts holds at most 20 entries.' USING ERRCODE = 'PT422';
  END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(contacts) LOOP
    IF jsonb_typeof(entry) <> 'object' THEN
      RAISE EXCEPTION 'contacts must be a list of {kind, value} entries.' USING ERRCODE = 'PT422';
    END IF;
    kind := entry ->> 'kind';
    value := entry ->> 'value';
    IF kind IS NULL OR kind NOT IN ('email', 'phone', 'other') THEN
      RAISE EXCEPTION 'A contact kind is email, phone, or other.' USING ERRCODE = 'PT422';
    END IF;
    IF kind = 'email' THEN
      IF value IS NULL OR value <> btrim(value) OR length(value) < 3 OR length(value) > 254 OR position('@' IN value) < 2 THEN
        RAISE EXCEPTION 'email must be a valid address.' USING ERRCODE = 'PT422';
      END IF;
    ELSIF value IS NULL OR value <> btrim(value) OR value = '' OR length(value) > 254 THEN
      RAISE EXCEPTION 'A contact value is 1 to 254 characters without surrounding spaces.' USING ERRCODE = 'PT422';
    END IF;
  END LOOP;
END
$$;

-- The service's assertPersonText(), with the same messages.
CREATE FUNCTION chronelle_assert_person_text(nickname text, description text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF nickname IS NOT NULL AND (nickname <> btrim(nickname) OR nickname = '' OR length(nickname) > 240) THEN
    RAISE EXCEPTION 'nickname is 1 to 240 characters without surrounding spaces.' USING ERRCODE = 'PT422';
  END IF;
  IF description IS NOT NULL AND (description <> btrim(description) OR description = '' OR length(description) > 2000) THEN
    RAISE EXCEPTION 'description is 1 to 2000 characters without surrounding spaces.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- A Person's contacts in kept order, as the API serializes them.
CREATE FUNCTION chronelle_person_contacts(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value) ORDER BY c.position), '[]'::jsonb)
  FROM person_contacts c
  WHERE c.workspace_id = $1 AND c.person_id = $2;
$$;

-- The first email contact, which persons.email mirrors.
CREATE FUNCTION chronelle_person_first_email(contacts jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT entry ->> 'value'
  FROM jsonb_array_elements(contacts) WITH ORDINALITY AS entries(entry, position)
  WHERE entry ->> 'kind' = 'email'
  ORDER BY position
  LIMIT 1;
$$;

-- A legacy `email` change as a contact list: the address first, then the
-- non-email contacts already kept; null removes the email contacts.
CREATE FUNCTION chronelle_person_contacts_with_email(workspace_id uuid, object_id uuid, email text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT (CASE WHEN $3 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('kind', 'email', 'value', $3)) END)
    || COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value) ORDER BY c.position)
      FROM person_contacts c
      WHERE c.workspace_id = $1 AND c.person_id = $2 AND c.kind <> 'email'
    ), '[]'::jsonb);
$$;

-- The contacts a create or update asks for: `contacts` as given, else a
-- legacy `email` folded into the kept contacts, else null for unchanged.
CREATE FUNCTION chronelle_person_requested_contacts(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN $3 ? 'contacts' THEN $3 -> 'contacts'
    WHEN $3 ? 'email' THEN chronelle_person_contacts_with_email($1, $2, $3 ->> 'email')
    ELSE NULL
  END;
$$;

-- Replaces a Person's contacts and keeps persons.email as the first email.
CREATE FUNCTION chronelle_person_set_contacts(workspace_id uuid, object_id uuid, contacts jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  PERFORM chronelle_assert_person_contacts(contacts);
  DELETE FROM person_contacts c WHERE c.workspace_id = workspace_id AND c.person_id = object_id;
  INSERT INTO person_contacts (id, workspace_id, person_id, kind, value, position)
  SELECT chronelle_uuidv7(), workspace_id, object_id, entry ->> 'kind', entry ->> 'value', position - 1
  FROM jsonb_array_elements(contacts) WITH ORDINALITY AS entries(entry, position);
  UPDATE persons p SET email = chronelle_person_first_email(contacts)
  WHERE p.workspace_id = workspace_id AND p.object_id = object_id;
END
$$;

-- A Person's labels in name order, as the API serializes them.
CREATE FUNCTION chronelle_person_label_ids(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(l.id::text ORDER BY lower(l.name), l.id), '[]'::jsonb)
  FROM person_labels pl
  JOIN labels l ON l.id = pl.label_id
  WHERE pl.workspace_id = $1 AND pl.person_id = $2;
$$;

-- Replaces a Person's labels with the given set; every id must be a label of
-- the workspace, with the service's message.
CREATE FUNCTION chronelle_person_set_labels(workspace_id uuid, object_id uuid, label_ids jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  ids uuid[];
BEGIN
  IF label_ids IS NULL OR jsonb_typeof(label_ids) <> 'array' THEN
    RAISE EXCEPTION 'labelIds must be a list of label IDs.' USING ERRCODE = 'PT422';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT (value #>> '{}')::uuid), '{}') INTO ids
  FROM jsonb_array_elements(label_ids) AS value;
  IF EXISTS (
    SELECT 1 FROM unnest(ids) AS wanted(id)
    WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.workspace_id = workspace_id AND l.id = wanted.id)
  ) THEN
    RAISE EXCEPTION 'labelIds must name labels of this workspace.' USING ERRCODE = 'PT422';
  END IF;
  DELETE FROM person_labels pl WHERE pl.workspace_id = workspace_id AND pl.person_id = object_id;
  INSERT INTO person_labels (workspace_id, person_id, label_id)
  SELECT workspace_id, object_id, wanted.id FROM unnest(ids) AS wanted(id);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_person_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'person',
    'userId', p.user_id::text,
    'email', p.email,
    'nickname', p.nickname,
    'description', p.description,
    'contacts', chronelle_person_contacts($1, $2),
    'labelIds', chronelle_person_label_ids($1, $2)
  )
  FROM persons p
  WHERE p.workspace_id = $1 AND p.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_person_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'object', to_jsonb(o),
    'person', to_jsonb(p),
    'contacts', chronelle_person_contacts($1, $2),
    'labels', chronelle_person_label_ids($1, $2)
  )
  FROM objects o
  JOIN persons p ON p.workspace_id = o.workspace_id AND p.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_person_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  user_id uuid := (input ->> 'userId')::uuid;
  nickname text := input ->> 'nickname';
  description text := input ->> 'description';
  contacts jsonb := COALESCE(chronelle_person_requested_contacts(workspace_id, object_id, input), '[]'::jsonb);
BEGIN
  PERFORM chronelle_assert_person_contacts(contacts);
  PERFORM chronelle_assert_person_text(nickname, description);
  PERFORM chronelle_assert_person_state(workspace_id, object_id, user_id, chronelle_person_first_email(contacts));
  INSERT INTO persons (object_id, workspace_id, user_id, email, nickname, description)
  VALUES (object_id, workspace_id, user_id, NULL, nickname, description);
  PERFORM chronelle_person_set_contacts(workspace_id, object_id, contacts);
  IF input ? 'labelIds' THEN
    PERFORM chronelle_person_set_labels(workspace_id, object_id, input -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_person_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_person persons%ROWTYPE;
  contacts jsonb := chronelle_person_requested_contacts(workspace_id, object_id, changes);
BEGIN
  SELECT * INTO current_person FROM persons p
  WHERE p.workspace_id = workspace_id AND p.object_id = object_id;
  IF contacts IS NOT NULL THEN
    PERFORM chronelle_assert_person_contacts(contacts);
  END IF;
  PERFORM chronelle_assert_person_text(
    CASE WHEN changes ? 'nickname' THEN changes ->> 'nickname' ELSE current_person.nickname END,
    CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE current_person.description END
  );
  PERFORM chronelle_assert_person_state(
    workspace_id,
    object_id,
    CASE WHEN changes ? 'userId' THEN (changes ->> 'userId')::uuid ELSE current_person.user_id END,
    CASE WHEN contacts IS NULL THEN current_person.email ELSE chronelle_person_first_email(contacts) END
  );
END
$$;

CREATE OR REPLACE FUNCTION chronelle_person_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  contacts jsonb := chronelle_person_requested_contacts(workspace_id, object_id, changes);
BEGIN
  UPDATE persons p
  SET user_id = CASE WHEN changes ? 'userId' THEN (changes ->> 'userId')::uuid ELSE p.user_id END,
      nickname = CASE WHEN changes ? 'nickname' THEN changes ->> 'nickname' ELSE p.nickname END,
      description = CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE p.description END
  WHERE p.workspace_id = workspace_id AND p.object_id = object_id;
  IF contacts IS NOT NULL THEN
    PERFORM chronelle_person_set_contacts(workspace_id, object_id, contacts);
  END IF;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_person_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;
