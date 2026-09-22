\set ON_ERROR_STOP on
\set ECHO none
\set runtime_role chronelle_runtime
\set runtime_password ''
\set owner_password ''
\getenv runtime_role CHRONELLE_RUNTIME_ROLE
\getenv runtime_password RUNTIME_DATABASE_PASSWORD
\getenv owner_password PGPASSWORD

BEGIN;
SET LOCAL search_path = pg_catalog, public;

SELECT current_database() AS database_name,
       :'runtime_role' ~ '^chronelle_runtime(_[a-z0-9]+)?$'
       AND length(:'runtime_role') <= 63
       AND :'runtime_password' ~ '^[A-Za-z0-9_-]{24,128}$'
       AND :'runtime_password' <> :'owner_password' AS valid_settings
\gset
\if :valid_settings
\else
DO $$ BEGIN RAISE EXCEPTION 'Invalid runtime role or password configuration'; END $$;
\endif

SELECT set_config('chronelle.runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO runtime FROM pg_roles
    WHERE rolname = current_setting('chronelle.runtime_role');
  IF FOUND AND (
    NOT runtime.rolcanlogin OR runtime.rolinherit OR runtime.rolsuper
    OR runtime.rolcreatedb OR runtime.rolcreaterole OR runtime.rolreplication
    OR runtime.rolbypassrls
    OR EXISTS (SELECT FROM pg_auth_members WHERE member = runtime.oid)
    OR EXISTS (SELECT FROM pg_db_role_setting WHERE setrole = runtime.oid)
    OR EXISTS (SELECT FROM pg_shdepend
      WHERE refclassid = 'pg_authid'::regclass AND refobjid = runtime.oid
        AND (deptype = 'o' OR (deptype = 'a' AND dbid = 0
          AND NOT (classid = 'pg_database'::regclass AND objid =
            (SELECT oid FROM pg_database WHERE datname = current_database())))))
  ) THEN
    RAISE EXCEPTION 'Runtime role must be an unprivileged login without membership or ownership, role settings, or external cluster grants';
  END IF;
END $$;

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_role'
) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

-- This policy is for a dedicated Chronelle database, not a shared application schema.
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC, :"runtime_role";
GRANT CONNECT ON DATABASE :"database_name" TO :"runtime_role";
REVOKE ALL ON SCHEMA public FROM PUBLIC, :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, :"runtime_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, :"runtime_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, :"runtime_role";

-- Table-level revocation does not remove separately granted column privileges.
SELECT format('REVOKE ALL (%s) ON %s FROM PUBLIC, %I',
  string_agg(format('%I', attname), ', '), attrelid::regclass, :'runtime_role')
FROM pg_attribute JOIN pg_class ON pg_class.oid = attrelid
WHERE relnamespace = 'public'::regnamespace AND attnum > 0
  AND NOT attisdropped AND attacl IS NOT NULL
GROUP BY attrelid
\gexec

GRANT SELECT, INSERT ON
  public.users, public.documents, public.audit_events, public.object_revisions,
  public.event_context_commands, public.object_create_commands, public.reversible_commands,
  public.command_changes, public.command_receipts, public.event_page_revisions,
  public.person_contacts, public.person_labels, public.identity_exchanges
TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON
  public.workspaces, public.workspace_members, public.objects,
  public.object_relations, public.resource_grants, public.events, public.tasks,
  public.expenses, public.reminders, public.document_transfer_authorizations,
  public.command_stacks, public.user_sessions, public.user_credentials,
  public.email_verifications, public.labels, public.task_labels,
  public.persons, public.user_connections, public.user_invitations, public.pending_shares,
  public.notes, public.sections, public.user_identities
TO :"runtime_role";
GRANT DELETE ON public.resource_grants, public.labels, public.task_labels,
  public.person_contacts, public.person_labels, public.workspace_members, public.sections
TO :"runtime_role";

-- New tables and functions require an explicit runtime privilege review.
-- Find people runs on the PostgreSQL path with the folded name and the
-- trigram similarity: the fold function and the extension functions
-- behind it and the % operator.
GRANT EXECUTE ON FUNCTION
  public.chronelle_search_fold(text),
  public.unaccent(text),
  public.unaccent(regdictionary, text),
  public.similarity(text, text),
  public.similarity_op(text, text)
  TO :"runtime_role";

ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, :"runtime_role";

SELECT format('ALTER ROLE %I PASSWORD %L', :'runtime_role', :'runtime_password')
\gexec
COMMIT;
