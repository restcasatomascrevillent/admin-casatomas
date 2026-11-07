set client_encoding = 'UTF8';
-- 20261107620000_ia_modelos_herramientas (07/11/2026)
--
-- gpt-6.1-sol no sirve para chat-facturas ni chat-web: con reasoning_effort
-- "none" OpenAI responde 400 («does not support 'none' with this model») y con
-- "low", 400 «Function tools with reasoning_effort are not supported … use
-- /v1/responses» (docs/facturas/EVAL-MODELOS.md). Si alguien lo elegía en
-- Super Admin › Servicios › Modelos, cada pregunta fallaba y pasaba al respaldo.
--
--   1. ia_modelos_disponibles.compatible_herramientas (NULL = sin probar,
--      true/false = resultado de «Probar»: llamada mínima a Chat Completions con
--      una herramienta y los parámetros de nuestras funciones), con
--      compatible_motivo y compatible_probado_en. Lo escribe ia-modelos-openai.
--   2. ia_modelo_funcion.usa_herramientas (true en chat-facturas y chat-web; no
--      lo puede cambiar el panel: el GRANT de UPDATE sigue siendo de modelo,
--      modelo_respaldo y notas).
--   3. ia_modelo_funcion_antes rechaza guardar (modelo o respaldo) un modelo con
--      compatible_herramientas = false en una función con usa_herramientas.
--   4. ia_modelos_centro devuelve los campos nuevos (el selector los deshabilita).
--   5. gpt-6.1-sol se marca ya como incompatible con el motivo de la evaluación.
-- Test: supabase/tests/ia_modelos_herramientas_test.sql
-- Rollback: supabase/rollbacks/20261107620000_ia_modelos_herramientas_ROLLBACK.sql
begin;
set local lock_timeout = '5s';

alter table public.ia_modelos_disponibles
  add column if not exists compatible_herramientas boolean,
  add column if not exists compatible_motivo text check (compatible_motivo is null or length(compatible_motivo) <= 400),
  add column if not exists compatible_probado_en timestamptz;
comment on column public.ia_modelos_disponibles.compatible_herramientas is
  'Resultado de «Probar» (ia-modelos-openai): ¿admite Chat Completions con herramientas y los parámetros de nuestras '
  'funciones? NULL = sin probar. false = no se puede elegir en funciones con usa_herramientas. 20261107620000.';

alter table public.ia_modelo_funcion
  add column if not exists usa_herramientas boolean not null default false;
comment on column public.ia_modelo_funcion.usa_herramientas is
  'La función llama a Chat Completions con herramientas (function calling): solo admite modelos con '
  'ia_modelos_disponibles.compatible_herramientas distinto de false. 20261107620000.';

CREATE OR REPLACE FUNCTION public.ia_modelo_funcion_antes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_m text;
  v_motivo text;
begin
  if tg_op = 'UPDATE' and new.funcion is distinct from old.funcion then
    raise exception 'La función de una fila de ia_modelo_funcion no se puede cambiar' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.modelo is not distinct from old.modelo
     and new.modelo_respaldo is not distinct from old.modelo_respaldo
     and new.notas is not distinct from old.notas
     and new.modelo_codigo is not distinct from old.modelo_codigo
     and new.centralizado is not distinct from old.centralizado then
    return new;
  end if;
  if (new.modelo is not null or new.modelo_respaldo is not null) and not new.centralizado then
    raise exception 'La función % todavía no lee el modelo de esta tabla (centralizado = false): cambiarlo aquí no tendría efecto', new.funcion
      using errcode = '23514';
  end if;
  foreach v_m in array array_remove(array[new.modelo, new.modelo_respaldo], null) loop
    if tg_op = 'UPDATE' and (v_m is not distinct from old.modelo or v_m is not distinct from old.modelo_respaldo) then
      continue; -- ya estaba puesto: no se revalida (puede haberse retirado después)
    end if;
    if not exists (select 1 from public.ia_modelos_disponibles d where d.id = v_m and d.retirado_en is null) then
      raise exception 'El modelo % no está entre los modelos disponibles de la cuenta de OpenAI (o está retirado). Actualiza la lista antes.', v_m
        using errcode = '23514';
    end if;
    -- 20261107620000_ia_modelos_herramientas: chat-facturas y chat-web llaman a
    -- Chat Completions CON herramientas; un modelo que «Probar» marcó como
    -- incompatible fallaría en cada pregunta.
    if new.usa_herramientas then
      select d.compatible_motivo into v_motivo
        from public.ia_modelos_disponibles d
       where d.id = v_m and d.compatible_herramientas is false;
      if found then
        raise exception 'El modelo % no sirve para % (usa herramientas con Chat Completions): %', v_m, new.funcion,
          coalesce(v_motivo, 'la prueba con herramientas falló') using errcode = '23514';
      end if;
    end if;
  end loop;
  new.cambiado_en := now();
  new.cambiado_por := auth.uid();
  -- Sin usuario (SQL a mano, service_role): quien lo haga puede firmar con
  -- `set local ia_modelos.cambiado_por = '…'`; si no, «sistema».
  new.cambiado_por_email := coalesce(nullif(auth.jwt() ->> 'email', ''),
                                     nullif(left(current_setting('ia_modelos.cambiado_por', true), 120), ''),
                                     'sistema');
  return new;
end;
$function$;

-- Sin pasar por la validación (solo cambia usa_herramientas: el trigger no hace nada).
update public.ia_modelo_funcion set usa_herramientas = true
 where funcion in ('chat-facturas', 'chat-web') and not usa_herramientas;

update public.ia_modelos_disponibles
   set compatible_herramientas = false,
       compatible_motivo = 'OpenAI 400: no admite reasoning_effort "none"; con "low" exige /v1/responses para usar herramientas '
                           || '(evaluación del 07/11/2026, docs/facturas/EVAL-MODELOS.md).',
       compatible_probado_en = now()
 where id = 'gpt-6.1-sol' and compatible_herramientas is null;

CREATE OR REPLACE FUNCTION public.ia_modelos_centro(p_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with dias as (select greatest(1, least(coalesce(p_dias, 30), 366)) as n),
  coste as (
    select u.funcion, sum(u.coste_usd) as usd, sum(u.llamadas) as llamadas,
           bool_or(u.coste_usd is null and u.llamadas > 0) as sin_tarifa
      from public.ia_uso_diario u, dias
     where u.dia >= (current_date - dias.n)
     group by u.funcion
  ),
  ultimo as (
    select distinct on (x.funcion) x.funcion, x.modelo, x.created_at
      from public.ia_uso x
     where x.created_at > now() - interval '60 days'
     order by x.funcion, x.created_at desc
  )
  select jsonb_build_object(
    'dias', (select n from dias),
    'funciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'funcion', f.funcion,
               'descripcion', fn.descripcion,
               'modelo', f.modelo,
               'modelo_respaldo', f.modelo_respaldo,
               'modelo_codigo', f.modelo_codigo,
               'centralizado', f.centralizado,
               'usa_herramientas', f.usa_herramientas,
               'notas', f.notas,
               'cambiado_por_email', f.cambiado_por_email,
               'cambiado_en', f.cambiado_en,
               'ultimo_modelo_usado', ul.modelo,
               'ultimo_uso', ul.created_at,
               'coste_usd', c.usd,
               'llamadas', c.llamadas,
               'coste_sin_tarifa', coalesce(c.sin_tarifa, false))
             order by f.centralizado desc, fn.orden, f.funcion)
        from public.ia_modelo_funcion f
        join public.ia_funciones fn on fn.funcion = f.funcion
        left join coste c on c.funcion = f.funcion
        left join ultimo ul on ul.funcion = f.funcion), '[]'::jsonb),
    'disponibles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'owned_by', d.owned_by,
               'creado_openai', d.creado_openai,
               'primera_vez_visto', d.primera_vez_visto,
               'ultima_vez_visto', d.ultima_vez_visto,
               'retirado_en', d.retirado_en,
               'de_interes', d.de_interes,
               'nuevo', (not d.primera_carga and d.primera_vez_visto > now() - interval '30 days'),
               'usd_por_m_input', p.usd_por_m_input,
               'usd_por_m_output', p.usd_por_m_output,
               'precio_fuente', p.fuente,
               'compatible_herramientas', d.compatible_herramientas,
               'compatible_motivo', d.compatible_motivo,
               'compatible_probado_en', d.compatible_probado_en)
             order by d.retirado_en is not null, d.de_interes desc, d.creado_openai desc nulls last, d.id)
        from public.ia_modelos_disponibles d
        left join public.ia_precios p on p.modelo = d.id), '[]'::jsonb),
    'ultima_lista', (select max(d.ultima_vez_visto) from public.ia_modelos_disponibles d),
    'historial', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.cambiado_en desc)
        from (select h.funcion, h.modelo_anterior, h.modelo_nuevo, h.respaldo_anterior, h.respaldo_nuevo,
                     h.notas, h.cambiado_por_email, h.cambiado_en
                from public.ia_modelo_funcion_historial h
               order by h.cambiado_en desc limit 100) h), '[]'::jsonb)
  );
$function$;

revoke all on function public.ia_modelo_funcion_antes() from public, anon, authenticated;
revoke all on function public.ia_modelos_centro(integer) from public, anon;
grant execute on function public.ia_modelos_centro(integer) to authenticated, service_role;

commit;

select 'ia_modelos_herramientas: aplicada' as resultado;
