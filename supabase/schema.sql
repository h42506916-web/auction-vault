-- =====================================================================
-- Auction Vault — Supabase schema
-- Run ONCE in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Creates tables, Row Level Security policies, public RPC functions and
-- seeds the 12 example auction items and the 4 storage vault tiers.
-- Admin = the signed-in user whose email is h.bastian1@icloud.com.
-- =====================================================================
-- After this, also run supabase/migration_002.sql (storage vault offers)
-- and supabase/migration_003.sql (rejects joke / fake / rude buyer entries)
-- and supabase/migration_004.sql (debts / paid tracking, public top offers)
-- and supabase/migration_005.sql (buyer accounts: profiles + avatars on offers)
-- and supabase/migration_006.sql (my_bids: "My offers" on the Profile tab)
-- and supabase/migration_007.sql (Listing tab: buyers list + manage their own items).

create extension if not exists pgcrypto;  -- gen_random_uuid() (already on in Supabase)

-- ---------------------------------------------------------------------
-- Admin helper
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'h.bastian1@icloud.com', false);
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.items (
  id           text primary key default gen_random_uuid()::text,
  name         text not null check (char_length(name) between 1 and 120),
  description  text not null default '',
  category     text not null default 'Other',
  emoji        text not null default '📦',
  image_url    text not null default '',
  current_bid  numeric(10,2) not null default 0 check (current_bid >= 0),
  bid_count    integer not null default 0 check (bid_count >= 0),
  buy_now      numeric(10,2) not null check (buy_now > 0),
  starting_bid numeric(10,2) not null default 0 check (starting_bid >= 0),
  discount     integer not null default 0 check (discount between 0 and 95),
  ends_at      timestamptz not null,
  status       text not null default 'active' check (status in ('active','sold','removed')),
  source       text not null default 'seller' check (source in ('seller','seed')),
  created_at   timestamptz not null default now()
);
create index if not exists items_status_ends_idx on public.items (status, ends_at);

create table if not exists public.storage_tiers (
  id      text primary key,
  name    text not null,
  emoji   text not null default '🔐',
  price   numeric(10,2) not null check (price >= 0),
  perks   text[] not null default '{}',
  ribbon  text,
  cls     text not null default '',
  sort    integer not null default 0,
  active  boolean not null default true
);

create table if not exists public.pickups (
  id             uuid primary key default gen_random_uuid(),
  item_id        text references public.items(id) on delete set null,
  item_name      text not null,
  price          numeric(10,2) not null check (price >= 0),
  purchase_type  text not null check (purchase_type in ('Buy It Now','Highest bid')),
  buyer_name     text not null,
  class          text not null default '',
  contact        text not null default '',
  meetup         text not null,
  "time"         text not null,
  reference      text not null unique,
  collected      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists pickups_created_idx on public.pickups (created_at desc);

create table if not exists public.bids (
  id           uuid primary key default gen_random_uuid(),
  item_id      text not null references public.items(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  bidder_name  text not null default 'Anonymous',
  created_at   timestamptz not null default now()
);
create index if not exists bids_item_idx on public.bids (item_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.items         enable row level security;
alter table public.storage_tiers enable row level security;
alter table public.pickups       enable row level security;
alter table public.bids          enable row level security;

drop policy if exists items_public_read  on public.items;
drop policy if exists items_admin_all    on public.items;
drop policy if exists tiers_public_read  on public.storage_tiers;
drop policy if exists tiers_admin_all    on public.storage_tiers;
drop policy if exists pickups_admin_all  on public.pickups;
drop policy if exists bids_admin_all     on public.bids;

-- Public (anon + any signed-in user) can see items that are not removed.
create policy items_public_read on public.items
  for select to anon, authenticated using (status <> 'removed');
-- Admin can do everything.
create policy items_admin_all on public.items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy tiers_public_read on public.storage_tiers
  for select to anon, authenticated using (true);
create policy tiers_admin_all on public.storage_tiers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Pickups and bids: admin only (anon goes through the RPCs below).
create policy pickups_admin_all on public.pickups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy bids_admin_all on public.bids
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Table privileges (RLS above further restricts rows)
-- ---------------------------------------------------------------------
revoke all on public.items, public.storage_tiers, public.pickups, public.bids from anon, authenticated;
grant select on public.items, public.storage_tiers to anon;
grant select, insert, update, delete on public.items, public.storage_tiers, public.pickups, public.bids to authenticated;

-- ---------------------------------------------------------------------
-- Public RPC functions (SECURITY DEFINER: run with owner rights, validate inputs)
-- ---------------------------------------------------------------------

-- Minimum next bid: starting bid if no bids yet, otherwise current bid + step.
create or replace function public.min_next_bid(p_current numeric, p_starting numeric, p_bid_count integer)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_bid_count, 0) = 0 then coalesce(p_starting, 0)
    else p_current + case when p_current < 50 then 1 when p_current < 200 then 5 else 10 end
  end;
$$;

create or replace function public.place_bid(p_item_id text, p_amount numeric, p_bidder_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it      public.items%rowtype;
  v_min   numeric;
  v_amt   numeric := round(coalesce(p_amount, 0), 2);
  v_name  text := left(coalesce(nullif(btrim(p_bidder_name), ''), 'Anonymous'), 60);
begin
  select * into it from public.items where id = p_item_id for update;
  if not found or it.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'This item is no longer listed.');
  end if;
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'closed', 'message', 'Sorry, this item has already sold.');
  end if;
  if it.ends_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'ended', 'message', 'Sorry, this auction has ended.');
  end if;
  v_min := public.min_next_bid(it.current_bid, it.starting_bid, it.bid_count);
  if v_amt < v_min or v_amt > 1000000 then
    return jsonb_build_object('ok', false, 'error', 'too_low', 'min', v_min,
      'message', 'Your bid must be at least $' || to_char(v_min, 'FM999999990.00') || '.');
  end if;

  update public.items set current_bid = v_amt, bid_count = bid_count + 1 where id = it.id;
  insert into public.bids (item_id, amount, bidder_name) values (it.id, v_amt, v_name);

  return jsonb_build_object('ok', true, 'current_bid', v_amt, 'bid_count', it.bid_count + 1,
    'min_next', public.min_next_bid(v_amt, it.starting_bid, it.bid_count + 1));
end;
$$;

create or replace function public.buy_now(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items%rowtype;
  v_price numeric;
begin
  select * into it from public.items where id = p_item_id for update;
  if not found or it.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'This item is no longer listed.');
  end if;
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'sold', 'message', 'Sorry, this item has already been sold.');
  end if;
  if it.ends_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'ended', 'message', 'Sorry, this auction has ended.');
  end if;
  v_price := round(it.buy_now * (100 - it.discount) / 100, 2);
  update public.items set status = 'sold' where id = it.id;
  return jsonb_build_object('ok', true, 'price', v_price);
end;
$$;

-- Records a cash meet-up pickup. Re-sending the same reference (retry, or a higher
-- bid from the same browser) updates that pickup if it is not yet collected.
create or replace function public.create_pickup(
  p_item_id text, p_item_name text, p_price numeric, p_purchase_type text,
  p_buyer_name text, p_class text, p_contact text, p_meetup text, p_time text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it      public.items%rowtype;
  v_ref   text := left(btrim(coalesce(p_reference, '')), 40);
  v_name  text := left(btrim(coalesce(p_buyer_name, '')), 60);
  v_price numeric := round(coalesce(p_price, 0), 2);
  v_id    uuid;
begin
  if char_length(v_ref) < 6 then
    return jsonb_build_object('ok', false, 'error', 'bad_reference', 'message', 'Missing pickup reference.');
  end if;
  if char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name', 'message', 'Please enter your name.');
  end if;
  if p_purchase_type not in ('Buy It Now', 'Highest bid') then
    return jsonb_build_object('ok', false, 'error', 'bad_type', 'message', 'Unknown purchase type.');
  end if;
  if coalesce(btrim(p_meetup), '') = '' or coalesce(btrim(p_time), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_meetup', 'message', 'Please choose a meet-up point and time.');
  end if;
  select * into it from public.items where id = p_item_id;
  if not found or it.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'This item is no longer listed.');
  end if;
  if p_purchase_type = 'Buy It Now' then
    v_price := round(it.buy_now * (100 - it.discount) / 100, 2);  -- never trust the client price
  elsif v_price <= 0 or v_price > it.current_bid then
    return jsonb_build_object('ok', false, 'error', 'bad_price', 'message', 'That bid amount does not match this item.');
  end if;

  insert into public.pickups as p (item_id, item_name, price, purchase_type, buyer_name, class, contact, meetup, "time", reference)
  values (it.id, it.name, v_price, p_purchase_type, v_name,
          left(btrim(coalesce(p_class, '')), 30), left(btrim(coalesce(p_contact, '')), 80),
          left(btrim(p_meetup), 60), left(btrim(p_time), 30), v_ref)
  on conflict (reference) do update
    set price = excluded.price, buyer_name = excluded.buyer_name, class = excluded.class,
        contact = excluded.contact, meetup = excluded.meetup, "time" = excluded."time", created_at = now()
    where p.collected = false and p.item_id = excluded.item_id and p.purchase_type = excluded.purchase_type
  returning p.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'reference_taken', 'message', 'That pickup reference is already in use.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref, 'price', v_price);
end;
$$;

-- Public bid history for one item (amount, bidder name, time), newest first.
create or replace function public.item_bids(p_item_id text)
returns table (amount numeric, bidder_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.amount, b.bidder_name, b.created_at
  from public.bids b
  join public.items i on i.id = b.item_id and i.status <> 'removed'
  where b.item_id = p_item_id
  order by b.created_at desc
  limit 25;
$$;

revoke all on function public.place_bid(text, numeric, text) from public;
revoke all on function public.buy_now(text) from public;
revoke all on function public.create_pickup(text, text, numeric, text, text, text, text, text, text, text) from public;
revoke all on function public.item_bids(text) from public;
grant execute on function public.place_bid(text, numeric, text) to anon, authenticated;
grant execute on function public.buy_now(text) to anon, authenticated;
grant execute on function public.create_pickup(text, text, numeric, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.item_bids(text) to anon, authenticated;
grant execute on function public.min_next_bid(numeric, numeric, integer) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Seed data (only inserted if missing; safe to re-run)
-- ---------------------------------------------------------------------
insert into public.storage_tiers (id, name, emoji, price, perks, ribbon, cls, sort, active) values
  ('vault-bronze', 'The Starter Vault', '🔐',  20, array['Entry-level mystery','A great first unlock','Instant confirmation'], null, '', 1, true),
  ('vault-silver', 'The Silver Vault',  '🗝️',  50, array['Step-up mystery tier','Better odds of a standout find','Priority confirmation'], null, 't-silver', 2, true),
  ('vault-gold',   'The Gold Vault',    '👑', 100, array['Premium mystery tier','Our most-loved surprise','VIP support line'], 'Most Popular', 't-gold featured', 3, true),
  ('vault-black',  'The Black Vault',   '🖤', 250, array['Top-secret tier','Extremely limited','Personal call from the owner'], 'Limited', 't-black', 4, true)
on conflict (id) do nothing;

-- The 12 example items. Timers start now; they are NEVER relisted automatically.
insert into public.items (id, name, category, emoji, starting_bid, current_bid, buy_now, ends_at, description, bid_count, source) values
  ('seed-1',  'Vintage Film Camera (35mm)',    'Electronics',   '📷',  20,  45, 120, now() + interval '5.5 hours', 'Classic 35mm rangefinder pulled from a recently opened vault. Shutter fires, light seals look tidy.', 1, 'seed'),
  ('seed-2',  'Retro Game Console Bundle',     'Toys & Games',  '🎮',  50,  88, 199, now() + interval '26 hours',  'Console with two controllers and a box of cartridges. Untested beyond power-on.', 1, 'seed'),
  ('seed-3',  'Cordless Drill & Bit Set',      'Tools',         '🛠️',  15,  32,  75, now() + interval '49 hours',  '18V cordless drill, one battery, charger and a 40-piece bit set in a case.', 0, 'seed'),
  ('seed-4',  'Acoustic Guitar',               'Music',         '🎸',  40,  65, 180, now() + interval '3.2 hours', 'Dreadnought acoustic, a few dings on the body, plays nicely. Soft case included.', 0, 'seed'),
  ('seed-5',  'Antique Pocket Watch',          'Collectibles',  '⌚',  60, 140, 350, now() + interval '70 hours',  'Brass-cased pocket watch with chain. Ticks when wound. Age unknown — sold as found.', 0, 'seed'),
  ('seed-6',  'Designer-Style Leather Jacket', 'Fashion',       '🧥',  25,  25,  90, now() + interval '12 hours',  'Brown leather jacket, size M-ish. Light wear on the cuffs.', 0, 'seed'),
  ('seed-7',  'Mountain Bike',                 'Sports',        '🚲',  80, 115, 260, now() + interval '30 hours',  '21-speed mountain bike. Tyres need air, brakes work.', 0, 'seed'),
  ('seed-8',  'Box of Comic Books (40+)',      'Collectibles',  '📚',  10,  38, 110, now() + interval '8 hours',   'Mixed lot of 40+ comics in bags and boards. Titles vary — a true mystery box.', 0, 'seed'),
  ('seed-9',  'Espresso Machine',              'Home & Garden', '☕',  30,  52, 140, now() + interval '54 hours',  'Home espresso machine with portafilter and milk frother. Powers on.', 0, 'seed'),
  ('seed-10', 'Vinyl Record Collection',       'Music',         '💿',  20,  61, 150, now() + interval '18 hours',  'About 60 LPs, mostly 70s and 80s rock and soul. Sleeves show shelf wear.', 0, 'seed'),
  ('seed-11', 'Camping Gear Lot',              'Sports',        '⛺',  15,  22,  70, now() + interval '95 hours',  '2-person tent, two sleeping bags, a lantern and a camp stove.', 0, 'seed'),
  ('seed-12', 'Mystery Locked Safe',           'Other',         '🔒',  50, 175, 400, now() + interval '1.5 hours', 'A small locked safe found at the back of a vault. Contents unknown. No key. Good luck!', 1, 'seed')
on conflict (id) do nothing;

insert into public.bids (item_id, amount, bidder_name, created_at)
select v.item_id, v.amount, v.bidder_name, now() - v.ago
from (values
  ('seed-1',   45::numeric, 'lensfan',     interval '2 hours'),
  ('seed-2',   88::numeric, 'pixelpete',   interval '1 hour'),
  ('seed-12', 175::numeric, 'vaulthunter', interval '30 minutes')
) as v(item_id, amount, bidder_name, ago)
where not exists (select 1 from public.bids b where b.item_id = v.item_id);
