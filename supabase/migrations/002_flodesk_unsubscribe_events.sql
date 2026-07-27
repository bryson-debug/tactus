-- Logs each "subscriber.unsubscribed" webhook event received from Flodesk.
-- Flodesk's REST API has no unsubscribed_at field on the subscriber record
-- and no historical event log -- the ONLY way to compute "how many people
-- unsubscribed in period X" is to capture these events ourselves as they
-- happen, going forward from whenever the webhook is registered. See
-- lib/flodesk-client.js / lib/flodesk-webhook-store.js.
create table if not exists flodesk_unsubscribe_events (
  id bigint generated always as identity primary key,
  subscriber_id text,
  email text,
  event_time timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists flodesk_unsubscribe_events_event_time_idx
  on flodesk_unsubscribe_events (event_time);
