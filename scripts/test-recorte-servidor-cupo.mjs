// Recorte de fotos en el servidor: constancia en ia_uso y topes de gasto
// (20261103180000) contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:recorte-servidor:db
//
// Cubre: migración REAL aplicada dos veces (idempotente, no pisa topes
// editados), reservar solo con permiso de carta, tope mensual / diario / de
// CPU, terminar solo sobre la fila propia, uso solo para service_role o super
// admin, y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261103180000_recorte_servidor_cupo.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261103180000_recorte_servidor_cupo_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const U = { CARTA: "a0000000-0000-0000-0000-000000000001", OTRO: "a0000000-0000-0000-0000-000000000002", SA: "a0000000-0000-0000-0000-000000000003" };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.permisos_carta (user_id uuid primary key);
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select _section = 'gestor_carta' and exists (select 1 from public.permisos_carta where user_id = auth.uid()) $f$;
  grant execute on function public.can_write_section(text) to authenticated, service_role;
  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  grant execute on function public.is_super_admin(uuid) to authenticated, service_role;

  create table public.ia_precios (modelo text primary key, usd_por_m_input numeric(12,6) not null, usd_por_m_cached numeric(12,6),
    usd_por_m_cache_write numeric(12,6), usd_por_m_output numeric(12,6) not null, notas text, fuente text, verificado_en date);
  create table public.ia_funciones (funcion text primary key, descripcion text not null, instrumentada boolean not null default false,
    unidad text not null default 'llamada', orden integer not null default 100, activo boolean not null default true);
  create table public.ia_uso (id bigint generated always as identity primary key, funcion text not null, operacion text not null default 'chat',
    modelo text not null, prompt_tokens integer not null default 0, completion_tokens integer not null default 0, llamadas integer not null default 1,
    coste_usd numeric(12,6), estado text not null default 'ok', disparador text, duracion_ms integer, created_at timestamptz not null default now());
  alter table public.ia_uso enable row level security;
  create table public.servicios_contratados (proveedor text primary key, limites jsonb not null default '{}'::jsonb);

  insert into public.permisos_carta values ('${U.CARTA}');
  insert into public.super_admins values ('${U.SA}');
  insert into public.servicios_contratados values ('vercel', '{"cpu_activa": {"limite": 4}, "recortes_servidor_dia": {"limite": 3}}');
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${rol};
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: rol })}', true);`);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}
/** Como como(), pero confirmando lo hecho. */
async function comoYGuardar(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${rol};
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: rol })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const reservar = async () => (await db.query("select public.recorte_servidor_reservar() as r")).rows[0].r;
const falla = async (p, re, msg) => {
  try {
    await p;
  } catch (e) {
    ok(re.test(e.message), `${msg}: ${e.message}`);
    return;
  }
  assert.fail(`${msg}: no ha fallado`);
};

// Semilla: tarifa a 0, función en el catálogo y topes sin pisar lo editado (día = 3).
const lim = (await db.query("select limites from public.servicios_contratados where proveedor = 'vercel'")).rows[0].limites;
igual(lim.recortes_servidor_dia.limite, 3, "no pisa el tope diario editado");
igual(lim.recortes_servidor_mes.limite, 600, "tope mensual por defecto");
igual(lim.cpu_recortes_mes.limite, 120, "tope de CPU por defecto");
ok(lim.cpu_activa, "conserva los límites que había");
igual((await db.query("select usd_por_m_input::float as p from public.ia_precios where modelo = 'vercel:recortar-foto'")).rows[0].p, 0, "tarifa 0");
ok((await db.query("select instrumentada from public.ia_funciones where funcion = 'recortar-foto'")).rows[0].instrumentada, "función dada de alta");

// Permisos.
await falla(como(U.OTRO, reservar), /permiso/i, "sin permiso de carta no reserva");
await falla(como(null, reservar, "anon"), /permission denied|permiso/i, "anon no reserva");

// Reserva y terminar.
const r1 = await comoYGuardar(U.CARTA, reservar);
ok(r1.permitido === true && r1.id > 0, "reserva con permiso");
igual([r1.recortes_mes, r1.recortes_dia, r1.tope_dia], [1, 1, 3], "cuenta tras reservar");
const fila = (await db.query("select funcion, modelo, coste_usd::float as c, disparador, duracion_ms from public.ia_uso where id = $1", [r1.id])).rows[0];
igual(fila, { funcion: "recortar-foto", modelo: "vercel:recortar-foto", c: 0, disparador: `usuario:${U.CARTA}`, duracion_ms: null }, "fila en ia_uso");

await comoYGuardar(U.OTRO, () => db.query("select public.recorte_servidor_terminar($1, 5000, true)", [r1.id]));
igual((await db.query("select duracion_ms from public.ia_uso where id = $1", [r1.id])).rows[0].duracion_ms, null, "otro usuario no anota la fila ajena");
await comoYGuardar(U.CARTA, () => db.query("select public.recorte_servidor_terminar($1, 4321, false)", [r1.id]));
igual((await db.query("select duracion_ms, estado from public.ia_uso where id = $1", [r1.id])).rows[0], { duracion_ms: 4321, estado: "error" }, "anota duración y estado");
await comoYGuardar(U.CARTA, () => db.query("select public.recorte_servidor_terminar($1, 99, true)", [r1.id]));
igual((await db.query("select duracion_ms from public.ia_uso where id = $1", [r1.id])).rows[0].duracion_ms, 4321, "no se reescribe una vez anotada");

// Tope diario (3).
await comoYGuardar(U.CARTA, reservar);
await comoYGuardar(U.CARTA, reservar);
const r4 = await comoYGuardar(U.CARTA, reservar);
igual([r4.permitido, r4.motivo, r4.id], [false, "dia", null], "al tope diario no reserva ni anota");
igual(Number((await db.query("select count(*) from public.ia_uso")).rows[0].count), 3, "solo 3 filas");

// Tope de CPU: con más minutos anotados que el tope, no reserva aunque quepan fotos.
await db.exec(`update public.servicios_contratados set limites = limites || '{"recortes_servidor_dia": {"limite": 100}, "cpu_recortes_mes": {"limite": 1}}' where proveedor = 'vercel'`);
await db.exec(`update public.ia_uso set duracion_ms = 61000 where duracion_ms is null`);
igual((await como(U.CARTA, reservar)).motivo, "cpu", "tope de CPU");

// Tope mensual (las filas del mes pasado no cuentan).
await db.exec(`update public.servicios_contratados set limites = limites || '{"cpu_recortes_mes": {"limite": 1000}, "recortes_servidor_mes": {"limite": 3}}' where proveedor = 'vercel'`);
igual((await como(U.CARTA, reservar)).motivo, "mes", "tope mensual");
await db.exec(`update public.ia_uso set created_at = now() - interval '40 days' where id = ${r1.id}`);
ok((await como(U.CARTA, reservar)).permitido, "las del mes pasado no cuentan");

// Uso: service_role o super admin.
await falla(como(U.CARTA, () => db.query("select public.recorte_servidor_uso()")), /permiso/i, "usuario normal no ve el uso");
const uso = (await como(U.SA, () => db.query("select public.recorte_servidor_uso() as u"))).rows[0].u;
igual([uso.recortes_mes, uso.tope_mes], [2, 3], "super admin ve el uso");
const usoSr = (await como(null, () => db.query("select public.recorte_servidor_uso() as u"), "service_role")).rows[0].u;
igual(usoSr.cpu_ms_mes, 122000, "service_role ve los ms del mes");

// Rollback.
await db.exec(ROLLBACK);
ok((await db.query("select to_regprocedure('public.recorte_servidor_reservar()') as f")).rows[0].f === null, "rollback quita las funciones");
ok(!(await db.query("select limites from public.servicios_contratados where proveedor = 'vercel'")).rows[0].limites.recortes_servidor_mes, "rollback quita los topes");
igual(Number((await db.query("select count(*) from public.ia_uso")).rows[0].count), 3, "rollback conserva el histórico");

console.log(`recorte_servidor_cupo: ${comprobaciones} comprobaciones OK`);
