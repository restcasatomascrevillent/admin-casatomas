set client_encoding = 'UTF8';
-- 20261122190000_reservas_menu_cerrado — «Menú cerrado» (de grupo) y su precio (10/11/2026)
--
-- Petición del dueño: «hay que poner un seleccionable para entender la reserva,
-- que se pueda poner si hay menú o no hay, y si hay que ponga el precio de ese
-- menú» (p. ej. un menú de grupo de 55 €).
--
-- OJO: NO es el «Menú del día» (`reservas.menu_del_dia`, 20261122100000:
-- martes a jueves a mediodía, Comedor o Terraza, lo usa la web), que sigue igual.
-- Aquí van dos columnas nuevas y propias:
--   · `menu_cerrado`  boolean NOT NULL DEFAULT false — selector «Menú cerrado: No / Sí»
--     del panel (cualquier día). Se guarda aparte para que «Sí» sin precio aún
--     escrito se distinga de «No».
--   · `menu_precio`   numeric(6,2) NULL — precio del menú en euros (>= 0); NULL =
--     sin precio. Solo con `menu_cerrado = true` (CHECK).
-- Idempotente. Vuelta atrás: supabase/rollbacks/20261122190000_reservas_menu_cerrado_ROLLBACK.sql
begin;

alter table public.reservas
  add column if not exists menu_cerrado boolean not null default false,
  add column if not exists menu_precio numeric(6,2);

alter table public.reservas drop constraint if exists reservas_menu_precio_no_negativo;
alter table public.reservas
  add constraint reservas_menu_precio_no_negativo check (menu_precio is null or menu_precio >= 0);

alter table public.reservas drop constraint if exists reservas_menu_precio_solo_menu_cerrado;
alter table public.reservas
  add constraint reservas_menu_precio_solo_menu_cerrado check (menu_precio is null or menu_cerrado);

comment on column public.reservas.menu_cerrado is
  'Menú cerrado (de grupo) del panel: selector «Menú cerrado: No / Sí», cualquier día. NO es menu_del_dia (menú del día de martes a jueves).';
comment on column public.reservas.menu_precio is
  'Precio del menú cerrado en euros. NULL = sin precio. Solo con menu_cerrado = true.';

commit;
