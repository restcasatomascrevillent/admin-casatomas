set client_encoding = 'UTF8';
-- Vuelta atrás de 20261204100000_chat_presupuestos: quita las tres funciones y la tabla
-- (los presupuestos del chat se pierden; no son facturas ni se usan fuera del chat).
begin;
drop function if exists public.comparar_presupuesto_agente(uuid, numeric, numeric);
drop function if exists public.referencias_precio_agente(bigint, text, text, date);
drop function if exists public.emparejar_presupuesto_agente(jsonb);
drop table if exists public.chat_presupuestos;
commit;
