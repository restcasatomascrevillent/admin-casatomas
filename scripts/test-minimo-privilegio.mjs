// Mínimo privilegio de la BD (T4a-DB-AUTHZ, remediación 2026-10-30) contra un
// Postgres en memoria (PGlite). Nunca toca Supabase: ni la demo ni producción.
//
//   npm run test:minimo-privilegio:db
//
// Estado de partida: supabase/tests/fixtures/t4a_estado_previo.sql (tablas,
// RLS, políticas, GRANT y funciones de autorización tal y como los deja Git
// a0b8d3a, generado desde el laboratorio de remediacion-2026-10-30) + el
// estado SUPUESTO de producción para IA-01 (ejecutar_consulta_chatbot no está
// en Git). Encima, las cinco migraciones REALES 20261030100000…140000.
//
// Cubre: personas anon / staff / lector / gestor / facturas / superadmin /
// service_role (supabase/tests/t4a_minimo_privilegio_test.sql), idempotencia
// (segunda pasada = misma huella), guardas (política esperada ausente,
// política desconocida que reabriría por OR, DB-05 sin las anteriores) con
// atomicidad, condición de IA-01 (una DEFINER con control de rol no se toca)
// y los cinco rollbacks (vuelven a la huella de partida).
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = "supabase/migrations";
const RB = "supabase/rollbacks";
const PREFIJOS = ["20261030100000", "20261030110000", "20261030120000", "20261030130000", "20261030140000"];
const ficheros = await readdir(MIG);
const MIGRACIONES = PREFIJOS.map((p) => {
  const f = ficheros.find((x) => x.startsWith(`${p}_`) && x.endsWith(".sql"));
  assert.ok(f, `No se encontró ${MIG}/${p}_*.sql`);
  return f;
});
const sql = {};
for (const f of MIGRACIONES) sql[f] = await readFile(`${MIG}/${f}`, "utf8");
const FIXTURE = await readFile("supabase/tests/fixtures/t4a_estado_previo.sql", "utf8");
const TEST = await readFile("supabase/tests/t4a_minimo_privilegio_test.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema extensions;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema public, auth, private, extensions to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
`;
// IA-01: funciones que existen fuera de Git (estado supuesto de demo/prod, 20260918084909:214-223).
const PROD_IA01 = `
  create function public.ejecutar_consulta_chatbot(query_sql text) returns jsonb
    language plpgsql security definer set search_path = public as $$
    declare r jsonb; begin execute format('select coalesce(jsonb_agg(t), %L::jsonb) from (%s) t', '[]', query_sql) into r; return r; end $$;
  create function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric)
    returns json language plpgsql security definer set search_path = public as $$
    begin return json_build_object('es_duplicado', false, 'motivo', null, 'factura_existente', null); end $$;
  create function public.buscar_contexto_chatbot(consulta text) returns setof text
    language plpgsql security definer set search_path = public as $$
    begin if not public.has_section_permission(auth.uid(), 'facturas', 'view') then raise exception 'sin permiso'; end if; return; end $$;
  revoke all on function public.ejecutar_consulta_chatbot(text), public.verificar_duplicado_factura(character varying, character varying, date, numeric),
    public.buscar_contexto_chatbot(text) from public, anon;
  grant execute on function public.ejecutar_consulta_chatbot(text), public.verificar_duplicado_factura(character varying, character varying, date, numeric),
    public.buscar_contexto_chatbot(text) to authenticated, service_role;
`;
const HUELLA = `
  select 'P ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '-') || ' ' || coalesce(with_check, '-') h from pg_policies where schemaname = 'public'
  union all select 'R ' || relname || ' ' || relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all select 'G ' || c.relname || ' ' || r.rol || ' ' || p.pr from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(pr)
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege(r.rol, c.oid, p.pr)
  union all select 'F ' || p.oid::regprocedure::text || ' ' || r.rol || ' ' || has_function_privilege(r.rol, p.oid, 'EXECUTE')
    from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol) where p.pronamespace = 'public'::regnamespace
  order by 1`;

async function base() {
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  await db.exec(FIXTURE);
  await db.exec(PROD_IA01);
  return db;
}
const huella = async (db) => (await db.query(HUELLA)).rows.map((r) => r.h);
const aplicar = async (db, desde = 0, hasta = MIGRACIONES.length) => {
  for (const f of MIGRACIONES.slice(desde, hasta)) await db.exec(sql[f]);
};
const falla = async (db, texto, patron, msg) => {
  await assert.rejects(db.exec(texto), patron, msg);
  await db.exec("rollback").catch(() => {});
  comprobaciones++;
};

// 1. Estado de partida: el agujero existe (control negativo del propio fixture)
{
  const db = await base();
  const r = await db.query(`select has_function_privilege('authenticated', 'public.ejecutar_limpieza_gdpr()', 'EXECUTE') g,
    has_function_privilege('anon', 'public.is_super_admin(uuid)', 'EXECUTE') o,
    exists (select 1 from pg_policies where tablename = 'novedades' and qual = 'true') n,
    (select relrowsecurity from pg_class where oid = 'public.salas'::regclass) s`);
  igual(r.rows[0], { g: true, o: true, n: true, s: false }, "El fixture no reproduce el estado previo (DB-01/DB-05/DB-02/DB-04)");
  await db.close();
}

// 2. Migraciones, idempotencia, personas, IA-01 y rollbacks
{
  const db = await base();
  const antes = await huella(db);
  await aplicar(db);
  const despues = await huella(db);
  await aplicar(db);
  igual(await huella(db), despues, "La segunda pasada de las migraciones cambia algo: no son idempotentes");
  ok(despues.join("\n") !== antes.join("\n"), "Las migraciones no han cambiado nada");

  await db.exec(TEST); // aborta con ASSERT FAILED si falla una persona
  comprobaciones++;

  const ia = await db.query(`select has_function_privilege('authenticated', 'public.buscar_contexto_chatbot(text)', 'EXECUTE') b,
    has_function_privilege('service_role', 'public.ejecutar_consulta_chatbot(text)', 'EXECUTE') e`);
  igual(ia.rows[0], { b: true, e: true }, "IA-01 tocó una DEFINER con control de rol o quitó EXECUTE a service_role");

  for (const f of [...MIGRACIONES].reverse()) {
    const rb = `${RB}/${f.replace(/\.sql$/, "_ROLLBACK.sql")}`;
    await db.exec(await readFile(rb, "utf8"));
  }
  const tras = await huella(db);
  const dif = [...antes.filter((x) => !tras.includes(x)).map((x) => `- ${x}`), ...tras.filter((x) => !antes.includes(x)).map((x) => `+ ${x}`)];
  igual(dif, [], "Los rollbacks no vuelven exactamente al estado de partida");
  await db.close();
}

// 3. Guardas: aborta y no deja nada a medias
{
  const db = await base();
  await db.exec(`drop policy "Auth can manage resenas" on public.resenas`);
  await aplicar(db, 0, 3);
  await falla(db, sql[MIGRACIONES[3]], /faltan políticas que se esperaba encontrar[\s\S]*resenas/, "DB-02 no aborta si falta una política esperada");
  const r = await db.query(`select count(*)::int n from pg_policies where tablename = 'novedades' and qual = 'true'`);
  ok(r.rows[0].n > 0, "DB-02 abortada dejó cambios a medias en novedades");
  await db.close();
}
{
  const db = await base();
  await db.exec(`create policy colada on public.novedades for insert to authenticated with check (true)`);
  await aplicar(db, 0, 3);
  await falla(db, sql[MIGRACIONES[3]], /no conoce[\s\S]*novedades: colada/, "DB-02 no aborta ante una política permisiva desconocida");
  await db.close();
}
{
  const db = await base();
  await falla(db, sql[MIGRACIONES[4]], /evalúa anon y usan is_admin/, "DB-05 sin DB-01/DB-02 no aborta (dejaría a anon con errores)");
  const r = await db.query(`select has_function_privilege('anon', 'public.is_super_admin(uuid)', 'EXECUTE') o`);
  ok(r.rows[0].o, "DB-05 abortada dejó revocado is_super_admin");
  await db.close();
}
{
  // Tablas opcionales ausentes (types.ts no lista salas, chatbot_config ni noticias_hosteleria): se omiten
  const db = await base();
  await db.exec(`drop table public.salas; drop table public.chatbot_config;`);
  await aplicar(db);
  const r = await db.query(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
  igual(r.rows[0].n, 0, "Sin salas/chatbot_config las migraciones no terminan bien");
  await db.close();
}

console.log(`test-minimo-privilegio: ${comprobaciones} comprobaciones OK (${MIGRACIONES.length} migraciones, tests en supabase/tests/t4a_minimo_privilegio_test.sql)`);
