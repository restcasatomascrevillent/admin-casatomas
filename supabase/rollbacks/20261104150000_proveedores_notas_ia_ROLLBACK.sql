-- Deshace 20261104150000_proveedores_notas_ia (borra las indicaciones escritas).
drop function if exists public.proveedores_notas_ia_guardar(bigint, text);
alter table public.proveedores drop constraint if exists proveedores_notas_ia_largo;
alter table public.proveedores drop column if exists notas_ia;
