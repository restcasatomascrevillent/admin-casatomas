set client_encoding = 'UTF8';
-- ROLLBACK de 20261115400000_margenes_por_peso_datos: vuelve los dos mapeos
-- estimados como estaban en 20261115210000 (solo si siguen en 'estimado' /
-- sin revisar; lo corregido a mano se queda).

update public.escandallo_platos e
   set producto_id = 2251, nota = 'se vende al peso: 1 kg en crudo', updated_at = now()
 where e.plato_id = '111e2e2d-5357-47c2-baf2-3e7a72ea4579'
   and e.producto_id = 300
   and e.origen = 'estimado'
   and not exists (select 1 from public.escandallo_platos x where x.plato_id = e.plato_id and x.producto_id = 2251);

delete from public.margenes_carta_revision
 where tipo = 'plato' and articulo_id = '3bc24b89-c7d7-40fd-a126-86fe704563e3'
   and not revisado
   and sin_mapear_motivo like 'No hay compras de calamar de bahía fresco%';

insert into public.escandallo_platos (plato_id, producto_id, cantidad, unidad, origen, nota, orden)
select '3bc24b89-c7d7-40fd-a126-86fe704563e3', 221, 1000, 'g', 'estimado', 'se vende al peso: 1 kg', 0
 where exists (select 1 from public."Platos" where id = '3bc24b89-c7d7-40fd-a126-86fe704563e3')
   and exists (select 1 from public.productos_catalogo where id = 221)
   and not exists (select 1 from public.escandallo_platos where plato_id = '3bc24b89-c7d7-40fd-a126-86fe704563e3');

select 'margenes_por_peso_datos: deshecha' as resultado;
