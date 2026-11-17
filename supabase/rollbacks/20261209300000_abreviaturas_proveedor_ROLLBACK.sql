-- Vuelta atrás de 20261209300000_abreviaturas_proveedor.
-- Quita los triggers, las funciones y la tabla (se pierde el diccionario aprendido; se reconstruye con la migración
-- y `select public.abreviaturas_recalcular();`). clasificar-productos sin la tabla sigue funcionando (la ignora).
set lock_timeout = '5s';
drop trigger if exists trg_productos_factura_abreviaturas_ins on public.productos_factura;
drop trigger if exists trg_productos_factura_abreviaturas_upd on public.productos_factura;
drop function if exists public.productos_factura_aprender_abreviatura();
drop function if exists public.abreviaturas_recalcular(bigint);
drop function if exists public.abreviaturas_observar_linea(text, bigint, bigint, integer);
drop function if exists public.abreviaturas_token_generico(text);
drop table if exists public.abreviaturas_proveedor;
