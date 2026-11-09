-- ===========================================================================
--  Logs web · operaciones completadas registradas por la base de datos
--
--  Sin aplicar en producción: demo primero. Requiere 20261118100000_logs_web.sql.
--  Idempotente. Deshacer: supabase/rollbacks/20261118100100_logs_web_operaciones_bd_ROLLBACK.sql
--
--  El navegador solo ve las operaciones de quien acepta «Estadísticas». Para
--  que las conversiones de los informes tengan una referencia completa (todos
--  los visitantes), la propia BD apunta en web_eventos (fuente 'base_datos',
--  sin sesión ni datos personales):
--    · reserva_creada_bd      INSERT en reservas con canal = 'web'
--    · reserva_confirmada_bd  una reserva web pasa a confirmada o verificada
--    · cheque_pagado_bd       un cheque con origen = 'web' pasa a pagado
--  valor = comensales / importe en euros (cifras de negocio, no personales).
--
--  REGISTRAR NUNCA ROMPE LA OPERACIÓN: todo va en un bloque con EXCEPTION que
--  solo deja un WARNING. evento_id determinista (md5 de tabla+id+tipo): un
--  cambio de estado repetido no duplica el evento.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.web_eventos') is null then
    raise exception 'logs_web_operaciones_bd: aplica antes 20261118100000_logs_web.sql. No se ha cambiado nada.';
  end if;
end;
$$;

create or replace function public.web_logs_operacion_bd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entorno text;
  v_tipo text;
  v_valor numeric;
  v_id text;
begin
  begin
    if tg_table_name = 'reservas' then
      if coalesce(new.canal, '') <> 'web' then
        return null;
      end if;
      if tg_op = 'INSERT' then
        v_tipo := 'reserva_creada_bd';
      elsif new.estado is distinct from old.estado and new.estado in ('confirmada', 'verificada')
            and coalesce(old.estado, '') not in ('confirmada', 'verificada', 'completada') then
        v_tipo := 'reserva_confirmada_bd';
      else
        return null;
      end if;
      v_valor := new.numero_comensales;
    elsif tg_table_name = 'cheques_regalo' then
      if coalesce(new.origen, '') <> 'web' or new.estado <> 'pagado' then
        return null;
      end if;
      if tg_op = 'UPDATE' and old.estado = 'pagado' then
        return null;
      end if;
      v_tipo := 'cheque_pagado_bd';
      v_valor := new.importe_eur;
    else
      return null;
    end if;

    v_id := new.id::text;
    select entorno_bd into v_entorno from public.web_logs_config where id;
    insert into public.web_eventos (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, valor, propiedades)
    values (md5(tg_table_name || ':' || v_id || ':' || v_tipo)::uuid, now(), coalesce(v_entorno, 'produccion'),
            'casa-tomas-story', 'base_datos', 'operacion', v_tipo, v_valor, jsonb_build_object('tabla', tg_table_name))
    on conflict (evento_id) do nothing;
  exception when others then
    raise warning 'web_logs_operacion_bd (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.web_logs_operacion_bd() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.reservas') is not null then
    execute 'drop trigger if exists web_logs_operacion_bd on public.reservas';
    execute 'create trigger web_logs_operacion_bd after insert or update of estado on public.reservas
             for each row execute function public.web_logs_operacion_bd()';
  end if;
  if to_regclass('public.cheques_regalo') is not null then
    execute 'drop trigger if exists web_logs_operacion_bd on public.cheques_regalo';
    execute 'create trigger web_logs_operacion_bd after insert or update of estado on public.cheques_regalo
             for each row execute function public.web_logs_operacion_bd()';
  end if;
end;
$$;

do $$ begin raise notice 'logs_web_operaciones_bd: aplicada'; end $$;

commit;
