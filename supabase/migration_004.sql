-- =====================================================================
-- Auction Vault - migration 004: debts / receipts (paid tracking) and
-- public "top offer" summary for the auction page.
-- Run ONCE in the Supabase dashboard (SQL Editor -> New query -> paste -> Run),
-- after schema.sql, migration_002.sql and migration_003.sql.
-- Safe to re-run: columns are only added if missing, functions are replaced.
--
-- 1. public.pickups gets  paid boolean not null default false  and  paid_at timestamptz.
--    "collected" (item handed over) stays separate from "paid" (cash received).
-- 2. public.mark_pickups_paid(uuid[], boolean) and public.mark_pickup_paid(uuid, boolean):
--    admin-only (email h.bastian1@icloud.com) functions used by the seller page's
--    Debts / Receipts section. They set paid and paid_at (now() / null).
-- 3. A trigger keeps paid / paid_at admin-only: buyers re-sending a pickup through
--    create_pickup / create_vault_offer can never change paid, and a pickup that is
--    already paid is never overwritten by them.
-- 4. public.top_offers(): public list of the highest offer per listed item
--    (item id, amount, bidder name only - never class or contact). Bidder names
--    are already public in item_bids(); this just saves one call per item.
-- =====================================================================

begin;

-- 1. Paid columns ------------------------------------------------------
alter table public.pickups add column if not exists paid boolean not null default false;
alter table public.pickups add column if not exists paid_at timestamptz;
create index if not exists pickups_unpaid_idx on public.pickups (paid, created_at desc);

-- 2. Admin-only "mark paid" functions ------------------------------------
create or replace function public.mark_pickups_paid(p_ids uuid[], p_paid boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'not authorised: only the owner can mark pickups paid' using errcode = '42501';
  end if;
  update public.pickups
     set paid = coalesce(p_paid, false),
         paid_at = case when coalesce(p_paid, false) then coalesce(paid_at, now()) else null end
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and paid is distinct from coalesce(p_paid, false);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.mark_pickup_paid(p_id uuid, p_paid boolean)
returns integer
language sql
security definer
set search_path = public
as $$
  select public.mark_pickups_paid(array[p_id], p_paid);
$$;

revoke all on function public.mark_pickups_paid(uuid[], boolean) from public, anon;
revoke all on function public.mark_pickup_paid(uuid, boolean) from public, anon;
grant execute on function public.mark_pickups_paid(uuid[], boolean) to authenticated;
grant execute on function public.mark_pickup_paid(uuid, boolean) to authenticated;

-- 3. Guard: only the admin (or the SQL editor / service role) changes paid -----
create or replace function public.pickups_paid_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_claims jsonb := auth.jwt();
  v_trusted boolean := public.is_admin()
    or v_claims is null
    or coalesce(v_claims ->> 'role', '') = 'service_role';
begin
  if tg_op = 'INSERT' then
    if not v_trusted then
      new.paid := false;
      new.paid_at := null;
    end if;
  else
    if not v_trusted then
      if old.paid then
        return old;  -- a paid pickup is never overwritten by a buyer re-send
      end if;
      new.paid := old.paid;
      new.paid_at := old.paid_at;
    end if;
  end if;
  if new.paid and new.paid_at is null then
    new.paid_at := now();
  elsif not new.paid then
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists pickups_paid_guard on public.pickups;
create trigger pickups_paid_guard
  before insert or update on public.pickups
  for each row execute function public.pickups_paid_guard();

-- 4. Public top offer per item -------------------------------------------
create or replace function public.top_offers()
returns table (item_id text, amount numeric, bidder_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (b.item_id) b.item_id, b.amount, b.bidder_name, b.created_at
  from public.bids b
  join public.items i on i.id = b.item_id and i.status <> 'removed'
  order by b.item_id, b.amount desc, b.created_at asc;
$$;

revoke all on function public.top_offers() from public;
grant execute on function public.top_offers() to anon, authenticated;

commit;

-- Make the changes visible to the API straight away
notify pgrst, 'reload schema';
