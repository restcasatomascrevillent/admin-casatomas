-- ROLLBACK de 20261104121000_servicios_configurables.sql (Super Admin › Servicios ›
-- Configurar: añadir y borrar servicios).
-- Aplicar a mano SOLO si hay que deshacerlo, y ANTES del rollback de
-- 20261103160000 si se quieren deshacer los dos (la política de borrado usa la
-- columna `activo`). Quita:
--   · el permiso de dar de alta (INSERT) y de borrar (DELETE) del super admin,
--     con sus políticas;
--   · el trigger que borra las lecturas de un servicio borrado;
--   · el texto nuevo del límite automático de OpenAI (vuelve el de la semilla).
-- NO borra los servicios que el dueño haya añadido: quedan como cualquier otro
-- (se pueden editar y quitar, pero ya no añadir ni borrar).
begin;
set local lock_timeout = '5s';

drop policy if exists servicios_contratados_insert_super_admin on public.servicios_contratados;
drop policy if exists servicios_contratados_delete_super_admin on public.servicios_contratados;
-- Quitar el INSERT de la tabla quita también el de cada columna.
revoke insert, delete on public.servicios_contratados from authenticated;

drop trigger if exists servicios_contratados_al_borrar on public.servicios_contratados;
drop function if exists public.servicios_contratados_al_borrar();

update public.servicios_contratados
   set limites = jsonb_set(limites, '{gasto_ia_mes,limite_desde}', to_jsonb('Tope de gasto de IA de Super Admin › Costes'::text))
 where proveedor = 'openai'
   and limites -> 'gasto_ia_mes' ->> 'limite_desde' = 'Tope de gasto de IA de Super Admin › Servicios › Costes';

comment on table public.servicios_contratados is
  'Servicios contratados (Super Admin › Servicios): plan, precio, renovación, cuenta, enlace al panel y LÍMITES del plan '
  '({ métrica: { etiqueta, limite, unidad, periodo, fuente, nota, orden } }; limite null = sin dato). Solo super admin. '
  'El consumo lo lee la Edge Function servicios-uso y lo guarda en servicios_uso.';

commit;
