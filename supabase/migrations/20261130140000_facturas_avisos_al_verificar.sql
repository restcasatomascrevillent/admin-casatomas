set client_encoding = 'UTF8';
-- ============================================================================
--  20261130140000_facturas_avisos_al_verificar (14/11/2026)
-- ----------------------------------------------------------------------------
--  «Cuando una factura o albarán se revisa y se marca como verificada, deben
--  desaparecer sus avisos.»
--
--  Antes: los avisos de Facturas (campana, «Avisos», Telegram) solo se ponían
--  al día con el cron de las 06:15. Al verificar un documento:
--    · «Proveedor X: factura de 2.325 €» (importe inusual) seguía en la campana
--      hasta que caducaba sola (semanas), aunque ya se había comprobado.
--    · «159 documentos con avisos sin revisar» seguía con 159. Al día siguiente
--      el cron sacaba OTRO aviso nuevo («157 documentos…»), sin leer, y volvía a
--      salir en Telegram: parecía que se repetía.
--  Ahora, en cuanto se verifica (trigger por sentencia en facturas):
--    1. El «importe inusual» de un documento verificado A MANO se archiva como
--       «Visto» (caduca, leído y silenciado por su clave: el cron no lo saca otra
--       vez). Los «Revisada auto» no: nadie ha mirado el importe.
--    2. El resumen «N documentos con avisos sin revisar» se recalcula con la misma
--       cuenta y la misma clave que usará el cron (avisos:N:id): se actualiza EN
--       SU SITIO (sin aviso nuevo, sin volver a Telegram) y, si llega a 0, caduca.
--  Se aplica también a lo que ya está verificado (al final del fichero).
--  No toca el cron (facturas_generar_alertas) ni las alertas de precios.
--
--  Aplicar: supabase db query --linked -f supabase/migrations/20261130140000_facturas_avisos_al_verificar.sql
--  Deshacer: supabase/rollbacks/20261130140000_facturas_avisos_al_verificar_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

create or replace function public.facturas_alertas_tras_verificar(p_ids bigint[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261130140000_facturas_avisos_al_verificar. p_ids: documentos recién
-- verificados (null = todos los verificados).
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := current_date;
  v_nuevo_d int := coalesce((u ->> 'proveedor_nuevo_dias')::int, 45);
  v_av_d    int := coalesce((u ->> 'avisos_dias')::int, 7);
  v_inu     int := 0;
  v_sil     int := 0;
  v_rev     int := 0;
  v_n       int;
  v_max     bigint;
  v_min     bigint;
  v_docs    jsonb;
  v_clave   text;
begin
  -- ── 1. Importe inusual de documentos verificados a mano ─────────────────────
  -- Silencio por clave ANTES de que exista el aviso (si se verifica antes del cron)
  -- y también si ya existe. Solo documentos recientes: el cron solo mira esos.
  insert into facturas_alertas_silencios (tipo, clave)
  select 'facturas_importe_inusual', 'importe_inusual:' || f.id
    from facturas f
   where coalesce(f.verificada, false) and f.verificacion_origen = 'manual'
     and (p_ids is null or f.id = any(p_ids))
     and (f.fecha > v_hoy - v_nuevo_d - 30
          or exists (select 1 from notificaciones_dashboard n
                      where n.clave = 'importe_inusual:' || f.id
                        and (n.caduca_en is null or n.caduca_en > now() or not n.leida)))
     and not exists (select 1 from facturas_alertas_silencios s where s.clave = 'importe_inusual:' || f.id);
  get diagnostics v_sil = row_count;

  update notificaciones_dashboard n
     set caduca_en = least(coalesce(n.caduca_en, now()), now()), leida = true
    from facturas f
   where n.tipo = 'facturas_importe_inusual'
     and n.clave = 'importe_inusual:' || f.id
     and coalesce(f.verificada, false) and f.verificacion_origen = 'manual'
     and (p_ids is null or f.id = any(p_ids))
     and (n.caduca_en is null or n.caduca_en > now() or not n.leida);
  get diagnostics v_inu = row_count;

  -- ── 2. «N documentos con avisos sin revisar», al día ────────────────────────
  -- Misma regla que facturas_alertas_candidatas (a_avisos).
  select count(*), max(fa.id), min(fa.id)
    into v_n, v_max, v_min
    from facturas fa
   where not coalesce(fa.verificada, false)
     and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))
     and jsonb_typeof(fa.alertas_validacion) = 'array'
     and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a
                  where coalesce(a ->> 'codigo', '') <> 'extraccion_historica');

  if v_n = 0 then
    update notificaciones_dashboard n
       set caduca_en = now(), leida = true
     where n.tipo = 'facturas_revision' and n.datos ->> 'resumen' = 'avisos'
       and (n.caduca_en is null or n.caduca_en > now());
    get diagnostics v_rev = row_count;
  else
    v_clave := format('avisos:%s:%s', v_n, v_max);
    select jsonb_agg(z.id order by z.id) into v_docs
      from (select fa.id
              from facturas fa
             where not coalesce(fa.verificada, false)
               and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))
               and jsonb_typeof(fa.alertas_validacion) = 'array'
               and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a
                            where coalesce(a ->> 'codigo', '') <> 'extraccion_historica')
             order by fa.id limit 20) z;
    -- Solo si han BAJADO (se han verificado): si suben, que lo diga el cron con un aviso nuevo.
    update notificaciones_dashboard n
       set clave = v_clave,
           titulo = format('%s documentos con avisos sin revisar', v_n),
           mensaje = format('%s documentos tienen avisos de lectura (importes, IVA, precios raros…) sin revisar desde hace más de %s días. Revísalos y márcalos como verificados.', v_n, v_av_d),
           datos = n.datos || jsonb_build_object('enlace', '?tab=compras&modo=documentos&doc=' || v_min,
                                                 'factura_id', v_min, 'documentos', v_docs, 'cuantos', v_n)
     where n.tipo = 'facturas_revision' and n.datos ->> 'resumen' = 'avisos'
       and (n.caduca_en is null or n.caduca_en > now())
       and n.clave is distinct from v_clave
       and coalesce((n.datos ->> 'cuantos')::int, 0) > v_n
       and not exists (select 1 from notificaciones_dashboard x where x.clave = v_clave);
    get diagnostics v_rev = row_count;
  end if;

  return jsonb_build_object('inusuales_archivados', v_inu, 'silencios', v_sil,
                            'resumen_actualizado', v_rev, 'sin_revisar', v_n);
end;
$$;

comment on function public.facturas_alertas_tras_verificar(bigint[]) is
  'Al verificar documentos: archiva su «importe inusual» (si es a mano) y pone al día el resumen «N documentos con avisos sin revisar» sin crear aviso nuevo. SECURITY DEFINER. 20261130140000.';

revoke all on function public.facturas_alertas_tras_verificar(bigint[]) from public, anon, authenticated;
grant execute on function public.facturas_alertas_tras_verificar(bigint[]) to service_role;

-- Trigger por sentencia (una sola pasada aunque se verifiquen muchos a la vez).
create or replace function public.facturas_avisos_al_verificar_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261130140000_facturas_avisos_al_verificar
declare
  v_ids bigint[];
begin
  select array_agg(n.id) into v_ids
    from nuevas n
    left join viejas v on v.id = n.id
   where coalesce(n.verificada, false) and not coalesce(v.verificada, false);
  if v_ids is not null then
    perform public.facturas_alertas_tras_verificar(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function public.facturas_avisos_al_verificar_trg() from public, anon, authenticated;

drop trigger if exists facturas_avisos_al_verificar on public.facturas;
create trigger facturas_avisos_al_verificar
  after update on public.facturas
  referencing old table as viejas new table as nuevas
  for each statement execute function public.facturas_avisos_al_verificar_trg();

-- Lo que ya está verificado.
select 'facturas_avisos_al_verificar: aplicada | ' || public.facturas_alertas_tras_verificar(null)::text as resultado;
