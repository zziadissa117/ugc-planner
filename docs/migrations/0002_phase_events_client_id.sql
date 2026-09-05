-- 0002 - make pushing a phase_event idempotent.
--
-- Apply only to a database that has already run schema.sql (migration 0001)
-- WITHOUT this column. A project provisioned from the current schema.sql
-- already has it and must skip this file.
--
-- Why: phase_events.id is a bigserial, so it is assigned by whichever database
-- inserts the row. The local id is a client-side sequence and means nothing on
-- the server, so a push sends the row without an id. That makes the push
-- non-idempotent: if it succeeds but the response is lost, the retry inserts
-- the same event a second time.
--
-- Duplicated events are not a cosmetic problem. phase_events is the only source
-- of MEASURED timings, and it is append-only precisely so that history cannot
-- be edited to cover a mistake. A duplicate silently biases every derived
-- figure and there is nothing that could later tell it apart from a real event.
--
-- With a client-minted key, the retry breaks the unique constraint instead, and
-- the sync target reads that as "already applied".

alter table phase_events
  add column if not exists client_id uuid not null default gen_random_uuid();

-- Scoped to the user, matching every other constraint in this schema: two
-- accounts cannot collide with each other, and RLS keeps them apart anyway.
alter table phase_events
  add constraint phase_events_user_client_id_unique unique (user_id, client_id);
