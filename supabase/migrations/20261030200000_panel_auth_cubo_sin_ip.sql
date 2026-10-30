-- ===========================================================================
--  CT-REM-FN-03 (residual «cubo sin-ip», hallazgo de V2) ·
--  iniciar_intento_panel: los intentos sin IP comparten un cubo limitado.
--
--  Sin aplicar: la aplica el dueño (demo primero). Requiere
--  20261030151000_panel_auth_limite_por_email.sql. Misma firma
--  (p_email text, p_ruta text) y mismo contrato {id, permitido[, motivo]}.
--
--  DEFECTO (previo a la remediación, reproducido en PGlite):
--    * Cuando panel-auth manda `x-audit-ip: ''` (sin cf-connecting-ip ni
--      X-Forwarded-For), el trigger fn_identificar_actor_auditoria guarda
--      ip_address = '' (coalesce('' , NULL) = '').
--    * La función calculaba v_ip = 'sin-ip' y contaba
--      `ip_address is not distinct from nullif(v_ip,'sin-ip')`, es decir
--      `ip_address IS NULL`. Las filas con '' nunca casaban: el cubo sin IP
--      no tenía límite por IP (31, 100… intentos admitidos).
--
--  ARREGLO: la IP de la petición y la de cada fila se normalizan con la misma
--  expresión: '' y NULL -> 'sin-ip'. Todo intento sin IP (cabecera vacía o
--  ausente) cae en un único cubo «sin-ip» al que se aplican los mismos 30/min
--  que a cualquier IP. El límite por email (10 / 15 min) no cambia.
--  No se toca el trigger de auditoría (lo usa toda la auditoría del panel):
--  la fila sigue guardando '' o NULL tal cual llega.
--
--  Índice de expresión nuevo para que el conteo por cubo siga siendo barato
--  (el de 20261008080000 está sobre ip_address «en crudo» y no sirve para la
--  expresión normalizada).
--
--  search_path vacío; todo calificado. Idempotente.
--  Rollback: supabase/rollbacks/20261030200000_panel_auth_cubo_sin_ip_ROLLBACK.sql
-- ===========================================================================

begin;

create index if not exists idx_audit_log_accesos_panel_ip_cubo
  on public.audit_log ((coalesce(nullif(ip_address, ''), 'sin-ip')), created_at)
  where tabla = 'accesos_panel';

create or replace function public.iniciar_intento_panel(p_email text, p_ruta text default '/auth')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_ip        constant integer  := 30;                    -- por cubo de IP y minuto
  c_max_email     constant integer  := 10;                    -- por email ...
  c_ventana_email constant interval := interval '15 minutes'; -- ... en esta ventana
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip      text;
  v_email   text := left(lower(btrim(coalesce(p_email, ''))), 255);
  v_id      uuid;
  v_n_ip    bigint;
  v_n_email bigint;
  v_motivo  text;
begin
  if auth.role() is distinct from 'service_role' or v_headers->>'x-audit-source' is distinct from 'panel-auth' then
    raise exception 'Solo panel-auth';
  end if;
  -- Misma normalización que el conteo: '' / ausente -> 'sin-ip'. El trigger
  -- guarda left(x-audit-ip, 128), así que se recorta igual antes de comparar.
  v_ip := coalesce(nullif(left(v_headers->>'x-audit-ip', 128), ''), 'sin-ip');

  perform pg_advisory_xact_lock(hashtextextended('panel-auth:' || v_ip, 0));
  perform pg_advisory_xact_lock(hashtextextended('panel-auth-email:' || v_email, 0));

  select count(*) into v_n_ip from public.audit_log
  where tabla = 'accesos_panel'
    and detalles ? 'email_introducido'
    and coalesce(nullif(ip_address, ''), 'sin-ip') = v_ip
    and created_at > clock_timestamp() - interval '1 minute';

  select count(*) into v_n_email from public.audit_log
  where tabla = 'accesos_panel'
    and detalles->>'email_introducido' = v_email
    and created_at > clock_timestamp() - c_ventana_email
    and coalesce(detalles->>'resultado', '') not in ('limite_intentos', 'correcto');

  if v_n_ip >= c_max_ip then
    v_motivo := 'ip';
  elsif v_n_email >= c_max_email then
    v_motivo := 'email';
  end if;

  insert into public.audit_log (accion, tabla, detalles)
  values (
    case when v_motivo is not null then 'login_fallido' else 'intento_login' end,
    'accesos_panel',
    jsonb_build_object(
      'email_introducido', v_email,
      'ruta', case when p_ruta = '/super-admin/login' then p_ruta else '/auth' end,
      'resultado', case when v_motivo is not null then 'limite_intentos' else 'pendiente' end,
      'identidad_verificada', false)
    || case when v_motivo is not null then jsonb_build_object('limite', v_motivo) else '{}'::jsonb end)
  returning id into v_id;

  if v_motivo is not null then
    return jsonb_build_object('id', v_id, 'permitido', false, 'motivo', v_motivo);
  end if;
  return jsonb_build_object('id', v_id, 'permitido', true);
end;
$$;

revoke all on function public.iniciar_intento_panel(text, text) from public, anon, authenticated;
grant execute on function public.iniciar_intento_panel(text, text) to service_role;

commit;
