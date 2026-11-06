// «Editar» para escribir en la carta (gestor_carta) y en el newsletter
// (marketing) contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:permisos-carta-newsletter:db
//
// Parte del estado de la demo el 06/11/2026 (políticas de Platos, Vinos,
// Bebidas, Cocteles, historial_ajustes_precios, configuracion_web,
// trabajos_recorte/video, votos_vino_favorito, newsletter_envios,
// campanas_marketing, email_eventos y de los cubos de la carta; funciones
// trabajos_*_permiso y recorte_servidor_reservar; sesión de panel viva) con
// can_write_section mirando «Ver», como en el repo, para que se vea el agujero
// que cierra. Aplica la migración REAL 20261106500000 dos veces y su rollback.
// Cubre: que se para sin can_edit_section; que con solo «Ver» se lee pero no se
// escribe (ni tablas, ni cubos, ni RPC); que «Editar» y el super admin siguen
// escribiendo; que Instagram y el Gestor Web (gestion_web) no cambian; que las
// funciones conservan propietario y permisos; y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261106500000_permisos_carta_newsletter.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261106500000_permisos_carta_newsletter_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const CAN_EDIT = `
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  revoke all on function public.can_edit_section(text) from public, anon;
  grant execute on function public.can_edit_section(text) to authenticated, service_role;
`;

// Carta: las cuatro tablas con las políticas de la demo (06/11/2026).
const tablaCarta = (t, p) => `
  create table public."${t}" (id uuid primary key default gen_random_uuid(), nombre text, precio_eur numeric,
    activado boolean default true, restaurante boolean default true, touza boolean default false);
  alter table public."${t}" enable row level security;
  grant select on public."${t}" to anon;
  grant select, insert, update, delete on public."${t}" to authenticated;
  grant all on public."${t}" to service_role;
  create policy "Público puede ver ${p} activos" on public."${t}" for select to public using (activado = true);
  create policy "Authenticated users can read ${t}" on public."${t}" for select to authenticated using (true);
  create policy ${p}_insert_seccion on public."${t}" for insert to authenticated with check ((select public.can_write_section('gestor_carta')));
  create policy ${p}_update_seccion on public."${t}" for update to authenticated
    using ((select public.can_write_section('gestor_carta'))) with check ((select public.can_write_section('gestor_carta')));
  create policy ${p}_delete_seccion on public."${t}" for delete to authenticated using ((select public.can_write_section('gestor_carta')));
  create policy ${p}_service_role on public."${t}" for all to service_role using (true) with check (true);
`;

const PANEL = (t) => `
  create policy acceso_panel_no_bloqueado on public.${t} as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));`;

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema storage;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private, storage to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create table public.user_permissions (id uuid primary key default gen_random_uuid(), user_id uuid not null, section_key text not null,
    can_view boolean default false, can_edit boolean default false, unique (user_id, section_key));
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view = true) or (_permission = 'edit' and can_edit = true))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  -- Como en el repo (20260918120000): «Ver» basta para escribir. Es el agujero que cierra la migración.
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text) to anon, authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = ''
    as $f$ select auth.uid() is not null and coalesce((auth.jwt() ->> 'bloqueado')::boolean, false) = false $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  ${tablaCarta("Platos", "platos")}
  ${tablaCarta("Vinos", "vinos")}
  ${tablaCarta("Bebidas", "bebidas")}
  ${tablaCarta("Cocteles", "cocteles")}
  ${PANEL('"Platos"')} ${PANEL('"Vinos"')} ${PANEL('"Bebidas"')} ${PANEL('"Cocteles"')}

  create table public.historial_ajustes_precios (id uuid primary key default gen_random_uuid(), categoria text, porcentaje numeric);
  alter table public.historial_ajustes_precios enable row level security;
  grant select, insert, update, delete on public.historial_ajustes_precios to authenticated;
  create policy historial_ajustes_precios_select_seccion on public.historial_ajustes_precios for select to authenticated
    using ((select public.can_read_section('gestor_carta')));
  create policy historial_ajustes_precios_insert_seccion on public.historial_ajustes_precios for insert to authenticated
    with check ((select public.can_write_section('gestor_carta')));
  create policy historial_ajustes_precios_update_seccion on public.historial_ajustes_precios for update to authenticated
    using ((select public.can_write_section('gestor_carta'))) with check ((select public.can_write_section('gestor_carta')));
  create policy historial_ajustes_precios_delete_seccion on public.historial_ajustes_precios for delete to authenticated
    using ((select public.can_write_section('gestor_carta')));
  ${PANEL("historial_ajustes_precios")}

  create table public.configuracion_web (id boolean primary key default true, mostrar_fotos_platos_casa_tomas boolean default true,
    encuesta_vinos_activa boolean default false, mostrar_menu_dia_casa_tomas boolean default true);
  alter table public.configuracion_web enable row level security;
  grant select on public.configuracion_web to anon;
  grant select, update on public.configuracion_web to authenticated;
  create policy configuracion_web_select_publico on public.configuracion_web for select to anon, authenticated using (true);
  create policy configuracion_web_update_seccion on public.configuracion_web for update to authenticated
    using ((select public.can_write_section('gestor_carta'))) with check ((select public.can_write_section('gestor_carta')));
  ${PANEL("configuracion_web")}
  -- El menú y las tapas del Gestor Web van por RPC con gestion_web (no cambia).
  create function public.configuracion_web_visibilidad_menu_tapas(p_seccion text, p_mostrar boolean) returns void
    language plpgsql security definer set search_path = public as $f$
    begin
      if auth.uid() is null or public.can_write_section('gestion_web') is not true then
        raise exception 'No tienes permiso para gestionar el menú y las tapas de la web.' using errcode = '42501';
      end if;
      update public.configuracion_web set mostrar_menu_dia_casa_tomas = p_mostrar where id;
    end $f$;
  revoke all on function public.configuracion_web_visibilidad_menu_tapas(text, boolean) from public, anon;
  grant execute on function public.configuracion_web_visibilidad_menu_tapas(text, boolean) to authenticated, service_role;

  create table public.trabajos_recorte (id uuid primary key default gen_random_uuid(), creado_por uuid, estado text default 'pendiente',
    procesado_por uuid, reclamado_en timestamptz, intentos integer default 0, error text, terminado_en timestamptz);
  create table public.trabajos_video (like public.trabajos_recorte including defaults);
  alter table public.trabajos_recorte enable row level security;
  alter table public.trabajos_video enable row level security;
  grant select, insert, delete on public.trabajos_recorte, public.trabajos_video to authenticated;
  create policy trabajos_recorte_select_seccion on public.trabajos_recorte for select to authenticated using ((select public.can_write_section('gestor_carta')));
  create policy trabajos_recorte_insert_seccion on public.trabajos_recorte for insert to authenticated
    with check ((select public.can_write_section('gestor_carta')) and creado_por = (select auth.uid()) and estado = 'pendiente'
      and procesado_por is null and reclamado_en is null and intentos = 0 and error is null and terminado_en is null);
  create policy trabajos_recorte_delete_seccion on public.trabajos_recorte for delete to authenticated
    using ((select public.can_write_section('gestor_carta')) and estado <> 'procesando');
  create policy trabajos_video_select_seccion on public.trabajos_video for select to authenticated using ((select public.can_write_section('gestor_carta')));
  create policy trabajos_video_insert_seccion on public.trabajos_video for insert to authenticated
    with check ((select public.can_write_section('gestor_carta')) and creado_por = (select auth.uid()) and estado = 'pendiente'
      and procesado_por is null and reclamado_en is null and intentos = 0 and error is null and terminado_en is null);
  create policy trabajos_video_delete_seccion on public.trabajos_video for delete to authenticated
    using ((select public.can_write_section('gestor_carta')) and estado <> 'procesando');
  ${PANEL("trabajos_recorte")} ${PANEL("trabajos_video")}

  -- Funciones tal y como están en la demo (las dos primeras, verbatim).
  create function public.trabajos_recorte_permiso() returns void language plpgsql stable security definer set search_path = '' as $f$
    begin
      if auth.uid() is null or not public.can_write_section('gestor_carta') then
        raise exception 'Sin permiso de carta' using errcode = '42501';
      end if;
      if to_regprocedure('private.sesion_panel_permitida()') is not null then
        if not coalesce((select private.sesion_panel_permitida()), false) then
          raise exception 'Sesión de panel no válida' using errcode = '42501';
        end if;
      end if;
    end $f$;
  create function public.trabajos_video_permiso() returns void language plpgsql stable security definer set search_path = '' as $f$
    begin
      if auth.uid() is null or not public.can_write_section('gestor_carta') then
        raise exception 'Sin permiso de carta' using errcode = '42501';
      end if;
      if to_regprocedure('private.sesion_panel_permitida()') is not null then
        if not coalesce((select private.sesion_panel_permitida()), false) then
          raise exception 'Sesión de panel no válida' using errcode = '42501';
        end if;
      end if;
    end $f$;
  -- recorte_servidor_reservar: misma guarda; el resto (cupos) no importa aquí.
  create function public.recorte_servidor_reservar() returns jsonb language plpgsql security definer set search_path = '' as $f$
    begin
      if auth.uid() is null or not coalesce(public.can_write_section('gestor_carta'), false) then
        raise exception 'Sin permiso para la carta' using errcode = '42501';
      end if;
      return jsonb_build_object('permitido', true);
    end $f$;
  comment on function public.recorte_servidor_reservar() is 'Reserva un recorte en el servidor (prueba).';
  revoke all on function public.trabajos_recorte_permiso(), public.trabajos_video_permiso(), public.recorte_servidor_reservar() from public, anon;
  grant execute on function public.trabajos_recorte_permiso(), public.trabajos_video_permiso(), public.recorte_servidor_reservar() to authenticated, service_role;

  create table public.votos_vino_favorito (id uuid primary key default gen_random_uuid(), vino_nombre text, nombre text, contacto text);
  alter table public.votos_vino_favorito enable row level security;
  grant select, delete on public.votos_vino_favorito to authenticated;
  create policy votos_vino_favorito_select_panel on public.votos_vino_favorito for select to authenticated using ((select public.can_write_section('gestor_carta')));
  create policy votos_vino_favorito_delete_panel on public.votos_vino_favorito for delete to authenticated using ((select public.can_write_section('gestor_carta')));
  ${PANEL("votos_vino_favorito")}

  -- Newsletter.
  create table public.newsletter_suscriptores (id uuid primary key default gen_random_uuid(), email text, activo boolean default true);
  create table public.newsletter_envios (id uuid primary key default gen_random_uuid(), asunto text, estado text);
  create table public.campanas_marketing (id uuid primary key default gen_random_uuid(), nombre text);
  create table public.email_eventos (id uuid primary key default gen_random_uuid(), tipo text);
  alter table public.newsletter_suscriptores enable row level security;
  alter table public.newsletter_envios enable row level security;
  alter table public.campanas_marketing enable row level security;
  alter table public.email_eventos enable row level security;
  grant select on public.newsletter_suscriptores to authenticated;
  grant select, insert, update, delete on public.newsletter_envios, public.campanas_marketing, public.email_eventos to authenticated;
  create policy newsletter_suscriptores_select_seccion on public.newsletter_suscriptores for select to authenticated using ((select public.can_read_section('marketing')));
  ${["newsletter_envios", "campanas_marketing", "email_eventos"].map((t) => `
  create policy ${t}_select_seccion on public.${t} for select to authenticated using ((select public.can_read_section('marketing')));
  create policy ${t}_insert_seccion on public.${t} for insert to authenticated with check ((select public.can_write_section('marketing')));
  create policy ${t}_update_seccion on public.${t} for update to authenticated
    using ((select public.can_write_section('marketing'))) with check ((select public.can_write_section('marketing')));
  create policy ${t}_delete_seccion on public.${t} for delete to authenticated using ((select public.can_write_section('marketing')));
  ${PANEL(t)}`).join("\n")}

  -- Lo que NO se toca: Instagram (aunque le quedara un can_write_section) y el Gestor Web.
  create table public.instagram_piezas (id uuid primary key default gen_random_uuid(), titulo text);
  create table public.marketing_fechas (id uuid primary key default gen_random_uuid(), nombre text);
  alter table public.instagram_piezas enable row level security;
  alter table public.marketing_fechas enable row level security;
  grant select, insert, update on public.instagram_piezas, public.marketing_fechas to authenticated;
  create policy instagram_piezas_insert_seccion on public.instagram_piezas for insert to authenticated with check ((select public.can_write_section('marketing')));
  create policy marketing_fechas_insert_seccion on public.marketing_fechas for insert to authenticated with check ((select public.can_write_section('marketing')));
  create function public.instagram_prueba_permiso() returns void language plpgsql security definer set search_path = '' as $f$
    begin
      if not public.can_write_section('marketing') then raise exception 'sin permiso'; end if;
    end $f$;
  create table public.novedades (id uuid primary key default gen_random_uuid(), titulo text);
  alter table public.novedades enable row level security;
  grant select, insert, update on public.novedades to authenticated;
  create policy novedades_select_seccion on public.novedades for select to authenticated using (true);
  create policy novedades_update_seccion on public.novedades for update to authenticated
    using ((select public.can_write_section('gestion_web'))) with check ((select public.can_write_section('gestion_web')));

  -- Storage: los cubos de la carta (y uno de Instagram y otro del Gestor Web que no cambian).
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid);
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
  create policy "Lectura pública de buckets" on storage.objects for select to anon, authenticated using (true);
  create policy carta_imagenes_insert_seccion on storage.objects for insert to authenticated
    with check (bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta']) and (select public.can_write_section('gestor_carta')));
  create policy carta_imagenes_update_seccion on storage.objects for update to authenticated
    using (bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta']) and (select public.can_write_section('gestor_carta')))
    with check (bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta']) and (select public.can_write_section('gestor_carta')));
  create policy carta_imagenes_delete_seccion on storage.objects for delete to authenticated
    using (bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'carta']) and (select public.can_write_section('gestor_carta')));
  create policy instagram_objetos_insert_seccion on storage.objects for insert to authenticated
    with check (bucket_id = 'instagram' and (select public.can_write_section('marketing')));
  create policy novedades_imagenes_insert_seccion on storage.objects for insert to authenticated
    with check (bucket_id = 'novedades' and (select public.can_write_section('gestion_web')));
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",          // super admin, sin filas de permisos
  CARTA_VER: "a0000000-0000-0000-0000-000000000002",   // Carta: solo «Ver»
  CARTA_EDITA: "a0000000-0000-0000-0000-000000000003", // Carta: «Ver» + «Editar»
  NEWS_VER: "a0000000-0000-0000-0000-000000000004",    // Newsletter: solo «Ver»
  NEWS_EDITA: "a0000000-0000-0000-0000-000000000005",  // Newsletter: «Ver» + «Editar»
  WEB_VER: "a0000000-0000-0000-0000-000000000006",     // Gestor Web (gestion_web): solo «Ver»
  NADA: "a0000000-0000-0000-0000-000000000007",        // sin ninguna de estas secciones
};
const DATOS = `
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${U.CARTA_VER}', 'gestor_carta', true, false), ('${U.CARTA_EDITA}', 'gestor_carta', true, true),
    ('${U.NEWS_VER}', 'marketing', true, false), ('${U.NEWS_EDITA}', 'marketing', true, true),
    ('${U.WEB_VER}', 'gestion_web', true, false), ('${U.NADA}', 'dashboard', true, true);
  insert into public."Platos" (nombre, precio_eur) values ('Croquetas', 9), ('Pulpo', 18);
  insert into public."Platos" (nombre, precio_eur, activado) values ('Oculto', 5, false);
  insert into public."Vinos" (nombre, precio_eur) values ('Albariño', 24);
  insert into public."Bebidas" (nombre, precio_eur) values ('Agua', 2);
  insert into public."Cocteles" (nombre, precio_eur) values ('Mojito', 9);
  insert into public.historial_ajustes_precios (categoria, porcentaje) values ('Entrantes', 5);
  insert into public.configuracion_web default values;
  insert into public.votos_vino_favorito (vino_nombre, nombre, contacto) values ('Albariño', 'Ana', 'ana@x.es');
  insert into public.newsletter_suscriptores (email) values ('cliente@x.es');
  insert into public.newsletter_envios (asunto, estado) values ('Octubre', 'completado');
  insert into public.campanas_marketing (nombre) values ('Navidad');
  insert into public.email_eventos (tipo) values ('delivered');
  insert into public.novedades (titulo) values ('Jornadas');
  insert into storage.objects (bucket_id, name) values ('vinos', 'albarino.webp'), ('platos', 'croquetas.webp');
`;

// ─── 0. Sin can_edit_section se para sin cambiar nada ──────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await assert.rejects(otra.exec(MIGRACION), /falta public\.can_edit_section/, "no se paró sin can_edit_section");
  comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query(`select count(*)::int n from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%can_edit_section%'`)).rows[0].n, 0,
    "la migración abortada cambió políticas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CAN_EDIT);
await db.exec(DATOS);
const q = (sql, params) => db.query(sql, params);

async function como(u, fn) {
  await db.exec("begin");
  try {
    if (u === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated" })}', true);`);
    }
    const r = await fn();
    await db.exec("rollback"); // ninguna prueba deja nada escrito: cada una parte del mismo estado
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const filas = (u, sql) => como(u, async () => (await q(sql)).rows.length);
const rechaza = async (u, sql, patron, msg) => {
  await assert.rejects(como(u, () => q(sql)), patron, msg);
  comprobaciones++;
};
const acepta = async (u, sql, msg) => {
  await como(u, () => q(sql));
  ok(true, msg);
};
const RLS = /row-level security/;

const politicas = async () =>
  (await q(`select schemaname, tablename, policyname, cmd, coalesce(qual, '') q, coalesce(with_check, '') c
            from pg_policies order by 1, 2, 3`)).rows;
const expresion = async (tabla, politica) =>
  (await q(`select coalesce(qual, '') q, coalesce(with_check, '') c from pg_policies where tablename = $1 and policyname = $2`, [tabla, politica])).rows[0];
const fuente = async (fn) => (await q(`select prosrc from pg_proc where proname = $1`, [fn])).rows[0].prosrc;
const firmaFuncion = async (fn) =>
  (await q(`select p.prosecdef, pg_get_userbyid(p.proowner) dueno, p.proconfig, obj_description(p.oid, 'pg_proc') comentario,
              has_function_privilege('anon', p.oid, 'execute') anon,
              has_function_privilege('authenticated', p.oid, 'execute') autenticado
            from pg_proc p where p.proname = $1`, [fn])).rows[0];

// ─── 1. Antes: con solo «Ver» se escribe (el agujero) ──────────────────────
igual(await filas(U.CARTA_VER, `update public."Platos" set precio_eur = 1 returning id`), 3, "antes: solo «Ver» cambiaba precios de la carta");
igual(await filas(U.NEWS_VER, `insert into public.newsletter_envios (asunto) values ('x') returning id`), 1, "antes: solo «Ver» creaba envíos del newsletter");
const firmasAntes = {};
for (const fn of ["trabajos_recorte_permiso", "trabajos_video_permiso", "recorte_servidor_reservar"]) firmasAntes[fn] = await firmaFuncion(fn);
const instagramAntes = (await politicas()).filter((p) => /^(instagram|marketing_fechas|novedades)/.test(p.tablename) || /^(instagram|novedades)_/.test(p.policyname));
const gestionWebAntes = await fuente("configuracion_web_visibilidad_menu_tapas");

// ─── 2. Migración (dos veces: la segunda no cambia nada) ───────────────────
await db.exec(MIGRACION);
const trasPrimera = await politicas();
await db.exec(MIGRACION);
igual(await politicas(), trasPrimera, "la segunda pasada cambió políticas");

// Expresiones: misma condición, solo cambia la función (y su alias).
igual(await expresion("Platos", "platos_update_seccion"), {
  q: "( SELECT can_edit_section('gestor_carta'::text) AS can_edit_section)",
  c: "( SELECT can_edit_section('gestor_carta'::text) AS can_edit_section)",
}, "Platos: la política de editar no quedó limpia");
ok((await expresion("trabajos_recorte", "trabajos_recorte_insert_seccion")).c.includes("creado_por = ( SELECT auth.uid() AS uid)"),
  "trabajos_recorte perdió el resto de la condición");
ok((await expresion("objects", "carta_imagenes_insert_seccion")).c.startsWith("((bucket_id = ANY"), "los cubos de la carta perdieron el filtro de cubo");
igual((await politicas()).filter((p) => (p.q + p.c).includes("can_write_section('gestor_carta'")), [], "queda alguna política de la carta con can_write_section");
igual((await politicas()).filter((p) => p.schemaname === "public" && /^(newsletter_|campanas_marketing|email_eventos)/.test(p.tablename)
  && (p.q + p.c).includes("can_write_section('marketing'")), [], "queda alguna política del newsletter con can_write_section");
igual((await politicas()).filter((p) => /^(instagram|marketing_fechas|novedades)/.test(p.tablename) || /^(instagram|novedades)_/.test(p.policyname)),
  instagramAntes, "Instagram o el Gestor Web cambiaron");
igual(await fuente("configuracion_web_visibilidad_menu_tapas"), gestionWebAntes, "la RPC del menú y las tapas cambió");
ok((await fuente("instagram_prueba_permiso")).includes("can_write_section('marketing')"), "una función de Instagram cambió");
for (const fn of ["trabajos_recorte_permiso", "trabajos_video_permiso", "recorte_servidor_reservar"]) {
  ok((await fuente(fn)).includes("can_edit_section('gestor_carta')") && !(await fuente(fn)).includes("can_write_section"), `${fn} no pasó a «Editar»`);
  igual(await firmaFuncion(fn), firmasAntes[fn], `${fn} perdió propietario, SECURITY DEFINER, search_path, comentario o permisos`);
}

// ─── 3. Carta: leer sigue igual ────────────────────────────────────────────
for (const u of [U.CARTA_VER, U.CARTA_EDITA, U.SA]) {
  igual(await filas(u, `select id from public."Platos"`), 3, `la carta se sigue leyendo (${u})`);
  igual(await filas(u, `select id from public."Vinos"`), 1, `los vinos se siguen leyendo (${u})`);
}
igual(await filas("anon", `select id from public."Platos"`), 2, "la web (anon) sigue viendo solo los platos activos");
igual(await filas(U.CARTA_VER, "select id from public.historial_ajustes_precios"), 1, "con «Ver» se lee el historial de ajustes");
igual(await filas(U.CARTA_VER, "select id from public.configuracion_web"), 1, "con «Ver» se lee la configuración de la web");

// ─── 4. Carta: con solo «Ver» no se escribe nada ───────────────────────────
igual(await filas(U.CARTA_VER, `update public."Platos" set precio_eur = 1 returning id`), 0, "solo «Ver» cambió precios");
igual(await filas(U.CARTA_VER, `update public."Vinos" set restaurante = false returning id`), 0, "solo «Ver» cambió la visibilidad de un vino");
igual(await filas(U.CARTA_VER, `delete from public."Bebidas" returning id`), 0, "solo «Ver» borró bebidas");
igual(await filas(U.CARTA_VER, `delete from public."Cocteles" returning id`), 0, "solo «Ver» borró cócteles");
await rechaza(U.CARTA_VER, `insert into public."Vinos" (nombre) values ('Nuevo')`, RLS, "solo «Ver» añadió un vino");
await rechaza(U.CARTA_VER, `insert into public.historial_ajustes_precios (categoria, porcentaje) values ('x', 1)`, RLS, "solo «Ver» guardó un ajuste de precios");
igual(await filas(U.CARTA_VER, "delete from public.historial_ajustes_precios returning id"), 0, "solo «Ver» borró el historial");
igual(await filas(U.CARTA_VER, "update public.configuracion_web set encuesta_vinos_activa = true returning id"), 0, "solo «Ver» abrió la votación");
await rechaza(U.CARTA_VER, `insert into public.trabajos_recorte (creado_por) values ('${U.CARTA_VER}')`, RLS, "solo «Ver» mandó un recorte");
await rechaza(U.CARTA_VER, `insert into public.trabajos_video (creado_por) values ('${U.CARTA_VER}')`, RLS, "solo «Ver» mandó un vídeo");
await db.exec(`insert into public.trabajos_video (creado_por) values ('${U.CARTA_EDITA}')`);
igual(await filas(U.CARTA_VER, "select id from public.trabajos_video"), 0, "solo «Ver» leyó la cola de vídeos");
igual(await filas(U.CARTA_VER, "select id from public.votos_vino_favorito"), 0, "solo «Ver» leyó nombres y contactos de la votación");
igual(await filas(U.CARTA_VER, "delete from public.votos_vino_favorito returning id"), 0, "solo «Ver» vació la votación");
await rechaza(U.CARTA_VER, "insert into storage.objects (bucket_id, name) values ('vinos', 'nuevo.webp')", RLS, "solo «Ver» subió una foto de la carta");
igual(await filas(U.CARTA_VER, "update storage.objects set name = 'x' where bucket_id = 'vinos' returning id"), 0, "solo «Ver» cambió una foto");
igual(await filas(U.CARTA_VER, "delete from storage.objects where bucket_id = 'platos' returning id"), 0, "solo «Ver» borró una foto");
const SIN_CARTA = /Sin permiso (de|para la) carta/;
await rechaza(U.CARTA_VER, "select public.trabajos_recorte_permiso()", SIN_CARTA, "solo «Ver» pasó trabajos_recorte_permiso");
await rechaza(U.CARTA_VER, "select public.trabajos_video_permiso()", SIN_CARTA, "solo «Ver» pasó trabajos_video_permiso");
await rechaza(U.CARTA_VER, "select public.recorte_servidor_reservar()", SIN_CARTA, "solo «Ver» reservó un recorte en el servidor");
await rechaza(U.NADA, `insert into public."Platos" (nombre) values ('x')`, RLS, "sin la sección se añadió un plato");

// ─── 5. Carta: «Editar» y el super admin siguen escribiendo ────────────────
for (const u of [U.CARTA_EDITA, U.SA]) {
  igual(await filas(u, `update public."Platos" set precio_eur = precio_eur + 1 returning id`), 3, `«Editar» cambia precios (${u})`);
  igual(await filas(u, `insert into public."Vinos" (nombre) values ('Nuevo') returning id`), 1, `«Editar» añade vinos (${u})`);
  igual(await filas(u, `delete from public."Bebidas" returning id`), 1, `«Editar» borra bebidas (${u})`);
  igual(await filas(u, `update public."Cocteles" set activado = false returning id`), 1, `«Editar» despublica cócteles (${u})`);
  igual(await filas(u, "insert into public.historial_ajustes_precios (categoria, porcentaje) values ('x', 1) returning id"), 1, `«Editar» guarda ajustes (${u})`);
  igual(await filas(u, "update public.configuracion_web set encuesta_vinos_activa = true returning id"), 1, `«Editar» abre la votación (${u})`);
  igual(await filas(u, `insert into public.trabajos_recorte (creado_por) values ('${u}') returning id`), 1, `«Editar» manda recortes (${u})`);
  igual(await filas(u, "select id from public.trabajos_video"), 1, `«Editar» lee la cola de vídeos (${u})`);
  igual(await filas(u, "select id from public.votos_vino_favorito"), 1, `«Editar» lee la votación (${u})`);
  igual(await filas(u, "delete from public.votos_vino_favorito returning id"), 1, `«Editar» vacía la votación (${u})`);
  igual(await filas(u, "insert into storage.objects (bucket_id, name) values ('vinos', 'nuevo.webp') returning id"), 1, `«Editar» sube fotos (${u})`);
  igual(await filas(u, "delete from storage.objects where bucket_id = 'platos' returning id"), 1, `«Editar» borra fotos (${u})`);
  await acepta(u, "select public.trabajos_recorte_permiso()", `«Editar» pasa trabajos_recorte_permiso (${u})`);
  await acepta(u, "select public.trabajos_video_permiso()", `«Editar» pasa trabajos_video_permiso (${u})`);
  igual((await como(u, () => q("select public.recorte_servidor_reservar() r"))).rows[0].r, { permitido: true }, `«Editar» reserva recortes (${u})`);
}
// Una sesión de panel bloqueada no escribe aunque tenga «Editar» (la restrictiva sigue ahí).
await assert.rejects((async () => {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: U.CARTA_EDITA, role: "authenticated", bloqueado: true })}', true);`);
    await q(`insert into public."Vinos" (nombre) values ('x')`);
  } finally { await db.exec("rollback"); }
})(), RLS, "un usuario bloqueado escribió en la carta");
comprobaciones++;

// ─── 6. Newsletter ─────────────────────────────────────────────────────────
for (const u of [U.NEWS_VER, U.NEWS_EDITA, U.SA]) {
  igual(await filas(u, "select id from public.newsletter_suscriptores"), 1, `los suscriptores se consultan (${u})`);
  igual(await filas(u, "select id from public.newsletter_envios"), 1, `el historial de envíos se consulta (${u})`);
  igual(await filas(u, "select id from public.email_eventos"), 1, `las estadísticas se consultan (${u})`);
}
await rechaza(U.NEWS_VER, "insert into public.newsletter_envios (asunto) values ('x')", RLS, "solo «Ver» creó un envío");
igual(await filas(U.NEWS_VER, "update public.newsletter_envios set estado = 'fallido' returning id"), 0, "solo «Ver» cambió un envío");
igual(await filas(U.NEWS_VER, "delete from public.newsletter_envios returning id"), 0, "solo «Ver» borró envíos");
await rechaza(U.NEWS_VER, "insert into public.campanas_marketing (nombre) values ('x')", RLS, "solo «Ver» creó una campaña");
igual(await filas(U.NEWS_VER, "update public.campanas_marketing set nombre = 'x' returning id"), 0, "solo «Ver» cambió una campaña");
await rechaza(U.NEWS_VER, "insert into public.email_eventos (tipo) values ('x')", RLS, "solo «Ver» escribió estadísticas");
for (const u of [U.NEWS_EDITA, U.SA]) {
  igual(await filas(u, "insert into public.newsletter_envios (asunto) values ('x') returning id"), 1, `«Editar» crea envíos (${u})`);
  igual(await filas(u, "update public.campanas_marketing set nombre = 'x' returning id"), 1, `«Editar» cambia campañas (${u})`);
  igual(await filas(u, "delete from public.email_eventos returning id"), 1, `«Editar» borra eventos (${u})`);
}
igual(await filas(U.NEWS_EDITA, `update public."Platos" set precio_eur = 1 returning id`), 0, "editar Newsletter no da la carta");

// ─── 7. Lo que no cambia: Gestor Web con «Ver» e Instagram ─────────────────
igual(await filas(U.WEB_VER, "update public.novedades set titulo = 'x' returning id"), 1, "el Gestor Web con «Ver» sigue cambiando novedades");
igual(await filas(U.WEB_VER, "insert into storage.objects (bucket_id, name) values ('novedades', 'n.webp') returning id"), 1,
  "el Gestor Web con «Ver» sigue subiendo fotos de novedades");
await acepta(U.WEB_VER, "select public.configuracion_web_visibilidad_menu_tapas('menu', false)", "el Gestor Web con «Ver» sigue cambiando el menú y las tapas");
await acepta(U.NEWS_VER, "insert into public.instagram_piezas (titulo) values ('x')", "Instagram no se tocó (la política de prueba sigue con can_write_section)");

// ─── 8. Rollback: todo como estaba; se puede volver a aplicar ──────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual((await politicas()).filter((p) => (p.q + p.c).includes("can_edit_section")), [], "el rollback dejó políticas con can_edit_section");
igual(await expresion("Platos", "platos_update_seccion"), {
  q: "( SELECT can_write_section('gestor_carta'::text) AS can_write_section)",
  c: "( SELECT can_write_section('gestor_carta'::text) AS can_write_section)",
}, "el rollback no dejó la política de Platos como estaba");
for (const fn of ["trabajos_recorte_permiso", "trabajos_video_permiso", "recorte_servidor_reservar"]) {
  ok((await fuente(fn)).includes("can_write_section('gestor_carta')"), `el rollback no devolvió ${fn}`);
  igual(await firmaFuncion(fn), firmasAntes[fn], `el rollback cambió la firma de ${fn}`);
}
igual(await filas(U.CARTA_VER, `update public."Platos" set precio_eur = 1 returning id`), 3, "tras el rollback, vuelve lo de antes");
igual((await politicas()).filter((p) => /^(instagram|marketing_fechas|novedades)/.test(p.tablename) || /^(instagram|novedades)_/.test(p.policyname)),
  instagramAntes, "el rollback tocó Instagram o el Gestor Web");
await db.exec(MIGRACION);
igual(await politicas(), trasPrimera, "volver a aplicar tras el rollback no deja lo mismo");
igual(await filas(U.CARTA_VER, `update public."Platos" set precio_eur = 1 returning id`), 0, "volver a aplicar no cerró la carta");

await db.close();
console.log(`permisos carta y newsletter (PGlite): ${comprobaciones} comprobaciones correctas`);
