-- ROLLBACK de 20261102160000_trabajos_recorte.sql (recorte de fotos en un ordenador).
-- Aplicar a mano SOLO si hay que deshacerlo. Borra los trabajos pendientes
-- (las fotos NO: siguen en la ficha, sin recortar). El panel sigue
-- funcionando sin la tabla: guarda la foto normal y avisa.
begin;
drop function if exists public.soltar_trabajo_recorte(uuid);
drop function if exists public.terminar_trabajo_recorte(uuid, boolean, text);
drop function if exists public.reclamar_trabajo_recorte(uuid, text);
drop function if exists public.trabajos_recorte_permiso();
drop table if exists public.trabajos_recorte;
drop function if exists public.trabajos_recorte_validar();
commit;
