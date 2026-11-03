// Recorte de fotos en un ordenador: trabajos_recorte y sus RPC contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:trabajos-recorte:db
//
// Cubre: la migración REAL 20261102160000 aplicada dos veces (idempotente),
// RLS por sección gestor_carta (y sesión de panel), validación de tabla +
// registro_id (la ficha tiene que existir), rutas sin carpetas, un trabajo
// vivo por ficha, reclamar (más antiguo primero, FOR UPDATE SKIP LOCKED,
// abandonados > 10 min), terminar solo por quien reclamó, soltar, borrar y el
// rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261102160000_trabajos_recorte.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261102160000_trabajos_recorte_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view) or (_permission = 'edit' and can_edit))) end $f$;
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  revoke all on function public.has_section_permission(uuid, text, text) from public;
  grant execute on function public.can_write_section(text), public.is_super_admin(uuid) to authenticated;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public."Platos" (id text primary key, nombre text);
  create table public."Vinos" (id uuid primary key, nombre text);
  create table public."Bebidas" (id uuid primary key, nombre text);
  create table public."Cocteles" (id uuid primary key, nombre text);
`;

const U = {
  CARTA: "a0000000-0000-0000-0000-000000000001",
  PC: "a0000000-0000-0000-0000-000000000002",
  STAFF: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
};
const V1 = "c0000000-0000-0000-0000-000000000001";
const B1 = "c0000000-0000-0000-0000-000000000002";
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.CARTA}', 'carta@t', null), ('${U.PC}', 'pc@t', null), ('${U.STAFF}', 'staff@t', null), ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) values
    ('${sesion(U.CARTA)}', '${U.CARTA}'), ('${sesion(U.PC)}', '${U.PC}'), ('${sesion(U.STAFF)}', '${U.STAFF}'), ('${sesion(U.BLOQ)}', '${U.BLOQ}');
  insert into public.user_permissions values
    ('${U.CARTA}', 'gestor_carta', true, true), ('${U.PC}', 'gestor_carta', true, false),
    ('${U.STAFF}', 'dashboard', true, true), ('${U.BLOQ}', 'gestor_carta', true, true);
  insert into public."Platos" (id, nombre) values ('p1', 'Arroz meloso'), ('p2', 'Chuletón');
  insert into public."Vinos" (id, nombre) values ('${V1}', 'Fondillón');
  insert into public."Bebidas" (id, nombre) values ('${B1}', 'Vermut');
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

async function como(u, fn) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const q = (sql, params) => db.query(sql, params);
const rechaza = async (u, sql, patron, msg) => {
  await assert.rejects(como(u, () => q(sql)), patron, msg);
  comprobaciones++;
};
const crear = (u, tabla, id, ruta = `${id}.jpg`, tema = "cartulina") => como(u, () => q(
  `insert into public.trabajos_recorte (tabla, registro_id, nombre, ruta_original, tema, creado_por, dispositivo_origen)
   values ($1, $2, 'x', $3, $4, $5, 'Safari · iPhone') returning id`, [tabla, id, ruta, tema, u]));

// 1. Alta y validaciones.
const t1 = (await crear(U.CARTA, "Platos", "p1")).rows[0].id;
ok(t1, "CARTA no pudo crear el trabajo de un plato");
const tv = (await crear(U.CARTA, "Vinos", V1, `${V1}.jpeg`)).rows[0].id;
ok(tv, "CARTA no pudo crear el trabajo de un vino");
await rechaza(U.STAFF, `insert into public.trabajos_recorte (tabla, registro_id, ruta_original, creado_por) values ('Platos', 'p2', 'p2.jpg', '${U.STAFF}')`, /row-level security/, "STAFF creó un trabajo");
await rechaza(U.BLOQ, `insert into public.trabajos_recorte (tabla, registro_id, ruta_original, creado_por) values ('Platos', 'p2', 'p2.jpg', '${U.BLOQ}')`, /row-level security/, "Bloqueado creó un trabajo");
await rechaza(U.CARTA, `insert into public.trabajos_recorte (tabla, registro_id, ruta_original, creado_por) values ('Platos', 'p2', 'p2.jpg', '${U.PC}')`, /row-level security/, "Se creó a nombre de otro");
await rechaza(U.CARTA, `insert into public.trabajos_recorte (tabla, registro_id, ruta_original, creado_por, estado) values ('Platos', 'p2', 'p2.jpg', '${U.CARTA}', 'listo')`, /row-level security/, "Se creó en 'listo'");
await assert.rejects(crear(U.CARTA, "user_permissions", "p2"), /trabajos_recorte_tabla_chk|no admitida/, "Tabla arbitraria aceptada"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Platos", "no-existe"), /no existe/, "Ficha inexistente aceptada"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Bebidas", "p1"), /no existe/, "Id de otra tabla aceptado"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Platos", "p2", "../vinos/x.jpg"), /trabajos_recorte_ruta_chk/, "Ruta con .. aceptada"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Platos", "p2", "carpeta/p2.jpg"), /trabajos_recorte_ruta_chk/, "Ruta con carpeta aceptada"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Platos", "p2", "p2.jpg", "Robado; drop"), /trabajos_recorte_tema_chk/, "Tema raro aceptado"); comprobaciones++;
await assert.rejects(crear(U.CARTA, "Platos", "p1"), /trabajos_recorte_un_vivo_por_ficha/, "Dos trabajos vivos para la misma ficha"); comprobaciones++;
await assert.rejects(db.exec(`begin; set local role anon; select * from public.trabajos_recorte;`), /permission denied/);
await db.exec("rollback");
comprobaciones++;

// 2. Lectura y RPC sin permiso.
igual((await como(U.PC, () => q("select count(*)::int n from public.trabajos_recorte"))).rows[0].n, 2, "PC no ve los pendientes");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.trabajos_recorte"))).rows[0].n, 0, "STAFF ve trabajos");
await rechaza(U.CARTA, `update public.trabajos_recorte set estado = 'listo'`, /permission denied/, "UPDATE directo permitido");
await rechaza(U.STAFF, `select * from public.reclamar_trabajo_recorte()`, /Sin permiso de carta/, "STAFF reclamó");
await rechaza(U.BLOQ, `select * from public.reclamar_trabajo_recorte()`, /Sesión de panel no válida/, "Bloqueado reclamó");

// 3. Reclamar: el más antiguo primero; dos reclamos no cogen el mismo.
const reclamar = (u, id = null) => como(u, () => q(`select * from public.reclamar_trabajo_recorte($1, 'Chrome · Windows')`, [id]));
const ra = await reclamar(U.PC);
const rb = await reclamar(U.CARTA);
igual(ra.rows[0].id, t1, "No se cogió el más antiguo primero");
igual(rb.rows[0].id, tv, "El segundo reclamo no cogió el otro");
igual([ra.rows[0].estado, ra.rows[0].procesado_por, ra.rows[0].intentos], ["procesando", U.PC, 1], "El reclamo no marcó procesando");
igual((await reclamar(U.PC)).rows.length, 0, "Se reclamó uno ya en proceso");
const def = (await q(`select pg_get_functiondef('public.reclamar_trabajo_recorte(uuid, text)'::regprocedure) d`)).rows[0].d;
ok(/for\s+update\s+skip\s+locked/i.test(def), "reclamar_trabajo_recorte sin FOR UPDATE SKIP LOCKED");

// 4. Terminar: solo quien lo reclamó.
await rechaza(U.CARTA, `select public.terminar_trabajo_recorte('${t1}', true)`, /no lo está procesando/, "Otro cerró el trabajo de PC");
const fin = (await como(U.PC, () => q(`select * from public.terminar_trabajo_recorte('${t1}', true)`))).rows[0];
igual([fin.estado, fin.error], ["listo", null], "terminar(ok) no dejó 'listo'");
const err = (await como(U.CARTA, () => q(`select * from public.terminar_trabajo_recorte('${tv}', false, 'No se encontró la botella')`))).rows[0];
igual([err.estado, err.error], ["error", "No se encontró la botella"], "terminar(error) no guardó el error");
ok((await crear(U.CARTA, "Platos", "p1", "p1.png")).rows[0].id, "No se pudo crear otro tras terminar");

// 5. Abandonados y soltar.
await db.exec(`update public.trabajos_recorte set estado = 'procesando', procesado_por = '${U.CARTA}', reclamado_en = now() - interval '11 minutes' where registro_id = 'p1' and estado = 'pendiente'`);
const re = await reclamar(U.PC);
igual([re.rows[0]?.registro_id, re.rows[0]?.procesado_por], ["p1", U.PC], "No se retomó el abandonado");
igual((await como(U.CARTA, () => q(`select public.soltar_trabajo_recorte('${re.rows[0].id}') s`))).rows[0].s, false, "Otro soltó el trabajo");
igual((await como(U.PC, () => q(`select public.soltar_trabajo_recorte('${re.rows[0].id}') s`))).rows[0].s, true, "PC no pudo soltar");

// 6. Borrar: pendiente sí, procesando no.
const tid = re.rows[0].id;
await reclamar(U.PC, tid);
igual((await como(U.CARTA, () => q(`with b as (delete from public.trabajos_recorte where id = '${tid}' returning 1) select count(*)::int n from b`))).rows[0].n, 0, "Se borró uno en proceso");
await como(U.PC, () => q(`select public.soltar_trabajo_recorte('${tid}')`));
igual((await como(U.CARTA, () => q(`with b as (delete from public.trabajos_recorte where id = '${tid}' returning 1) select count(*)::int n from b`))).rows[0].n, 1, "No se pudo cancelar un pendiente");

// 7. Rollback.
await db.exec(ROLLBACK);
const quedan = (await q(`select count(*)::int n from pg_class where relname = 'trabajos_recorte' and relnamespace = 'public'::regnamespace`)).rows[0].n
  + (await q(`select count(*)::int n from pg_proc where proname like '%trabajo%recorte%'`)).rows[0].n;
igual(quedan, 0, "El rollback dejó tablas o funciones");
await db.exec(MIGRACION);
comprobaciones++;

await db.close();
console.log(`trabajos_recorte: ${comprobaciones} comprobaciones OK`);
