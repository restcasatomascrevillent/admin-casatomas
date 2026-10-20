-- =====================================================================
-- ROLLBACK de 20260923100000_resenas_lectura_publica_segura.sql
-- Restaura el estado EXACTO anterior a la migracion.
--
-- QUE HACE ESTO SI SE EJECUTA
--   Devuelve `anon` al privilegio de tabla completa sobre `resenas` que
--   tenia antes (SELECT de tabla, no de columna) y borra la politica
--   "Publico puede ver resenas publicadas". El resultado NO es una fuga:
--   sin ninguna politica que deje pasar filas a `anon`, la RLS vuelve a
--   devolver 0 filas para ese rol exactamente como hoy (comprobado:
--   `set local role anon; select count(*) from resenas` -> 0 antes de la
--   migracion que este fichero revierte). Es decir, este rollback deshace
--   el arreglo y vuelve a dejar el carrusel de resenas de la web vacio y en
--   silencio -- el mismo bug que la migracion cerraba -- pero NO reabre el
--   acceso a `email`: no hay fila visible para `anon` de la que leerlo.
--   Usar solo si el arreglo rompio algo en produccion y hay que volver
--   atras con prisa.
-- =====================================================================

begin;

-- Inverso de "create policy ... Publico puede ver resenas publicadas ..."
drop policy if exists "Público puede ver reseñas publicadas" on public.resenas;

-- Inverso de "grant select (columnas concretas) ... to anon"
revoke select (id, nombre_cliente, comentario, valoracion, fecha, estado, google_rating)
  on public.resenas from anon;

-- Inverso de "revoke select on public.resenas from anon" -- devuelve el
-- privilegio de tabla completa que anon tenia antes de la migracion.
grant select on public.resenas to anon;

commit;
