# Migrations

`docs/schema.sql` is the authoritative shape and is **migration 0001**. Apply it
first to an empty project.

Files here are deltas against a database that has already run everything before
them. They exist because the schema is expected to change after a project is
provisioned, and at that point editing `schema.sql` alone stops being enough.

`schema.sql` always reflects the full current shape, so a fresh project needs
`schema.sql` and nothing else. An existing one needs the numbered files it has
not run yet.
