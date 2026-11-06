set client_encoding = 'UTF8';
-- Caso 7 (D17) · DEMO · importes > 10.000 € confirmados en el PDF.
-- El aviso «total_documento_extremo» lo vuelve a calcular la base de datos (no se puede borrar):
-- se marcan como REVISADAS (verificada = true, origen manual) las facturas cuyo único aviso es ese
-- o cuyos avisos se han comprobado: 1300 (Embajadores, R670) y 1574 (Galmar, R881).
-- 605 (Joselito) ya estaba verificada; 2158 (Embajadores, R1479) se deja: su aviso es de CIF.
begin;
update facturas set verificada = true
 where id in (1300, 1574) and import_clave in ('zip2026:R670.pdf#0', 'zip2026:R881.pdf#0') and not coalesce(verificada, false);
select id, verificada, verificacion_origen from facturas where id in (1300, 1574, 605, 2158) order by id;
commit;
