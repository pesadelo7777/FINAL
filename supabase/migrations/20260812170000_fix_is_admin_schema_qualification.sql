do $migration$
declare
  current_definition text := pg_catalog.pg_get_functiondef(
    'public.is_admin()'::regprocedure
  );
  fixed_definition text;
begin
  fixed_definition := pg_catalog.replace(
    current_definition,
    'FROM profiles',
    'FROM public.profiles'
  );

  if fixed_definition = current_definition then
    raise exception 'Expected FROM profiles in public.is_admin()';
  end if;

  execute fixed_definition;
end;
$migration$;
