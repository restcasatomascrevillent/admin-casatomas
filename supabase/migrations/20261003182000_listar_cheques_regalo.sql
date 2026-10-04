-- Listado paginado de tickets con permisos de Cheques.
create or replace function public.listar_cheques_regalo(p_pagina integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare respuesta jsonb;
begin
  if not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  if p_pagina < 0 then raise exception 'Página inválida'; end if;
  select jsonb_build_object(
    'total', (select count(*) from public.cheques_regalo),
    'expedidos', (select count(*) from public.cheques_regalo where codigo is not null),
    'importe_pagado', (select coalesce(sum(importe_eur),0) from public.cheques_regalo where estado = 'pagado'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id, creado_en, codigo, importe_eur, comprador_nombre,
        destinatario_nombre, estado, usado
      from public.cheques_regalo order by creado_en desc, id desc
      limit 50 offset p_pagina::bigint * 50
    ) t), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end $$;
revoke all on function public.listar_cheques_regalo(integer) from public, anon;
grant execute on function public.listar_cheques_regalo(integer) to authenticated;
notify pgrst, 'reload schema';
