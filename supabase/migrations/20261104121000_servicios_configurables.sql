set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104121000_servicios_configurables — Super Admin › Servicios ›
-- Configurar: añadir y borrar servicios (04/11/2026)
-- ===========================================================================
-- Petición del dueño: «configurar para quitar elementos o añadir… que la
-- sección de costes vaya dentro de servicios». Hasta ahora el super admin solo
-- podía EDITAR las filas de `servicios_contratados`; las altas y las bajas eran
-- solo de service_role (20261103120000).
--
-- QUÉ CAMBIA
--   1. ALTAS: el super admin puede dar de alta un servicio (INSERT de las
--      columnas que ya edita, más `proveedor`, la clave, que la pantalla saca
--      del nombre). `actualizado_en` y `actualizado_por` NO se conceden: los
--      ponen sus valores por defecto (now() y auth.uid()). Las validaciones
--      (proveedor, nombre, precios, URL https, categoría, límites…) son las
--      CHECK de las dos migraciones anteriores.
--   2. QUITAR SIN BORRAR: no cambia, ya existía: `activo = false` («no lo
--      usamos»), que ni se lee ni suma al coste. La pantalla lo llama «Quitar».
--   3. BORRAR DEL TODO: solo un servicio YA QUITADO (`activo = false`), para
--      que nunca se borre por error uno en uso. Sus lecturas de `servicios_uso`
--      se borran con él (trigger SECURITY DEFINER: el navegador no escribe en
--      esa tabla). El borrado queda en la auditoría (trg_auditoria).
--   4. El límite automático de OpenAI decía «Tope de gasto de IA de Super Admin
--      › Costes»; Costes es ahora una pestaña de Servicios. Se cambia el texto
--      solo si sigue siendo el de la semilla (no pisa lo editado).
--
-- OJO: un servicio de la SEMILLA que se borre volvería si se reaplicaran
-- 20261103120000 o 20261103160000 (`on conflict do nothing`). Para lo que
-- solo no se usa, mejor «Quitar».
--
-- APLICAR (una a una, nunca `db push`): DESPUÉS de 20261103120000 y
-- 20261103160000. Demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del dueño.
-- Idempotente. Termina en «servicios_configurables: aplicada».
-- Deshacer: supabase/rollbacks/20261104121000_servicios_configurables_ROLLBACK.sql
-- (ANTES que el rollback de 20261103160000 si se quieren deshacer los dos).
-- Pruebas: npm run test:servicios:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.servicios_contratados') is null or to_regclass('public.servicios_uso') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_configurables: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.servicios_contratados'::regclass
                    and attname = 'activo' and not attisdropped) then
    raise exception 'servicios_configurables: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Altas (solo super admin) ────────────────────────────────────────────
grant insert (proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas,
              categoria, orden, activo, por_confirmar, precio_anual, fuente_precio)
  on public.servicios_contratados to authenticated;

drop policy if exists servicios_contratados_insert_super_admin on public.servicios_contratados;
create policy servicios_contratados_insert_super_admin
  on public.servicios_contratados for insert to authenticated
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- ─── 3. Borrar del todo: solo lo ya quitado (activo = false) ────────────────
grant delete on public.servicios_contratados to authenticated;

drop policy if exists servicios_contratados_delete_super_admin on public.servicios_contratados;
create policy servicios_contratados_delete_super_admin
  on public.servicios_contratados for delete to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) and not activo );

-- Las lecturas del servicio borrado se van con él (si no, un servicio nuevo
-- con la misma clave heredaría la última lectura del viejo).
create or replace function public.servicios_contratados_al_borrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.servicios_uso where proveedor = old.proveedor;
  return old;
end;
$$;
revoke all on function public.servicios_contratados_al_borrar() from public, anon, authenticated;
drop trigger if exists servicios_contratados_al_borrar on public.servicios_contratados;
create trigger servicios_contratados_al_borrar
  after delete on public.servicios_contratados
  for each row execute function public.servicios_contratados_al_borrar();

comment on table public.servicios_contratados is
  'Servicios contratados (Super Admin › Servicios): plan, precio, renovación, cuenta, enlace al panel y LÍMITES del plan '
  '({ métrica: { etiqueta, limite, unidad, periodo, fuente, nota, orden } }; limite null = sin dato). Solo super admin: '
  'lee, edita, da de alta y borra (solo lo quitado, activo = false; 20261104121000). '
  'El consumo lo lee la Edge Function servicios-uso y lo guarda en servicios_uso.';

-- ─── 4. Texto del límite automático de OpenAI (solo si es el de la semilla) ─
update public.servicios_contratados
   set limites = jsonb_set(limites, '{gasto_ia_mes,limite_desde}', to_jsonb('Tope de gasto de IA de Super Admin › Servicios › Costes'::text))
 where proveedor = 'openai'
   and limites -> 'gasto_ia_mes' ->> 'limite_desde' = 'Tope de gasto de IA de Super Admin › Costes';

-- ─── Comprobación final ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicios_contratados'
                    and policyname = 'servicios_contratados_insert_super_admin' and cmd = 'INSERT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicios_contratados'
                       and policyname = 'servicios_contratados_delete_super_admin' and cmd = 'DELETE')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.servicios_contratados'::regclass
                       and tgname = 'servicios_contratados_al_borrar' and not tgisinternal)
     or not has_column_privilege('authenticated', 'public.servicios_contratados', 'proveedor', 'INSERT')
     or has_column_privilege('authenticated', 'public.servicios_contratados', 'actualizado_por', 'INSERT')
     or not has_table_privilege('authenticated', 'public.servicios_contratados', 'DELETE') then
    raise exception 'servicios_configurables: la comprobación final ha fallado. No se ha cambiado nada.';
  end if;
  raise notice 'servicios_configurables: aplicada';
end;
$$;

commit;
