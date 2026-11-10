// «Bloquear servicio» y «menú del día» (10/11/2026) contra un Postgres en
// memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:servicios-bloqueados:db
//
// Aplica la migración REAL 20261122100000 (dos veces: idempotente) y su
// rollback, y comprueba: la tabla y su clave (fecha, turno), el CHECK del
// turno, el default de menu_del_dia, RLS activa con sus políticas, que anon
// no tiene permisos y authenticated sí, la publicación de tiempo real y que
// una reserva en un servicio bloqueado SÍ entra por la BD (el bloqueo es solo
// de la web: las manuales del panel se permiten).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122100000_servicios_bloqueados.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122100000_servicios_bloqueados_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const falla = async (promesa, re, msg) => { await assert.rejects(promesa, re, msg); comprobaciones++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create function public.can_read_section(text) returns boolean language sql as $$ select true $$;
  create function public.can_write_section(text) returns boolean language sql as $$ select true $$;
  create function public.fn_registrar_auditoria() returns trigger language plpgsql as $$ begin return null; end $$;
  create table public.reservas (
    id uuid primary key default gen_random_uuid(),
    nombre text, fecha date, hora time, numero_comensales int, estado varchar default 'pendiente'
  );
  insert into public.reservas (nombre, fecha, hora, numero_comensales) values ('Antes', '2026-12-01', '14:00', 2);
`);

let hayPublicacion = true;
try {
  await db.exec(`create publication supabase_realtime;`);
} catch {
  hayPublicacion = false; // PGlite sin publicaciones: la guarda de la migración lo salta.
}

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

// Tabla, clave y CHECK.
await db.exec(`insert into public.servicios_bloqueados (fecha, turno, motivo) values ('2026-12-12', 'cena', 'Lleno')`);
await db.exec(`insert into public.servicios_bloqueados (fecha, turno) values ('2026-12-12', 'comida')`);
await falla(db.exec(`insert into public.servicios_bloqueados (fecha, turno) values ('2026-12-12', 'cena')`), /duplicate key|unique/i, "clave (fecha, turno)");
await falla(db.exec(`insert into public.servicios_bloqueados (fecha, turno) values ('2026-12-13', 'desayuno')`), /check/i, "turno solo comida/cena");
const { rows: filas } = await db.query(`select created_at is not null as con_fecha, created_by from public.servicios_bloqueados where turno = 'cena'`);
ok(filas[0].con_fecha && filas[0].created_by === null, "created_at por defecto y created_by = auth.uid()");

// menu_del_dia: false por defecto (también en las filas que ya había), not null.
const { rows: menu } = await db.query(`select bool_and(menu_del_dia = false) as todas_false from public.reservas`);
ok(menu[0].todas_false, "menu_del_dia = false en las reservas existentes");
await db.exec(`insert into public.reservas (nombre, fecha, hora, numero_comensales, menu_del_dia) values ('Menú', '2026-12-15', '14:00', 2, true)`);
await falla(db.exec(`insert into public.reservas (nombre, fecha, hora, numero_comensales, menu_del_dia) values ('X', '2026-12-15', '14:00', 2, null)`), /null/i, "menu_del_dia not null");

// El bloqueo NO afecta a la BD: una reserva manual en la cena bloqueada entra.
await db.exec(`insert into public.reservas (nombre, fecha, hora, numero_comensales) values ('Manual', '2026-12-12', '21:00', 4)`);
ok(true, "reserva manual en un servicio bloqueado: permitida");

// RLS, políticas y permisos.
const { rows: rls } = await db.query(`select relrowsecurity from pg_class where oid = 'public.servicios_bloqueados'::regclass`);
ok(rls[0].relrowsecurity, "RLS activa");
const { rows: pol } = await db.query(`select policyname, cmd from pg_policies where tablename = 'servicios_bloqueados' order by policyname`);
ok(JSON.stringify(pol.map((p) => p.cmd).sort()) === JSON.stringify(["DELETE", "INSERT", "SELECT"]), "políticas select/insert/delete");
const priv = async (rol, p) => (await db.query(`select has_table_privilege($1, 'public.servicios_bloqueados', $2) as t`, [rol, p])).rows[0].t;
ok(!(await priv("anon", "SELECT")) && !(await priv("anon", "INSERT")), "anon sin acceso directo");
ok((await priv("authenticated", "SELECT")) && (await priv("authenticated", "INSERT")) && (await priv("authenticated", "DELETE")), "authenticated: select/insert/delete");
ok(!(await priv("authenticated", "UPDATE")), "authenticated sin update (como salas_cerradas_servicio)");

if (hayPublicacion) {
  const { rows: pub } = await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'servicios_bloqueados'`);
  ok(pub[0].n === 1, "en supabase_realtime (una vez, aunque se aplique dos veces)");
}

// Rollback.
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
const { rows: tabla } = await db.query(`select to_regclass('public.servicios_bloqueados') as t`);
ok(tabla[0].t === null, "rollback quita la tabla");
const { rows: col } = await db.query(`select count(*)::int n from information_schema.columns where table_name = 'reservas' and column_name = 'menu_del_dia'`);
ok(col[0].n === 0, "rollback quita reservas.menu_del_dia");

console.log(`OK servicios bloqueados + menú del día: ${comprobaciones} comprobaciones${hayPublicacion ? "" : " (sin publicación en PGlite)"}`);
