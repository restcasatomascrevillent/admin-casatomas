set client_encoding = 'UTF8';
-- ROLLBACK de 20261209100000_servicios_cierre.sql: devuelve Loading, Vercel,
-- Hostinger y Mapbox a como estaban (de la copia que guardó la migración),
-- borra el contador de cargas del mapa de vinos (¡se pierden las cargas
-- contadas!) y el cuadre de la IA, y deja `servicios_cargas_mapa_vinos` como
-- en 20261122153000 (sesiones con el evento `mapa_vinos`).
-- Antes, volver a desplegar la versión anterior de `servicios-uso` y de la web.
begin;

do $$
begin
  if to_regclass('public.servicios_contratados_copia_cierre') is not null then
    update public.servicios_contratados s
       set nombre = c.fila ->> 'nombre',
           plan = c.fila ->> 'plan',
           ciclo = c.fila ->> 'ciclo',
           precio_mensual = (c.fila ->> 'precio_mensual')::numeric,
           precio_anual = (c.fila ->> 'precio_anual')::numeric,
           moneda = c.fila ->> 'moneda',
           activo = (c.fila ->> 'activo')::boolean,
           por_confirmar = (c.fila ->> 'por_confirmar')::boolean,
           precio_confirmado_en = (c.fila ->> 'precio_confirmado_en')::date,
           fuente_precio = c.fila ->> 'fuente_precio',
           plan_siguiente = c.fila ->> 'plan_siguiente',
           precio_siguiente = (c.fila ->> 'precio_siguiente')::numeric,
           si_se_pasa = c.fila ->> 'si_se_pasa',
           para_que = c.fila ->> 'para_que',
           notas = c.fila ->> 'notas',
           limites = coalesce(c.fila -> 'limites', '{}'::jsonb)
      from public.servicios_contratados_copia_cierre c
     where c.proveedor = s.proveedor;
    drop table public.servicios_contratados_copia_cierre;
  end if;
end;
$$;

drop function if exists public.ia_cuadre_openai(date, date);
drop function if exists public.mapa_vinos_contar_carga();

create or replace function public.servicios_cargas_mapa_vinos(p_desde timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  if to_regclass('public.web_eventos') is null then
    return null;
  end if;
  execute $q$
    select count(distinct coalesce(sesion_id::text, evento_id::text))::int
      from public.web_eventos
     where tipo = 'mapa_vinos' and entorno = 'produccion'
       and not es_bot and not es_prueba and not es_interno
       and ocurrido_en >= $1
  $q$ into v using p_desde;
  return v;
end;
$$;
revoke all on function public.servicios_cargas_mapa_vinos(timestamptz) from public, anon, authenticated;
grant execute on function public.servicios_cargas_mapa_vinos(timestamptz) to service_role;

drop table if exists public.mapa_vinos_cargas;

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    update public.ia_funciones set instrumentada = false where funcion = 'procesar-dibujo-perimetro';
  end if;
end;
$$;

commit;
