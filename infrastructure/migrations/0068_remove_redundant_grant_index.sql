-- The scoped uniqueness constraint begins with these same four columns.
-- It serves resource/principal lookups as well as enforcing scoped uniqueness.
DROP INDEX resource_grants_resource_principal_idx;
