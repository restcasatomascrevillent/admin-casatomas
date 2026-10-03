-- Listado paginado de tickets con permisos de Cheques.
create or replace function public.listar_cheques_regalo_v2(p_pagina integer default 0, p_busqueda text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare respuesta jsonb; termino text := lower(trim(coalesce(p_busqueda, '')));
begin
  if not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  if p_pagina < 0 then raise exception 'Página inválida'; end if;
  select jsonb_build_object(
    'total', (select count(*) from public.cheques_regalo),
    'canjeados', (select count(*) from public.cheques_regalo where coalesce(usado,false)),
    'coincidencias', (select count(*) from public.cheques_regalo where termino = '' or position(termino in lower(coalesce(codigo,''))) > 0 or position(termino in lower(coalesce(comprador_nombre,''))) > 0),
    'expedidos', (select count(*) from public.cheques_regalo where codigo is not null),
    'importe_pagado', (select coalesce(sum(importe_eur),0) from public.cheques_regalo where estado = 'pagado'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id,
        coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at') as creado_en,
        codigo, importe_eur, comprador_nombre,
        destinatario_nombre, estado, usado
      from public.cheques_regalo c
      where termino = '' or position(termino in lower(coalesce(codigo,''))) > 0 or position(termino in lower(coalesce(comprador_nombre,''))) > 0
      order by coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz desc nulls last, id desc
      limit 50 offset p_pagina::bigint * 50
    ) t), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end $$;
revoke all on function public.listar_cheques_regalo_v2(integer, text) from public, anon;
grant execute on function public.listar_cheques_regalo_v2(integer, text) to authenticated;
notify pgrst, 'reload schema';
