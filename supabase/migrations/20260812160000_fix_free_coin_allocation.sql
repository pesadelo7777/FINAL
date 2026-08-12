-- Correção pontual das moedas gratuitas do LifeVU.
-- Novo perfil: 10 moedas. Renovação diária: saldo gratuito volta para 5.
-- Saldos existentes e moedas avulsas/VIP nunca são alterados pela migration.

alter table public.profiles
  alter column moedas_free set default 10;

alter table public.profiles
  add column if not exists ultimo_reset_diario date;

-- Marca usuários existentes como já renovados hoje sem alterar nenhum saldo.
update public.profiles
set ultimo_reset_diario = (timezone('America/Bahia', now()))::date
where ultimo_reset_diario is null;

alter table public.profiles
  alter column ultimo_reset_diario
    set default (timezone('America/Bahia', now()))::date,
  alter column ultimo_reset_diario set not null;

create or replace function public.lifevu_set_new_profile_free_coins()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.moedas_free := 10;
  new.ultimo_reset_diario := (
    pg_catalog.timezone('America/Bahia', pg_catalog.now())
  )::date;
  return new;
end;
$$;

-- O prefixo zz faz este BEFORE INSERT executar depois de outros triggers do
-- mesmo evento, inclusive um criador legado que ainda envie o valor 2.
drop trigger if exists zz_lifevu_set_new_profile_free_coins
  on public.profiles;

create trigger zz_lifevu_set_new_profile_free_coins
before insert on public.profiles
for each row
execute function public.lifevu_set_new_profile_free_coins();

create or replace function public.protect_secure_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_reset_authorized boolean :=
    coalesce(
      pg_catalog.current_setting('lifevu.daily_reset_authorized', true),
      ''
    ) = '1';
begin
  -- Preserva a regra atual: service_role e administradores podem atualizar
  -- todas as colunas protegidas.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  IF public.is_admin() THEN
      RETURN NEW;
  END IF;

  -- A flag diária nunca libera os demais campos financeiros.
  if new.moedas_avulsas is distinct from old.moedas_avulsas
     or new.creditos_pagos is distinct from old.creditos_pagos
     or new.plano is distinct from old.plano
     or new.role is distinct from old.role
     or new.vip_vencimento is distinct from old.vip_vencimento then
    raise exception
      'Acesso Negado: Tentativa de fraude bloqueada pelo sistema.';
  end if;

  -- Sem a autorização interna, as colunas diárias também são protegidas.
  if not v_daily_reset_authorized
     and (
       new.moedas_free is distinct from old.moedas_free
       or new.ultimo_reset_diario is distinct from old.ultimo_reset_diario
     ) then
    raise exception
      'Acesso Negado: Tentativa de fraude bloqueada pelo sistema.';
  end if;

  return new;
end;
$$;

create or replace function public.resetar_moedas_diarias(usuario_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (
    pg_catalog.timezone('America/Bahia', pg_catalog.now())
  )::date;
  v_last_reset date;
begin
  if auth.uid() is distinct from usuario_id
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select ultimo_reset_diario
  into v_last_reset
  from public.profiles
  where id = usuario_id
  for update;

  if not found or v_last_reset >= v_today then
    return false;
  end if;

  perform pg_catalog.set_config(
    'lifevu.daily_reset_authorized',
    '1',
    true
  );

  update public.profiles
  set moedas_free = 5,
      ultimo_reset_diario = v_today
  where id = usuario_id;

  return true;
end;
$$;

revoke all on function public.resetar_moedas_diarias(uuid) from public;
grant execute on function public.resetar_moedas_diarias(uuid)
  to authenticated, service_role;
