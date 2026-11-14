set client_encoding = 'UTF8';
-- ============================================================================
-- 20261130160000_avisos_precio_sugerido — «Aplicar el precio sugerido» desde el
-- aviso de Telegram (14/11/2026)
-- ----------------------------------------------------------------------------
-- Petición del dueño: cuando un aviso sugiere un precio nuevo en la carta (por
-- subida de coste), que lleve un ENLACE para aplicarlo sin buscar el plato.
--
-- Seguridad: el enlace de Telegram solo lleva el id del aviso
-- (/aplicar-precio/<uuid>). Para ver la sugerencia y aplicarla hace falta
-- SESIÓN en el panel y permiso de EDITAR la carta (gestor_carta · edit); el
-- precio lo calcula el servidor (no se fía del navegador), se confirma en la
-- pantalla y vale UNA vez por aviso (datos.precio_aplicado).
--
-- 1. avisos_precio_sugerido(aviso): para un aviso «Margen bajo» de un PLATO o
--    de un VINO (restaurante), el precio de carta (con IVA) que devuelve el
--    coste al límite de Facturas › Márgenes, redondeado hacia arriba a 0,50 €:
--      plato: coste ÷ (límite % / 100) = venta sin IVA mínima
--      vino:  coste × multiplicador mínimo = venta sin IVA mínima
--      con IVA: × (1 + iva_pct de margenes_carta_config)
--    Solo si es más que el precio actual. Al peso y tienda: sin sugerencia.
--    La pueden llamar service_role (la Edge Function avisos-telegram) y quien
--    pueda editar la carta.
-- 2. avisos_aplicar_precio_sugerido(aviso, precio): cambia precio_eur del plato
--    o vino (el sugerido, o el que ponga la persona: 0,50–9.999 €), lo apunta
--    en historial_ajustes_precios (así Márgenes lo cuenta como «precio
--    ajustado», igual que «Ajustar precios») y marca el aviso como aplicado y
--    leído. Segunda vez: error «ya_aplicado».
--
-- No toca margenes_* ni la lógica de la carta: solo lee margenes_carta_config y
-- escribe precio_eur de UNA fila de "Platos" o "Vinos".
-- Rollback: supabase/rollbacks/20261130160000_avisos_precio_sugerido_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

create or replace function public.avisos_precio_sugerido(p_aviso uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n          record;
  v_canal    text;
  v_id       text;
  v_coste    numeric;
  v_limite   numeric;
  v_iva      numeric;
  v_nombre   text;
  v_cat      text;
  v_actual   numeric;
  v_sin_iva  numeric;
  v_sugerido numeric;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not coalesce(public.has_section_permission((select auth.uid()), 'gestor_carta', 'edit'), false) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  select id, tipo, datos into n from public.notificaciones_dashboard where id = p_aviso;
  if not found or n.tipo <> 'facturas_margen_bajo' then
    return null;
  end if;
  v_canal  := n.datos ->> 'canal';
  v_id     := n.datos ->> 'articulo_id';
  v_coste  := nullif(n.datos ->> 'coste', '')::numeric;
  v_limite := nullif(n.datos ->> 'limite', '')::numeric;
  if v_canal not in ('plato', 'vino') or v_id is null or not (v_coste > 0) or not (v_limite > 0) then
    return null;
  end if;

  select coalesce(iva_pct, 10) into v_iva from public.margenes_carta_config where id;
  v_iva := coalesce(v_iva, 10);

  if v_canal = 'plato' then
    select p.nombre, p.categoria, p.precio_eur::numeric into v_nombre, v_cat, v_actual from public."Platos" p where p.id::text = v_id;
    v_sin_iva := v_coste / (v_limite / 100);
  else
    select v.nombre, v.categoria, v.precio_eur::numeric into v_nombre, v_cat, v_actual from public."Vinos" v where v.id::text = v_id;
    v_sin_iva := v_coste * v_limite;
  end if;
  if v_nombre is null then
    return null;
  end if;

  v_sugerido := round(ceil(v_sin_iva * (1 + v_iva / 100) * 2) / 2, 2);

  return jsonb_build_object(
    'aviso_id', n.id,
    'canal', v_canal,
    'tipo_carta', case v_canal when 'plato' then 'platos' else 'vinos' end,
    'articulo_id', v_id,
    'nombre', v_nombre,
    'categoria', v_cat,
    'precio_actual', v_actual,
    -- Sin sugerencia si ya cobra eso o más, o si sale un disparate (más del triple: datos raros).
    'precio_sugerido', case when v_sugerido > coalesce(v_actual, 0) + 0.004
                             and (v_actual is null or v_actual <= 0 or v_sugerido <= v_actual * 3)
                            then v_sugerido end,
    'venta_sin_iva_minima', round(v_sin_iva, 2),
    'coste', round(v_coste, 2),
    'limite', v_limite,
    'valor', nullif(n.datos ->> 'valor', '')::numeric,
    'iva_pct', v_iva,
    'aplicado', n.datos -> 'precio_aplicado'
  );
end;
$$;

create or replace function public.avisos_aplicar_precio_sugerido(p_aviso uuid, p_precio numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  s        jsonb;
  v_datos  jsonb;
  v_precio numeric;
  v_antes  numeric;
begin
  if v_uid is null or not coalesce(public.has_section_permission(v_uid, 'gestor_carta', 'edit'), false) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  -- Bloquea el aviso: dos clics a la vez no aplican dos veces.
  select datos into v_datos from public.notificaciones_dashboard where id = p_aviso for update;
  if not found then
    raise exception 'aviso_no_encontrado';
  end if;
  if v_datos ? 'precio_aplicado' then
    raise exception 'ya_aplicado';
  end if;

  s := public.avisos_precio_sugerido(p_aviso);
  if s is null then
    raise exception 'sin_sugerencia';
  end if;
  v_precio := round(coalesce(p_precio, (s ->> 'precio_sugerido')::numeric), 2);
  if v_precio is null then
    raise exception 'sin_sugerencia';
  end if;
  if v_precio < 0.5 or v_precio > 9999 then
    raise exception 'precio_fuera_de_rango';
  end if;
  v_antes := (s ->> 'precio_actual')::numeric;

  if s ->> 'canal' = 'plato' then
    update public."Platos" set precio_eur = v_precio where id::text = s ->> 'articulo_id';
  else
    update public."Vinos" set precio_eur = v_precio where id::text = s ->> 'articulo_id';
  end if;

  insert into public.historial_ajustes_precios (tipo_carta, categoria, porcentaje, items_afectados, snapshot, user_id)
  values (s ->> 'tipo_carta', coalesce(s ->> 'categoria', 'todas'),
          case when v_antes > 0 then round((v_precio / v_antes - 1) * 100, 2) else 0 end, 1,
          jsonb_build_array(jsonb_build_object('id', s ->> 'articulo_id', 'nombre', s ->> 'nombre',
                                               'precio_anterior', v_antes, 'precio_nuevo', v_precio)),
          v_uid);

  update public.notificaciones_dashboard
     set leida = true,
         datos = coalesce(datos, '{}'::jsonb) || jsonb_build_object('precio_aplicado',
                   jsonb_build_object('precio', v_precio, 'antes', v_antes, 'por', v_uid, 'en', now()))
   where id = p_aviso;

  return jsonb_build_object('ok', true, 'nombre', s ->> 'nombre', 'antes', v_antes, 'precio', v_precio, 'tipo_carta', s ->> 'tipo_carta');
end;
$$;

revoke all on function public.avisos_precio_sugerido(uuid) from public, anon;
revoke all on function public.avisos_aplicar_precio_sugerido(uuid, numeric) from public, anon;
grant execute on function public.avisos_precio_sugerido(uuid) to authenticated, service_role;
grant execute on function public.avisos_aplicar_precio_sugerido(uuid, numeric) to authenticated;
