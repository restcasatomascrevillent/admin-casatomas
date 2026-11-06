// Quien solo tiene «Ver» (06/11/2026): la migración REAL 20261106520000 y su
// rollback contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:permisos-solo-ver:db
//
// Parte de lo que hay en la demo (canjear_cheque_regalo con permiso de EDICIÓN,
// de 20261008161255, verificar_cheque_regalo y el trigger de caducidad, sacados
// de las migraciones del repo) y aplica la migración dos veces. Cubre: que se
// para si falta algo; que con «Ver» en Cheques se canjea y queda quién y cuándo;
// que sin la sección, sin sesión o con un cheque no válido no; que anon no puede
// ejecutarla; que «Editar» y el super admin siguen pudiendo; y que el rollback
// devuelve la exigencia de edición (y se puede volver a aplicar).
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACIONES = "supabase/migrations";
const MIGRACION = await readFile(`${MIGRACIONES}/20261106520000_permisos_reservas_cheques_tienda.sql`, "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261106520000_permisos_reservas_cheques_tienda_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const ok = (valor, nombre) => { assert.ok(valor, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };

/** Definición de una función tal y como quedó en una migración ANTERIOR a esta (el estado de la demo). */
async function definicionAntes(nombre) {
  let ultima = null;
  for (const fichero of (await readdir(MIGRACIONES)).filter((f) => f.endsWith(".sql") && f < "20261106520000").sort()) {
    const sql = await readFile(`${MIGRACIONES}/${fichero}`, "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\([\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\2[^;]*;/gi;
    for (const m of sql.matchAll(re)) if (m[1].toLowerCase() === nombre) ultima = m[0].replace(/^create\s+function/i, "create or replace function");
  }
  if (!ultima) throw new Error(`No se encontró ${nombre} en las migraciones anteriores`);
  return ultima;
}

const EDITOR = "10000000-0000-0000-0000-000000000001";
const LECTOR = "20000000-0000-0000-0000-000000000002";
const AJENO = "30000000-0000-0000-0000-000000000003";
const SUPER = "40000000-0000-0000-0000-000000000004";
const LECTOR_RESERVAS = "50000000-0000-0000-0000-000000000005";

const db = new PGlite();
const una = async (texto, params) => (await db.query(texto, params)).rows[0];
const como = (usuario) => db.exec(`set test.actor = '${usuario ?? ""}'`);
const canjear = async (codigo) => (await una(`select public.canjear_cheque_regalo($1) as r`, [codigo])).r;

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${EDITOR}'), ('${LECTOR}'), ('${AJENO}'), ('${SUPER}'), ('${LECTOR_RESERVAS}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;

  -- Permisos por sección como en el panel: el super admin siempre; 'edit' según can_edit, 'view' según can_view.
  create table public.super_admins (user_id uuid primary key);
  insert into public.super_admins values ('${SUPER}');
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean);
  insert into public.user_permissions values
    ('${EDITOR}', 'cheques', true, true),
    ('${LECTOR}', 'cheques', true, false),
    ('${LECTOR_RESERVAS}', 'reservas', true, true);
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when exists (select 1 from public.super_admins where user_id = _user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view) or (_permission = 'edit' and can_edit))) end $f$;

  create table public.plantilla_cheques_regalo (id boolean primary key default true check (id), caducidad_meses integer not null default 12);
  insert into public.plantilla_cheques_regalo(id) values (true);
  create table public.cheques_regalo (
    id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
    importe_eur numeric not null, destinatario_nombre text,
    estado text not null default 'pendiente' check (estado in ('pendiente','pagado','cancelado')),
    codigo text unique, usado boolean not null default false, canjeado_en timestamptz, canjeado_por uuid references auth.users(id),
    emitido_en timestamptz, caduca_el date
  );
  revoke all on public.cheques_regalo from public, anon, authenticated;
`);
for (const nombre of ["private.cheques_controlar_caducidad", "public.verificar_cheque_regalo", "public.canjear_cheque_regalo"]) {
  await db.exec(await definicionAntes(nombre));
}
await db.exec(`
  create trigger cheques_controlar_caducidad before insert or update on public.cheques_regalo
    for each row execute function private.cheques_controlar_caducidad();
  grant execute on function public.verificar_cheque_regalo(text), public.canjear_cheque_regalo(text) to authenticated;
`);

const pagado = async (codigo) => {
  await db.query(`insert into public.cheques_regalo (importe_eur, estado, codigo) values (50, 'pagado', $1)`, [codigo]);
};
for (const c of ["CT-ANTES001", "CT-LECTOR01", "CT-EDITOR01", "CT-SUPER001", "CT-AJENO001", "CT-ROLLBK01", "CT-OTRAVEZ1"]) await pagado(c);
await db.exec(`insert into public.cheques_regalo (importe_eur, estado, codigo) values (30, 'cancelado', 'CT-CANCEL01')`);

// ─── 0. Antes de la migración (la demo de hoy): «Ver» no canjea ──────────────
await como(LECTOR);
await falla(canjear("CT-ANTES001"), /permiso/, "antes de la migración, solo «Ver» no canjea");

// ─── 1. Se para si falta algo, sin tocar nada ────────────────────────────────
{
  const vacia = new PGlite();
  await vacia.exec(`create role anon nologin; create role authenticated nologin; create schema auth;`);
  await falla(vacia.exec(MIGRACION), /permisos_reservas_cheques_tienda: falta .*public\.cheques_regalo/, "sin cheques_regalo se para");
  await vacia.close();
}

// ─── 2. Se aplica (dos veces: es idempotente) ────────────────────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);
const fuente = (await una(`select prosrc from pg_proc where oid = 'public.canjear_cheque_regalo(text)'::regprocedure`)).prosrc;
ok(fuente.includes("'cheques', 'view'") && !fuente.includes("'cheques', 'edit'"), "canjear pide la vista de Cheques");
igual((await una(`select has_function_privilege('anon', 'public.canjear_cheque_regalo(text)', 'EXECUTE') as p`)).p, false, "anon no puede canjear");
igual((await una(`select has_function_privilege('authenticated', 'public.canjear_cheque_regalo(text)', 'EXECUTE') as p`)).p, true, "authenticated sí puede ejecutarla");

// ─── 3. Con solo «Ver» en Cheques se canjea, y queda quién y cuándo ──────────
await como(LECTOR);
let r = await canjear(" ct-lector01 ");
igual([r.usado, r.valido], [true, false], "solo «Ver» canjea (normaliza el código)");
const fila = await una(`select canjeado_por, canjeado_en is not null as con_fecha from public.cheques_regalo where codigo = 'CT-LECTOR01'`);
igual([fila.canjeado_por, fila.con_fecha], [LECTOR, true], "queda registrado quién y cuándo");
await falla(canjear("CT-LECTOR01"), /ya ha sido canjeado/, "no se canjea dos veces");
await falla(canjear("CT-CANCEL01"), /no es válido/, "un cheque cancelado no se canjea");

// ─── 4. «Editar» y el super admin siguen pudiendo ────────────────────────────
await como(EDITOR);
igual((await canjear("CT-EDITOR01")).usado, true, "con «Editar» se canjea");
await como(SUPER);
igual((await canjear("CT-SUPER001")).usado, true, "el super admin canjea");

// ─── 5. Sin la sección Cheques o sin sesión, no ──────────────────────────────
await como(AJENO);
await falla(canjear("CT-AJENO001"), /permiso/, "sin permiso de Cheques no se canjea");
await como(LECTOR_RESERVAS);
await falla(canjear("CT-AJENO001"), /permiso/, "editar Reservas no da nada en Cheques");
await como(null);
await falla(canjear("CT-AJENO001"), /permiso/, "sin sesión no se canjea");
igual((await una(`select usado from public.cheques_regalo where codigo = 'CT-AJENO001'`)).usado, false, "el cheque sigue sin usar");

// ─── 6. Rollback: vuelve a pedir «Editar» (y es idempotente) ─────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
await como(LECTOR);
await falla(canjear("CT-ROLLBK01"), /permiso/, "tras el rollback, solo «Ver» ya no canjea");
await como(EDITOR);
igual((await canjear("CT-ROLLBK01")).usado, true, "tras el rollback, «Editar» sigue canjeando");
igual((await una(`select has_function_privilege('anon', 'public.canjear_cheque_regalo(text)', 'EXECUTE') as p`)).p, false, "tras el rollback, anon tampoco");

// ─── 7. Se puede volver a aplicar después del rollback ───────────────────────
await db.exec(MIGRACION);
await como(LECTOR);
igual((await canjear("CT-OTRAVEZ1")).usado, true, "reaplicada, solo «Ver» vuelve a canjear");

await db.close();
console.log(`test-permisos-solo-ver: ${comprobaciones} comprobaciones superadas`);
