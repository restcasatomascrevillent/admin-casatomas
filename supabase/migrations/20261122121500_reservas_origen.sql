set client_encoding = 'UTF8';
-- «Cómo se hizo la reserva» (pedido del dueño, 10/11/2026).
--
-- reservas.origen (jsonb, opcional): lo escribe SOLO la Edge Function
-- reservas-web al crear una reserva desde la web. Forma v1:
--   { "v": 1,
--     "cliente":  { formulario_abierto_at, primer_contacto_at, enviado_at,
--                   duracion_segundos, campos_cambiados[], consultas_disponibilidad,
--                   consultas_sin_hueco, intentos_fallidos, idioma, idioma_navegador,
--                   pagina_entrada, pagina_formulario, referente (solo host),
--                   utm_*, qr, pantalla_ancho, pantalla_alto, tactil } | null,
--     "servidor": { recibido_at, user_agent, dispositivo, navegador, sistema,
--                   ip_hash (HMAC con sal, 16 hex; nunca la IP), procedencia } }
-- Las reservas del teléfono, del panel y las anteriores a esta migración
-- quedan con origen NULL: el panel enseña entonces lo que haya (created_at,
-- canal, auditoría).
--
-- RGPD: sin datos de contacto (ya están en la fila). Se borra con la reserva
-- (misma retención que el resto de la fila: limpieza RGPD existente).
-- Idempotente. Vuelta atrás: supabase/rollbacks/20261122121500_reservas_origen_ROLLBACK.sql
begin;

alter table public.reservas add column if not exists origen jsonb;

comment on column public.reservas.origen is
  'Cómo se hizo la reserva (web): tiempos del formulario, página de entrada, utm, dispositivo y lo que ve reservas-web (UA, HMAC de IP). NULL en teléfono/panel/antiguas. Lo escribe reservas-web.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_origen_objeto_acotado' and conrelid = 'public.reservas'::regclass
  ) then
    -- Tope de tamaño de defensa: la función ya limita lo del navegador a 4 KB.
    alter table public.reservas
      add constraint reservas_origen_objeto_acotado
      check (origen is null or (jsonb_typeof(origen) = 'object' and pg_column_size(origen) <= 16384));
  end if;
end $$;

commit;
