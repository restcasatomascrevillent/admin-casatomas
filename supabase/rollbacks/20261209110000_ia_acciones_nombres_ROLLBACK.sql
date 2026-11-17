set client_encoding = 'UTF8';
-- ROLLBACK de 20261209110000_ia_acciones_nombres.sql: quita la frase de acción
-- (y el «qué hace» que no tenían) a las tres funciones, solo si siguen con el
-- texto que puso la migración.
begin;

update public.ia_funciones set accion = null
 where (funcion, accion) in (
   ('embeddings-nombres', 'Preparar una tanda de nombres de producto para el buscador'),
   ('analizar-peticion', 'Analizar una petición de mejora'),
   ('buscar-precios-mercado', 'Buscar precios de lonja'));

update public.ia_funciones set que_hace = null
 where (funcion, que_hace) in (
   ('embeddings-nombres', 'Prepara los nombres de los productos de las facturas para poder buscarlos por parecido (sola, al llegar nombres nuevos).'),
   ('analizar-peticion', 'Analiza una petición de mejora del panel y propone cómo hacerla.'));

commit;
