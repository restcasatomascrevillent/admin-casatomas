-- ---------------------------------------------------------------------------
-- Auto-verificación de facturas y albaranes (10/10/2026)
-- ---------------------------------------------------------------------------
-- Hasta hoy todo documento se quedaba "Sin revisar" hasta que alguien
-- activaba "Marcar como verificada" en el panel, y nadie lo hacía. Ahora un
-- documento se da por revisado SOLO, con verificacion_origen = 'auto', si:
--   1. no tiene ninguna alerta de validación (alertas_validacion vacía),
--   2. total y subtotal están presentes,
--   3. no parece duplicado de otro documento del mismo proveedor
--      (mismo número normalizado, o mismo tipo + fecha + total),
--   4. el proveedor ya tenía al menos un documento anterior (id menor).
--      Proveedor nuevo => se queda para revisión humana.
--
-- Dónde se aplica: trigger AFTER UPDATE en facturas. La Edge Function
-- procesar-factura inserta con verificada=false y luego hace UPDATE de
-- alertas_validacion (validarYGuardarAlertas): ese UPDATE dispara la regla, así
-- que no hace falta redesplegar la función.
--
-- Si un humano cambia importes (total/subtotal/iva) se recalculan las alertas
-- de validar_cordura_factura (las alertas que pone el OCR en TS, p. ej.
-- total_deducido o fecha_ausente, se conservan) y, si el documento estaba
-- auto-verificado y ya no cumple la regla, vuelve a "Sin revisar".
-- Las verificaciones humanas (origen 'manual') nunca se tocan.
-- ---------------------------------------------------------------------------

alter table public.facturas
  add column if not exists verificacion_origen text;

-- Las verificadas que ya existen las marcó una persona.
update public.facturas
   set verificacion_origen = 'manual'
 where coalesce(verificada, false) and verificacion_origen is null;

alter table public.facturas drop constraint if exists facturas_verificacion_origen_check;
alter table public.facturas
  add constraint facturas_verificacion_origen_check
  check (verificacion_origen is null or verificacion_origen in ('auto', 'manual'));

-- Coherencia: hay origen si y solo si está verificada.
alter table public.facturas drop constraint if exists facturas_verificacion_origen_coherente;
alter table public.facturas
  add constraint facturas_verificacion_origen_coherente
  check ((coalesce(verificada, false) and verificacion_origen is not null)
      or (not coalesce(verificada, false) and verificacion_origen is null));

comment on column public.facturas.verificacion_origen is
  'Quién dio el documento por revisado: auto (cuadra todo y proveedor conocido; no lo ha mirado nadie) o manual (una persona). NULL = sin revisar.';

-- ---------------------------------------------------------------------------
-- Regla
-- ---------------------------------------------------------------------------
create or replace function public.factura_cumple_autoverificacion(p_factura_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.facturas f
     where f.id = p_factura_id
       and (f.alertas_validacion is null
            or (jsonb_typeof(f.alertas_validacion) = 'array' and jsonb_array_length(f.alertas_validacion) = 0))
       and f.total is not null
       and f.subtotal is not null
       and f.proveedor_id is not null
       -- proveedor conocido: algún documento anterior suyo
       and exists (select 1 from public.facturas p
                    where p.proveedor_id = f.proveedor_id and p.id < f.id)
       -- no duplicado
       and not exists (
         select 1 from public.facturas d
          where d.id <> f.id
            and d.proveedor_id = f.proveedor_id
            and (
              (coalesce(f.numero_documento, '') <> ''
               and upper(regexp_replace(d.numero_documento, '[^A-Za-z0-9]', '', 'g'))
                 = upper(regexp_replace(f.numero_documento, '[^A-Za-z0-9]', '', 'g')))
              or (d.tipo = f.tipo and d.fecha = f.fecha and d.total = f.total)
            )
       )
  );
$$;

revoke all on function public.factura_cumple_autoverificacion(bigint) from public, anon;
grant execute on function public.factura_cumple_autoverificacion(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: origen coherente con lo que hace una persona
-- ---------------------------------------------------------------------------
create or replace function public.facturas_origen_verificacion()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_old_ver boolean := case when tg_op = 'UPDATE' then coalesce(old.verificada, false) else false end;
  v_old_ori text    := case when tg_op = 'UPDATE' then old.verificacion_origen else null end;
begin
  if not coalesce(new.verificada, false) then
    new.verificacion_origen := null;
  elsif not v_old_ver and new.verificacion_origen is not distinct from v_old_ori then
    new.verificacion_origen := 'manual';
  elsif new.verificacion_origen is null then
    new.verificacion_origen := coalesce(v_old_ori, 'manual');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_facturas_origen_verificacion on public.facturas;
create trigger trg_facturas_origen_verificacion
  before insert or update of verificada, verificacion_origen on public.facturas
  for each row execute function public.facturas_origen_verificacion();


-- ---------------------------------------------------------------------------
-- AFTER UPDATE: recalcular alertas si cambian importes y aplicar la regla
-- ---------------------------------------------------------------------------
create or replace function public.facturas_autoverificar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sql      jsonb;
  v_previas  jsonb;
  v_alertas  jsonb;
  v_codigos_sql constant text[] := array[
    'descuadre_cabecera', 'descuadre_linea', 'iva_incoherente',
    'precio_atipico_historico', 'precio_unitario_extremo',
    'subtotal_ausente', 'total_ausente',
    'total_documento_extremo', 'total_documento_irrisorio'];
  v_ok       boolean;
begin
  -- Las escrituras que hace este propio trigger no vuelven a evaluarse.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Una persona ha cambiado importes: las alertas guardadas ya no valen.
  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.iva is distinct from old.iva then
    v_sql := coalesce(public.validar_cordura_factura(new.id), '[]'::jsonb);
    select coalesce(jsonb_agg(a), '[]'::jsonb) into v_previas
      from jsonb_array_elements(
             case when jsonb_typeof(new.alertas_validacion) = 'array'
                  then new.alertas_validacion else '[]'::jsonb end) a
     where not ((a->>'codigo') = any (v_codigos_sql));
    v_alertas := v_sql || v_previas;
    update public.facturas
       set alertas_validacion = case when jsonb_array_length(v_alertas) > 0 then v_alertas end
     where id = new.id;
  end if;

  -- Si en este mismo UPDATE una persona ha tocado la verificación, manda ella.
  if new.verificada is distinct from old.verificada then
    return null;
  end if;

  v_ok := public.factura_cumple_autoverificacion(new.id);

  if not coalesce(new.verificada, false) and v_ok then
    update public.facturas
       set verificada = true, verificacion_origen = 'auto'
     where id = new.id;
  elsif new.verificacion_origen = 'auto' and not v_ok then
    update public.facturas
       set verificada = false, verificacion_origen = null
     where id = new.id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_facturas_autoverificar on public.facturas;
create trigger trg_facturas_autoverificar
  after update of alertas_validacion, total, subtotal, iva, proveedor_id, numero_documento, fecha, tipo
  on public.facturas
  for each row execute function public.facturas_autoverificar();

-- ---------------------------------------------------------------------------
-- Backfill: documentos existentes sin revisar que cumplen la regla. Además de
-- las alertas guardadas se exige que validar_cordura_factura (versión actual)
-- no devuelva nada: muchos documentos antiguos tienen alertas_validacion NULL
-- porque se procesaron antes de que existiera la validación.
-- ---------------------------------------------------------------------------
update public.facturas f
   set verificada = true, verificacion_origen = 'auto'
 where not coalesce(f.verificada, false)
   and public.factura_cumple_autoverificacion(f.id)
   and jsonb_array_length(coalesce(public.validar_cordura_factura(f.id), '[]'::jsonb)) = 0;
