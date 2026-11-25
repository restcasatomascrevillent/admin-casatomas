set client_encoding = 'UTF8';
-- ============================================================================
-- 20261222100000_telegram_facturas — Telegram: un mensaje por factura y cierre del día (25/11/2026)
-- ----------------------------------------------------------------------------
-- Petición del dueño: «cuando se suba un aviso, si ha subido el precio, si hay algo que destacar de esa factura, se
-- tiene que enviar automáticamente a Telegram con lo que ha pasado de forma explícita y el enlace al Drive de esa
-- factura […] también que al final del día mande un aviso con el resumen de facturas que se han subido ese día».
--
-- El mensaje por factura (y el precio con el mismo margen de marisco y vino) lo arma la función avisos-telegram; aquí:
-- 1. avisos_telegram_config: cierre_activo (sí), cierre_hora (22, hora de Madrid) y cierre_ultimo_dia (uno al día).
--    El super admin cambia los dos primeros desde Super Admin › Servicios › Configurar › Telegram.
-- 2. Facturas «al momento»: se añaden Importes inusuales y Precio pactado roto (también hablan de una factura) a
--    tipos_al_momento (la fila actual y el valor por defecto). Se pueden quitar desde el panel.
-- 3. avisos_telegram_hay_pendientes(): las subidas de precio (facturas_precio_sube) cuentan aunque no suenen en la
--    campana (impacto de menos de 10 €/mes o agrupadas por proveedor). Misma regla que logica.ts → AVISA_SIEMPRE.
-- 4. avisos_telegram_disparar('cierre'): una vez al día a partir de cierre_hora, al chat de Resúmenes.
-- 5. Registro de envíos: tipo 'cierre'. Cron avisos-telegram-cierre (cada hora, a y 10).
--
-- Columnas nuevas, funciones, un cron y dos tipos más al momento. No activa Telegram.
-- APLICAR (nunca `db push`): demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo con el «sí»
-- del dueño. La función avisos-telegram nueva funciona también sin ella (salvo «cierre»). Idempotente.
-- Tiene que terminar en «telegram_facturas: aplicada».
-- Deshacer: supabase/rollbacks/20261222100000_telegram_facturas_ROLLBACK.sql
-- Pruebas:  node scripts/test-telegram-facturas.mjs (PGlite)
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.avisos_telegram_reservas') is null or to_regprocedure('public.avisos_telegram_canal(text)') is null then
    raise exception 'telegram_facturas: faltan 20261216100000_telegram_canales y 20261217100000_telegram_reservas_estado. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Cierre del día ──────────────────────────────────────────────────────
alter table public.avisos_telegram_config
  add column if not exists cierre_activo     boolean  not null default true,
  add column if not exists cierre_hora       smallint not null default 22 check (cierre_hora between 0 and 23),
  add column if not exists cierre_ultimo_dia date;

comment on column public.avisos_telegram_config.cierre_activo is
  'Cierre del día por Telegram (facturas subidas hoy y avisos del día) al chat de Resúmenes (20261222100000).';
comment on column public.avisos_telegram_config.cierre_hora is
  'Hora de Madrid a partir de la que sale el cierre del día (20261222100000).';
comment on column public.avisos_telegram_config.cierre_ultimo_dia is
  'Día (Madrid) del último cierre enviado o mirado sin nada que contar: uno al día (20261222100000).';

grant update (cierre_activo, cierre_hora) on public.avisos_telegram_config to authenticated;

-- ─── 2. Importes inusuales y precio pactado roto, al momento ────────────────
alter table public.avisos_telegram_config alter column tipos_al_momento
  set default array['facturas_margen_bajo', 'facturas_precio_sube', 'facturas_importe_inusual', 'facturas_precio_pactado'];
update public.avisos_telegram_config
   set tipos_al_momento = tipos_al_momento
         || array(select t from unnest(array['facturas_importe_inusual', 'facturas_precio_pactado']) t where t <> all(tipos_al_momento))
 where id and not (tipos_al_momento @> array['facturas_importe_inusual', 'facturas_precio_pactado']);

-- ─── 3. ¿Hay algo por mandar al momento? Subidas aunque no suenen ───────────
create or replace function public.avisos_telegram_hay_pendientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- Avisos del panel marcados «al momento» (Facturas y márgenes). Los de reservas ya no: van por avisos_telegram_reservas.
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
     where n.tipo = any(c.tipos_al_momento)
       and n.tipo not like 'reserva\_%'
       and (case public.avisos_telegram_canal(n.tipo)
              when 'reservas' then coalesce(c.chat_reservas, c.chat_id)
              else coalesce(c.chat_facturas, c.chat_id)
            end) is not null
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo not like 'ia\_modelo%'
       -- 20261222100000: las subidas de precio, aunque no suenen en la campana (impacto pequeño o agrupadas).
       and (coalesce(n.datos ->> 'campana', 'true') <> 'false' or n.tipo = 'facturas_precio_sube')
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  ) or exists (
    -- Pasos de reserva por mandar (misma regla que avisos_telegram_reservas_reclamar).
    select 1
      from public.avisos_telegram_reservas x
      join public.avisos_telegram_config c on c.id
     where c.reservas_al_momento
       and coalesce(c.chat_reservas, c.chat_id) is not null
       and x.enviado_en is null and x.intentos < 3
       and x.created_at >= greatest(coalesce(c.activo_desde, now()), now() - interval '1 day')
       and (x.reclamado_en is null or x.reclamado_en < now() - interval '2 minutes')
  );
$$;
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

-- ─── 4. Disparador: acción «cierre» ─────────────────────────────────────────
create or replace function public.avisos_telegram_disparar(p_accion text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.avisos_telegram_config%rowtype;
  v_ahora   timestamp := now() at time zone 'Europe/Madrid';
  v_url     text;
  v_secreto text;
begin
  if p_accion not in ('pendientes', 'resumen', 'fallos', 'semanal', 'cierre') then
    raise exception 'avisos_telegram_disparar: acción desconocida %', p_accion;
  end if;
  select * into c from public.avisos_telegram_config where id;
  if not found or not c.activo then
    return 'inactivo';
  end if;
  -- 20261216100000: cada acción va al chat de su canal. Reservas y Facturas usan el general (chat_id) si no
  -- tienen el suyo; los fallos técnicos, solo chat_fallos.
  if (case p_accion
        when 'pendientes' then coalesce(c.chat_reservas, c.chat_facturas, c.chat_id)
        when 'fallos'     then c.chat_fallos
        else coalesce(c.chat_resumenes, c.chat_id)
      end) is null then
    return 'sin_chat';
  end if;

  if p_accion = 'pendientes' then
    if c.silencio_activo and public.avisos_telegram_en_silencio(extract(hour from v_ahora)::int, c.silencio_desde, c.silencio_hasta) then
      return 'silencio';
    end if;
    if not public.avisos_telegram_hay_pendientes() then
      return 'nada';
    end if;
  elsif p_accion = 'fallos' then
    -- Fallos internos: sin silencio nocturno; solo si hay alguno por mandar.
    if not exists (
      select 1 from public.fallos_internos f
       where f.enviado_en is null and f.intentos < 3
         and f.created_at >= public.fallos_internos_desde()
         and (f.reclamado_en is null or f.reclamado_en < now() - interval '2 minutes')
    ) then
      return 'nada';
    end if;
  elsif p_accion = 'cierre' then
    -- 20261222100000: cierre del día, una vez al día a partir de cierre_hora (si esa hora falla, lo intenta la siguiente).
    if not c.cierre_activo
       or extract(hour from v_ahora)::int < c.cierre_hora
       or c.cierre_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
  elsif p_accion = 'semanal' then
    -- Una vez a la semana: el día y la hora configurados (si esa hora falla, lo intenta la siguiente).
    if not c.semanal_activo
       or extract(isodow from v_ahora)::int <> c.semanal_dia
       or extract(hour from v_ahora)::int < c.semanal_hora
       or c.semanal_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
  else
    -- Una vez al día, a partir de la hora configurada (si una hora falla, lo intenta la siguiente).
    if extract(hour from v_ahora)::int < c.hora_resumen or c.resumen_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
    -- Limpieza: el registro guarda 90 días.
    delete from public.avisos_telegram_envios where enviado_en < now() - interval '90 days';
    delete from public.fallos_internos where created_at < now() - interval '90 days';
  end if;

  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return 'sin_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return 'sin_vault';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/functions/v1/avisos-telegram',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('accion', p_accion);
  return 'llamada';
end;
$$;
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- ─── 5. Registro de envíos y cron ───────────────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal', 'reserva', 'cierre'));

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-cierre') then
      perform cron.unschedule('avisos-telegram-cierre');
    end if;
    perform cron.schedule('avisos-telegram-cierre', '10 * * * *', $cron$ select public.avisos_telegram_disparar('cierre'); $cron$);
  else
    raise notice 'telegram_facturas: no hay pg_cron; el cron del cierre NO se ha instalado.';
  end if;
end;
$$;

do $$ begin raise notice 'telegram_facturas: aplicada'; end $$;

commit;
