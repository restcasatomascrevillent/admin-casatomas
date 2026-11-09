// Puntuaciones Parker con fuente (08/11/2026), contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:vinos-parker:db
//
// Aplica las migraciones REALES 20261104140000 (columnas Parker), 20261118105000
// (tabla con fuentes + trigger de publicación) y 20261118110000 (datos de la
// revisión) dos veces, y cubre: que la web solo ve la puntuación VERIFICADA,
// DEFINITIVA y de la AÑADA QUE SE SIRVE (o la NV si el vino es sin añada); que
// lo escrito a mano en "Vinos".puntuacion_parker se ignora; intervalos y «+» en
// el texto público; los CHECK (entidad solo Parker/WA, verificada con fuente,
// no localizada con motivo, una fila por añada); la RLS (anon no ve la tabla,
// solo «Gestor carta» con editar escribe); el borrado en cascada; y los
// rollbacks.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (ruta) => readFile(ruta, "utf8");
const COPEO = await leer("supabase/migrations/20261104140000_vinos_copeo_y_parker.sql");
const FUENTES = await leer("supabase/migrations/20261118105000_vinos_puntuacion_parker_fuentes.sql");
const FUENTES_ROLLBACK = await leer("supabase/rollbacks/20261118105000_vinos_puntuacion_parker_fuentes_ROLLBACK.sql");
const DATOS = await leer("supabase/migrations/20261118110000_vinos_puntuacion_parker_revision_datos.sql");
const DATOS_ROLLBACK = await leer("supabase/rollbacks/20261118110000_vinos_puntuacion_parker_revision_datos_ROLLBACK.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const rechaza = async (promesa, patron, msg) => { await assert.rejects(promesa, patron, msg); comprobaciones++; };

const U = {
  CARTA: "00000000-0000-0000-0000-00000000000a", // «Gestor carta» con editar
  VER: "00000000-0000-0000-0000-00000000000b", // «Gestor carta» solo ver
  NADA: "00000000-0000-0000-0000-00000000000c", // sin permisos
};

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated;
  grant select on auth.users to authenticated;

  create table public.user_permissions (user_id uuid, section_key text, can_read boolean, can_edit boolean);
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.user_permissions where user_id = auth.uid() and section_key = _section and (can_read or can_edit)) $f$;
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.user_permissions where user_id = auth.uid() and section_key = _section and can_edit) $f$;
  grant execute on function public.can_read_section(text), public.can_edit_section(text) to anon, authenticated;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = ''
    as $f$ select auth.uid() is not null $f$;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public."Vinos" (
    id text primary key, nombre text, categoria text, precio_eur double precision,
    activado boolean, restaurante boolean default true, touza boolean default true);
  alter table public."Vinos" enable row level security;
  grant select, insert, update, delete on public."Vinos" to anon, authenticated, service_role;
  create policy vinos_publico on public."Vinos" for select using (activado = true);
  create policy vinos_autenticados on public."Vinos" for select to authenticated using (auth.uid() is not null);
  create policy vinos_update_seccion on public."Vinos" for update to authenticated
    using ((select public.can_edit_section('gestor_carta'))) with check ((select public.can_edit_section('gestor_carta')));
`;

const SEMILLA = `
  insert into auth.users values ('${U.CARTA}'), ('${U.VER}'), ('${U.NADA}');
  insert into public.user_permissions values
    ('${U.CARTA}', 'gestor_carta', true, true), ('${U.VER}', 'gestor_carta', true, false);
  insert into public."Vinos" (id, nombre, categoria, precio_eur, activado) values
    ('aalto', 'Aalto 2021', 'VINOS TINTOS — RIBERA DEL DUERO', 50, true),
    ('pingus', 'Pingus', 'VINOS TINTOS — RIBERA DEL DUERO', 900, true),
    ('krug', 'Krug Grande Cuvée 170ème Édition', 'VINOS ESPUMOSOS — CHAMPAGNE', 330, true),
    ('nv', 'Laurent-Perrier La Cuvée', 'VINOS ESPUMOSOS — CHAMPAGNE', 68, true);
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(SEMILLA);
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
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}

const publicado = async (id) =>
  (await q(`select puntuacion_parker p, puntuacion_parker_anada a, puntuacion_parker_texto t from public."Vinos" where id = $1`, [id])).rows[0];

// ─── 0. Migraciones idempotentes; lo cargado a mano el 04/11 deja de publicarse
await db.exec(COPEO);
await q(`update public."Vinos" set puntuacion_parker = 94, puntuacion_parker_anada = 2021 where id = 'aalto'`);
for (let i = 0; i < 2; i++) await db.exec(FUENTES);
ok(true, "20261118105000 es idempotente");
igual(await publicado("aalto"), { p: null, a: null, t: null }, "una puntuación sin fila verificada deja de publicarse");

// ─── 1. Publicación: solo verificada, definitiva y de la añada que se sirve ─
const fila = (vino, campos) => {
  const base = {
    vino_id: vino, anada: null, sin_anada: false, estado: "verificada", motivo: null, puntos_texto: "94",
    puntos_min: 94, puntos_max: 94, provisional: false, vino_evaluado: "Aalto 2021",
    entidad: "Robert Parker Wine Advocate", critico: "Luis Gutiérrez", fecha_valoracion: "2024-06",
    fuente_nombre: "Wine-Searcher", fuente_url: "https://www.wine-searcher.com/x", fuente_tipo: "secundaria",
    cita: "Robert Parker's Wine Advocate 94 — 2021", fecha_consulta: "2026-11-08", origen: "revision", ...campos,
  };
  const cols = Object.keys(base);
  return q(`insert into public.vinos_puntuacion_parker (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    cols.map((c) => base[c]));
};

await fila("aalto", { anada: 2021 });
igual(await publicado("aalto"), { p: null, a: null, t: null }, "sin añada servida no se publica aunque esté verificada");
await q(`update public."Vinos" set anada = 2021 where id = 'aalto'`);
igual(await publicado("aalto"), { p: 94, a: 2021, t: "94" }, "con la añada servida = la verificada, se publica");
await q(`update public."Vinos" set anada = 2022 where id = 'aalto'`);
igual(await publicado("aalto"), { p: null, a: null, t: null }, "otra añada servida: no se reutiliza la de 2021");
await fila("aalto", { anada: 2022, estado: "revision", fuente_tipo: "secundaria" });
igual(await publicado("aalto"), { p: null, a: null, t: null }, "una fila en revisión no se publica");
await q(`update public.vinos_puntuacion_parker set estado = 'verificada', puntos_texto = '95+', puntos_min = 95, puntos_max = 95 where vino_id = 'aalto' and anada = 2022`);
igual(await publicado("aalto"), { p: 95, a: 2022, t: "95+" }, "al verificarla se publica, con el «+»");
await q(`update public."Vinos" set puntuacion_parker = 70, puntuacion_parker_texto = '70' where id = 'aalto'`);
igual(await publicado("aalto"), { p: 95, a: 2022, t: "95+" }, "lo escrito a mano en las columnas públicas se ignora");

// Intervalos: nunca una cifra; provisional no sale en la web.
await fila("pingus", { anada: 2023, puntos_texto: "(97-99)", puntos_min: 97, puntos_max: 99, provisional: true, vino_evaluado: "Pingus 2023" });
await q(`update public."Vinos" set anada = 2023 where id = 'pingus'`);
igual(await publicado("pingus"), { p: null, a: null, t: null }, "un intervalo provisional (barrica) no se publica");
igual((await q(`select puntos_min, puntos_max, puntos_texto from public.vinos_puntuacion_parker where vino_id = 'pingus'`)).rows,
  [{ puntos_min: 97, puntos_max: 99, puntos_texto: "(97-99)" }], "el intervalo se guarda entero");
await q(`update public.vinos_puntuacion_parker set provisional = false where vino_id = 'pingus'`);
igual(await publicado("pingus"), { p: 97, a: 2023, t: "97–99" }, "un intervalo definitivo se publica como intervalo");

// NV: solo la fila sin añada de un vino marcado sin añada.
await fila("krug", { sin_anada: true, puntos_texto: "95", puntos_min: 95, puntos_max: 95, vino_evaluado: "Krug Grande Cuvée 170ème Édition" });
igual(await publicado("krug"), { p: null, a: null, t: null }, "NV verificada pero el vino no está marcado sin añada: no se publica");
await q(`update public."Vinos" set sin_anada = true where id = 'krug'`);
igual(await publicado("krug"), { p: 95, a: null, t: "95" }, "vino NV con su fila NV verificada: se publica sin añada");
await rechaza(q(`update public."Vinos" set anada = 2015 where id = 'krug'`), /vinos_sin_anada_sin_ano/, "un vino sin añada no puede tener añada");

// Borrar la fila verificada retira el icono.
await q(`delete from public.vinos_puntuacion_parker where vino_id = 'krug'`);
igual(await publicado("krug"), { p: null, a: null, t: null }, "al borrar la verificada, la web deja de enseñarla");

// ─── 2. CHECK ───────────────────────────────────────────────────────────────
await rechaza(fila("nv", { sin_anada: true, entidad: "Guía Peñín" }), /vinos_puntuacion_parker_entidad_chk/, "Peñín no es Parker");
await rechaza(fila("nv", { sin_anada: true, entidad: "James Suckling (no Parker)" }), /vinos_puntuacion_parker_entidad_chk/, "Suckling no es Parker");
await rechaza(fila("nv", { sin_anada: true, fuente_url: null }), /vinos_puntuacion_parker_verificada_chk/, "verificada sin URL");
await rechaza(fila("nv", { sin_anada: true, fecha_consulta: null }), /vinos_puntuacion_parker_verificada_chk/, "verificada sin fecha de consulta");
await rechaza(fila("nv", {}), /vinos_puntuacion_parker_verificada_chk/, "verificada sin añada ni NV");
await rechaza(fila("nv", { sin_anada: true, estado: "no_localizada" }), /vinos_puntuacion_parker_no_localizada_chk/, "no localizada con puntos");
await rechaza(fila("nv", { estado: "no_localizada", puntos_texto: null, puntos_min: null, puntos_max: null }),
  /vinos_puntuacion_parker_no_localizada_chk/, "no localizada sin motivo");
await rechaza(fila("nv", { sin_anada: true, puntos_min: 96, puntos_max: 94 }), /vinos_puntuacion_parker_puntos_chk/, "intervalo al revés");
await rechaza(fila("nv", { sin_anada: true, puntos_min: 0, puntos_max: 0, puntos_texto: "0" }), /vinos_puntuacion_parker_puntos_chk/, "cero puntos");
await rechaza(fila("nv", { sin_anada: true, fuente_url: "javascript:alert(1)" }), /vinos_puntuacion_parker_url_chk/, "URL no http");
await rechaza(fila("aalto", { anada: 2021, estado: "revision" }), /vinos_puntuacion_parker_vino_anada_key/, "una fila por vino y añada");
await fila("nv", { estado: "no_localizada", motivo: "referencia_ambigua", puntos_texto: null, puntos_min: null, puntos_max: null,
  fuente_url: null, fuente_nombre: null, fuente_tipo: null, cita: null, notas: "NV sin saca identificada" });
await fila("nv", { estado: "no_localizada", motivo: "anada_desconocida", sin_anada: true, puntos_texto: null, puntos_min: null,
  puntos_max: null, fuente_url: null, fuente_nombre: null, fuente_tipo: null, cita: null });
ok(true, "fila «añada desconocida» (clave -1) y NV (clave 0) conviven");
igual((await q(`select clave_anada from public.vinos_puntuacion_parker where vino_id = 'nv' order by clave_anada`)).rows.map((r) => r.clave_anada),
  [-1, 0], "clave_anada: -1 añada desconocida, 0 NV");

// ─── 3. RLS ─────────────────────────────────────────────────────────────────
await rechaza(como("anon", () => q(`select * from public.vinos_puntuacion_parker`)), /permission denied/, "la web no ve la tabla");
igual((await como(U.NADA, () => q(`select id from public.vinos_puntuacion_parker`))).rows.length, 0, "sin permiso no se ve nada");
ok((await como(U.VER, () => q(`select id from public.vinos_puntuacion_parker`))).rows.length > 0, "con «Ver» se lee");
await rechaza(como(U.VER, () => q(`insert into public.vinos_puntuacion_parker (vino_id, anada, estado) values ('pingus', 2019, 'pendiente')`)),
  /row-level security/, "con «Ver» no se escribe");
igual((await como(U.VER, () => q(`update public.vinos_puntuacion_parker set notas = 'x' returning id`))).rows.length, 0, "con «Ver» no se cambia");
const insertada = await como(U.CARTA, () => q(`insert into public.vinos_puntuacion_parker (vino_id, anada, estado, origen) values ('pingus', 2019, 'pendiente', 'busqueda') returning actualizado_por`));
igual(insertada.rows[0].actualizado_por, U.CARTA, "con «Editar» se escribe y el autor lo pone la base de datos");
igual((await como("anon", () => q(`select puntuacion_parker_texto from public."Vinos" where id = 'pingus'`))).rows,
  [{ puntuacion_parker_texto: "97–99" }], "la web lee el texto público en Vinos");

// ─── 4. Cascada ─────────────────────────────────────────────────────────────
await q(`insert into public."Vinos" (id, nombre, activado, anada) values ('borrar', 'Vino a borrar', true, 2020)`);
await fila("borrar", { anada: 2020 });
igual(await publicado("borrar"), { p: 94, a: 2020, t: "94" }, "vino nuevo con añada y fila verificada: publicado");
await q(`delete from public."Vinos" where id = 'borrar'`);
igual((await q(`select count(*)::int n from public.vinos_puntuacion_parker where vino_id = 'borrar'`)).rows[0].n, 0, "borrar el vino borra sus puntuaciones");

// ─── 5. Datos de la revisión (idempotentes, solo ids que existen) ───────────
for (let i = 0; i < 2; i++) await db.exec(DATOS);
ok(true, "20261118110000 es idempotente y no falla con ids que no existen");
const desajustes = await q(`select w.id from public."Vinos" w cross join lateral public.vinos_parker_calculado(w.id, w.anada, w.sin_anada) c
  where (w.puntuacion_parker, w.puntuacion_parker_anada, w.puntuacion_parker_texto) is distinct from (c.puntos, c.anada, c.texto)`);
igual(desajustes.rows, [], "tras los datos, lo publicado coincide con lo calculado");
await db.exec(DATOS_ROLLBACK);
ok(true, "el rollback de los datos se aplica");

// ─── 6. Rollback del esquema ────────────────────────────────────────────────
for (let i = 0; i < 2; i++) await db.exec(FUENTES_ROLLBACK);
igual((await q(`select to_regclass('public.vinos_puntuacion_parker') t`)).rows[0].t, null, "rollback: la tabla desaparece");
igual((await q(`select count(*)::int n from information_schema.columns where table_name = 'Vinos' and column_name in ('anada', 'sin_anada', 'puntuacion_parker_texto')`)).rows[0].n,
  0, "rollback: las columnas nuevas desaparecen");
await q(`update public."Vinos" set puntuacion_parker = 90 where id = 'aalto'`);
igual((await q(`select puntuacion_parker p from public."Vinos" where id = 'aalto'`)).rows[0].p, 90, "tras el rollback, la puntuación vuelve a ser editable a mano");
await db.exec(FUENTES);
ok(true, "se puede volver a aplicar después del rollback");

console.log(`✓ vinos-parker: ${comprobaciones} comprobaciones`);
