-- Ajustes del dueño sobre 20261114140000: Torelló y Gramona agrupados como Cava; Artadi como Rioja.
begin;
update "Vinos" set categoria='VINOS ESPUMOSOS — CAVA', denominacion_origen='D.O. Cava'
 where categoria='VINOS ESPUMOSOS — CORPINNAT';
update "Vinos" set categoria='VINOS TINTOS — RIOJA', denominacion_origen='D.O.Ca. Rioja'
 where (id like '83ae3d93%' or id like '7e02d098%') and categoria='VINOS TINTOS — SIN D.O.';
commit;
