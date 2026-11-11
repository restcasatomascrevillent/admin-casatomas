// Interruptor de la carta de Bebidas en la web (11/11/2026): la migración REAL 20261124110000 y su
// rollback contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:carta-bebidas-web:db
//
// Reproduce configuracion_web con sus políticas (lectura pública, editar con «gestor_carta») y cubre:
// que se para si falta la tabla; que la columna nace apagada; que la web (anon) la lee; que el panel la
// cambia con «gestor_carta» y sin él no; que anon no la cambia; idempotencia y rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261124110000_carta_bebidas_web.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261124110000_carta_bebidas_web_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };

const CARTA = "10000000-0000-0000-0000-000000000001";
const OTRO = "20000000-0000-0000-0000-000000000002";

// ─── 0. Sin la tabla se para ─────────────────────────────────────────────────────────────────────
{
  const vacia = new PGlite();
  await vacia.exec(`create role anon nologin; create role authenticated nologin;`);
  await falla(vacia.exec(MIGRACION), /falta public\.configuracion_web/, "sin configuracion_web se para");
  await vacia.close();
}

const db = new PGlite();
const valor = async () => (await db.query(`select mostrar_carta_bebidas_casa_tomas as v from public.configuracion_web`)).rows[0].v;
async function como(usuario, sql) {
  await db.exec(`set role authenticated; set test.actor = '${usuario}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role; set test.actor = '';");
  }
}

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean);
  insert into public.user_permissions values ('${CARTA}', 'gestor_carta', true, true), ('${OTRO}', 'reservas', true, true);
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = public as $f$
    select exists (select 1 from public.user_permissions where user_id = (select auth.uid()) and section_key = _section and can_edit) $f$;

  create table public.configuracion_web (
    id boolean primary key default true check (id),
    mostrar_fotos_platos_casa_tomas boolean not null default true,
    mostrar_menu_dia_casa_tomas boolean not null default true
  );
  insert into public.configuracion_web (id) values (true);
  alter table public.configuracion_web enable row level security;
  create policy configuracion_web_select_publico on public.configuracion_web for select to anon, authenticated using (true);
  create policy configuracion_web_update_seccion on public.configuracion_web for update to authenticated
    using ((select public.can_edit_section('gestor_carta'))) with check ((select public.can_edit_section('gestor_carta')));
  revoke all on public.configuracion_web from public, anon, authenticated;
  grant select on public.configuracion_web to anon;
  grant select, update on public.configuracion_web to authenticated;
`);

// ─── 1. Se aplica (dos veces) y nace apagada ─────────────────────────────────────────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);
igual(await valor(), false, "la carta de Bebidas nace apagada");

// ─── 2. La web (anon) la lee ─────────────────────────────────────────────────────────────────────
await db.exec("set role anon;");
igual((await db.query(`select mostrar_carta_bebidas_casa_tomas as v from public.configuracion_web`)).rows[0].v, false, "la web la lee con anon");
await falla(db.query(`update public.configuracion_web set mostrar_carta_bebidas_casa_tomas = true`), /permission denied/, "anon no la cambia");
await db.exec("reset role;");

// ─── 3. El panel la cambia con «gestor_carta»; sin él, no ────────────────────────────────────────
igual((await como(OTRO, `update public.configuracion_web set mostrar_carta_bebidas_casa_tomas = true`)).affectedRows, 0, "sin «gestor_carta» no la cambia");
igual(await valor(), false, "sigue apagada");
igual((await como(CARTA, `update public.configuracion_web set mostrar_carta_bebidas_casa_tomas = true`)).affectedRows, 1, "con «gestor_carta» se enciende");
igual(await valor(), true, "encendida");

// ─── 4. Reaplicar no pisa el valor; rollback y vuelta ────────────────────────────────────────────
await db.exec(MIGRACION);
igual(await valor(), true, "reaplicar la migración no la vuelve a apagar");
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'configuracion_web' and column_name = 'mostrar_carta_bebidas_casa_tomas'`)).rows[0].n, 0, "el rollback borra la columna");
await db.exec(MIGRACION);
igual(await valor(), false, "reaplicada tras el rollback, vuelve a nacer apagada");

await db.close();
console.log(`test-carta-bebidas-web: ${comprobaciones} comprobaciones superadas`);
