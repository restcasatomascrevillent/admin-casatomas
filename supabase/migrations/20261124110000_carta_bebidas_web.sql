-- Carta de Bebidas en la web: interruptor, apagado por defecto (11/11/2026, petición del dueño:
-- «Desactiva de la web la carta de Bebidas (añade un botón en el admin panel por si se quiere activar
-- las bebidas o no en la web, por defecto no)»).
--
-- Lo cambia Gestor web › Carta › Bebidas (permiso de editar «gestor_carta», la política UPDATE que ya
-- tiene la tabla). La web pública lo lee al construirse y cada minuto: apagado, la página
-- /carta/bebidas no sale (lleva a /carta) y desaparecen los botones que llevaban a ella.
--
-- Vuelta atrás: supabase/rollbacks/20261124110000_carta_bebidas_web_ROLLBACK.sql

do $$
begin
  if to_regclass('public.configuracion_web') is null then
    raise exception 'carta_bebidas_web: falta public.configuracion_web (20261001113700)';
  end if;
end;
$$;

alter table public.configuracion_web
  add column if not exists mostrar_carta_bebidas_casa_tomas boolean not null default false;

comment on column public.configuracion_web.mostrar_carta_bebidas_casa_tomas is
  'Carta de Bebidas en la web de Casa Tomás (/carta/bebidas). Apagada por defecto (11/11/2026).';

-- Las webs leen con anon; el panel cambia el valor con «gestor_carta» (RLS configuracion_web_update_seccion).
grant select (mostrar_carta_bebidas_casa_tomas) on public.configuracion_web to anon, authenticated;
grant update (mostrar_carta_bebidas_casa_tomas) on public.configuracion_web to authenticated;

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select mostrar_carta_bebidas_casa_tomas from public.configuracion_web;   -- false
