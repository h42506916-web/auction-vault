-- =====================================================================
-- Auction Vault - migration 007: "Listing" tab (buyers list their own items)
-- Run once in Supabase SQL Editor (safe to run again). Needs migrations 003+005.
-- Signed-in users with a profile can list items and manage ONLY their own
-- (edit, discount, sold/relist, remove) through the RPCs below. Direct table
-- writes stay admin-only (RLS unchanged). Pickups, buyer contacts, debts and
-- vault prices stay admin-only. item_listers() shows who listed each item.
-- =====================================================================

begin;

alter table public.items add column if not exists owner_id uuid references auth.users(id) on delete set null;
create index if not exists items_owner_idx on public.items (owner_id, created_at desc);

-- First problem with a listing, or null. Returns {ok:false,error,field,message}.
create or replace function public.my_item_problem(p_name text, p_desc text, p_cat text,
  p_emoji text, p_img text, p_start numeric, p_full numeric, p_days numeric, p_disc numeric)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  f text; m text;
begin
  if char_length(p_name) not between 2 and 80 or p_name !~ '[A-Za-z]' or public.is_bad_entry(p_name) then
    f := 'name'; m := 'Please give the item a real name (2-80 characters, no joke or rude words).';
  elsif char_length(p_desc) > 600 or public.is_bad_entry(p_desc) then
    f := 'description'; m := 'Please keep the description real and friendly (up to 600 characters).';
  elsif p_cat is null or p_cat <> all (array['Electronics','Collectibles','Tools','Fashion','Home & Garden','Sports','Toys & Games','Music','Other']) then
    f := 'category'; m := 'Please pick a category.';
  elsif char_length(p_emoji) not between 1 and 8 or p_emoji ~ '[A-Za-z0-9<>"''&]' then
    f := 'emoji'; m := 'The icon should be a single emoji.';
  elsif p_img <> '' and (char_length(p_img) > 500 or p_img !~ '^https://[^[:space:]"''<>]+$') then
    f := 'image'; m := 'Image URL must start with https://';
  elsif p_start is null or p_start < 0 or p_start > 10000 then
    f := 'startBid'; m := 'Starting offer must be $0 - $10,000.';
  elsif p_full is null or p_full <= 0 or p_full > 10000 or p_full < p_start then
    f := 'buyNow'; m := 'Full price must be above $0, at most $10,000 and at least the starting offer.';
  elsif p_days is null or p_days < 1 or p_days > 30 then
    f := 'days'; m := 'Auction length must be 1-30 days.';
  elsif p_disc is null or p_disc < 0 or p_disc > 90 then
    f := 'discount'; m := 'Discount must be 0-90%.';
  else
    return null;
  end if;
  return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', f, 'message', m);
end;
$$;

-- Signed in + has a profile, else an error object.
create or replace function public.my_item_auth()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'login_required', 'message', 'Please sign in to list items.')
    when not exists (select 1 from public.profiles where id = auth.uid())
      then jsonb_build_object('ok', false, 'error', 'profile_required', 'message', 'Please finish your profile first.')
  end;
$$;

-- Active (live, unsold) listings for a user
create or replace function public.my_active_count(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.items
  where owner_id = p_uid and status = 'active' and ends_at > now();
$$;

create or replace function public.create_my_item(p_name text, p_description text, p_category text,
  p_emoji text, p_image_url text, p_starting_bid numeric, p_buy_now numeric, p_days numeric, p_discount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  e jsonb := public.my_item_auth();
  r public.items%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_emoji text := coalesce(nullif(btrim(p_emoji), ''), U&'\+01F4E6');
  v_img text := btrim(coalesce(p_image_url, ''));
begin
  if e is not null then return e; end if;
  e := public.my_item_problem(v_name, v_desc, p_category, v_emoji, v_img, p_starting_bid, p_buy_now, p_days, p_discount);
  if e is not null then return e; end if;
  perform pg_advisory_xact_lock(hashtext('my_items:' || v_uid::text));
  if public.my_active_count(v_uid) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items', 'message', 'You can have up to 20 live listings. Mark some sold or remove them first.');
  end if;
  if (select count(*) from public.items where owner_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'message', 'You have listed 10 items in the last hour. Please wait a bit.');
  end if;
  insert into public.items (name, description, category, emoji, image_url, current_bid, bid_count,
    buy_now, starting_bid, discount, ends_at, status, source, owner_id)
  values (v_name, v_desc, p_category, v_emoji, v_img, round(p_starting_bid, 2), 0,
    round(p_buy_now, 2), round(p_starting_bid, 2), round(p_discount)::int, now() + p_days * interval '1 day', 'active', 'seller', v_uid)
  returning * into r;
  return jsonb_build_object('ok', true, 'item', to_jsonb(r));
end;
$$;

-- null arguments = keep. p_status: 'active' (relist) or 'sold'. p_days restarts the timer.
create or replace function public.update_my_item(p_id text, p_name text default null, p_description text default null,
  p_category text default null, p_emoji text default null, p_image_url text default null, p_starting_bid numeric default null,
  p_buy_now numeric default null, p_days numeric default null, p_discount numeric default null, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  e jsonb := public.my_item_auth();
  it public.items%rowtype;
  r public.items%rowtype;
begin
  if e is not null then return e; end if;
  perform pg_advisory_xact_lock(hashtext('my_items:' || v_uid::text));
  select * into it from public.items where id = p_id and owner_id = v_uid and status <> 'removed' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That listing was not found (only your own items can be changed).');
  end if;
  if p_status is not null and p_status not in ('active', 'sold') then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'status', 'message', 'Unknown status.');
  end if;
  e := public.my_item_problem(btrim(coalesce(p_name, it.name)), btrim(coalesce(p_description, it.description)),
    coalesce(p_category, it.category), coalesce(nullif(btrim(p_emoji), ''), it.emoji), btrim(coalesce(p_image_url, it.image_url)),
    coalesce(p_starting_bid, it.starting_bid), coalesce(p_buy_now, it.buy_now), coalesce(p_days, 7), coalesce(p_discount, it.discount));
  if e is not null then return e; end if;
  if coalesce(p_status, it.status) = 'active' and (it.status <> 'active' or it.ends_at <= now())
     and public.my_active_count(v_uid) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items', 'message', 'You can have up to 20 live listings.');
  end if;
  update public.items set
    name = btrim(coalesce(p_name, name)),
    description = btrim(coalesce(p_description, description)),
    category = coalesce(p_category, category),
    emoji = coalesce(nullif(btrim(p_emoji), ''), emoji),
    image_url = btrim(coalesce(p_image_url, image_url)),
    starting_bid = round(coalesce(p_starting_bid, starting_bid), 2),
    current_bid = case when bid_count = 0 then round(coalesce(p_starting_bid, starting_bid), 2) else current_bid end,
    buy_now = round(coalesce(p_buy_now, buy_now), 2),
    discount = round(coalesce(p_discount, discount))::int,
    status = coalesce(p_status, status),
    ends_at = case when p_days is not null then now() + p_days * interval '1 day'
                   when p_status = 'active' and ends_at <= now() then now() + interval '7 days'
                   else ends_at end
  where id = it.id
  returning * into r;
  return jsonb_build_object('ok', true, 'item', to_jsonb(r));
end;
$$;

create or replace function public.remove_my_item(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb := public.my_item_auth();
begin
  if e is not null then return e; end if;
  update public.items set status = 'removed' where id = p_id and owner_id = auth.uid() and status <> 'removed';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That listing was not found.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.my_items()
returns setof public.items
language sql
stable
security definer
set search_path = public
as $$
  select * from public.items
  where auth.uid() is not null and owner_id = auth.uid() and status <> 'removed'
  order by created_at desc
  limit 100;
$$;

-- Public: who listed each item (profile fields only)
create or replace function public.item_listers()
returns table (item_id text, username text, display_name text, avatar_emoji text, avatar_color text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, p.username, p.display_name, p.avatar_emoji, p.avatar_color
  from public.items i
  join public.profiles p on p.id = i.owner_id
  where i.status <> 'removed';
$$;

-- No offers on your own listing
create or replace function public.no_self_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bidder_id is not null and exists (select 1 from public.items where id = new.item_id and owner_id = new.bidder_id) then
    raise exception 'You can''t make an offer on your own listing.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists no_self_bid on public.bids;
create trigger no_self_bid before insert on public.bids for each row execute function public.no_self_bid();

revoke all on function public.my_item_problem(text, text, text, text, text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.my_item_auth() from public, anon, authenticated;
revoke all on function public.my_active_count(uuid) from public, anon, authenticated;
revoke all on function public.no_self_bid() from public, anon, authenticated;
revoke all on function public.create_my_item(text, text, text, text, text, numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.update_my_item(text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.remove_my_item(text) from public, anon;
revoke all on function public.my_items() from public, anon;
revoke all on function public.item_listers() from public;
grant execute on function public.create_my_item(text, text, text, text, text, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_my_item(text, text, text, text, text, text, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.remove_my_item(text) to authenticated;
grant execute on function public.my_items() to authenticated;
grant execute on function public.item_listers() to anon, authenticated;

commit;

-- Make the changes visible to the API straight away
notify pgrst, 'reload schema';
