set client_encoding = 'UTF8';
-- ROLLBACK de 20261115210000_analisis_margenes_carta_datos (mapeo estimado de la carta).
-- Quita SOLO lo estimado que nadie ha tocado: líneas de escandallo y vinos con
-- origen 'estimado' y los motivos de «sin mapear» de artículos no revisados.
-- Lo corregido en el panel (origen 'manual') y lo marcado como revisado se queda.
-- Ojo: un plato con alguna línea corregida a mano tiene TODAS sus líneas en
-- 'manual' (guardar sustituye el escandallo entero), así que no se toca.

delete from public.escandallo_platos where origen = 'estimado';
delete from public.vino_producto where origen = 'estimado';
delete from public.margenes_carta_revision where not revisado and sin_mapear_motivo is not null;

select 'analisis_margenes_carta_datos: deshecha' as resultado;
