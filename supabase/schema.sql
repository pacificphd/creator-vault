-- Creator Vault database schema (Supabase/Postgres)
create extension if not exists pgcrypto;
create table if not exists profiles (id uuid primary key, email text unique, full_name text, role text default 'customer' check(role in ('customer','admin')), created_at timestamptz default now());
create table if not exists categories (id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique, active boolean default true);
create table if not exists products (id uuid primary key default gen_random_uuid(), category_id uuid references categories(id), name text not null, slug text not null unique, description text, price integer not null check(price>=0), compare_price integer, compatibility text, file_size text, thumbnail_path text, active boolean default true, lifetime_updates boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists product_files (id uuid primary key default gen_random_uuid(), product_id uuid not null references products(id) on delete cascade, version text not null, storage_path text not null, is_current boolean default true, created_at timestamptz default now());
create table if not exists orders (id uuid primary key default gen_random_uuid(), user_id uuid references profiles(id), email text not null, amount integer not null, status text default 'pending' check(status in ('pending','paid','failed','refunded')), payment_provider text default 'razorpay', provider_order_id text, provider_payment_id text, created_at timestamptz default now());
create table if not exists order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade, product_id uuid not null references products(id), price integer not null);
create table if not exists purchases (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), product_id uuid not null references products(id), order_id uuid references orders(id), granted_at timestamptz default now(), unique(user_id,product_id));
create table if not exists coupons (id uuid primary key default gen_random_uuid(), code text not null unique, discount_type text check(discount_type in ('percent','fixed')), value numeric not null, active boolean default true, expires_at timestamptz);
create table if not exists banners (id uuid primary key default gen_random_uuid(), title text not null, subtitle text, image_path text, link text, sort_order integer default 0, active boolean default true, starts_at timestamptz, ends_at timestamptz);
create table if not exists download_events (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), product_id uuid not null references products(id), created_at timestamptz default now());

alter table profiles enable row level security;
alter table purchases enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table product_files enable row level security;
create policy "own profile" on profiles for select using (auth.uid()=id);
create policy "own purchases" on purchases for select using (auth.uid()=user_id);
create policy "own orders" on orders for select using (auth.uid()=user_id);
-- product_files intentionally has no public select policy; downloads must be issued by a server function after ownership verification.
