-- Single-row table holding the current QuickBooks Online OAuth connection.
-- id is always 1 -- there is only ever one QBO company connected to this
-- dashboard. See lib/quickbooks-token-store.js for reads/writes.
create table if not exists quickbooks_tokens (
  id integer primary key default 1,
  access_token text not null,
  refresh_token text not null,
  realm_id text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint quickbooks_tokens_single_row check (id = 1)
);

-- Flagged by Supabase's security advisor: RLS was disabled, exposing
-- access_token/refresh_token (live OAuth credentials) via the public REST
-- API to anyone with the project URL. The app only ever reads/writes this
-- table via the service_role key (lib/supabase-client.js), which bypasses
-- RLS regardless of policies -- so enabling RLS with no policies blocks all
-- other API access without breaking the app itself.
alter table quickbooks_tokens enable row level security;
