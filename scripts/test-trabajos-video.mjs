// «Mandar a un dispositivo potente»: trabajos_video + suscripciones_push y sus
// RPC contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:trabajos-video:db
//
// Cubre: la migración REAL 20261101160000 aplicada dos veces (idempotente),
// RLS por sección gestor_carta (y sesión de panel), reclamar atómico (dos
// reclamos a la vez nunca cogen el mismo; FOR UPDATE SKIP LOCKED), retoma de
// 'procesando' abandonados (> 10 min), terminar solo por quien reclamó,
// soltar, un único trabajo vivo por plato, suscripciones por usuario y el
// rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261101160000_trabajos_video.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261101160000_trabajos_video_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase + las funciones de permisos reales del panel
// (mismas definiciones que supabase/tests/fixtures/t4a_estado_previo.sql).
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
  grant select on public."Platos" to authenticated;
`;

// Personas: CARTA (gestor_carta), PC (gestor_carta, el dispositivo potente),
// STAFF (sin carta) y BLOQ (carta pero bloqueado).
const U = {
  CARTA: "a0000000-0000-0000-0000-000000000001",
  PC: "a0000000-0000-0000-0000-000000000002",
  STAFF: "a0000000-0000-0000-0000-000000000003",
  BLOQ: "a0000000-0000-0000-0000-000000000004",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.CARTA}', 'carta@t', null), ('${U.PC}', 'pc@t', null), ('${U.STAFF}', 'staff@t', null), ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) values
    ('${sesion(U.CARTA)}', '${U.CARTA}'), ('${sesion(U.PC)}', '${U.PC}'), ('${sesion(U.STAFF)}', '${U.STAFF}'), ('${sesion(U.BLOQ)}', '${U.BLOQ}');
  insert into public.user_permissions values
    ('${U.CARTA}', 'gestor_carta', true, true), ('${U.PC}', 'gestor_carta', true, false),
    ('${U.STAFF}', 'dashboard', true, true), ('${U.BLOQ}', 'gestor_carta', true, true);
  insert into public."Platos" (id, nombre) values ('p1', 'Arroz meloso'), ('p2', 'Chuletón'), ('p3', 'Tarta de queso');
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

/** Ejecuta fn como el usuario `u` (rol authenticated, JWT con session_id) dentro de una transacción. */
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
const ruta = (n) => `pendientes/${String(n).padStart(8, "0")}-abcd.mp4`;
const crear = (u, plato, n) => como(u, () => q(
  `insert into public.trabajos_video (plato_id, ruta_original, tema, creado_por, dispositivo_origen)
   values ($1, $2, 'cartulina', $3, 'iPhone') returning id`, [plato, ruta(n), u]));

// 1. Alta: CARTA sí; STAFF no; BLOQ no; no se puede crear a nombre de otro ni ya reclamado.
const t1 = (await crear(U.CARTA, "p1", 1)).rows[0].id;
ok(t1, "CARTA no pudo crear el trabajo");
await rechaza(U.STAFF, `insert into public.trabajos_video (plato_id, ruta_original, creado_por) values ('p2', '${ruta(2)}', '${U.STAFF}')`, /row-level security/, "STAFF creó un trabajo");
await rechaza(U.BLOQ, `insert into public.trabajos_video (plato_id, ruta_original, creado_por) values ('p2', '${ruta(2)}', '${U.BLOQ}')`, /row-level security/, "Un usuario bloqueado creó un trabajo");
await rechaza(U.CARTA, `insert into public.trabajos_video (plato_id, ruta_original, creado_por) values ('p2', '${ruta(2)}', '${U.PC}')`, /row-level security/, "Se creó a nombre de otro");
await rechaza(U.CARTA, `insert into public.trabajos_video (plato_id, ruta_original, creado_por, estado) values ('p2', '${ruta(2)}', '${U.CARTA}', 'listo')`, /row-level security/, "Se creó directamente en 'listo'");
await rechaza(U.CARTA, `insert into public.trabajos_video (plato_id, ruta_original, creado_por) values ('p2', 'otra/carpeta/x.mp4', '${U.CARTA}')`, /trabajos_video_ruta_chk/, "Ruta fuera de pendientes/ aceptada");
// Un solo trabajo vivo por plato
await assert.rejects(crear(U.CARTA, "p1", 9), /trabajos_video_un_vivo_por_plato/, "Dos trabajos vivos para el mismo plato");
comprobaciones++;
// anon no ve nada
await assert.rejects(db.exec(`begin; set local role anon; select * from public.trabajos_video;`), /permission denied/);
await db.exec("rollback");
comprobaciones++;

// 2. Lectura: CARTA y PC ven; STAFF no ve nada; sin UPDATE directo.
igual((await como(U.PC, () => q("select count(*)::int n from public.trabajos_video"))).rows[0].n, 1, "PC no ve el pendiente");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.trabajos_video"))).rows[0].n, 0, "STAFF ve trabajos");
await rechaza(U.CARTA, `update public.trabajos_video set estado = 'listo'`, /permission denied/, "UPDATE directo permitido");
await rechaza(U.STAFF, `select * from public.reclamar_trabajo_video()`, /Sin permiso de carta/, "STAFF reclamó");
await rechaza(U.BLOQ, `select * from public.reclamar_trabajo_video()`, /Sesión de panel no válida/, "Bloqueado reclamó");

// 3. Dos reclamos a la vez nunca cogen el mismo trabajo.
const t2 = (await crear(U.CARTA, "p2", 2)).rows[0].id;
const reclamar = (u) => como(u, () => q(`select * from public.reclamar_trabajo_video(null, 'PC prueba')`));
// PGlite tiene una sola conexión: los dos reclamos van uno tras otro (cada uno
// en su transacción). Con conexiones reales lo garantiza FOR UPDATE SKIP
// LOCKED (comprobado abajo en la definición de la función).
const ra = await reclamar(U.PC);
const rb = await reclamar(U.CARTA);
igual(ra.rows.length, 1, "El primer reclamo no cogió nada");
igual(rb.rows.length, 1, "El segundo reclamo no cogió nada");
ok(ra.rows[0].id !== rb.rows[0].id, "Dos reclamos cogieron el MISMO trabajo");
igual(ra.rows[0].id, t1, "No se cogió el más antiguo primero");
igual([ra.rows[0].estado, ra.rows[0].procesado_por, ra.rows[0].intentos], ["procesando", U.PC, 1], "El reclamo no marcó procesando/procesado_por/intentos");
igual((await reclamar(U.PC)).rows.length, 0, "Se reclamó un trabajo ya en proceso (reciente)");
// La función usa FOR UPDATE SKIP LOCKED (lo que garantiza lo anterior con conexiones reales).
const def = (await q(`select pg_get_functiondef('public.reclamar_trabajo_video(uuid, text)'::regprocedure) d`)).rows[0].d;
ok(/for\s+update\s+skip\s+locked/i.test(def), "reclamar_trabajo_video sin FOR UPDATE SKIP LOCKED");

// 4. Terminar: solo quien lo reclamó; luego ya no se puede repetir.
await rechaza(U.CARTA, `select public.terminar_trabajo_video('${t1}', true)`, /no lo está procesando/, "Otro usuario cerró el trabajo de PC");
const fin = (await como(U.PC, () => q(`select * from public.terminar_trabajo_video('${t1}', true)`))).rows[0];
igual([fin.estado, fin.error], ["listo", null], "terminar(ok) no dejó 'listo'");
ok(fin.terminado_en, "terminar no puso terminado_en");
await rechaza(U.PC, `select public.terminar_trabajo_video('${t1}', false, 'x')`, /no lo está procesando/, "Se cerró dos veces");
// Error con mensaje (CARTA reclamó t2)
const err = (await como(U.CARTA, () => q(`select * from public.terminar_trabajo_video('${t2}', false, 'Sin WebGPU')`))).rows[0];
igual([err.estado, err.error], ["error", "Sin WebGPU"], "terminar(error) no guardó el error");
// Con t1 listo y t2 en error, ya se puede crear otro para p1 y p2
ok((await crear(U.CARTA, "p1", 3)).rows[0].id, "No se pudo crear otro trabajo tras terminar el anterior");

// 5. Abandonados: 'procesando' de hace > 10 min se puede volver a reclamar.
const t4 = (await crear(U.CARTA, "p3", 4)).rows[0].id;
await db.exec(`update public.trabajos_video set estado = 'procesando', procesado_por = '${U.CARTA}', reclamado_en = now() - interval '11 minutes' where plato_id = 'p1' and estado = 'pendiente'`);
await db.exec(`update public.trabajos_video set estado = 'procesando', procesado_por = '${U.CARTA}', reclamado_en = now() - interval '5 minutes' where id = '${t4}'`);
const re = await reclamar(U.PC);
igual(re.rows.length, 1, "No se retomó el abandonado de hace 11 min");
igual([re.rows[0].plato_id, re.rows[0].procesado_por, re.rows[0].intentos], ["p1", U.PC, 1], "La retoma no pasó el trabajo a PC");
igual((await reclamar(U.PC)).rows.length, 0, "Se retomó uno de hace 5 min");
// Reclamar uno concreto (p_id)
await db.exec(`update public.trabajos_video set estado = 'pendiente', procesado_por = null, reclamado_en = null where id = '${t4}'`);
igual((await como(U.PC, () => q(`select id from public.reclamar_trabajo_video('${t4}')`))).rows[0]?.id, t4, "No se reclamó el trabajo indicado");

// 6. Soltar: vuelve a pendiente (solo el que lo tiene).
igual((await como(U.CARTA, () => q(`select public.soltar_trabajo_video('${t4}') s`))).rows[0].s, false, "Otro soltó el trabajo de PC");
igual((await como(U.PC, () => q(`select public.soltar_trabajo_video('${t4}') s`))).rows[0].s, true, "PC no pudo soltar su trabajo");
igual((await q(`select estado, procesado_por from public.trabajos_video where id = '${t4}'`)).rows[0], { estado: "pendiente", procesado_por: null }, "soltar no dejó pendiente");

// 7. Borrar: pendiente sí (cancelar), procesando no.
await como(U.PC, () => q(`select * from public.reclamar_trabajo_video('${t4}')`));
igual((await como(U.CARTA, () => q(`with b as (delete from public.trabajos_video where id = '${t4}' returning 1) select count(*)::int n from b`))).rows[0].n, 0, "Se borró un trabajo en proceso");
await como(U.PC, () => q(`select public.soltar_trabajo_video('${t4}')`));
igual((await como(U.CARTA, () => q(`with b as (delete from public.trabajos_video where id = '${t4}' returning 1) select count(*)::int n from b`))).rows[0].n, 1, "No se pudo cancelar un pendiente");
// Borrar el plato borra sus trabajos (on delete cascade)
await db.exec(`delete from public."Platos" where id = 'p2'`);
igual((await q(`select count(*)::int n from public.trabajos_video where plato_id = 'p2'`)).rows[0].n, 0, "Trabajos huérfanos al borrar el plato");

// 8. Suscripciones push: cada uno las suyas; el endpoint pasa al último usuario.
const EP = "https://fcm.googleapis.com/fcm/send/abc123";
const guardar = (u, ep = EP) => como(u, () => q(`select public.guardar_suscripcion_push($1, $2, $3, 'Chrome · Android') id`, [ep, "B".repeat(87), "A".repeat(22)]));
ok((await guardar(U.CARTA)).rows[0].id, "CARTA no pudo guardar su suscripción");
ok((await guardar(U.CARTA)).rows[0].id, "Repetir la suscripción falló (no es upsert)");
igual((await q(`select count(*)::int n from public.suscripciones_push`)).rows[0].n, 1, "La suscripción se duplicó");
igual((await como(U.PC, () => q(`select count(*)::int n from public.suscripciones_push`))).rows[0].n, 0, "PC ve suscripciones ajenas");
await rechaza(U.CARTA, `insert into public.suscripciones_push (user_id, endpoint, p256dh, auth) values ('${U.CARTA}', 'https://x/y', '${"B".repeat(87)}', '${"A".repeat(22)}')`, /permission denied/, "INSERT directo en suscripciones_push");
await guardar(U.PC); // mismo navegador, otro usuario
igual((await q(`select user_id from public.suscripciones_push`)).rows[0].user_id, U.PC, "El endpoint no pasó al último usuario");
await rechaza(U.BLOQ, `select public.guardar_suscripcion_push('https://x/z', '${"B".repeat(87)}', '${"A".repeat(22)}')`, /Sesión de panel no válida/, "Bloqueado guardó suscripción");
await rechaza(U.PC, `select public.guardar_suscripcion_push('http://inseguro/x', '${"B".repeat(87)}', '${"A".repeat(22)}')`, /suscripciones_push_endpoint_chk/, "Endpoint sin https aceptado");
igual((await como(U.CARTA, () => q(`with b as (delete from public.suscripciones_push returning 1) select count(*)::int n from b`))).rows[0].n, 0, "CARTA borró la suscripción de PC");
igual((await como(U.PC, () => q(`with b as (delete from public.suscripciones_push returning 1) select count(*)::int n from b`))).rows[0].n, 1, "PC no pudo borrar su suscripción");

// 9. Rollback: no queda nada.
await db.exec(ROLLBACK);
const quedan = (await q(`select count(*)::int n from pg_class where relname in ('trabajos_video', 'suscripciones_push') and relnamespace = 'public'::regnamespace`)).rows[0].n
  + (await q(`select count(*)::int n from pg_proc where proname in ('reclamar_trabajo_video', 'terminar_trabajo_video', 'soltar_trabajo_video', 'guardar_suscripcion_push', 'trabajos_video_permiso')`)).rows[0].n;
igual(quedan, 0, "El rollback dejó tablas o funciones");
await db.exec(MIGRACION); // se puede volver a aplicar tras el rollback
comprobaciones++;

await db.close();
console.log(`trabajos_video: ${comprobaciones} comprobaciones OK`);
