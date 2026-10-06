-- =====================================================================
-- Auction Vault - migration 006: "My offers" on the Profile tab
-- Run once in Supabase SQL Editor (safe to run again).
-- Needs migration_005 (bids.bidder_id, profiles).
--
-- Buyers cannot read the bids table directly (RLS = admin only), so
-- my_bids() returns ONLY the signed-in user's own offers, one row per
-- item: their best offer, how many offers they made, the item's current
-- top offer and whether theirs is it. No other buyers' details.
-- =====================================================================

begin;

drop function if exists public.my_bids();
create function public.my_bids()
returns table (item_id text, item_name text, item_emoji text, image_url text,
               item_status text, ends_at timestamptz, my_amount numeric,
               my_count integer, last_bid_at timestamptz, top_amount numeric,
               is_top boolean)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select b.item_id as iid, max(b.amount) as amt, count(*)::int as n,
           max(b.created_at) as last_at
    from public.bids b
    where auth.uid() is not null and b.bidder_id = auth.uid()
    group by b.item_id
  ), top as (
    select distinct on (b.item_id) b.item_id as iid, b.amount as amt, b.bidder_id as uid
    from public.bids b
    where b.item_id in (select iid from mine)
    order by b.item_id, b.amount desc, b.created_at asc
  )
  select i.id, i.name, i.emoji, i.image_url, i.status, i.ends_at,
         m.amt, m.n, m.last_at, t.amt, coalesce(t.uid = auth.uid(), false)
  from mine m
  join public.items i on i.id = m.iid and i.status <> 'removed'
  left join top t on t.iid = m.iid
  order by m.last_at desc
  limit 100;
$$;

revoke all on function public.my_bids() from public, anon;
grant execute on function public.my_bids() to authenticated;

commit;

-- Make the changes visible to the API straight away
notify pgrst, 'reload schema';
