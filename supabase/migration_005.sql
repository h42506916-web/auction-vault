-- =====================================================================
-- Auction Vault - migration 005: buyer accounts and profiles
-- Run ONCE in the Supabase dashboard (SQL Editor -> New query -> paste -> Run),
-- after schema.sql and migrations 002, 003 and 004. Safe to re-run.
--
-- Buyers sign up with username + password; the site logs in with the email
-- <username>@auctionvault.local (never emailed), so Auth "Confirm email" must be OFF.
-- Admin (h.bastian1@icloud.com, magic link) is unchanged. Adds: profiles (public
-- read, own-row writes via RPC), save_profile / username_available RPCs, bids.bidder_id,
-- place_bid needs a signed-in buyer with a profile (same signature), item_bids /
-- top_offers return the avatar, and a guard so only username accounts can sign up.
-- =====================================================================

begin;

-- 1. Profiles ------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text not null check (char_length(display_name) between 2 and 30),
  avatar_emoji  text not null default U&'\+01F600',
  avatar_color  text not null default '#0b2a5b',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create or replace function public.bad_username(p text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p, '') !~ '^[a-z0-9_]{3,20}$' or p !~ '[a-z]'
      or public.is_bad_name(replace(p, '_', ' ')) or public.is_bad_name(replace(p, '_', ''));
$$;

-- First bad field name, or null when everything is fine.
create or replace function public.profile_problem(p_username text, p_display_name text, p_emoji text, p_color text)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if public.bad_username(p_username) then
    return 'username';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 30
     or public.is_bad_name(p_display_name) then
    return 'display_name';
  end if;
  if not (coalesce(p_emoji, '') = any(array[U&'\+01F600', U&'\+01F60E', U&'\+01F920', U&'\+01F973', U&'\+01F916', U&'\+01F47D', U&'\+01F47B', U&'\+01F98A', U&'\+01F431', U&'\+01F436', U&'\+01F43C', U&'\+01F438', U&'\+01F981', U&'\+01F42F', U&'\+01F435', U&'\+01F984', U&'\+01F419', U&'\+01F996', U&'\+01F41D', U&'\+01F335', U&'\+01F355', U&'\+0026BD', U&'\+01F3AE', U&'\+01F680'])) then
    return 'avatar_emoji';
  end if;
  if not (lower(coalesce(p_color, '')) = any(array['#0b2a5b', '#1e88e5', '#00897b', '#43a047', '#f9a825', '#fb8c00', '#e53935', '#d81b60', '#8e24aa', '#546e7a'])) then
    return 'avatar_color';
  end if;
  return null;
end;
$$;

alter table public.profiles enable row level security;
drop policy if exists profiles_public_read on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_public_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Writes only go through save_profile() (validated); no direct insert/update grants.
revoke all on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_emoji, avatar_color, created_at) on public.profiles to anon, authenticated;

-- 2. Profile RPCs --------------------------------------------------------
create or replace function public.username_available(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if public.bad_username(v) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'username');
  end if;
  return jsonb_build_object('ok', true, 'available',
    not exists (select 1 from public.profiles where username = v)
    and not exists (select 1 from auth.users where lower(email) = v || '@auctionvault.local'));
end;
$$;

create or replace function public.save_profile(p_display_name text, p_avatar_emoji text, p_avatar_color text, p_username text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_user  text;
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_bad   text;
  pr      public.profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'login_required', 'message', 'Please sign in first.');
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select username into v_user from public.profiles where id = v_uid;
  if v_user is null then
    v_user := case when v_email like '%@auctionvault.local' then split_part(v_email, '@', 1)
                   else lower(btrim(coalesce(p_username, ''))) end;
  end if;
  v_bad := public.profile_problem(v_user, v_name, p_avatar_emoji, p_avatar_color);
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', v_bad);
  end if;
  begin
    insert into public.profiles as p (id, username, display_name, avatar_emoji, avatar_color)
    values (v_uid, v_user, v_name, p_avatar_emoji, lower(p_avatar_color))
    on conflict (id) do update
      set display_name = excluded.display_name, avatar_emoji = excluded.avatar_emoji,
          avatar_color = excluded.avatar_color
    returning * into pr;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'username_taken', 'field', 'username');
  end;
  return jsonb_build_object('ok', true, 'profile', jsonb_build_object('id', pr.id, 'username', pr.username,
    'display_name', pr.display_name, 'avatar_emoji', pr.avatar_emoji, 'avatar_color', pr.avatar_color));
end;
$$;

revoke all on function public.profile_problem(text, text, text, text) from public, anon, authenticated;
revoke all on function public.bad_username(text) from public, anon, authenticated;
revoke all on function public.username_available(text) from public;
revoke all on function public.save_profile(text, text, text, text) from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.save_profile(text, text, text, text) to authenticated;

-- 3. Offers need a signed-in buyer with a profile -------------------------
alter table public.bids add column if not exists bidder_id uuid references auth.users(id) on delete set null;
create index if not exists bids_bidder_idx on public.bids (bidder_id);

create or replace function public.place_bid(p_item_id text, p_amount numeric, p_bidder_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it    public.items%rowtype;
  pr    public.profiles%rowtype;
  v_uid uuid := auth.uid();
  v_min numeric;
  v_amt numeric := round(coalesce(p_amount, 0), 2);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'login_required', 'message', 'Please sign in to make an offer.');
  end if;
  select * into pr from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_required', 'message', 'Please finish your profile before making an offer.');
  end if;
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
  insert into public.bids (item_id, amount, bidder_name, bidder_id) values (it.id, v_amt, pr.display_name, v_uid);

  return jsonb_build_object('ok', true, 'current_bid', v_amt, 'bid_count', it.bid_count + 1,
    'min_next', public.min_next_bid(v_amt, it.starting_bid, it.bid_count + 1),
    'bidder_name', pr.display_name, 'username', pr.username,
    'avatar_emoji', pr.avatar_emoji, 'avatar_color', pr.avatar_color);
end;
$$;

revoke all on function public.place_bid(text, numeric, text) from public;
grant execute on function public.place_bid(text, numeric, text) to anon, authenticated;

-- 4. Public offer lists show the bidder's avatar ---------------------------
drop function if exists public.item_bids(text);
create function public.item_bids(p_item_id text)
returns table (amount numeric, bidder_name text, created_at timestamptz,
               username text, avatar_emoji text, avatar_color text)
language sql
stable
security definer
set search_path = public
as $$
  select b.amount, coalesce(p.display_name, b.bidder_name), b.created_at,
         p.username, p.avatar_emoji, p.avatar_color
  from public.bids b
  join public.items i on i.id = b.item_id and i.status <> 'removed'
  left join public.profiles p on p.id = b.bidder_id
  where b.item_id = p_item_id
  order by b.created_at desc
  limit 25;
$$;

drop function if exists public.top_offers();
create function public.top_offers()
returns table (item_id text, amount numeric, bidder_name text, created_at timestamptz,
               username text, avatar_emoji text, avatar_color text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (b.item_id) b.item_id, b.amount, coalesce(p.display_name, b.bidder_name),
         b.created_at, p.username, p.avatar_emoji, p.avatar_color
  from public.bids b
  join public.items i on i.id = b.item_id and i.status <> 'removed'
  left join public.profiles p on p.id = b.bidder_id
  order by b.item_id, b.amount desc, b.created_at asc;
$$;

revoke all on function public.item_bids(text) from public;
revoke all on function public.top_offers() from public;
grant execute on function public.item_bids(text) to anon, authenticated;
grant execute on function public.top_offers() to anon, authenticated;

-- 5. Only username accounts (plus the admin email) can sign up -------------
create or replace function public.guard_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_user  text := split_part(lower(coalesce(new.email, '')), '@', 1);
begin
  if v_email = 'h.bastian1@icloud.com' then
    return new;
  end if;
  if split_part(v_email, '@', 2) <> 'auctionvault.local'
     or public.bad_username(v_user) then
    raise exception 'Sign-ups need a valid username' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_auth_signup() from public, anon, authenticated;

do $$
begin
  drop trigger if exists guard_auth_signup on auth.users;
  create trigger guard_auth_signup before insert on auth.users
    for each row execute function public.guard_auth_signup();
exception when insufficient_privilege then
  raise notice 'Skipped the auth.users sign-up guard (no permission); everything else is installed.';
end;
$$;

commit;

-- Make the changes visible to the API straight away
notify pgrst, 'reload schema';
