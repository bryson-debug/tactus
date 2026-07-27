-- Logs Flodesk webhook events for both new subscribers and unsubscribes.
-- Flodesk's REST API has no created_at/date-range filter on its subscribers
-- list (so growth can't be queried directly for an arbitrary period, and
-- live-paginating the whole list doesn't fit Vercel's 10-second function
-- limit once an account has more than a few thousand subscribers -- proven
-- in production, not theoretical) and no unsubscribed_at field or
-- historical event log at all. Both growth and churn are computed from
-- this table instead, populated in real time by api/flodesk/webhook.js --
-- see lib/flodesk-client.js. Both numbers are only real from whenever the
-- webhook was registered onward; there is no historical backfill.
create table if not exists flodesk_subscriber_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('created', 'unsubscribed')),
  subscriber_id text,
  email text,
  event_time timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists flodesk_subscriber_events_type_time_idx
  on flodesk_subscriber_events (event_type, event_time);
