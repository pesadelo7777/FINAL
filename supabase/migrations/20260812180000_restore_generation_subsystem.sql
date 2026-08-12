-- Restaura apenas o subsistema transacional usado por /api/gemini.

create table if not exists public.lifevu_generation_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('processing', 'succeeded', 'refunded')),
  charged_bucket text check (charged_bucket in ('free', 'vip', 'purchased')),
  created_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz
);

create index if not exists lifevu_generation_requests_user_created_idx
  on public.lifevu_generation_requests (user_id, created_at desc);

create unique index if not exists lifevu_one_processing_request_per_user_idx
  on public.lifevu_generation_requests (user_id)
  where status = 'processing';

alter table public.lifevu_generation_requests enable row level security;
revoke all on table public.lifevu_generation_requests
  from public, anon, authenticated;

-- Preserva a definição remota vigente de protect_secure_columns() e acrescenta
-- somente o bypass transacional consumido pela função auxiliar privada abaixo.
do $migration$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.protect_secure_columns()'::regprocedure
  );
  v_marker text :=
    'if coalesce(auth.jwt() ->> ''role'', '''') = ''service_role'' then';
  v_guard text := $guard$if coalesce(
    pg_catalog.current_setting(
      'lifevu.generation_balance_authorized',
      true
    ),
    ''
  ) = '1' then
    if new.id is distinct from old.id
       or new.id is distinct from auth.uid()
       or not (
         new.moedas_free is distinct from old.moedas_free
         or new.moedas_vip is distinct from old.moedas_vip
         or new.moedas_avulsas is distinct from old.moedas_avulsas
       )
       or (
         pg_catalog.to_jsonb(new)
           - array['moedas_free', 'moedas_vip', 'moedas_avulsas']::text[]
       ) is distinct from (
         pg_catalog.to_jsonb(old)
           - array['moedas_free', 'moedas_vip', 'moedas_avulsas']::text[]
       ) then
      raise exception
        'Acesso Negado: Tentativa de fraude bloqueada pelo sistema.';
    end if;

    return new;
  end if;

  $guard$;
  v_position integer;
begin
  if pg_catalog.strpos(
    v_definition,
    'lifevu.generation_balance_authorized'
  ) = 0 then
    v_position := pg_catalog.strpos(v_definition, v_marker);

    if v_position = 0 then
      raise exception
        'Expected service_role guard in public.protect_secure_columns()';
    end if;

    v_definition := pg_catalog.substr(v_definition, 1, v_position - 1)
      || v_guard
      || pg_catalog.substr(v_definition, v_position);
    execute v_definition;
  end if;
end;
$migration$;

create or replace function public.lifevu_adjust_generation_bucket(
  p_user_id uuid,
  p_bucket text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_authorization text := pg_catalog.current_setting(
    'lifevu.generation_balance_authorized',
    true
  );
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_bucket is null
     or p_bucket not in ('free', 'vip', 'purchased')
     or p_delta is null
     or p_delta not in (-1, 1) then
    raise exception 'invalid_generation_balance_adjustment'
      using errcode = '22023';
  end if;

  perform pg_catalog.set_config(
    'lifevu.generation_balance_authorized',
    '1',
    true
  );

  if p_bucket = 'free' then
    update public.profiles
    set moedas_free = moedas_free + p_delta
    where id = p_user_id;
  elsif p_bucket = 'vip' then
    update public.profiles
    set moedas_vip = moedas_vip + p_delta
    where id = p_user_id;
  else
    update public.profiles
    set moedas_avulsas = moedas_avulsas + p_delta
    where id = p_user_id;
  end if;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  perform pg_catalog.set_config(
    'lifevu.generation_balance_authorized',
    coalesce(v_previous_authorization, ''),
    true
  );
end;
$$;

revoke all on function public.lifevu_adjust_generation_bucket(uuid, text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.lifevu_begin_generation(
  p_rate_limit_max integer default 10,
  p_window_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request_id uuid;
  v_bucket text;
  v_count integer;
  v_oldest timestamptz;
  v_retry_after integer;
  v_today date := (
    pg_catalog.timezone('America/Bahia', pg_catalog.now())
  )::date;
  v_stale record;
  v_is_vip boolean;
  v_previous_daily_authorization text;
begin
  if v_user_id is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'unauthorized'
    );
  end if;

  p_rate_limit_max := greatest(1, least(coalesce(p_rate_limit_max, 10), 100));
  p_window_seconds := greatest(60, least(coalesce(p_window_seconds, 600), 86400));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  for v_stale in
    select id, charged_bucket
    from public.lifevu_generation_requests
    where user_id = v_user_id
      and status = 'processing'
      and created_at < pg_catalog.now() - interval '2 minutes'
    for update
  loop
    if v_stale.charged_bucket is not null then
      perform public.lifevu_adjust_generation_bucket(
        v_user_id,
        v_stale.charged_bucket,
        1
      );
    end if;

    update public.lifevu_generation_requests
    set status = 'refunded', finished_at = pg_catalog.now()
    where id = v_stale.id and status = 'processing';
  end loop;

  if exists (
    select 1
    from public.lifevu_generation_requests
    where user_id = v_user_id and status = 'processing'
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'generation_in_progress',
      'retry_after', 5
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(created_at)
  into v_count, v_oldest
  from public.lifevu_generation_requests
  where user_id = v_user_id
    and created_at >= pg_catalog.now()
      - pg_catalog.make_interval(secs => p_window_seconds);

  if v_count >= p_rate_limit_max then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(extract(epoch from (
        v_oldest
        + pg_catalog.make_interval(secs => p_window_seconds)
        - pg_catalog.now()
      )))::integer
    );
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'rate_limited',
      'retry_after', v_retry_after
    );
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'profile_missing'
    );
  end if;

  if v_profile.ultimo_reset_diario < v_today then
    v_previous_daily_authorization := pg_catalog.current_setting(
      'lifevu.daily_reset_authorized',
      true
    );
    perform pg_catalog.set_config(
      'lifevu.daily_reset_authorized',
      '1',
      true
    );

    update public.profiles
    set moedas_free = 5,
        ultimo_reset_diario = v_today
    where id = v_user_id
    returning * into v_profile;

    perform pg_catalog.set_config(
      'lifevu.daily_reset_authorized',
      coalesce(v_previous_daily_authorization, ''),
      true
    );
  end if;

  v_is_vip := coalesce(v_profile.plano, '') ilike '%VIP%'
    and v_profile.vip_vencimento is not null
    and v_profile.vip_vencimento > pg_catalog.now();

  if not v_is_vip then
    if coalesce(v_profile.moedas_free, 0) > 0 then
      perform public.lifevu_adjust_generation_bucket(v_user_id, 'free', -1);
      v_bucket := 'free';
    elsif coalesce(v_profile.moedas_vip, 0) > 0 then
      perform public.lifevu_adjust_generation_bucket(v_user_id, 'vip', -1);
      v_bucket := 'vip';
    elsif coalesce(v_profile.moedas_avulsas, 0) > 0 then
      perform public.lifevu_adjust_generation_bucket(v_user_id, 'purchased', -1);
      v_bucket := 'purchased';
    else
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'code', 'insufficient_coins'
      );
    end if;
  end if;

  insert into public.lifevu_generation_requests
    (user_id, status, charged_bucket)
  values
    (v_user_id, 'processing', v_bucket)
  returning id into v_request_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'vip', v_is_vip,
    'charged_bucket', v_bucket
  );
end;
$$;

revoke all on function public.lifevu_begin_generation(integer, integer)
  from public, anon;
grant execute on function public.lifevu_begin_generation(integer, integer)
  to authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_original_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.lifevu_finish_generation(uuid,boolean)'
  ) is null then
    execute $function$
      create function public.lifevu_finish_generation(
        p_request_id uuid,
        p_succeeded boolean
      )
      returns boolean
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        v_user_id uuid := auth.uid();
        v_request public.lifevu_generation_requests%rowtype;
      begin
        if v_user_id is null then
          return false;
        end if;

        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(v_user_id::text, 0)
        );

        select * into v_request
        from public.lifevu_generation_requests
        where id = p_request_id and user_id = v_user_id
        for update;

        if not found or v_request.status <> 'processing' then
          return false;
        end if;

        if p_succeeded then
          update public.lifevu_generation_requests
          set status = 'succeeded', finished_at = pg_catalog.now()
          where id = p_request_id and status = 'processing';
          return found;
        end if;

        if v_request.charged_bucket is not null then
          perform public.lifevu_adjust_generation_bucket(
            v_user_id,
            v_request.charged_bucket,
            1
          );
        end if;

        update public.lifevu_generation_requests
        set status = 'refunded', finished_at = pg_catalog.now()
        where id = p_request_id and status = 'processing';
        return found;
      end;
      $body$;
    $function$;
  else
    v_definition := pg_catalog.pg_get_functiondef(
      'public.lifevu_finish_generation(uuid,boolean)'::regprocedure
    );

    if pg_catalog.strpos(
      v_definition,
      'lifevu_adjust_generation_bucket'
    ) = 0 then
      v_original_definition := v_definition;

      if pg_catalog.strpos(
        v_definition,
        'update public.profiles set moedas_free = moedas_free + 1 where id = v_user_id;'
      ) = 0
         or pg_catalog.strpos(
           v_definition,
           'update public.profiles set moedas_vip = moedas_vip + 1 where id = v_user_id;'
         ) = 0
         or pg_catalog.strpos(
           v_definition,
           'update public.profiles set moedas_avulsas = moedas_avulsas + 1 where id = v_user_id;'
         ) = 0 then
        raise exception
          'Unexpected definition of public.lifevu_finish_generation()';
      end if;

      v_definition := pg_catalog.replace(
        v_definition,
        'update public.profiles set moedas_free = moedas_free + 1 where id = v_user_id;',
        'perform public.lifevu_adjust_generation_bucket(v_user_id, ''free'', 1);'
      );
      v_definition := pg_catalog.replace(
        v_definition,
        'update public.profiles set moedas_vip = moedas_vip + 1 where id = v_user_id;',
        'perform public.lifevu_adjust_generation_bucket(v_user_id, ''vip'', 1);'
      );
      v_definition := pg_catalog.replace(
        v_definition,
        'update public.profiles set moedas_avulsas = moedas_avulsas + 1 where id = v_user_id;',
        'perform public.lifevu_adjust_generation_bucket(v_user_id, ''purchased'', 1);'
      );

      if v_definition = v_original_definition then
        raise exception
          'Expected generation refund updates in public.lifevu_finish_generation()';
      end if;

      execute v_definition;
    end if;
  end if;
end;
$migration$;

revoke all on function public.lifevu_finish_generation(uuid, boolean)
  from public, anon;
grant execute on function public.lifevu_finish_generation(uuid, boolean)
  to authenticated, service_role;
