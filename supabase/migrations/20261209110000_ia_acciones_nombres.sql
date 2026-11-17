set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261209110000_ia_acciones_nombres — Servicios › Costes › «Gasto de IA por
-- acción»: nombre en palabras para las funciones de IA que no lo tenían
-- ===========================================================================
-- Dueño (17/11/2026): «En la IA de OpenAI que detecte cuánto gasto hay por
-- acción, leer facturas, chatbot facturas, traducir, novedades, recortes, lo
-- que haya, pero que lo controle todo».
--
-- La pantalla ya saca el gasto de cada función (ia_coste_por_uso) y ahora lo
-- enseña por acción, cruzado con el catálogo (ia_funciones). Tres funciones
-- del catálogo no tenían frase de acción y dos tampoco «qué hace»: salían con
-- su nombre técnico. Aquí se les pone. Solo donde está vacío: no pisa nada.
--
-- APLICAR: demo primero (sfonaclosuafvlhutkon); producción (haqmmdfdzzatdnrrcgez)
-- solo tras aceptar el PR de la release y con el «sí» del dueño. Idempotente.
-- No hace falta desplegar ninguna función.
-- Deshacer: supabase/rollbacks/20261209110000_ia_acciones_nombres_ROLLBACK.sql
-- Pruebas: npm run test:servicios-cierre:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.ia_funciones') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'ia_funciones' and column_name = 'accion') then
    raise exception 'ia_acciones_nombres: falta 20261129153000_costes_servicios_ia. No se ha cambiado nada.';
  end if;
end;
$$;

update public.ia_funciones f
   set que_hace = coalesce(nullif(f.que_hace, ''), v.que_hace),
       accion   = coalesce(nullif(f.accion, ''), v.accion)
  from (values
    ('embeddings-nombres', 'Prepara los nombres de los productos de las facturas para poder buscarlos por parecido (sola, al llegar nombres nuevos).', 'Preparar una tanda de nombres de producto para el buscador'),
    ('analizar-peticion',  'Analiza una petición de mejora del panel y propone cómo hacerla.',                                                   'Analizar una petición de mejora'),
    ('buscar-precios-mercado', 'Precios de lonja con Perplexity (ya no se usa).',                                                              'Buscar precios de lonja')
  ) as v(funcion, que_hace, accion)
 where f.funcion = v.funcion
   and (nullif(f.que_hace, '') is null or nullif(f.accion, '') is null);

commit;
