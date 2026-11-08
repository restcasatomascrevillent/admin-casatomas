-- ===========================================================================
-- Mesas que se usan AL FINAL (para dejar paso)
-- ===========================================================================
--
-- Petición del dueño (08/11/2026): «En el Comedor, prioriza que las reservas
-- no vayan a las mesas 10, 11 y 12, porque ahí prefieren que no se sienten
-- para dejar mejor el paso, si se puede.»
--
-- NO es una exclusión (eso es asignacion_mesas_excluidas): estas mesas se
-- siguen ofreciendo, pero todos los repartos automáticos del panel
-- («Organizar», «Recalcular mesas», reemplazo al quitar una mesa prevista,
-- propuestas al sentar) las dejan como ÚLTIMO RECURSO, justo antes de
-- «sin mesa». Una reserva que ya está en una de ellas (a mano o fijada) se
-- respeta. La elección manual del camarero no se bloquea.
--
-- Columna nueva, mismo patrón que asignacion_mesas_excluidas
-- (20260930110000_config_asignacion.sql):
--   · asignacion_mesas_al_final uuid[] NOT NULL DEFAULT '{}'
-- Sin FK (Postgres no las admite en arrays): un uuid de una mesa borrada es
-- dato muerto inofensivo. No cambia el aforo ni toca asignaciones.
--
-- Relleno inicial: las mesas 10, 11 y 12 del Comedor de Casa Tomás, SOLO si
-- existen con esos ids y la lista sigue vacía (idempotente; en una BD sin
-- esas mesas no hace nada).
--
-- Rollback: supabase/rollbacks/20261108120000_mesas_usar_al_final_ROLLBACK.sql
-- (revertir ANTES el frontend que lee la columna).
-- ===========================================================================

alter table public.configuracion_reservas
  add column if not exists asignacion_mesas_al_final uuid[] not null default '{}'::uuid[];

comment on column public.configuracion_reservas.asignacion_mesas_al_final is
  'Mesas (mesas.id) que los repartos automáticos del panel usan solo como último recurso (para dejar paso). Se pueden elegir a mano. No cambia el aforo ni las asignaciones existentes.';

update public.configuracion_reservas c
set asignacion_mesas_al_final = m.ids
from (
  select array_agg(id order by nombre) as ids
  from public.mesas
  where id in (
    '24b5bbdc-b360-4ffb-b7f6-11b68536a73f',
    'bf592cfe-6634-4090-b9a9-83a7fe3b6254',
    'cda9eb0b-edf8-40b3-9af1-2e54782afe46'
  )
) m
where m.ids is not null
  and c.asignacion_mesas_al_final = '{}'::uuid[];

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select asignacion_mesas_al_final from public.configuracion_reservas;
--   -- -> {24b5bbdc-…, bf592cfe-…, cda9eb0b-…} (o {} si no existen esas mesas)
-- ===========================================================================
