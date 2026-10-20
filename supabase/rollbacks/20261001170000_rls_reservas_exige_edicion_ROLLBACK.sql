set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001170000_rls_reservas_exige_edicion.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- entero: lleva su propio begin/commit.
--
-- Qué revierte:
--   · reservas_insert_seccion, reservas_update_seccion y
--     reservas_delete_seccion vuelven EXACTAMENTE a como estaban en
--     pg_policies el 2026-10-01 (copiadas de ahí; PERMISSIVE, TO
--     authenticated, mismos nombres):
--       INSERT  WITH CHECK (can_write_section('reservas'::text))
--       UPDATE  USING (can_write_section('reservas'::text))
--               WITH CHECK (can_write_section('reservas'::text))
--       DELETE  USING (can_write_section('reservas'::text))
--   · Borra public.can_edit_section(text) si nada más depende de ella. Si
--     algo más la usa (p. ej. una migración posterior la llevó a otras
--     tablas), la deja y lo dice con un NOTICE: borrarla rompería eso.
--   · reservas_select_seccion y reservas_service_role no se tocan (la
--     migración tampoco las tocó).
--
-- Efecto de ejecutarlo: VUELVE EL AGUJERO. Quien solo puede VER reservas
-- vuelve a poder crearlas, cambiarlas y borrarlas por la API con su JWT
-- (el panel sigue sin dejarle: eso es de la interfaz).
--
-- Qué se pierde: nada guardado. Ni la migración ni este rollback tocan
-- filas. Los can_edit = true que se hayan dado en el paso (2) de la
-- migración se quedan: con 'view' ya no hacen falta, pero no estorban.
--
-- Antes de tocar nada comprueba la huella de las cinco políticas de
-- `reservas`: tiene que ser la de la migración o la de antes. Si es otra
-- cosa, alguien las ha cambiado después: aborta sin tocar nada. Igual si
-- existe una can_edit_section(text) que no es la de la migración.
--
-- Si la migración NO llegó a aplicarse, ejecutar esto no cambia nada: ni
-- siquiera toma el candado de `reservas` (solo lee el catálogo).
--
-- AVISO: si para entonces alguna Edge Function o el panel llama a
-- can_edit_section por RPC, revertir ese código ANTES: sin la función,
-- esas llamadas fallarían con PGRST202.
--
-- Cómo: npx supabase db query --linked -f supabase/rollbacks/20261001170000_rls_reservas_exige_edicion_ROLLBACK.sql
-- (o `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>`, o pegado entero
-- en el SQL editor). Lleva `lock_timeout = '5s'`: las políticas toman un
-- candado exclusivo sobre `reservas`. Si falla con 55P03
-- (lock_not_available), no se ha hecho nada: reintentar al rato.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $rollback$
declare
  v_huella text;
  v_antes constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_write_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_write_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_write_section('reservas'::text)|can_write_section('reservas'::text)$h$;
  v_despues constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_edit_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_edit_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_edit_section('reservas'::text)|can_edit_section('reservas'::text)$h$;
  v_fn regprocedure := to_regprocedure('public.can_edit_section(text)');
  v_cuerpo text;
  v_otros bigint;
begin
  -- 0) Guarda: nada se toca hasta haber comprobado las dos cosas.
  select string_agg(
           p.polname || '|' || p.polcmd::text || '|'
           || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
           || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                          from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                  from unnest(p.polroles) as r) as x), '') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
           ';' order by p.polname collate "C")
    into v_huella
    from pg_policy p
   where p.polrelid = 'public.reservas'::regclass;

  if v_huella is distinct from v_antes and v_huella is distinct from v_despues then
    raise exception 'ROLLBACK ABORTADO: las políticas de reservas no son ni las de 20261001170000 ni las de antes: alguien las ha cambiado después. No se ha tocado nada. Huella actual: %', v_huella;
  end if;

  if v_fn is not null then
    select btrim(regexp_replace(pr.prosrc, '\s+', ' ', 'g'))
      into v_cuerpo
      from pg_proc pr
     where pr.oid = v_fn;
    if v_cuerpo <> $c$select public.has_section_permission((select auth.uid()), _section, 'edit')$c$ then
      raise exception 'ROLLBACK ABORTADO: public.can_edit_section(text) existe pero no es la de 20261001170000 (cuerpo: %). No se ha tocado nada.', v_cuerpo;
    end if;
  end if;

  -- 1) Las tres políticas, solo si están en el estado de la migración.
  if v_huella = v_despues then
    execute $p$drop policy if exists "reservas_insert_seccion" on public.reservas$p$;
    execute $p$create policy "reservas_insert_seccion" on public.reservas
               as permissive for insert to authenticated
               with check (public.can_write_section('reservas'::text))$p$;

    execute $p$drop policy if exists "reservas_update_seccion" on public.reservas$p$;
    execute $p$create policy "reservas_update_seccion" on public.reservas
               as permissive for update to authenticated
               using (public.can_write_section('reservas'::text))
               with check (public.can_write_section('reservas'::text))$p$;

    execute $p$drop policy if exists "reservas_delete_seccion" on public.reservas$p$;
    execute $p$create policy "reservas_delete_seccion" on public.reservas
               as permissive for delete to authenticated
               using (public.can_write_section('reservas'::text))$p$;
  else
    raise notice 'Las políticas de reservas ya son las de antes de 20261001170000: no se tocan.';
  end if;

  -- 2) La función, solo si ya no la usa nada (las tres políticas de arriba
  --    ya no dependen de ella).
  if v_fn is not null then
    select count(*) into v_otros
      from pg_depend d
     where d.refclassid = 'pg_proc'::regclass
       and d.refobjid = v_fn;
    if v_otros = 0 then
      execute 'drop function public.can_edit_section(text)';
    else
      raise notice 'public.can_edit_section(text) no se borra: todavía dependen de ella % objetos (pg_depend). Las políticas de reservas sí se han revertido.', v_otros;
    end if;
  end if;
end
$rollback$;

-- 3) Comprobación final, dentro de la misma transacción.
do $final$
declare
  v_huella text;
  v_antes constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_write_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_write_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_write_section('reservas'::text)|can_write_section('reservas'::text)$h$;
  v_fn regprocedure := to_regprocedure('public.can_edit_section(text)');
begin
  select string_agg(
           p.polname || '|' || p.polcmd::text || '|'
           || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
           || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                          from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                  from unnest(p.polroles) as r) as x), '') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
           ';' order by p.polname collate "C")
    into v_huella
    from pg_policy p
   where p.polrelid = 'public.reservas'::regclass;

  if v_huella is distinct from v_antes then
    raise exception 'ROLLBACK ABORTADO al final: las políticas de reservas no han quedado como el 2026-10-01. No se ha hecho nada. Huella: %', v_huella;
  end if;

  if v_fn is not null
     and not exists (select 1 from pg_depend d
                      where d.refclassid = 'pg_proc'::regclass and d.refobjid = v_fn) then
    raise exception 'ROLLBACK ABORTADO al final: can_edit_section(text) sigue existiendo sin que nada la use. No se ha hecho nada.';
  end if;
end
$final$;

commit;
