-- Facturas > Proveedores: «Indicaciones para la IA» (proveedores.notas_ia).
-- Texto libre (max. 500) que procesar-factura añade al prompt de lectura, p. ej.
-- «Los mejillones de este proveedor son LATAS, no kg». Solo lo cambia quien tiene
-- permiso de edicion en Facturas, mediante la RPC (la lectura sigue la RLS actual
-- de proveedores). Idempotente. Rollback: supabase/rollbacks/20261104150000_proveedores_notas_ia_ROLLBACK.sql
do $$
begin
  if to_regclass('public.proveedores') is null or to_regprocedure('public.proveedores_puede_editar()') is null then
    raise exception 'proveedores_notas_ia: falta proveedores o proveedores_puede_editar (migracion 20261007180000). No se ha cambiado nada.';
  end if;
end $$;

alter table public.proveedores add column if not exists notas_ia text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.proveedores'::regclass and conname = 'proveedores_notas_ia_largo') then
    alter table public.proveedores add constraint proveedores_notas_ia_largo check (notas_ia is null or length(notas_ia) <= 500);
  end if;
end $$;
comment on column public.proveedores.notas_ia is 'Indicaciones para la lectura por IA de sus documentos (max. 500). Las lee procesar-factura.';

create or replace function public.proveedores_notas_ia_guardar(p_id bigint, p_notas text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notas text := nullif(btrim(regexp_replace(coalesce(p_notas, ''), '\s+', ' ', 'g')), '');
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Cambiar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'Las indicaciones no pueden pasar de 500 caracteres' using errcode = '22023';
  end if;
  update public.proveedores set notas_ia = v_notas where id = p_id;
  if not found then
    raise exception 'No existe el proveedor %', p_id using errcode = 'P0002';
  end if;
  return v_notas;
end;
$$;
revoke all on function public.proveedores_notas_ia_guardar(bigint, text) from public, anon;
grant execute on function public.proveedores_notas_ia_guardar(bigint, text) to authenticated, service_role;
