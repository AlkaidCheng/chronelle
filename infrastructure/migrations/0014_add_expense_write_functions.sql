-- Expense create and update as database functions on the shared object write
-- core of migration 0013. The family supplies the typed steps the core
-- resolves by name; authorization, the objects row, the version predicate,
-- the audit event, and the revision snapshot are the core's.
--
-- amount travels as text in both directions: the service validates the
-- decimal notation before the numeric(19,4) cast, and the serialized snapshot
-- and the returned row carry the column's canonical text so the adapter never
-- parses a JSON number.

-- The service's assertExpenseState(), in the same order with the same messages.
CREATE FUNCTION chronelle_assert_expense_state(amount text, currency text, occurred_at timestamptz)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF amount IS NULL OR amount !~ '^-?\d{1,15}(\.\d{1,4})?$' THEN
    RAISE EXCEPTION 'amount must fit numeric(19,4) decimal notation.' USING ERRCODE = 'PT422';
  END IF;
  IF currency IS NULL OR currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must contain three uppercase letters.' USING ERRCODE = 'PT422';
  END IF;
  IF occurred_at IS NULL THEN
    RAISE EXCEPTION 'occurredAt must be a valid date.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE FUNCTION chronelle_expense_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'expense',
    'amount', e.amount::text,
    'currency', e.currency,
    'occurredAt', chronelle_iso(e.occurred_at)
  )
  FROM expenses e
  WHERE e.workspace_id = $1 AND e.object_id = $2;
$$;

CREATE FUNCTION chronelle_expense_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'object', to_jsonb(o),
    'expense', to_jsonb(e) || jsonb_build_object('amount', e.amount::text)
  )
  FROM objects o
  JOIN expenses e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE FUNCTION chronelle_expense_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  amount text := input ->> 'amount';
  currency text := input ->> 'currency';
  occurred_at timestamptz := chronelle_instant(input -> 'occurredAt', 'occurredAt');
BEGIN
  PERFORM chronelle_assert_expense_state(amount, currency, occurred_at);
  INSERT INTO expenses (object_id, workspace_id, amount, currency, occurred_at)
  VALUES (object_id, workspace_id, amount::numeric, currency, occurred_at);
END
$$;

CREATE FUNCTION chronelle_expense_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_expense expenses%ROWTYPE;
BEGIN
  SELECT * INTO current_expense FROM expenses e
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
  PERFORM chronelle_assert_expense_state(
    COALESCE(changes ->> 'amount', current_expense.amount::text),
    COALESCE(changes ->> 'currency', current_expense.currency),
    COALESCE(chronelle_instant(changes -> 'occurredAt', 'occurredAt'), current_expense.occurred_at)
  );
END
$$;

CREATE FUNCTION chronelle_expense_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE expenses e
  SET amount = COALESCE((changes ->> 'amount')::numeric, e.amount),
      currency = COALESCE(changes ->> 'currency', e.currency),
      occurred_at = COALESCE(chronelle_instant(changes -> 'occurredAt', 'occurredAt'), e.occurred_at)
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
END
$$;

CREATE FUNCTION chronelle_expense_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_create($1, $2, $3, 'expense', $4);
$$;

CREATE FUNCTION chronelle_expense_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'expense', $4, $5, $6, $7);
$$;
