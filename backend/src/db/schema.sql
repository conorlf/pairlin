create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  real_email text not null,
  platform_email_alias text unique not null,
  name text,
  delivery_address jsonb,
  excess_tolerance numeric(8,2) default 10.00,
  mollie_customer_id text,
  created_at timestamptz default now()
);

create table if not exists retailers (
  domain text primary key,
  ioss_status text check (ioss_status in ('ioss','not_ioss','unknown')) default 'unknown',
  ioss_confidence int,
  last_checked timestamptz,
  hs_codes jsonb
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  retailer_domain text,
  retailer_url text,
  split_group_id uuid,
  split_index smallint,
  ioss_protection boolean default false,
  items_json jsonb not null default '[]',
  basket_value_eur numeric(10,2),
  estimated_duty numeric(10,2),
  estimated_vat numeric(10,2),
  estimated_courier_handling numeric(10,2),
  service_fee numeric(10,2),
  total_collected numeric(10,2),
  actual_customs_charge numeric(10,2),
  surplus_refunded boolean default false,
  status text default 'awaiting_payment' check (status in (
    'awaiting_payment','checkout_in_progress','in_transit',
    'customs_hold','customs_paid','delivered','manual_review'
  )),
  tracking_number text,
  retailer_order_ref text,
  mollie_payment_id text,
  mollie_refund_id text,
  created_at timestamptz default now()
);

create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  order_id uuid references orders(id),
  from_address text,
  subject text,
  type text check (type in ('order_confirmation','shipping','customs','other')),
  received_at timestamptz default now(),
  forwarded_at timestamptz,
  raw_content text
);

create table if not exists customs_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  courier text,
  charge_amount numeric(10,2),
  currency text default 'EUR',
  payment_url text,
  deadline timestamptz,
  within_tolerance boolean,
  paid_at timestamptz,
  confirmation_ref text,
  platform_card_last4 text
);

-- RLS
alter table users enable row level security;
alter table orders enable row level security;
alter table emails enable row level security;
alter table customs_events enable row level security;

create policy "users_own" on users for all using (auth.uid() = id);
create policy "orders_own" on orders for all using (auth.uid() = user_id);
create policy "emails_own" on emails for all using (auth.uid() = user_id);
create policy "customs_events_own" on customs_events
  for all using (
    order_id in (select id from orders where user_id = auth.uid())
  );
