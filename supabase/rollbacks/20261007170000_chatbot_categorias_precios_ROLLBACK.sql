set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261007170000_chatbot_categorias_precios.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261007170000_chatbot_categorias_precios_ROLLBACK.sql
--
-- ANTES: volver a desplegar la chat-facturas anterior (la nueva llama a
-- gasto_categorias_agente y variacion_precios_agente; sin ellas esas dos
-- herramientas dan error y el chatbot dice que no ha podido consultar).
-- El panel no se rompe: el control «Avisos de precio» de Facturas ›
-- Productos desaparece solo si no está la tabla.
-- Si también se va a revertir 20261007160000 (catálogo), ESTE va PRIMERO:
-- avisos_subida_precio apunta a productos_catalogo.
--
-- Quita los dos triggers de aviso de productos_factura y sus funciones, las
-- RPC gasto_categorias_agente y variacion_precios_agente, los ayudantes
-- (categoria_agente, lineas_precio_agente, precio_referencia_agente,
-- mismo_proveedor_agente, precio_es_agente) y las tablas
-- avisos_subida_precio y configuracion_facturas (se pierde el umbral
-- elegido). Las notificaciones de la campana que ya se crearon (tipo
-- 'subida_precio') se QUEDAN: son avisos ya dados; se pueden borrar desde la
-- campana. No toca facturas, líneas, catálogo ni categorías.
-- Imprime «chatbot_categorias_precios: revertida | funciones que quedan: 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop trigger if exists trg_productos_factura_aviso_precio_ins on public.productos_factura;
drop trigger if exists trg_productos_factura_aviso_precio_upd on public.productos_factura;
drop function if exists public.productos_factura_aviso_precio();
drop function if exists public.productos_avisar_subidas(bigint[]);
drop function if exists public.variacion_precios_agente(date, date, numeric, text, text, integer, text);
drop function if exists public.gasto_categorias_agente(text, date, date, text, text);
drop function if exists public.precio_referencia_agente(bigint, text, date, bigint);
drop function if exists public.lineas_precio_agente(bigint, bigint[]);
drop function if exists public.categoria_agente(text);
drop function if exists public.precio_es_agente(numeric, integer);
drop function if exists public.mismo_proveedor_agente(text, text);
drop table if exists public.avisos_subida_precio;
drop table if exists public.configuracion_facturas;
drop function if exists public.configuracion_facturas_tocar();

notify pgrst, 'reload schema';

commit;

select 'chatbot_categorias_precios: revertida | funciones que quedan: '
       || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('gasto_categorias_agente', 'variacion_precios_agente', 'precio_referencia_agente',
                                'lineas_precio_agente', 'categoria_agente', 'precio_es_agente', 'mismo_proveedor_agente',
                                'productos_avisar_subidas', 'productos_factura_aviso_precio', 'configuracion_facturas_tocar'))
       as resultado;
