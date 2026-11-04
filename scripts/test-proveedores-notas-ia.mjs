// Proveedores.notas_ia contra PGlite (nunca toca Supabase).
//   npm run test:proveedores-notas-ia:db
// Migracion REAL 20261104150000 (dos veces), RPC con permiso, limite y rollback.
// proveedores_puede_editar se sustituye por un stub (la real: 20261007180000).
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261104150000_proveedores_notas_ia.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261104150000_proveedores_notas_ia_ROLLBACK.sql", "utf8");
let n = 0;
const ok = (v, m) => { assert.ok(v, m); n++; };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table public.proveedores (id bigserial primary key, nombre text not null);
  insert into public.proveedores (nombre) values ('Hermanos Narejos');
  create table public.ajustes (editor boolean);
  insert into public.ajustes values (false);
  grant select on public.ajustes to authenticated;
  create function public.proveedores_puede_editar() returns boolean language sql stable security definer as $$ select editor from public.ajustes $$;
`);
await db.exec(MIGRACION);
await db.exec(MIGRACION);

const como = async (rol, sql) => { await db.exec(`set role ${rol}`); try { return await db.query(sql); } finally { await db.exec("reset role"); } };
const falla = async (sql, codigo) => {
  try { await como("authenticated", sql); } catch (e) { return ok(e.code === codigo, `${sql} -> ${e.code}`); }
  assert.fail(`debia fallar: ${sql}`);
};

await falla(`select public.proveedores_notas_ia_guardar(1, 'x')`, "42501");
ok((await db.query(`select notas_ia from public.proveedores where id = 1`)).rows[0].notas_ia === null, "sin permiso no cambia nada");

await db.exec(`update public.ajustes set editor = true`);
const r = await como("authenticated", `select public.proveedores_notas_ia_guardar(1, '  Los mejillones   son LATAS ') r`);
ok(r.rows[0].r === "Los mejillones son LATAS", "con permiso guarda y limpia espacios");
await falla(`select public.proveedores_notas_ia_guardar(1, repeat('a', 501))`, "22023");
await falla(`select public.proveedores_notas_ia_guardar(99, 'x')`, "P0002");
await como("authenticated", `select public.proveedores_notas_ia_guardar(1, '   ')`);
ok((await db.query(`select notas_ia from public.proveedores where id = 1`)).rows[0].notas_ia === null, "texto vacio = null");
try { await db.exec(`update public.proveedores set notas_ia = repeat('a', 501)`); assert.fail("CHECK"); } catch (e) { ok(e.code === "23514", "CHECK de 500"); }
try { await como("anon", `select public.proveedores_notas_ia_guardar(1, 'x')`); assert.fail("anon"); } catch (e) { ok(e.code === "42501", "anon sin execute"); }

await db.exec(ROLLBACK);
ok((await db.query(`select count(*)::int n from information_schema.columns where table_name='proveedores' and column_name='notas_ia'`)).rows[0].n === 0, "rollback quita la columna");
ok((await db.query(`select count(*)::int n from pg_proc where proname='proveedores_notas_ia_guardar'`)).rows[0].n === 0, "rollback quita la RPC");
console.log(`OK Proveedores.notas_ia: ${n} comprobaciones`);
