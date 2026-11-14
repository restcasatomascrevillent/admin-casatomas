set client_encoding = 'UTF8';
-- ROLLBACK de 20261129143100_ia_tarifas_sin_coste.sql: quita el trigger de
-- ia_precios y las dos funciones. Se quedan, a propósito, las tarifas dadas de
-- alta y los costes ya recalculados en ia_uso: son datos correctos (la tarifa
-- oficial y la cuenta de ia_registrar_uso) y quitarlos volvería a dejar las
-- preguntas del chat de Facturas «sin coste». Si aun así hubiera que borrar
-- una tarifa: delete from public.ia_precios where modelo = '…'; (las filas ya
-- recalculadas conservan su coste).
begin;

drop trigger if exists ia_precios_retarifar on public.ia_precios;
drop function if exists public.ia_precios_retarifar();
drop function if exists public.ia_retarifar_sin_coste(text);

commit;
