-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260930211000_email_reserva_modificada.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- ANTES: revertir y desplegar el codigo.
--   · emails-reserva sin 'reserva_modificada' (supabase functions deploy
--     emails-reserva con la version anterior). Con la version nueva viva y
--     sin estas columnas, /notificar-modificacion responderia
--     plantilla_no_configurada_reserva_modificada (no envia nada: falla
--     cerrado), pero un aviso que estuviera 'fallido' esperando reintento
--     se perderia sin mas.
--   · el panel sin la casilla «Avisar al cliente del cambio» (FormularioReserva).
--     Si no, el personal la veria marcada y cada guardado diria que no se ha
--     podido enviar el aviso.
--
-- QUE SE PIERDE:
--   · el historial de avisos de «reserva modificada» (filas de
--     envios_email_reserva con tipo_email = 'reserva_modificada'): hay que
--     borrarlas para poder volver al CHECK de 5 tipos y al indice unico por
--     (reserva, tipo), que con dos avisos vivos de la misma reserva fallaria;
--   · la plantilla 'reserva_modificada' y todas sus versiones editadas desde
--     el panel.
--   Copia previa si hace falta (antes del begin):
--     create table public.zz_backup_envios_reserva_modificada as
--       select * from public.envios_email_reserva where tipo_email = 'reserva_modificada';
--     create table public.zz_backup_plantillas_reserva_modificada as
--       select * from public.plantillas_email_reserva where tipo = 'reserva_modificada';
--
-- El resto de correos no pierde nada: sus filas tienen clave_aviso y detalle
-- a NULL, y el indice vuelve exactamente a su definicion anterior.
-- No toca reservas, ni el aforo, ni funciones, ni crons.
--
-- COMO: npx supabase db query --linked -f supabase/rollbacks/20260930211000_email_reserva_modificada_ROLLBACK.sql
-- (antes, que no haya transacciones de mas de 1 minuto en pg_stat_activity:
-- ver el paso 1 de la cabecera de la migracion). `lock_timeout = 5s`: si
-- otra sesion tiene cogida una de las dos tablas mas de 5 s, aborta con 55P03
-- y NO deshace nada (va todo en una transaccion): reintentar.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

delete from public.envios_email_reserva where tipo_email = 'reserva_modificada';
delete from public.plantillas_email_reserva where tipo = 'reserva_modificada';

-- Indice: vuelta a (reserva_id, tipo_email). El nuevo se crea antes de
-- quitar el actual: ningun instante sin garantia contra duplicados.
drop index if exists public.uq_envio_email_reserva_activo_anterior;
create unique index uq_envio_email_reserva_activo_anterior
  on public.envios_email_reserva (reserva_id, tipo_email)
  where resultado in ('pendiente', 'enviado');
drop index if exists public.uq_envio_email_reserva_activo;
alter index public.uq_envio_email_reserva_activo_anterior rename to uq_envio_email_reserva_activo;

alter table public.envios_email_reserva
  drop constraint if exists envios_email_reserva_clave_aviso_solo_modificada;
alter table public.envios_email_reserva drop column if exists detalle;
alter table public.envios_email_reserva drop column if exists clave_aviso;

alter table public.envios_email_reserva
  drop constraint if exists envios_email_reserva_tipo_email_check;
alter table public.envios_email_reserva
  add constraint envios_email_reserva_tipo_email_check
  check (tipo_email in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio'));

alter table public.plantillas_email_reserva
  drop constraint if exists plantillas_email_reserva_tipo_check;
alter table public.plantillas_email_reserva
  add constraint plantillas_email_reserva_tipo_check
  check (tipo in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio'));

comment on index public.uq_envio_email_reserva_activo is null;
comment on table public.envios_email_reserva is
  'Registro de cada intento de correo de reserva. La unidad de idempotencia es (reserva_id, tipo_email): ver uq_envio_email_reserva_activo. resend_id cruza con email_eventos (tabla de resend-webhook) para tracking de apertura/rebote.';
comment on table public.plantillas_email_reserva is
  'Contenido editable de los 5 correos de reserva. El esqueleto HTML fijo vive en supabase/functions/emails-reserva/plantillas.ts — esta tabla nunca guarda HTML, solo texto plano con tokens {{nombre}}, {{fecha}}, etc. Historial append-only: una fila por versión, es_actual marca la vigente.';

commit;

-- VERIFICACION:
--   select indexdef from pg_indexes where indexname = 'uq_envio_email_reserva_activo';
--   -- -> ... (reserva_id, tipo_email) WHERE (resultado = ANY (ARRAY['pendiente'::text, 'enviado'::text]))
--   select count(*) from information_schema.columns
--    where table_name = 'envios_email_reserva' and column_name in ('clave_aviso', 'detalle');
--   -- -> 0
--   select count(*) from public.plantillas_email_reserva where tipo = 'reserva_modificada';
--   -- -> 0
