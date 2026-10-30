-- ROLLBACK de migrations/20261030200000_panel_auth_cubo_sin_ip.sql (CT-REM-FN-03, residual «cubo sin-ip»).
-- A mano. Efecto: vuelve a la definición de 20261030151000 (límite por IP y por
-- email). REABRE el residual: con `x-audit-ip: ''` las filas guardan '' y el
-- conteo por IP las compara con NULL, así que el cubo sin IP deja de tener
-- límite por IP (el de email sigue). Borra el índice de expresión. Idempotente.
begin;

create or replace function public.iniciar_intento_panel(p_email text, p_ruta text default '/auth')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_ip        constant integer  := 30;                    -- por IP y minuto (sin cambios)
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
  v_ip := left(coalesce(nullif(v_headers->>'x-audit-ip', ''), 'sin-ip'), 128);

  perform pg_advisory_xact_lock(hashtextextended('panel-auth:' || v_ip, 0));
  perform pg_advisory_xact_lock(hashtextextended('panel-auth-email:' || v_email, 0));

  select count(*) into v_n_ip from public.audit_log
  where tabla = 'accesos_panel'
    and detalles ? 'email_introducido'
    and ip_address is not distinct from nullif(v_ip, 'sin-ip')
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

drop index if exists public.idx_audit_log_accesos_panel_ip_cubo;

commit;
