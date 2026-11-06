set client_encoding = 'UTF8';
-- Caso 1 (D12) · DEMO sfonaclosuafvlhutkon · 06/11/2026
-- Solo se vincula el albarán Makro 386 (pedido 9-242608469, 06/10/2026) a la factura 2360
-- (R1664.pdf p.1: «*** Número de pedido 9-242608469 … Fecha: 06/10/2026» y las 12 líneas del
-- albarán con las mismas cantidades e importes). Mismo mecanismo que el panel.
begin;
do $$
declare r jsonb;
begin
  if (select facturado_en_id from facturas where id = 386) is not null then
    raise notice 'El albarán 386 ya estaba vinculado; no se toca.';
    return;
  end if;
  if (select numero_documento from facturas where id = 386) <> '9-242608469'
     or (select import_clave from facturas where id = 2360) <> 'zip2026:R1664.pdf#0' then
    raise exception 'Los documentos 386 / 2360 no son los esperados';
  end if;
  r := vincular_albaran_factura(386, 2360, false);
  raise notice '%', r;
end $$;
select id, facturado_en_id, facturado_origen from facturas where id = 386;
commit;
