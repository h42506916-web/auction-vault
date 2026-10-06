-- =====================================================================
-- Auction Vault — migration 003: reject joke / fake / rude buyer entries
-- Run ONCE in the Supabase dashboard (SQL Editor → New query → paste → Run),
-- after schema.sql and migration_002.sql. Safe to re-run (only replaces functions;
-- no tables or data are changed).
--
-- Adds public.is_bad_entry(text) (placeholder words like "test"/"asdf", keyboard
-- mash, rude words incl. leetspeak) and public.is_bad_name(text) (the same plus
-- name-only checks), and makes create_pickup, create_vault_offer and place_bid
-- return  {"ok": false, "error": "invalid_entry", "field": "name"|"class"|"contact",
-- "message": "Invalid — ..."}  for a bad buyer name, class or contact.
-- Everything else about those three functions is unchanged. The website
-- (js/common.js, AV.validateEntry) runs a stricter copy of these checks first.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------

-- Splits an entry into lower-case words, accents removed. * $ @ ! | + stay inside a
-- word (they stand in for letters: sh1t, f*ck, a$$). Runs of single characters are
-- joined ("f u c k", "n/a" → "fuck", "na"). An email address is split at the @.
create or replace function public.entry_tokens(p_value text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v     text := lower(btrim(coalesce(p_value, '')));
  parts text[];
  p     text;
  run   text := '';
  toks  text[] := '{}';
begin
  v := regexp_replace(v, '[\u200B-\u200D\u2060\uFEFF]', '', 'g');
  v := translate(v, 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿāăąćĉċčďēĕėęěĝğġģĥĩīĭįĵķĺļľńņňōŏőŕŗřśŝşšţťũūŭůűųŵŷźżžơưǎǐǒǔǖǘǚǜǟǡǧǩǫǭǰǵǹǻȁȃȅȇȉȋȍȏȑȓȕȗșțȟȧȩȫȭȯȱȳ', 'aaaaaaceeeeiiiinooooouuuuyyaaaccccdeeeeegggghiiiijklllnnnooorrrssssttuuuuuuwyzzzouaiouuuuuaagkoojgnaaaeeiioorruusthaeooooy');
  if v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    v := replace(v, '@', ' ');
  end if;
  parts := regexp_split_to_array(v, '[][:space:]"#%&''(),./:;<=>?\\^_`{}~’‘“”–—·-]+');
  foreach p in array parts loop
    continue when p = '';
    if char_length(p) = 1 then
      run := run || p;
    else
      if run <> '' then toks := toks || run; run := ''; end if;
      toks := toks || p;
    end if;
  end loop;
  if run <> '' then toks := toks || run; end if;
  return toks;
end;
$$;

-- true = joke / fake / rude entry. Empty or null is NOT bad here (class and contact are optional).
create or replace function public.is_bad_entry(p_value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  placeholders constant text[] := array['test', 'tests', 'testing', 'tester', 'testname', 'asdf', 'asdfg', 'asdfgh', 'asdfghjkl', 'asd', 'sdf', 'dfg', 'jkl', 'qwe', 'qwer', 'qwert', 'qwerty', 'zxc', 'zxcv', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'xyz', 'aaa', 'xxx', 'zzz', 'none', 'nothing', 'na', 'nil', 'null', 'undefined', 'idk', 'dunno', 'name', 'myname', 'yourname', 'noname', 'firstname', 'lastname', 'fullname', 'surname', 'blah', 'blahblah', 'bla', 'fake', 'fakename', 'anonymous', 'anon', 'nobody', 'noone', 'someone', 'somebody', 'unknown', 'lol', 'lmao', 'lmfao', 'rofl', 'lel', 'xd', 'haha', 'hehe', 'hello', 'hi', 'hey', 'hiya', 'yo', 'sdfsdf', 'jkljkl', 'foo', 'foobar', 'user', 'username', 'guest', 'me', 'myself', 'nope', 'no', 'nah', 'yes', 'yeah', 'ok', 'okay', 'whatever', 'random', 'idc', 'student', 'person', 'human', 'thing', 'stuff', 'class', 'contact', 'phone', 'email', 'number', 'mobile'];
  phrases      constant text[] := array['ben dover', 'bend over', 'mike hunt', 'mike hawk', 'mike oxlong', 'mike litoris', 'hugh jass', 'hugh janus', 'amanda hugginkiss', 'seymour butts', 'harry balls', 'joe mama', 'yo mama', 'ur mom', 'your mom', 'ur mum', 'your mum', 'deez nuts', 'ligma', 'sugma', 'phil mccracken', 'dixie normous', 'ivana tinkle', 'heywood jablome', 'moe lester', 'john doe', 'jane doe', 'joe bloggs', 'your name', 'my name', 'first last', 'first name', 'last name'];
  whole_re     constant text := '^(?:[s5$*]+[h*]+[i1!|*]+[t7+*]+|[s5$*]+[h*]+[i1!|*]+[t7+*]+[e3*]+|[s5$*]+[h*]+[i1!|*]+[t7+*]+[t7+*]+[y*]+|[s5$*]+[h*]+[i1!|*]+[t7+*]+[t7+*]+[e3*]+[r*]+|[c*]+[r*]+[a4@*]+[p*]+|[c*]+[r*]+[a4@*]+[p*]+[p*]+[y*]+|[c*]+[uv*]+[n*]+[t7+*]+|[d*]+[i1!|*]+[c*]+[k*]+|[c*]+[o0*]+[c*]+[k*]+|[p*]+[r*]+[i1!|*]+[c*]+[k*]+|[t7+*]+[w*]+[a4@*]+[t7+*]+|[t7+*]+[i1!|*]+[t7+*]+|[t7+*]+[i1!|*]+[t7+*]+[s5$*]+|[t7+*]+[i1!|*]+[t7+*]+[t7+*]+[y*]+|[t7+*]+[i1!|*]+[t7+*]+[t7+*]+[i1!|*]+[e3*]+[s5$*]+|[b8*]+[o0*]+[o0*]+[b8*]+|[b8*]+[o0*]+[o0*]+[b8*]+[s5$*]+|[b8*]+[o0*]+[o0*]+[b8*]+[y*]+|[a4@*]+[s5$*]+[s5$*]+|[a4@*]+[r*]+[s5$*]+[e3*]+|[a4@*]+[s5$*]+[s5$*]+[h*]+[a4@*]+[t7+*]+|[b8*]+[uv*]+[t7+*]+[t7+*]+[h*]+[o0*]+[l1|*]+[e3*]+|[b8*]+[uv*]+[t7+*]+[t7+*]+[f*]+[a4@*]+[c*]+[e3*]+|[b8*]+[a4@*]+[s5$*]+[t7+*]+[a4@*]+[r*]+[d*]+|[p*]+[i1!|*]+[s5$*]+[s5$*]+|[p*]+[i1!|*]+[s5$*]+[s5$*]+[e3*]+[d*]+|[p*]+[i1!|*]+[s5$*]+[s5$*]+[e3*]+[r*]+|[w*]+[a4@*]+[n*]+[k*]+|[b8*]+[o0*]+[l1|*]+[l1|*]+[o0*]+[c*]+[k*]+[s5$*]+|[b8*]+[o0*]+[l1|*]+[l1|*]+[o0*]+[c*]+[k*]+|[b8*]+[uv*]+[g9*]+[g9*]+[e3*]+[r*]+|[s5$*]+[l1|*]+[uv*]+[t7+*]+|[s5$*]+[l1|*]+[a4@*]+[g9*]+|[s5$*]+[k*]+[a4@*]+[n*]+[k*]+|[d*]+[o0*]+[uv*]+[c*]+[h*]+[e3*]+|[d*]+[o0*]+[uv*]+[c*]+[h*]+[e3*]+[b8*]+[a4@*]+[g9*]+|[i1!|*]+[d*]+[i1!|*]+[o0*]+[t7+*]+|[s5$*]+[t7+*]+[uv*]+[p*]+[i1!|*]+[d*]+|[d*]+[uv*]+[m*]+[b8*]+|[m*]+[o0*]+[r*]+[o0*]+[n*]+|[l1|*]+[o0*]+[s5$*]+[e3*]+[r*]+|[r*]+[e3*]+[t7+*]+[a4@*]+[r*]+[d*]+|[r*]+[e3*]+[t7+*]+[a4@*]+[r*]+[d*]+[e3*]+[d*]+|[p*]+[o0*]+[o0*]+[p*]+|[p*]+[o0*]+[o0*]+[p*]+[y*]+|[s5$*]+[e3*]+[x*]+|[s5$*]+[e3*]+[x*]+[y*]+|[p*]+[o0*]+[r*]+[n*]+|[p*]+[o0*]+[r*]+[n*]+[o0*]+|[n*]+[uv*]+[d*]+[e3*]+|[n*]+[uv*]+[d*]+[e3*]+[s5$*]+|[n*]+[a4@*]+[z*]+[i1!|*]+|[h*]+[i1!|*]+[t7+*]+[l1|*]+[e3*]+[r*]+|[k*]+[y*]+[s5$*]+|[s5$*]+[t7+*]+[f*]+[uv*]+|[g9*]+[t7+*]+[f*]+[o0*]+|[w*]+[t7+*]+[f*]+|[o0*]+[m*]+[f*]+[g9*]+|[m*]+[i1!|*]+[l1|*]+[f*]+|[c*]+[uv*]+[m*]+|[j*]+[i1!|*]+[z*]+[z*]+|[s5$*]+[p*]+[uv*]+[n*]+[k*]+|[k*]+[n*]+[o0*]+[b8*]+|[k*]+[n*]+[o0*]+[b8*]+[h*]+[e3*]+[a4@*]+[d*]+|[n*]+[o0*]+[b8*]+|[b8*]+[e3*]+[l1|*]+[l1|*]+[e3*]+[n*]+[d*]+|[t7+*]+[o0*]+[s5$*]+[s5$*]+[e3*]+[r*]+|[p*]+[uv*]+[s5$*]+[s5$*]+[y*]+|[f*]+[a4@*]+[g9*]+|[f*]+[a4@*]+[g9*]+[s5$*]+|[c*]+[h*]+[i1!|*]+[n*]+[k*]+|[s5$*]+[p*]+[i1!|*]+[c*]+|[k*]+[i1!|*]+[k*]+[e3*]+|[w*]+[o0*]+[g9*]+|[p*]+[a4@*]+[k*]+[i1!|*]+|[g9*]+[o0*]+[o0*]+[k*]+|[t7+*]+[r*]+[a4@*]+[n*]+[n*]+[y*]+|[h*]+[o0*]+[m*]+[o0*]+|[l1|*]+[e3*]+[s5$*]+[b8*]+[o0*]+|[r*]+[a4@*]+[p*]+[e3*]+|[r*]+[a4@*]+[p*]+[i1!|*]+[s5$*]+[t7+*]+|[p*]+[e3*]+[d*]+[o0*]+|[p*]+[a4@*]+[e3*]+[d*]+[o0*]+|[p*]+[e3*]+[d*]+[o0*]+[p*]+[h*]+[i1!|*]+[l1|*]+[e3*]+|[p*]+[a4@*]+[e3*]+[d*]+[o0*]+[p*]+[h*]+[i1!|*]+[l1|*]+[e3*]+|[s5$*]+[uv*]+[c*]+[k*]+|[s5$*]+[uv*]+[c*]+[k*]+[s5$*]+|[b8*]+[a4@*]+[l1|*]+[l1|*]+[s5$*]+|[f*]+[a4@*]+[r*]+[t7+*]+|[t7+*]+[uv*]+[r*]+[d*]+|[b8*]+[o0*]+[o0*]+[g9*]+[e3*]+[r*]+|[uv*]+[g9*]+[l1|*]+[y*]+|[f*]+[a4@*]+[t7+*]+[s5$*]+[o0*]+|[f*]+[a4@*]+[t7+*]+[t7+*]+[y*]+|[n*]+[o0*]+[o0*]+[b8*]+|[f*]+[uv*]+[k*]+|[f*]+[uv*]+[q*]+|[f*]+[c*]+[k*]+|[f*]+[c*]+[uv*]+[k*]+|[f*]+[uv*]+[c*]+|[f*]+[k*]+|[f*]+[k*]+[n*]+|[f*]+[k*]+[i1!|*]+[n*]+[g9*]+|[e3*]+[f*]+[f*]+[i1!|*]+[n*]+[g9*]+|[p*]+[h*]+[uv*]+[k*]+|[p*]+[h*]+[uv*]+[c*]+[k*]+|[b8*]+[i1!|*]+[a4@*]+[t7+*]+[c*]+[h*]+|[p*]+[e3*]+[n*]+[i1!|*]+[s5$*]+|[v*]+[a4@*]+[g9*]+[i1!|*]+[n*]+[a4@*]+)(?:e?s)?(?:(?:head|face|hole|hat|bag|wad|wipe|stain|lord|licker|sucker|nugget|brain|weasel)(?:e?s)?)?$';
  embed_re     constant text := '[f*]+[uv*]+[c*]+[k*]+|[m*]+[o0*]+[t7+*]+[h*]+[e3*]+[r*]+[f*]+|[n*]+[i1!|*]+[g9*]+[g9*]+[e3*]+[r*]+|[n*]+[i1!|*]+[g9*]+[g9*]+[a4@*]+|[f*]+[a4@*]+[g9*]+[g9*]+[o0*]+[t7+*]+|[b8*]+[i1!|*]+[t7+*]+[c*]+[h*]+|[a4@*]+[s5$*]+[s5$*]+[h*]+[o0*]+[l1|*]+[e3*]+|[a4@*]+[r*]+[s5$*]+[e3*]+[h*]+[o0*]+[l1|*]+[e3*]+|[d*]+[i1!|*]+[c*]+[k*]+[h*]+[e3*]+[a4@*]+[d*]+|[s5$*]+[h*]+[i1!|*]+[t7+*]+[h*]+[e3*]+[a4@*]+[d*]+|[b8*]+[uv*]+[l1|*]+[l1|*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[h*]+[o0*]+[r*]+[s5$*]+[e3*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[c*]+[h*]+[i1!|*]+[c*]+[k*]+[e3*]+[n*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[b8*]+[a4@*]+[t7+*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[a4@*]+[p*]+[e3*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[d*]+[i1!|*]+[p*]+[s5$*]+[h*]+[i1!|*]+[t7+*]+|[c*]+[o0*]+[c*]+[k*]+[s5$*]+[uv*]+[c*]+[k*]+[e3*]+[r*]+|[w*]+[a4@*]+[n*]+[k*]+[e3*]+[r*]+|[w*]+[h*]+[o0*]+[r*]+[e3*]+|[d*]+[uv*]+[m*]+[b8*]+[a4@*]+[s5$*]+[s5$*]+|[j*]+[a4@*]+[c*]+[k*]+[a4@*]+[s5$*]+[s5$*]+|[s5$*]+[m*]+[a4@*]+[r*]+[t7+*]+[a4@*]+[s5$*]+[s5$*]+|[f*]+[a4@*]+[t7+*]+[a4@*]+[s5$*]+[s5$*]+|[l1|*]+[a4@*]+[r*]+[d*]+[a4@*]+[s5$*]+[s5$*]+|[k*]+[i1!|*]+[s5$*]+[s5$*]+[a4@*]+[s5$*]+[s5$*]+|[b8*]+[a4@*]+[d*]+[a4@*]+[s5$*]+[s5$*]+|[r*]+[e3*]+[t7+*]+[a4@*]+[r*]+[d*]+|[d*]+[i1!|*]+[l1|*]+[d*]+[o0*]+|[b8*]+[l1|*]+[o0*]+[w*]+[j*]+[o0*]+[b8*]+|[h*]+[a4@*]+[n*]+[d*]+[j*]+[o0*]+[b8*]+|[j*]+[i1!|*]+[z*]+[z*]+|[p*]+[uv*]+[s5$*]+[s5$*]+[y*]+|[t7+*]+[w*]+[a4@*]+[t7+*]+';
  keys_re      constant text := 'asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|zxcv|xcvb|cvbn|vbnm|poiu|lkjh|kjhg|jhgf|hgfd|gfds|fdsa|rewq|vcxz|mnbv|bvcx|qwert|werty|ertyu|rtyui|tyuio|yuiop|poiuy|oiuyt|iuytr|uytre|ytrew|trewq|asdfg|sdfgh|dfghj|fghjk|ghjkl|lkjhg|kjhgf|jhgfd|hgfds|gfdsa|zxcvb|xcvbn|cvbnm|mnbvc|nbvcx|bvcxz';
  toks    text[] := public.entry_tokens(p_value);
  t       text;
  plain   text;
  ph      text;
  n_ph    int := 0;
  n_other int := 0;
  spaced  text;
  compact text;
begin
  if coalesce(array_length(toks, 1), 0) = 0 then
    return false;
  end if;

  foreach t in array toks loop
    -- placeholder words ("test", "asdf", "n/a" ...) — bad only if the whole entry is made of them (and numbers)
    plain := regexp_replace(regexp_replace(t, '[*$@!|+]', '', 'g'), '^[0-9]+|[0-9]+$', '', 'g');
    if plain = any(placeholders) then n_ph := n_ph + 1;
    elsif plain <> '' then n_other := n_other + 1;
    end if;

    -- rude words (only on words with a letter, so phone numbers are left alone)
    if t ~ '[a-z]' and (t ~ whole_re or t ~ embed_re) then
      return true;
    end if;
    -- keyboard mash and the same letter 4+ times
    if regexp_replace(t, '[^a-z]', '', 'g') ~ keys_re or t ~ '([a-z])\1\1\1' then
      return true;
    end if;
  end loop;

  if n_ph > 0 and n_other = 0 then
    return true;
  end if;

  spaced  := ' ' || array_to_string(toks, ' ') || ' ';
  compact := array_to_string(toks, '');
  foreach ph in array phrases loop
    if position(' ' || ph || ' ' in spaced) > 0 or compact = replace(ph, ' ', '')
       or replace(ph, ' ', '') = any(toks) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- true = not acceptable as a buyer / bidder name: empty, under 2 characters, no letters,
-- is_bad_entry(), the same letter 3+ times, a 5+ letter word with no vowels, or a 40+ character word.
create or replace function public.is_bad_name(p_value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_value, ''));
  t text;
begin
  if char_length(v) < 2 then
    return true;
  end if;
  if not (v ~ '[A-Za-z]' or v ~ '[^\x01-\x7F]') then   -- only digits / symbols
    return true;
  end if;
  if public.is_bad_entry(v) then
    return true;
  end if;
  foreach t in array public.entry_tokens(v) loop
    if t ~ '([a-z])\1\1'
       or (t ~ '^[a-z]{5,}$' and t !~ '[aeiouy]')
       or char_length(t) > 40 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Internal helpers: the public RPCs below call them as their owner, so visitors don't need access.
revoke all on function public.entry_tokens(text) from public, anon, authenticated;
revoke all on function public.is_bad_entry(text) from public, anon, authenticated;
revoke all on function public.is_bad_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. place_bid (from schema.sql) — now rejects a bad bidder name
-- ---------------------------------------------------------------------
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
  if public.is_bad_name(left(btrim(coalesce(p_bidder_name, '')), 60)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'name',
      'message', 'Invalid — please enter your real name');
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
  insert into public.bids (item_id, amount, bidder_name) values (it.id, v_amt, v_name);

  return jsonb_build_object('ok', true, 'current_bid', v_amt, 'bid_count', it.bid_count + 1,
    'min_next', public.min_next_bid(v_amt, it.starting_bid, it.bid_count + 1));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. create_pickup (from schema.sql) — now rejects a bad name / class / contact
-- ---------------------------------------------------------------------
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
  if public.is_bad_name(v_name) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'name', 'message', 'Invalid — please enter your real name');
  end if;
  if public.is_bad_entry(left(btrim(coalesce(p_class, '')), 30)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'class', 'message', 'Invalid entry');
  end if;
  if public.is_bad_entry(left(btrim(coalesce(p_contact, '')), 80)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'contact', 'message', 'Invalid entry');
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

-- ---------------------------------------------------------------------
-- 4. create_vault_offer (from migration_002.sql) — now rejects a bad name / class / contact
-- ---------------------------------------------------------------------
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
  if public.is_bad_name(v_name) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'name', 'message', 'Invalid — please enter your real name');
  end if;
  if public.is_bad_entry(left(btrim(coalesce(p_class, '')), 30)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'class', 'message', 'Invalid entry');
  end if;
  if public.is_bad_entry(left(btrim(coalesce(p_contact, '')), 80)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_entry', 'field', 'contact', 'message', 'Invalid entry');
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

-- Same grants as before (create or replace keeps them; restated to be safe)
revoke all on function public.place_bid(text, numeric, text) from public;
revoke all on function public.create_pickup(text, text, numeric, text, text, text, text, text, text, text) from public;
revoke all on function public.create_vault_offer(text, numeric, text, text, text, text, text, text) from public;
grant execute on function public.place_bid(text, numeric, text) to anon, authenticated;
grant execute on function public.create_pickup(text, text, numeric, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.create_vault_offer(text, numeric, text, text, text, text, text, text) to anon, authenticated;

commit;

-- Make the changes visible to the API straight away
notify pgrst, 'reload schema';
