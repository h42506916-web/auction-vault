-- =====================================================================
-- Auction Vault — migration 002: storage vault offers
-- Run ONCE in the Supabase dashboard (SQL Editor → New query → paste → Run),
-- after schema.sql. Safe to re-run.
--
-- Storage vaults no longer have a checkout. Buyers make an offer (highest offer
-- wins) and pay cash at a school meet-up, like the auction. Offers are stored in
-- public.pickups with purchase_type = 'Vault offer' so they appear in the seller
-- page's Pickups & offers list.
-- =====================================================================

-- 1. pickups can now hold vault offers (no auction item, a storage tier instead)
alter table public.pickups add column if not exists tier_id text references public.storage_tiers(id) on delete set null;
alter table public.pickups drop constraint if exists pickups_purchase_type_check;
alter table public.pickups add constraint pickups_purchase_type_check
  check (purchase_type in ('Buy It Now', 'Highest bid', 'Vault offer'));

-- 2. Public RPC: record a storage vault offer with a cash meet-up.
--    Re-sending the same reference (retry, or a new offer from the same browser)
--    updates that offer if it is not yet collected.
create or replace function public.create_vault_offer(
  p_tier_id text, p_amount numeric, p_buyer_name text, p_class text, p_contact text,
  p_meetup text, p_time text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.storage_tiers%rowtype;
  v_ref   text := left(btrim(coalesce(p_reference, '')), 40);
  v_name  text := left(btrim(coalesce(p_buyer_name, '')), 60);
  v_amt   numeric := round(coalesce(p_amount, 0), 2);
  v_id    uuid;
begin
  if char_length(v_ref) < 6 then
    return jsonb_build_object('ok', false, 'error', 'bad_reference', 'message', 'Missing offer reference.');
  end if;
  if char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name', 'message', 'Please enter your name.');
  end if;
  if v_amt <= 0 or v_amt > 100000 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount', 'message', 'Please enter a valid offer amount.');
  end if;
  if coalesce(btrim(p_meetup), '') not in ('Languages Building', 'MPH - Bathrooms', 'Art Building')
     or coalesce(btrim(p_time), '') not in ('Lunch', 'Recess') then
    return jsonb_build_object('ok', false, 'error', 'bad_meetup', 'message', 'Please choose a meet-up point and time.');
  end if;
  select * into t from public.storage_tiers where id = p_tier_id;
  if not found or not t.active then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'This vault is not available right now.');
  end if;

  insert into public.pickups as p (item_id, tier_id, item_name, price, purchase_type, buyer_name, class, contact, meetup, "time", reference)
  values (null, t.id, t.name, v_amt, 'Vault offer', v_name,
          left(btrim(coalesce(p_class, '')), 30), left(btrim(coalesce(p_contact, '')), 80),
          btrim(p_meetup), btrim(p_time), v_ref)
  on conflict (reference) do update
    set price = excluded.price, buyer_name = excluded.buyer_name, class = excluded.class,
        contact = excluded.contact, meetup = excluded.meetup, "time" = excluded."time", created_at = now()
    where p.collected = false and p.tier_id = excluded.tier_id and p.purchase_type = 'Vault offer'
  returning p.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'reference_taken', 'message', 'That offer reference is already in use.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref, 'price', v_amt);
end;
$$;

revoke all on function public.create_vault_offer(text, numeric, text, text, text, text, text, text) from public;
grant execute on function public.create_vault_offer(text, numeric, text, text, text, text, text, text) to anon, authenticated;

-- Make the new function visible to the API straight away
notify pgrst, 'reload schema';
