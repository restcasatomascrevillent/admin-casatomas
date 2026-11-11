-- Prueba de 20261123100000_envase_tercio_litro (solo lectura).
do $$
declare v numeric; u text;
begin
  select volumen, unidad into v, u from public.envase_texto('Heineken 1/3 L caja 24');
  if v is distinct from 0.33 or u is distinct from 'l' then raise exception '1/3 L leído como % %', v, u; end if;
  select volumen into v from public.envase_texto('Agua 1/5 L');
  if v is distinct from 0.2 then raise exception '1/5 L leído como %', v; end if;
  select volumen into v from public.envase_texto('Mahou 1/2 L');
  if v is distinct from 0.5 then raise exception '1/2 L leído como %', v; end if;
  select volumen into v from public.envase_texto('Cerveza tercio 1/3');
  if v is distinct from 0.33 then raise exception '1/3 sin unidad leído como %', v; end if;
  if exists (select 1 from public.productos_catalogo
              where nombre ~* '\m1\s*/\s*3\s*(l|lts?|litros?)\y'
                and envase_origen is distinct from 'manual'
                and envase_cantidad is distinct from 0.33) then
    raise exception 'quedan productos «1/3 L» con envase distinto de 0,33 l';
  end if;
  raise notice 'envase_tercio_litro_test: OK';
end $$;
select 'envase_tercio_litro_test: OK' as resultado;
