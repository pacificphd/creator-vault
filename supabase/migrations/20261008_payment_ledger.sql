-- Accurate payment ledger support for Creator Vault analytics
create table if not exists orders (id uuid primary key default gen_random_uuid(), user_id uuid references profiles(id), email text not null, amount integer not null, status text default 'pending' check(status in ('pending','paid','failed','refunded')), payment_provider text default 'razorpay', provider_order_id text, provider_payment_id text, created_at timestamptz default now());
create table if not exists order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade, product_id uuid not null references products(id), price integer not null);
create unique index if not exists orders_provider_order_id_uq on orders(provider_order_id) where provider_order_id is not null;
create unique index if not exists order_items_order_product_uq on order_items(order_id,product_id);
alter table orders enable row level security;
alter table order_items enable row level security;
do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='own orders') then create policy "own orders" on orders for select using (auth.uid()=user_id); end if;
end $$;
