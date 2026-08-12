-- Finaliza o histórico financeiro sem recriar tabelas ou alterar RLS/policies.
-- Pré-requisitos remotos confirmados: profiles, historico_transacoes e
-- enforce_secure_columns BEFORE UPDATE já existem.

create or replace function public.protect_secure_columns()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_is_admin boolean := false;
begin
  -- Preserva a autorização existente: service_role e administradores podem
  -- atualizar colunas financeiras; usuários comuns não podem.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  ) into v_is_admin;

  if v_is_admin then
    return new;
  end if;

  new.moedas_avulsas := old.moedas_avulsas;
  new.creditos_pagos := old.creditos_pagos;
  new.plano := old.plano;
  new.role := old.role;
  new.vip_vencimento := old.vip_vencimento;
  return new;
end;
$$;

create or replace function public.record_financial_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_paid integer;
  v_coins_granted integer;
begin
  -- Compatibilidade com a RPC idempotente opcional da migration de economia:
  -- quando ela própria grava o histórico, o trigger não duplica a linha.
  if current_setting('lifevu.purchase_history_written_by_rpc', true) = '1' then
    return new;
  end if;

  v_paid := coalesce(new.creditos_pagos, 0) - coalesce(old.creditos_pagos, 0);

  if v_paid <= 0 then
    return new;
  end if;

  if v_paid = 5000 and coalesce(new.plano, '') ilike '%VIP 15%' then
    insert into public.historico_transacoes
      (user_id, tipo, descricao, data_hora)
    values
      (new.id, 'Automático', 'VIP 15 Dias · 5000 créditos', now());
    return new;
  end if;

  if v_paid = 9000 and coalesce(new.plano, '') ilike '%VIP 30%' then
    insert into public.historico_transacoes
      (user_id, tipo, descricao, data_hora)
    values
      (new.id, 'Automático', 'VIP 30 Dias · 9000 créditos', now());
    return new;
  end if;

  v_coins_granted := coalesce(new.moedas_avulsas, 0)
    - coalesce(old.moedas_avulsas, 0);

  if v_coins_granted <= 0 then
    return new;
  end if;

  insert into public.historico_transacoes
    (user_id, tipo, descricao, data_hora)
  values (
    new.id,
    'Automático',
    format(
      '+%s moedas · %s créditos · Moedas avulsas',
      v_coins_granted,
      v_paid
    ),
    now()
  );

  return new;
end;
$$;

revoke all on function public.record_financial_transaction() from public;

drop trigger if exists record_financial_transaction_after_update
  on public.profiles;

create trigger record_financial_transaction_after_update
after update of creditos_pagos on public.profiles
for each row
when (
  coalesce(new.creditos_pagos, 0) > coalesce(old.creditos_pagos, 0)
)
execute function public.record_financial_transaction();
