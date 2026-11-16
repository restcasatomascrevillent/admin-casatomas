set client_encoding = 'UTF8';
-- Control del enlace ingrediente -> producto en escandallo_platos.
--
-- Problema (07/12/2026): al copiar escandallos de la demo a producción, 16 filas
-- quedaron con un producto_id que en producción es OTRO producto (la nota decía
-- «queso manchego curado» y el producto era «Gamba blanca N1»; «huevos» iba a
-- «Oreja de cerdo»). Nada lo detectaba.
--
-- Qué hace esta migración (no bloquea nunca un guardado):
--   1. escandallo_enlace_dudoso(nota, producto): true si la nota tiene palabras con
--      significado y NINGUNA aparece en el nombre del producto.
--        · Palabras = 3+ letras, sin acentos, sin «palabras de relleno» (cantidades,
--          envases, «se vende al peso»...). Una nota sin palabras con significado
--          («una lata», «se vende al peso») no se juzga: false.
--        · Coincide una palabra si es igual a una del producto sin plural (huevos =
--          huevo), si comparten las 5 primeras letras (berenjena, parmesano ~
--          parmesana) o si pg_trgm word_similarity(palabra, producto) >= 0,6.
--        · Umbral 0,6: en la demo las notas bien enlazadas con una palabra distinta
--          puntúan 0,29-0,36 («ajetes»/«Ajo tierno» 0,29) y los errores reales
--          ~0. Con 0,6 no hay término medio: o hay raíz común o se avisa. Preferimos
--          un falso aviso («ajetes» ~ «Ajos tiernos», «parmesano» ~ «Grana Padano»)
--          a un fallo silencioso.
--   2. Columna escandallo_platos.revisar_enlace + trigger BEFORE INSERT/UPDATE de
--      nota o producto_id que la calcula SIEMPRE (guardado manual por la RPC
--      margenes_guardar_escandallo, estimación automática o copia de datos).
--   3. escandallos_enlaces_dudosos(): lista las filas dudosas recalculando en el
--      momento (sirve aunque el trigger estuviera desactivado al copiar datos).
--      Lanzarla tras copiar datos entre proyectos:
--        select * from public.escandallos_enlaces_dudosos();
begin;
set local lock_timeout = '5s';

create extension if not exists pg_trgm with schema extensions;

alter table public.escandallo_platos
  add column if not exists revisar_enlace boolean not null default false;

create or replace function public.escandallo_enlace_dudoso(p_nota text, p_producto text)
returns boolean
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_relleno constant text[] := array[
    'con','sin','los','las','del','que','hay','una','uno','unos','unas','dos','tres','cuatro','por','mas','les',
    'media','medio','vende','peso','lata','latas','pieza','piezas','caja','bote','bola','bolas','cubeta',
    'racion','raciones','porcion','filete','filetes','crudo','cruda','cocido','linea','lineas','compra','compras',
    'docena','calibre','cada','esta','este','puede','ser','barato','mezcladas','servidos','servido','hueso',
    'rendimiento','merma','cocer','troceada','troceado','cuando','como','entre','solo','para','kilo','gramos',
    'litro','litros','unidad','unidades','aprox','aproximadamente','dicen','recientes','cuentan','cajas','capricho'];
  v_prod text := lower(unaccent(coalesce(p_producto, '')));
  t text;
  p text;
  v_hay boolean := false;
  v_casa boolean;
  v_casa_alguna boolean := false;
begin
  if nullif(btrim(coalesce(p_nota, '')), '') is null then
    return false;
  end if;
  for t in
    select distinct m[1] from regexp_matches(lower(unaccent(p_nota)), '[a-z]{3,}', 'g') as m
  loop
    if t = any (v_relleno) then continue; end if;
    v_hay := true;
    v_casa := false;
    for p in select m[1] from regexp_matches(v_prod, '[a-z]{3,}', 'g') as m loop
      if regexp_replace(t, 'e?s$', '') = regexp_replace(p, 'e?s$', '')
         or (length(t) >= 5 and length(p) >= 5 and left(t, 5) = left(p, 5)) then
        v_casa := true;
        exit;
      end if;
    end loop;
    if not v_casa and extensions.word_similarity(t, v_prod) >= 0.6 then
      v_casa := true;
    end if;
    if v_casa then
      v_casa_alguna := true;
      exit;
    end if;
  end loop;
  return v_hay and not v_casa_alguna;
end;
$$;

create or replace function public.escandallo_marcar_enlace()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.revisar_enlace := public.escandallo_enlace_dudoso(
    new.nota, (select nombre from public.productos_catalogo where id = new.producto_id));
  return new;
end;
$$;

drop trigger if exists escandallo_marcar_enlace_trg on public.escandallo_platos;
create trigger escandallo_marcar_enlace_trg
  before insert or update of nota, producto_id on public.escandallo_platos
  for each row execute function public.escandallo_marcar_enlace();

-- Marca las filas que ya existen.
update public.escandallo_platos e
   set revisar_enlace = public.escandallo_enlace_dudoso(
         e.nota, (select p.nombre from public.productos_catalogo p where p.id = e.producto_id))
 where e.revisar_enlace is distinct from public.escandallo_enlace_dudoso(
         e.nota, (select p.nombre from public.productos_catalogo p where p.id = e.producto_id));

create or replace function public.escandallos_enlaces_dudosos()
returns table (
  id bigint, plato_id text, plato text, producto_id bigint, producto text,
  nota text, origen text, marcada boolean)
language sql
stable
set search_path = public, extensions
as $$
  select e.id, e.plato_id, pl.nombre, e.producto_id, p.nombre, e.nota, e.origen, e.revisar_enlace
    from public.escandallo_platos e
    join public.productos_catalogo p on p.id = e.producto_id
    left join public."Platos" pl on pl.id = e.plato_id
   where public.escandallo_enlace_dudoso(e.nota, p.nombre)
   order by pl.nombre, e.orden;
$$;

revoke all on function public.escandallos_enlaces_dudosos() from public, anon;
grant execute on function public.escandallos_enlaces_dudosos() to authenticated, service_role;
revoke all on function public.escandallo_enlace_dudoso(text, text) from public, anon;
grant execute on function public.escandallo_enlace_dudoso(text, text) to authenticated, service_role;

commit;
