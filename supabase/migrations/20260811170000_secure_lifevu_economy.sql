-- LifeVU economy constants
-- INITIAL_FREE_COINS = 10
-- DAILY_FREE_COINS = 5
-- COINS_PER_1000_CREDITS = 8
-- CREDITS_PER_PACKAGE = 1000

-- Legacy SonhoBom/IMVU compatibility contract:
-- * this migration does not change RLS policies or table grants on profiles;
-- * the economy trigger runs only on INSERT and never intercepts legacy UPDATEs;
-- * moedas_avulsas, plano and vip_vencimento keep their names and behavior;
-- * creditar_compra_confirmada is an optional service-role path, not a trigger
--   or a prerequisite for the bot's existing direct profiles update.

create extension if not exists pgcrypto;

alter table public.profiles
  alter column moedas_free set default 10;

alter table public.profiles
  add column if not exists ultimo_reset_diario date;

-- Existing users are marked as already renewed today. This migration never
-- overwrites their current balances or grants the new initial allocation.
update public.profiles
set ultimo_reset_diario = (timezone('America/Bahia', now()))::date
where ultimo_reset_diario is null;

alter table public.profiles
  alter column ultimo_reset_diario
    set default (timezone('America/Bahia', now()))::date,
  alter column ultimo_reset_diario set not null;

create or replace function public.lifevu_enforce_new_profile_economy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A profile insert receives the initial allocation exactly once, even if an
  -- older auth trigger still tries to pass the former value explicitly.
  new.moedas_free := 10;
  new.moedas_avulsas := coalesce(new.moedas_avulsas, 0);
  new.moedas_vip := coalesce(new.moedas_vip, 0);
  new.ultimo_reset_diario := coalesce(
    new.ultimo_reset_diario,
    (timezone('America/Bahia', now()))::date
  );
  return new;
end;
$$;

drop trigger if exists lifevu_new_profile_economy on public.profiles;
create trigger lifevu_new_profile_economy
before insert on public.profiles
for each row execute function public.lifevu_enforce_new_profile_economy();

create or replace function public.resetar_moedas_diarias(usuario_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_today date := (timezone('America/Bahia', now()))::date;
  v_last_reset date;
begin
  if auth.uid() is distinct from usuario_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select ultimo_reset_diario
  into v_last_reset
  from public.profiles
  where id = usuario_id
  for update;

  if not found then
    return false;
  end if;

  if v_last_reset < v_today then
    update public.profiles
    set moedas_free = 5,
        ultimo_reset_diario = v_today
    where id = usuario_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.resetar_moedas_diarias(uuid) from public;
grant execute on function public.resetar_moedas_diarias(uuid) to authenticated, service_role;

create table if not exists public.lifevu_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('processing', 'succeeded', 'refunded')),
  charged_bucket text check (charged_bucket in ('free', 'vip', 'purchased')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists lifevu_generation_requests_user_created_idx
  on public.lifevu_generation_requests (user_id, created_at desc);

create unique index if not exists lifevu_one_processing_request_per_user_idx
  on public.lifevu_generation_requests (user_id)
  where status = 'processing';

alter table public.lifevu_generation_requests enable row level security;
revoke all on table public.lifevu_generation_requests from public, anon, authenticated;

create or replace function public.lifevu_begin_generation(
  p_rate_limit_max integer default 10,
  p_window_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request_id uuid;
  v_bucket text;
  v_count integer;
  v_oldest timestamptz;
  v_retry_after integer;
  v_today date := (timezone('America/Bahia', now()))::date;
  v_stale record;
  v_is_vip boolean;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  p_rate_limit_max := greatest(1, least(coalesce(p_rate_limit_max, 10), 100));
  p_window_seconds := greatest(60, least(coalesce(p_window_seconds, 600), 86400));

  -- Serializes all generation decisions for this user across serverless instances.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  -- Recover abandoned requests after two minutes and refund their exact bucket.
  for v_stale in
    select id, charged_bucket
    from public.lifevu_generation_requests
    where user_id = v_user_id
      and status = 'processing'
      and created_at < now() - interval '2 minutes'
    for update
  loop
    if v_stale.charged_bucket = 'free' then
      update public.profiles set moedas_free = moedas_free + 1 where id = v_user_id;
    elsif v_stale.charged_bucket = 'vip' then
      update public.profiles set moedas_vip = moedas_vip + 1 where id = v_user_id;
    elsif v_stale.charged_bucket = 'purchased' then
      update public.profiles set moedas_avulsas = moedas_avulsas + 1 where id = v_user_id;
    end if;

    update public.lifevu_generation_requests
    set status = 'refunded', finished_at = now()
    where id = v_stale.id and status = 'processing';
  end loop;

  if exists (
    select 1 from public.lifevu_generation_requests
    where user_id = v_user_id and status = 'processing'
  ) then
    return jsonb_build_object('ok', false, 'code', 'generation_in_progress', 'retry_after', 5);
  end if;

  select count(*), min(created_at)
  into v_count, v_oldest
  from public.lifevu_generation_requests
  where user_id = v_user_id
    and created_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_rate_limit_max then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))::integer
    );
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'retry_after', v_retry_after);
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'profile_missing');
  end if;

  if v_profile.ultimo_reset_diario < v_today then
    update public.profiles
    set moedas_free = 5,
        ultimo_reset_diario = v_today
    where id = v_user_id
    returning * into v_profile;
  end if;

  v_is_vip := coalesce(v_profile.plano, '') ilike '%VIP%'
    and v_profile.vip_vencimento is not null
    and v_profile.vip_vencimento > now();

  if not v_is_vip then
    if coalesce(v_profile.moedas_free, 0) > 0 then
      update public.profiles set moedas_free = moedas_free - 1 where id = v_user_id;
      v_bucket := 'free';
    elsif coalesce(v_profile.moedas_vip, 0) > 0 then
      update public.profiles set moedas_vip = moedas_vip - 1 where id = v_user_id;
      v_bucket := 'vip';
    elsif coalesce(v_profile.moedas_avulsas, 0) > 0 then
      update public.profiles set moedas_avulsas = moedas_avulsas - 1 where id = v_user_id;
      v_bucket := 'purchased';
    else
      return jsonb_build_object('ok', false, 'code', 'insufficient_coins');
    end if;
  end if;

  insert into public.lifevu_generation_requests (user_id, status, charged_bucket)
  values (v_user_id, 'processing', v_bucket)
  returning id into v_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'vip', v_is_vip,
    'charged_bucket', v_bucket
  );
end;
$$;

revoke all on function public.lifevu_begin_generation(integer, integer) from public;
grant execute on function public.lifevu_begin_generation(integer, integer) to authenticated, service_role;

create or replace function public.lifevu_finish_generation(
  p_request_id uuid,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.lifevu_generation_requests%rowtype;
begin
  if v_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_request
  from public.lifevu_generation_requests
  where id = p_request_id and user_id = v_user_id
  for update;

  if not found or v_request.status <> 'processing' then
    return false;
  end if;

  if p_succeeded then
    update public.lifevu_generation_requests
    set status = 'succeeded', finished_at = now()
    where id = p_request_id and status = 'processing';
    return found;
  end if;

  if v_request.charged_bucket = 'free' then
    update public.profiles set moedas_free = moedas_free + 1 where id = v_user_id;
  elsif v_request.charged_bucket = 'vip' then
    update public.profiles set moedas_vip = moedas_vip + 1 where id = v_user_id;
  elsif v_request.charged_bucket = 'purchased' then
    update public.profiles set moedas_avulsas = moedas_avulsas + 1 where id = v_user_id;
  end if;

  update public.lifevu_generation_requests
  set status = 'refunded', finished_at = now()
  where id = p_request_id and status = 'processing';
  return found;
end;
$$;

revoke all on function public.lifevu_finish_generation(uuid, boolean) from public;
grant execute on function public.lifevu_finish_generation(uuid, boolean) to authenticated, service_role;

create table if not exists public.lifevu_purchase_receipts (
  payment_id text primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  credits integer not null check (credits > 0 and credits % 1000 = 0),
  coins integer not null check (coins > 0),
  created_at timestamptz not null default now()
);

alter table public.lifevu_purchase_receipts enable row level security;
revoke all on table public.lifevu_purchase_receipts from public, anon, authenticated;

create or replace function public.creditar_compra_confirmada(
  p_payment_id text,
  p_user_id uuid,
  p_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins integer;
  v_inserted text;
begin
  if p_payment_id is null or btrim(p_payment_id) = ''
     or p_credits < 1000 or p_credits % 1000 <> 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_purchase');
  end if;

  v_coins := (p_credits / 1000) * 8;

  insert into public.lifevu_purchase_receipts (payment_id, user_id, credits, coins)
  values (p_payment_id, p_user_id, p_credits, v_coins)
  on conflict (payment_id) do nothing
  returning payment_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok', false, 'code', 'already_processed');
  end if;

  -- The optional trusted RPC writes its own idempotent receipt/history entry.
  -- A later legacy UPDATE audit trigger uses this transaction-local flag to
  -- avoid recording the same purchase twice.
  perform set_config('lifevu.purchase_history_written_by_rpc', '1', true);

  update public.profiles
  set moedas_avulsas = coalesce(moedas_avulsas, 0) + v_coins,
      creditos_pagos = coalesce(creditos_pagos, 0) + p_credits
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  begin
    insert into public.historico_transacoes (user_id, tipo, descricao)
    values (
      p_user_id,
      'Automático',
      format('+%s moedas · %s créditos · Moedas avulsas', v_coins, p_credits)
    );
  exception
    when undefined_table or undefined_column then
      null;
  end;

  return jsonb_build_object('ok', true, 'credits', p_credits, 'coins', v_coins);
end;
$$;

revoke all on function public.creditar_compra_confirmada(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.creditar_compra_confirmada(text, uuid, integer) to service_role;
