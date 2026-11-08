// Originales de la carta en Google Drive (carta_fotos_originales) contra un
// Postgres en memoria (PGlite), con la migración REAL. Nunca toca Supabase.
//
//   npm run test:carta-originales:db
//
// Cubre 20261117100000_carta_fotos_originales.sql: se para si falta algo de
// lo que depende; idempotente; RLS (gestor_carta «Editar» escribe, «Ver» de
// carta o de marketing lee, otra sección no, anon nada, sesión bloqueada no);
// upsert por plato_id/vino_id (lo que hace instagram-drive); CHECK (plato O
// vino, marca, drive_id, nombre, medidas ≤ 4000, bytes ≤ 8 MB); la ficha y
// subido_por no se falsean; borrado en cascada con el plato; y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261117100000_carta_fotos_originales.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261117100000_carta_fotos_originales_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
async function falla(db, sql, patron, msg) {
  let error = null;
  try { await db.exec(sql); } catch (e) { error = e; }
  try { await db.exec("rollback;"); } catch { /* sin transacción */ }
  try { await db.exec("reset role;"); } catch { /* sin rol */ }
  ok(error && patron.test(String(error.message)), `${msg} (error: ${error?.message ?? "ninguno"})`);
}

// Andamiaje mínimo de Supabase + las funciones de permisos del panel
// (can_edit_section mira «Editar»; can_read_section, «Ver»).
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
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select exists (select 1 from public.super_admins where user_id = _user_id) or exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view) or (_permission = 'edit' and can_edit))) $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.can_read_section(text), public.can_edit_section(text) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.audit_log (tabla text, op text);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
    begin insert into public.audit_log values (tg_table_name, tg_op); return coalesce(new, old); end $f$;
`;
const CARTA_TABLAS = `
  create table public."Platos" (id text primary key, nombre text, activado boolean default true);
  create table public."Vinos" (id text primary key, nombre text, activado boolean default true);
  grant select on public."Platos", public."Vinos" to anon, authenticated;
`;

// CARTA (edita la carta), VERCARTA (solo «Ver» carta), MKT (Marketing, ver),
// OTRO (otra sección), BLOQ (carta pero bloqueado).
const U = {
  CARTA: "a0000000-0000-0000-0000-000000000001",
  VERCARTA: "a0000000-0000-0000-0000-000000000002",
  MKT: "a0000000-0000-0000-0000-000000000003",
  OTRO: "a0000000-0000-0000-0000-000000000004",
  BLOQ: "a0000000-0000-0000-0000-000000000005",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.CARTA}', 'c@t', null), ('${U.VERCARTA}', 'v@t', null), ('${U.MKT}', 'm@t', null), ('${U.OTRO}', 'o@t', null),
    ('${U.BLOQ}', 'b@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.user_permissions values
    ('${U.CARTA}', 'gestor_carta', true, true), ('${U.VERCARTA}', 'gestor_carta', true, false),
    ('${U.MKT}', 'marketing', true, false), ('${U.OTRO}', 'reservas', true, true), ('${U.BLOQ}', 'gestor_carta', true, true);
  insert into public."Platos" (id, nombre) values ('p1', 'Chuletón'), ('p2', 'Arroz meloso');
  insert into public."Vinos" (id, nombre) values ('v1', 'Pidio');
`;
const como = (u) => `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}","session_id":"${sesion(u)}","role":"authenticated"}', false);`;
const anon = `set role anon; select set_config('request.jwt.claims', '', false);`;

const FILA = (o = {}) => {
  const f = { plato_id: "'p1'", vino_id: "null", marca: "'casa-tomas'", drive_id: "'1AbCdEfGhIjKlMnOp'", nombre: "'chuleton-p1.jpg'", ancho: 4000, alto: 3000, bytes: 3_000_000, ...o };
  return `(${f.plato_id}, ${f.vino_id}, ${f.marca}, ${f.drive_id}, ${f.nombre}, ${f.ancho}, ${f.alto}, ${f.bytes})`;
};
const INSERT = (o, conflicto = "plato_id") =>
  `insert into public.carta_fotos_originales (plato_id, vino_id, marca, drive_id, nombre, ancho, alto, bytes) values ${FILA(o)}
   on conflict (${conflicto}) do update set drive_id = excluded.drive_id, nombre = excluded.nombre, ancho = excluded.ancho,
     alto = excluded.alto, bytes = excluded.bytes, marca = excluded.marca;`;

// 1. Se para si falta algo.
{
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  await falla(db, MIGRACION, /falta .*"Platos"/, "sin la carta, la migración se para");
  ok((await db.query(`select to_regclass('public.carta_fotos_originales') t`)).rows[0].t === null, "y no crea nada");
  await db.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE + CARTA_TABLAS + DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
igual(
  (await db.query(`select count(*)::int n from pg_policies where tablename = 'carta_fotos_originales'`)).rows[0].n,
  6,
  "5 políticas propias + la restrictiva de sesión, sin duplicar",
);
igual((await db.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.carta_fotos_originales'::regclass and not tgisinternal`)).rows[0].n, 2, "trigger propio + auditoría, una vez");

// 2. Escribe quien edita la carta.
await db.exec(como(U.CARTA) + INSERT() + "reset role;");
let fila = (await db.query(`select * from public.carta_fotos_originales where plato_id = 'p1'`)).rows[0];
ok(fila && fila.ancho === 4000 && fila.subido_por === U.CARTA, "gestor_carta («Editar») guarda el original, con subido_por = él");
// Upsert: cambiar la foto reemplaza la fila del plato (no crea otra).
await db.exec(como(U.CARTA) + INSERT({ drive_id: "'1ZyXwVuTsRqPoNmLk'", ancho: 3000, alto: 4000 }) + "reset role;");
const filas = (await db.query(`select drive_id, ancho, alto from public.carta_fotos_originales where plato_id = 'p1'`)).rows;
igual(filas, [{ drive_id: "1ZyXwVuTsRqPoNmLk", ancho: 3000, alto: 4000 }], "upsert por plato_id: una sola fila por plato");
await db.exec(como(U.CARTA) + INSERT({ plato_id: "null", vino_id: "'v1'", drive_id: "'1VinoVinoVinoVino'", nombre: "'pidio-v1.jpg'", ancho: 900, alto: 1200 }, "vino_id") + "reset role;");
ok((await db.query(`select 1 from public.carta_fotos_originales where vino_id = 'v1'`)).rows.length === 1, "y lo mismo con un vino (on conflict vino_id)");

// 3. No escriben los demás.
for (const [u, quien] of [[U.VERCARTA, "solo «Ver» carta"], [U.MKT, "Marketing"], [U.OTRO, "otra sección"], [U.BLOQ, "sesión bloqueada"]]) {
  await falla(db, como(u) + INSERT({ plato_id: "'p2'", drive_id: "'1OtroOtroOtroOtro'", nombre: "'arroz-p2.jpg'" }), /row-level security|violates/, `${quien} no puede guardar un original`);
}
await db.exec(como(U.MKT) + `update public.carta_fotos_originales set ancho = 1 where plato_id = 'p1'; reset role;`);
ok((await db.query(`select ancho from public.carta_fotos_originales where plato_id = 'p1'`)).rows[0].ancho === 3000, "Marketing no puede cambiar un original (el UPDATE no toca filas)");
await db.exec(como(U.MKT) + `delete from public.carta_fotos_originales; reset role;`);
ok((await db.query(`select count(*)::int n from public.carta_fotos_originales`)).rows[0].n === 2, "ni borrarlo");

// 4. Leen carta y Marketing; no otra sección, ni anon, ni bloqueados.
const leer = async (pre) => {
  await db.exec(pre);
  try {
    return (await db.query(`select count(*)::int n from public.carta_fotos_originales`)).rows[0].n;
  } catch (e) {
    return `error: ${e.message}`;
  } finally {
    await db.exec("reset role;");
  }
};
igual(await leer(como(U.VERCARTA)), 2, "«Ver» de la carta lee los originales");
igual(await leer(como(U.MKT)), 2, "Marketing (Instagram) lee los originales");
igual(await leer(como(U.OTRO)), 0, "otra sección no ve nada");
igual(await leer(como(U.BLOQ)), 0, "una sesión bloqueada no ve nada");
ok(String(await leer(anon)).startsWith("error"), "anon no tiene permiso sobre la tabla (las webs no ven ids de Drive)");

// 5. CHECK.
const malas = [
  [{ plato_id: "'p2'", vino_id: "'v1'" }, "de un plato y un vino a la vez"],
  [{ plato_id: "null" }, "sin plato ni vino"],
  [{ plato_id: "'p2'", marca: "'otra'" }, "marca desconocida"],
  [{ plato_id: "'p2'", drive_id: "'../../etc'" }, "drive_id con caracteres raros"],
  [{ plato_id: "'p2'", nombre: "'../x.jpg'" }, "nombre de fichero raro"],
  [{ plato_id: "'p2'", ancho: 4001 }, "más de 4000 px"],
  [{ plato_id: "'p2'", bytes: 9_000_000 }, "más de 8 MB"],
];
for (const [o, msg] of malas) {
  await falla(db, INSERT({ drive_id: "'1CheckCheckCheckC'", nombre: "'arroz-p2.jpg'", ...o }), /violates|check|constraint/i, `CHECK: ${msg}`);
}
await falla(db, INSERT({ plato_id: "'no-existe'", drive_id: "'1CheckCheckCheckD'", nombre: "'x-no-existe.jpg'" }), /foreign key/i, "el plato tiene que existir");

// 6. La ficha y subido_por no se falsean al editar.
await db.exec(como(U.CARTA) + `update public.carta_fotos_originales set plato_id = 'p2', subido_por = '${U.OTRO}' where plato_id = 'p1'; reset role;`);
fila = (await db.query(`select plato_id, subido_por from public.carta_fotos_originales where drive_id = '1ZyXwVuTsRqPoNmLk'`)).rows[0];
igual(fila, { plato_id: "p1", subido_por: U.CARTA }, "un UPDATE no cambia el plato ni falsea subido_por");

// 7. Auditoría y cascada.
ok((await db.query(`select count(*)::int n from public.audit_log where tabla = 'carta_fotos_originales'`)).rows[0].n >= 3, "se audita");
await db.exec(`delete from public."Platos" where id = 'p1'`);
ok((await db.query(`select count(*)::int n from public.carta_fotos_originales where plato_id = 'p1'`)).rows[0].n === 0, "al borrar el plato se borra su fila (los ficheros siguen en Drive)");

// 8. Rollback (dos veces).
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
ok((await db.query(`select to_regclass('public.carta_fotos_originales') t`)).rows[0].t === null, "el rollback quita la tabla");
ok((await db.query(`select count(*)::int n from pg_proc where proname = 'carta_fotos_originales_al_editar'`)).rows[0].n === 0, "y la función");
ok((await db.query(`select count(*)::int n from public."Vinos"`)).rows[0].n === 1, "sin tocar la carta");
// Se puede volver a aplicar.
await db.exec(MIGRACION);
ok((await db.query(`select to_regclass('public.carta_fotos_originales') t`)).rows[0].t !== null, "y se puede volver a aplicar");

console.log(`✔ carta_fotos_originales: ${comprobaciones} comprobaciones`);
