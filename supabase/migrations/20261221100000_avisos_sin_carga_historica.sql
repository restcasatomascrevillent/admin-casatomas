set client_encoding = 'UTF8';
-- ============================================================================
-- 20261221100000_avisos_sin_carga_historica · «389 documentos con avisos sin revisar»
-- ----------------------------------------------------------------------------
-- Queja del dueño (24/11/2026): Telegram dice «389 documentos con avisos sin revisar»,
-- una cifra tan alta que no sirve para nada.
-- Causa (SELECT en producción, 24/11): de esos 389, 315 vienen de la carga masiva del zip de
-- facturas (import_clave no nulo, subidas el 08, 15 y 16/11) y 292 de ellos son de más de 90
-- días. El resumen cuenta todo documento sin verificar con algún aviso de lectura cuyo
-- created_at tenga más de 7 días: según cada tanda de la carga cumplía los 7 días, la cifra
-- subía sola (190 → 210 → 213 → 274 → 389 del 17 al 24/11) sin que nadie subiera nada.
-- Regla nueva: se cuenta lo ACCIONABLE = lo subido a mano o por la bandeja (import_clave nulo)
-- y lo importado de los últimos 90 días (por fecha del documento). La carga histórica antigua
-- ya no cuenta. En producción quedan 97 (74 subidos a mano o por la bandeja + 23 importados
-- recientes) en lugar de 389.
-- Qué cambia:
--   1. facturas_aviso_accionable(import_clave, fecha, hoy, dias): la regla, en un sitio.
--   2. facturas_alertas_candidatas (CTE «avisos») y facturas_alertas_tras_verificar (cuenta y
--      lista de ids) añaden esa condición. Se parchean sobre la definición que hay en la base
--      (sin copiar 600 líneas); si la definición no tiene el texto esperado, la migración falla
--      y no toca nada.
--   3. avisos_telegram_datos_semanal (si existe: llegó en 20261209400000): la cifra de
--      «Facturas con avisos» del resumen semanal, con la misma regla («lo mismo que cuenta
--      Por revisar»; en producción 417 → 125).
-- Después de aplicarla: select public.facturas_generar_alertas(); (el aviso de 389 caduca y
-- sale el de 97). No borra ni cambia ningún documento: solo deja de contar los antiguos.
-- Rollback: supabase/rollbacks/20261221100000_avisos_sin_carga_historica_ROLLBACK.sql
-- Test: node scripts/test-avisos-historicos.mjs
-- ============================================================================
begin;

create or replace function public.facturas_aviso_accionable(
  p_import_clave text,
  p_fecha date,
  p_hoy date,
  p_dias int default 90
) returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select p_import_clave is null or p_fecha >= p_hoy - p_dias
$$;

comment on function public.facturas_aviso_accionable(text, date, date, int) is
  '¿Cuenta este documento en «N documentos con avisos sin revisar»? Lo subido a mano o por la bandeja (sin import_clave) y lo importado de los últimos p_dias días; la carga histórica antigua no. 20261221100000.';

do $mig$
declare
  v_ancla_a constant text := 'and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))';
  v_nuevo_a constant text := v_ancla_a || E'\n       and public.facturas_aviso_accionable(fa.import_clave, fa.fecha, v_hoy)';
  v_firma text;
  v_def text;
  v_nueva text;
begin
  foreach v_firma in array array['public.facturas_alertas_candidatas(date)', 'public.facturas_alertas_tras_verificar(bigint[])'] loop
    v_def := pg_get_functiondef(v_firma::regprocedure);
    if position('facturas_aviso_accionable' in v_def) > 0 then
      continue; -- ya aplicada
    end if;
    v_nueva := replace(v_def, v_ancla_a, v_nuevo_a);
    if v_nueva = v_def then
      raise exception '% no tiene el texto esperado del filtro de avisos; no se toca', v_firma;
    end if;
    execute v_nueva;
  end loop;

  if to_regprocedure('public.avisos_telegram_datos_semanal(date)') is not null then
    v_def := pg_get_functiondef('public.avisos_telegram_datos_semanal(date)'::regprocedure);
    if position('facturas_aviso_accionable' in v_def) = 0 then
      -- Sin depender de si el salto de línea entre las dos condiciones es LF o CRLF.
      v_nueva := regexp_replace(
        v_def,
        '(and not \(fa\.tipo = ''albaran'' and fa\.facturado_en_id is not null\)\s+)(and jsonb_typeof\(fa\.alertas_validacion\) = ''array'')',
        '\1and public.facturas_aviso_accionable(fa.import_clave, fa.fecha, v_hoy)' || chr(10) || '       \2');
      if v_nueva = v_def then
        raise exception 'avisos_telegram_datos_semanal no tiene el texto esperado del filtro de avisos; no se toca';
      end if;
      execute v_nueva;
    end if;
  end if;
end
$mig$;

commit;
