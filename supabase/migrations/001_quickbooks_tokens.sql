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
