// espacios_reserva por sección (T7-ESPACIOS, CT-REM-DB-02, D-005) contra un
// Postgres en memoria (PGlite). Nunca toca Supabase: ni la demo ni producción.
//
//   npm run test:espacios:db
//
// Estado de partida: el mismo andamiaje y fixture que test-minimo-privilegio
// (supabase/tests/fixtures/t4a_estado_previo.sql) + las cinco migraciones de
// T4a + public.espacios_reserva en tres variantes:
//   DEMO   las 9 políticas reales de la demo (evidencias/demo-s0/politicas-demo.json)
//          + restrictiva, GRANT de antes de 20260928140000 (TRUNCATE a authenticated)
//   GIT    las 6 de 20260928140000 (DELETE solo super admin) + restrictiva
//   PARCIAL la demo sin las 3 "Solo usuarios autenticados…" (p. ej. producción)
// Encima, la migración REAL 20261030210000.
//
// Cubre: personas (supabase/tests/t7_espacios_reserva_test.sql) en las tres
// variantes, idempotencia (segunda pasada = misma huella), rollback exacto
// (vuelve a la huella de partida de cada variante y borra la foto), y guardas
// con atomicidad (política desconocida, estado no reconocido).
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIG = "supabase/migrations";
const RB = "supabase/rollbacks";
const T4A = ["20261030100000", "20261030110000", "20261030120000", "20261030130000", "20261030140000"];
const PROPIA = "20261030210000";
const ficheros = await readdir(MIG);
const buscar = (p) => {
  const f = ficheros.find((x) => x.startsWith(`${p}_`) && x.endsWith(".sql"));
  assert.ok(f, `No se encontró ${MIG}/${p}_*.sql`);
  return f;
};
const sqlT4a = await Promise.all(T4A.map(async (p) => readFile(`${MIG}/${buscar(p)}`, "utf8")));
const fMig = buscar(PROPIA);
const MIGRACION = await readFile(`${MIG}/${fMig}`, "utf8");
const ROLLBACK = await readFile(`${RB}/${fMig.replace(/\.sql$/, "_ROLLBACK.sql")}`, "utf8");
const FIXTURE = await readFile("supabase/tests/fixtures/t4a_estado_previo.sql", "utf8");
const TEST = await readFile("supabase/tests/t7_espacios_reserva_test.sql", "utf8");

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
// IA-01 (lo necesita 20261030110000; igual que en test-minimo-privilegio)
const PROD_IA01 = `
  create function public.ejecutar_consulta_chatbot(query_sql text) returns jsonb
    language plpgsql security definer set search_path = public as $$ begin return '[]'::jsonb; end $$;
  create function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric)
    returns json language plpgsql security definer set search_path = public as $$
    begin return json_build_object('es_duplicado', false); end $$;
  revoke all on function public.ejecutar_consulta_chatbot(text), public.verificar_duplicado_factura(character varying, character varying, date, numeric) from public, anon;
  grant execute on function public.ejecutar_consulta_chatbot(text), public.verificar_duplicado_factura(character varying, character varying, date, numeric) to authenticated, service_role;
`;
const RESTRICTIVA = `create policy "acceso_panel_no_bloqueado" on public.espacios_reserva as restrictive for all to authenticated
  using (( SELECT private.sesion_panel_permitida() AS sesion_panel_permitida)) with check (( SELECT private.sesion_panel_permitida() AS sesion_panel_permitida));`;
const TABLA = `
  create table public.espacios_reserva (id uuid default gen_random_uuid() primary key, nombre text not null, descripcion text,
    capacidad_maxima integer, activa boolean default true, caracteristicas jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.mesas_t7 (id uuid default gen_random_uuid() primary key, espacio_id uuid references public.espacios_reserva(id) on delete cascade);
  alter table public.espacios_reserva enable row level security;
  revoke all on public.espacios_reserva from anon, authenticated, service_role;
  grant all on public.espacios_reserva to service_role;
`;
// Nombres y expresiones copiados de politicas-demo.json (pg_policies de la demo).
const DEMO_POLITICAS = {
  publico: `create policy "Público puede ver espacios activos" on public.espacios_reserva for select to public using ((activa = true));`,
  crear: `create policy "Solo usuarios autenticados pueden crear espacios" on public.espacios_reserva for insert to public with check ((auth.uid() IS NOT NULL));`,
  actualizar: `create policy "Solo usuarios autenticados pueden actualizar espacios" on public.espacios_reserva for update to public using ((auth.uid() IS NOT NULL)) with check ((auth.uid() IS NOT NULL));`,
  eliminar: `create policy "Solo usuarios autenticados pueden eliminar espacios" on public.espacios_reserva for delete to public using ((auth.uid() IS NOT NULL));`,
  read: `create policy "Authenticated users can read espacios_reserva" on public.espacios_reserva for select to authenticated using (true);`,
  insert: `create policy "Authenticated users can insert espacios_reserva" on public.espacios_reserva for insert to authenticated with check (true);`,
  update: `create policy "Authenticated users can update espacios_reserva" on public.espacios_reserva for update to authenticated using (true) with check (true);`,
  delete: `create policy "Authenticated users can delete espacios_reserva" on public.espacios_reserva for delete to authenticated using (true);`,
  only: `create policy "Only authenticated can read espacios" on public.espacios_reserva for select to authenticated using (true);`,
};
const GRANTS_DEMO = `grant select, references, trigger on public.espacios_reserva to anon;
  grant select, insert, update, delete, truncate, references, trigger on public.espacios_reserva to authenticated;`;
const VARIANTES = {
  DEMO: TABLA + GRANTS_DEMO + Object.values(DEMO_POLITICAS).join("\n") + RESTRICTIVA,
  PARCIAL: TABLA + GRANTS_DEMO + Object.entries(DEMO_POLITICAS)
    .filter(([k]) => !["crear", "actualizar", "eliminar"].includes(k)).map(([, v]) => v).join("\n") + RESTRICTIVA,
  GIT: TABLA + `grant select on public.espacios_reserva to anon;
    grant select, insert, update, delete, references, trigger on public.espacios_reserva to authenticated;
    create policy espacios_reserva_select_anon_activos on public.espacios_reserva for select to anon using ( activa = true );
    create policy espacios_reserva_select_seccion on public.espacios_reserva for select to authenticated using ( (select public.can_read_section('reservas')) );
    create policy espacios_reserva_insert_seccion on public.espacios_reserva for insert to authenticated with check ( (select public.can_write_section('reservas')) );
    create policy espacios_reserva_update_seccion on public.espacios_reserva for update to authenticated using ( (select public.can_write_section('reservas')) ) with check ( (select public.can_write_section('reservas')) );
    create policy espacios_reserva_delete_super_admin on public.espacios_reserva for delete to authenticated using ( (select public.is_super_admin((select auth.uid()))) );
    create policy espacios_reserva_service_role on public.espacios_reserva for all to service_role using (true) with check (true);` + RESTRICTIVA,
};

const HUELLA = `
  select 'P ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '-') || ' ' || coalesce(with_check, '-') h
    from pg_policies where schemaname = 'public' and tablename = 'espacios_reserva'
  union all select 'R ' || relrowsecurity from pg_class where oid = 'public.espacios_reserva'::regclass
  union all select 'G ' || r.rol || ' ' || p.pr from (values ('anon'), ('authenticated'), ('service_role')) r(rol)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(pr)
    where has_table_privilege(r.rol, 'public.espacios_reserva', p.pr)
  union all select 'T ' || c.oid::regclass::text from pg_class c where c.relnamespace = 'private'::regnamespace and c.relkind = 'r'
  order by 1`;
const huella = async (db) => (await db.query(HUELLA)).rows.map((r) => r.h);

async function base(variante) {
  const db = new PGlite();
  await db.exec(ANDAMIAJE);
  await db.exec(FIXTURE);
  await db.exec(PROD_IA01);
  await db.exec(VARIANTES[variante]);
  for (const s of sqlT4a) await db.exec(s); // RC2 delante, como en la demo
  return db;
}
const falla = async (db, texto, patron, msg) => {
  await assert.rejects(db.exec(texto), patron, msg);
  await db.exec("rollback").catch(() => {});
  comprobaciones++;
};

// 0. Control negativo: en la demo, STAFF (solo dashboard) SÍ borra espacios hoy
{
  const db = await base("DEMO");
  await db.exec(`insert into auth.users (id, email) values ('a0000000-0000-0000-0000-00000000000a', 's@t');
    insert into auth.sessions (id, user_id) values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a');
    insert into public.espacios_reserva (nombre) values ('x');`);
  await db.exec(`begin; set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","session_id":"a1000000-0000-0000-0000-000000000001"}', true);`);
  const d = await db.query(`with b as (delete from public.espacios_reserva returning 1) select count(*)::int n from b`);
  await db.exec("rollback");
  igual(d.rows[0].n, 1, "El fixture DEMO no reproduce el agujero (STAFF debería poder borrar antes de la migración)");
  await db.close();
}

// 1. Las tres variantes: aplica, idempotencia, personas, rollback exacto
for (const variante of ["DEMO", "PARCIAL", "GIT"]) {
  const db = await base(variante);
  const antes = await huella(db);
  await db.exec(MIGRACION);
  const despues = await huella(db);
  ok(despues.join("\n") !== antes.join("\n"), `${variante}: la migración no cambió nada`);
  ok(despues.includes("T private.rem_t7_espacios_reserva_previo"), `${variante}: no guardó la foto previa`);
  await db.exec(MIGRACION);
  igual(await huella(db), despues, `${variante}: la segunda pasada cambia algo (no es idempotente)`);

  await db.exec(TEST); // aborta con ASSERT FAILED si falla una persona
  comprobaciones++;

  await db.exec(ROLLBACK);
  const tras = await huella(db);
  const dif = [...antes.filter((x) => !tras.includes(x)).map((x) => `- ${x}`), ...tras.filter((x) => !antes.includes(x)).map((x) => `+ ${x}`)];
  igual(dif, [], `${variante}: el rollback no vuelve exactamente al estado de partida`);

  // reaplicar tras el rollback deja el mismo estado final
  await db.exec(MIGRACION);
  igual(await huella(db), despues, `${variante}: reaplicar tras el rollback no da el mismo estado final`);
  await db.close();
}

// 2. Guardas: abortan y no dejan nada a medias
{
  const db = await base("DEMO");
  await db.exec(`create policy colada on public.espacios_reserva for delete to authenticated using (true)`);
  const antes = await huella(db);
  await falla(db, MIGRACION, /no conoce[\s\S]*colada/, "No aborta ante una política desconocida");
  igual(await huella(db), antes, "Abortada por política desconocida, dejó cambios a medias");
  await db.close();
}
{
  const db = await base("DEMO");
  await db.exec(`do $$ declare r record; begin for r in select polname from pg_policy where polrelid = 'public.espacios_reserva'::regclass
    and polname <> 'acceso_panel_no_bloqueado' loop execute format('drop policy %I on public.espacios_reserva', r.polname); end loop; end $$;`);
  const antes = await huella(db);
  await falla(db, MIGRACION, /no reconocido/, "No aborta con un estado de partida no reconocido");
  igual(await huella(db), antes, "Abortada por estado no reconocido, dejó cambios a medias");
  await db.close();
}
{
  const db = await base("DEMO");
  await falla(db, ROLLBACK, /no existe la foto/, "El rollback sin migración previa no aborta");
  await db.close();
}

console.log(`test-espacios-reserva: ${comprobaciones} comprobaciones OK (DEMO, PARCIAL, GIT; tests en supabase/tests/t7_espacios_reserva_test.sql)`);
