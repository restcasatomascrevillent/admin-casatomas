-- Últimos dos «ORIGEN PENDIENTE», resueltos buscando el vino en la web.
-- Brión Cepas Vellas: Godello 2024, bodega Brión, D.O. Ribeira Sacra (Quiroga, Lugo) — fichas Campoluz/Mentta.
-- Tumba del Rey Moro 2022 (solo prod): Garnacha de Comando G; Bodeboca/La Cava de Piñero/CellarTracker = Vinos de Madrid
-- (European Cellars dice Cebreros; el viñedo está en Villanueva de Ávila según Vinous). Confirmar en contraetiqueta.
begin;
update "Vinos" set categoria='VINOS BLANCOS — RIBEIRA SACRA', denominacion_origen='D.O. Ribeira Sacra',
  ubicacion_pais='España', ubicacion_region='Quiroga, Lugo'
 where id like '117a840e%' and categoria ilike '%ORIGEN PENDIENTE%';
update "Vinos" set categoria='VINOS TINTOS — VINOS DE MADRID', denominacion_origen='D.O. Vinos de Madrid',
  ubicacion_pais='España', ubicacion_region=coalesce(nullif(btrim(ubicacion_region),''),'Villanueva de Ávila, Ávila')
 where id like '04d8f2cc%' and categoria ilike '%ORIGEN PENDIENTE%';
commit;
