// RRSS: editor IA de fotos y vídeos, borradores de Facebook e ideas para
// grabar (20261118120000_rrss.sql) contra un Postgres en memoria (PGlite),
// con la migración REAL. Nunca toca Supabase.
//
//   npm run test:rrss:db
//
// Cubre: se para sin can_edit_section sin dejar nada; se aplica sin cubo ni
// ia_funciones; idempotente (vuelve a dejar el cubo privado y no pisa
// ia_funciones); seis tablas con RLS, cubo PRIVADO «rrss» de 50 MB y alta de
// «rrss-ia» sin instrumentar; RLS (con «Ver» se lee y no se escribe, con
// «Editar» sí; otra sección, sesión bloqueada, sesión inexistente y anon,
// nada); creado_por del servidor en trabajos, archivos e ideas (ni al crear
// ni al cambiar); CHECK (marca, canal, tipo, estilo, rutas, tamaño, piezas…);
// generaciones siempre «pendiente» con creado_por y created_at del servidor,
// una sola activa por trabajo, solo las columnas del estado se cambian, no
// vuelven a «pendiente» ni a ejecutarse una vez terminadas, los intentos no
// bajan y «Cancelar» funciona; topes diarios en día de Madrid (vídeo por
// usuario y entre todos, fotos, IA) con cerrojo, que no cuentan lo de ayer ni
// se saltan con un created_at viejo; peticiones a la IA (solo «ok» se
// cambia); políticas del cubo (también con sesión bloqueada); borrado en
// cascada; auditoría (sin las generaciones); baja de un usuario (creado_por
// queda NULL, sin referencias colgando); y el rollback (el cubo solo se borra
// vacío), con nueva aplicación después.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261118120000_rrss.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261118120000_rrss_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (el de scripts/test-instagram-ia.mjs), por
// piezas para poder quitar can_edit_section o el cubo.
const BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant references on auth.users to authenticated;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean, primary key (user_id, section_key));
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view = true) or (_permission = 'edit' and can_edit = true))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid, detalles jsonb);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor, detalles)
      values (TG_TABLE_NAME, lower(TG_OP), auth.uid(), case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
`;
// can_edit_section (20261001170000): «Editar» del usuario actual.
const CAN_EDIT = `
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  revoke all on function public.can_edit_section(text) from public, anon;
  grant execute on function public.can_edit_section(text) to authenticated, service_role;
`;
// update_updated_at_column como en producción: SECURITY DEFINER y sin EXECUTE
// para los roles de la API (20260922200000); los disparadores la llaman igual.
const UPDATED_AT = `
  create function public.update_updated_at_column() returns trigger language plpgsql security definer set search_path = public
    as $f$ begin new.updated_at = now(); return new; end $f$;
  revoke all on function public.update_updated_at_column() from public, anon, authenticated;
`;
const STORAGE = `
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;
`;
const ANDAMIAJE = BASE + CAN_EDIT + UPDATED_AT + STORAGE;
// Catálogo de costes (20260928193000_costes_sistema.sql), lo justo.
const IA_FUNCIONES = `
  create table public.ia_funciones (funcion text primary key, descripcion text not null,
    instrumentada boolean not null default false, unidad text not null default 'llamada',
    orden integer not null default 100, activo boolean not null default true);
`;
// Como en Supabase: lo nuevo de public nace con todos los privilegios para
// anon y authenticated; la RLS (y los revoke de la migración) son la barrera.
const PRIVILEGIOS_SUPABASE = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002", // Marketing: ver y editar
  VER: "a0000000-0000-0000-0000-000000000003", // Marketing: solo ver
  OTRA: "a0000000-0000-0000-0000-000000000004", // Reservas: ver y editar
  BLOQ: "a0000000-0000-0000-0000-000000000005", // Marketing: ver y editar, pero bloqueado
  MKT2: "a0000000-0000-0000-0000-000000000006", // Marketing: ver y editar
  MKT3: "a0000000-0000-0000-0000-000000000007", // Marketing: ver y editar
  BAJA: "a0000000-0000-0000-0000-000000000008", // Marketing: ver y editar; se le da de baja al final
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.VER}', 'ver@t', null), ('${U.OTRA}', 'otra@t', null),
    ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.MKT2}', 'mkt2@t', null), ('${U.MKT3}', 'mkt3@t', null),
    ('${U.BAJA}', 'baja@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.VER}', 'marketing', true, false), ('${U.OTRA}', 'reservas', true, true),
    ('${U.BLOQ}', 'marketing', true, true), ('${U.MKT2}', 'marketing', true, true), ('${U.MKT3}', 'marketing', true, true),
    ('${U.BAJA}', 'marketing', true, true);
`;
const TABLAS = ["rrss_archivos", "rrss_generaciones", "rrss_ia_peticiones", "rrss_ideas", "rrss_proyectos", "rrss_resultados"];
const LISTAR_TABLAS = "select tablename from pg_tables where schemaname = 'public' and tablename like 'rrss\\_%' order by 1";

// ─── 0. Sin can_edit_section se para sin crear nada ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE + UPDATED_AT + STORAGE + IA_FUNCIONES);
  await falla(otra.exec(MIGRACION), /rrss: faltan can_read_section \/ can_edit_section/, "no se paró sin can_edit_section");
  await otra.exec("rollback");
  igual((await otra.query(`select to_regclass('public.rrss_proyectos') t, (select count(*)::int from storage.buckets) cubos,
      (select count(*)::int from public.ia_funciones) ia`)).rows[0],
    { t: null, cubos: 0, ia: 0 }, "la migración abortada dejó tablas, el cubo o la fila de ia_funciones");
  await otra.close();
}

// ─── 1. Sin cubos ni ia_funciones también se aplica ─────────────────────────
{
  const otra = new PGlite();
  await otra.exec(BASE + CAN_EDIT + UPDATED_AT);
  await otra.exec(MIGRACION);
  igual((await otra.query(LISTAR_TABLAS)).rows.map((r) => r.tablename), TABLAS, "sin storage ni ia_funciones no creó las tablas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(IA_FUNCIONES);
await db.exec(DATOS);
await db.exec(PRIVILEGIOS_SUPABASE);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;
async function como(u, fn, rol = "authenticated", sesionId = u && sesion(u)) {
  await db.exec("begin");
  try {
    if (rol === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesionId })}', true);`);
    }
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const filas = (u, sql, params, rol) => como(u, async () => (await q(sql, params)).rows, rol);
// Inicio del día de Madrid (lo mismo que calculan los disparadores).
const DIA = "(date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid')";
const AYER = `${DIA} - interval '1 second'`;

// ─── 2. Estructura: tablas, RLS, cubo privado e ia_funciones ────────────────
{
  igual((await q(LISTAR_TABLAS)).rows.map((r) => r.tablename), TABLAS, "faltan tablas de RRSS");
  igual(await n("select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relname like 'rrss\\_%' and relkind = 'r' and relrowsecurity"),
    6, "alguna tabla de RRSS sin RLS");
  igual(await n(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename like 'rrss\\_%'
      and policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE'`), 6, "falta la política restrictiva de sesión de panel");
  igual(await n(`select count(*)::int n from unnest($1::text[]) t where has_table_privilege('anon', 'public.' || t, 'SELECT')
      or has_table_privilege('anon', 'public.' || t, 'INSERT') or has_table_privilege('anon', 'public.' || t, 'UPDATE')
      or has_table_privilege('anon', 'public.' || t, 'DELETE')`, [TABLAS]), 0, "anon conserva privilegios en tablas de RRSS");
  // Generaciones y peticiones a la IA: sin UPDATE de tabla, sin DELETE ni
  // TRUNCATE (aunque Supabase los dé por defecto); UPDATE solo de columnas.
  igual((await q(`select t, has_table_privilege('authenticated', 'public.' || t, 'UPDATE') upd, has_table_privilege('authenticated', 'public.' || t, 'DELETE') del,
      has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') trunc from unnest(array['rrss_generaciones', 'rrss_ia_peticiones']) t order by 1`)).rows,
  [{ t: "rrss_generaciones", upd: false, del: false, trunc: false }, { t: "rrss_ia_peticiones", upd: false, del: false, trunc: false }],
  "authenticated conserva UPDATE de tabla, DELETE o TRUNCATE en generaciones o peticiones a la IA");
  const actualizables = async (tabla) => (await q(`select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE') order by attname`, [`public.${tabla}`])).rows.map((r) => r.attname);
  igual(await actualizables("rrss_generaciones"), ["avisos", "error", "estado", "intentos", "lease_hasta", "progreso", "terminado_at"],
    "columnas de generaciones que authenticated puede cambiar");
  igual(await actualizables("rrss_ia_peticiones"), ["ok"], "columnas de peticiones a la IA que authenticated puede cambiar");
  // PGlite tiene una sola conexión: la carrera no se puede reproducir, pero
  // el cerrojo tiene que estar en los dos topes.
  igual((await q(`select proname from pg_proc where proname in ('rrss_comprobar_cupo_generacion', 'rrss_comprobar_cupo_ia')
      and prosrc like '%pg_advisory_xact_lock%' order by 1`)).rows.map((r) => r.proname),
  ["rrss_comprobar_cupo_generacion", "rrss_comprobar_cupo_ia"], "algún tope diario sin cerrojo (dos peticiones a la vez se lo saltarían)");
  igual((await q(`select id, public, file_size_limit::int limite, 'audio/mp4' = any (allowed_mime_types) audio,
      'video/quicktime' = any (allowed_mime_types) mov, 'image/jpeg' = any (allowed_mime_types) jpg from storage.buckets where id = 'rrss'`)).rows,
    [{ id: "rrss", public: false, limite: 52428800, audio: true, mov: true, jpg: true }], "el cubo «rrss» no es privado de 50 MB o le faltan tipos");
  igual((await q("select instrumentada, unidad from public.ia_funciones where funcion = 'rrss-ia'")).rows,
    [{ instrumentada: false, unidad: "llamada" }], "falta «rrss-ia» sin instrumentar en ia_funciones");

  // Volver a aplicar deja el cubo privado otra vez y no pisa ia_funciones.
  await q("update storage.buckets set public = true, file_size_limit = 1 where id = 'rrss'");
  await q("update public.ia_funciones set instrumentada = true where funcion = 'rrss-ia'");
  await db.exec(MIGRACION);
  igual((await q("select public, file_size_limit::int limite from storage.buckets where id = 'rrss'")).rows,
    [{ public: false, limite: 52428800 }], "volver a aplicar no dejó el cubo privado de 50 MB");
  igual((await q("select instrumentada from public.ia_funciones where funcion = 'rrss-ia'")).rows,
    [{ instrumentada: true }], "volver a aplicar pisó la fila de ia_funciones");
  await q("update public.ia_funciones set instrumentada = false where funcion = 'rrss-ia'");
}

// ─── 3. RLS: con «Ver» se lee; con «Editar» se escribe; los demás, nada ─────
const INSERTAR_PROYECTO = "insert into public.rrss_proyectos (marca, canal, tipo) values ('touza', 'facebook', 'story') returning id";
const P1 = (await filas(U.MKT,
  "insert into public.rrss_proyectos (marca, canal, tipo, instrucciones) values ('casa-tomas', 'instagram', 'carrusel', 'Más luz') returning id, creado_por, estilo, estado, origen"))[0];
igual({ ...P1, id: undefined }, { id: undefined, creado_por: U.MKT, estilo: "elegante", estado: "borrador", origen: "editor" },
  "valores por defecto del trabajo (creado_por, estilo, estado, origen)");
const A1 = randomUUID();
const INSERTAR_ARCHIVO = (proyecto, id = randomUUID()) => [
  "insert into public.rrss_archivos (id, proyecto_id, tipo, ruta, nombre, mime, bytes, ancho, alto) values ($1, $2, 'foto', $3, 'plato.jpg', 'image/jpeg', 2048000, 4000, 3000) returning creado_por",
  [id, proyecto, `originales/${proyecto}/${id}.jpg`],
];
igual(await filas(U.MKT, ...INSERTAR_ARCHIVO(P1.id, A1)), [{ creado_por: U.MKT }], "«Editar» no pudo registrar un original");
const INSERTAR_RESULTADO = (proyecto, generacion, indice = 0) => [
  "insert into public.rrss_resultados (proyecto_id, generacion_id, indice, medio, ruta, ancho, alto, bytes) values ($1, $2, $3, 'foto', $4, 1080, 1350, 350000) returning indice",
  [proyecto, generacion, indice, `resultados/${proyecto}/${generacion ?? randomUUID()}/${indice}.jpg`],
];
igual(await filas(U.MKT, ...INSERTAR_RESULTADO(P1.id, null)), [{ indice: 0 }], "«Editar» no pudo guardar un resultado");
const INSERTAR_IDEA = `insert into public.rrss_ideas (marca, canal, tipo, objetivo, propuestas, modelo)
  values ('touza', 'facebook', 'reel', '{"meta":"más visitas"}', '[{"titulo":"Vermú del domingo"}]', 'gpt-5.6-luna') returning creado_por`;
igual(await filas(U.MKT, INSERTAR_IDEA), [{ creado_por: U.MKT }], "«Editar» no pudo guardar ideas");

{
  const LEIBLES = ["rrss_proyectos", "rrss_archivos", "rrss_resultados", "rrss_ideas"];
  const ve = (u, rol, sesionId) => como(u, async () => {
    const r = {};
    for (const t of LEIBLES) r[t] = await n(`select count(*)::int n from public.${t}`);
    return r;
  }, rol, sesionId);
  const UNO = Object.fromEntries(LEIBLES.map((t) => [t, 1]));
  const CERO = Object.fromEntries(LEIBLES.map((t) => [t, 0]));
  igual(await ve(U.VER), UNO, "con «Ver» no se leen los trabajos");
  igual(await ve(U.MKT2), UNO, "otro de Marketing no ve los trabajos (son de la sección, no de quien los crea)");
  igual(await ve(U.SA), UNO, "el super admin no ve los trabajos");
  igual(await ve(U.OTRA), CERO, "otra sección ve los trabajos");
  igual(await ve(U.BLOQ), CERO, "un usuario bloqueado ve los trabajos");
  igual(await ve(U.MKT, "authenticated", "b0000000-0000-0000-0000-0000000000ff"), CERO, "con una sesión que no existe se ven los trabajos");
  await falla(ve(null, "anon"), /permission denied/, "anon lee los trabajos");
  await falla(como(null, () => q("select 1 from public.rrss_generaciones"), "anon"), /permission denied/, "anon lee las generaciones");
  await falla(como(null, () => q("select 1 from public.rrss_ia_peticiones"), "anon"), /permission denied/, "anon lee las peticiones a la IA");
}

// Con solo «Ver»: nada de escribir.
await falla(filas(U.VER, INSERTAR_PROYECTO), /row-level security/, "con «Ver» se crean trabajos");
igual((await filas(U.VER, "update public.rrss_proyectos set titulo = 'x' returning id")).length, 0, "con «Ver» se cambian trabajos");
igual((await filas(U.VER, "delete from public.rrss_proyectos returning id")).length, 0, "con «Ver» se borran trabajos");
await falla(filas(U.VER, ...INSERTAR_ARCHIVO(P1.id)), /row-level security/, "con «Ver» se registran originales");
igual((await filas(U.VER, "update public.rrss_archivos set orden = 5 returning id")).length, 0, "con «Ver» se cambian archivos");
igual((await filas(U.VER, "delete from public.rrss_resultados returning id")).length, 0, "con «Ver» se borran resultados");
await falla(filas(U.VER, INSERTAR_IDEA), /row-level security/, "con «Ver» se guardan ideas");
// Otra sección, bloqueado y anon tampoco.
await falla(filas(U.OTRA, INSERTAR_PROYECTO), /row-level security/, "otra sección crea trabajos");
igual((await filas(U.OTRA, "update public.rrss_proyectos set titulo = 'x' returning id")).length, 0, "otra sección cambia trabajos");
await falla(filas(U.BLOQ, INSERTAR_PROYECTO), /row-level security/, "un usuario bloqueado crea trabajos");
await falla(filas(null, INSERTAR_PROYECTO, [], "anon"), /permission denied/, "anon crea trabajos");
// El super admin sí.
igual((await filas(U.SA, INSERTAR_PROYECTO)).length, 1, "el super admin no pudo crear un trabajo");
// «Editar» cambia el trabajo y updated_at se mueve solo.
igual(await filas(U.MKT,
  `update public.rrss_proyectos set plan = '{"piezas":[]}', textos = '{"caption":"Hola"}', estado = 'listo' where id = $1
   returning estado, updated_at > created_at as tocado`, [P1.id]),
[{ estado: "listo", tocado: true }], "«Editar» no cambió el trabajo o updated_at no se movió");

// creado_por lo pone el servidor: ni al crear ni al cambiar se atribuye a otro.
{
  const pf = (await filas(U.MKT, "insert into public.rrss_proyectos (marca, canal, tipo, creado_por) values ('touza', 'instagram', 'reel', $1) returning id, creado_por",
    [U.MKT2]))[0];
  igual(pf.creado_por, U.MKT, "se creó un trabajo a nombre de otro");
  const af = randomUUID();
  igual(await filas(U.MKT, "insert into public.rrss_archivos (id, proyecto_id, tipo, ruta, mime, bytes, creado_por) values ($1, $2, 'video', $3, 'video/mp4', 1000, $4) returning creado_por",
    [af, pf.id, `originales/${pf.id}/${af}.mp4`, U.MKT2]), [{ creado_por: U.MKT }], "se registró un original a nombre de otro");
  const idf = (await filas(U.MKT, "insert into public.rrss_ideas (marca, canal, propuestas, creado_por) values ('casa-tomas', 'instagram', '[]', $1) returning id, creado_por",
    [U.MKT2]))[0];
  igual(idf.creado_por, U.MKT, "se guardaron ideas a nombre de otro");
  for (const [tabla, id] of [["rrss_proyectos", pf.id], ["rrss_archivos", af], ["rrss_ideas", idf.id]]) {
    igual(await filas(U.MKT, `update public.${tabla} set creado_por = $2 where id = $1 returning creado_por`, [id, U.MKT2]), [{ creado_por: U.MKT }],
      `se pasó a otro la autoría en ${tabla}`);
    igual(await filas(U.MKT2, `update public.${tabla} set creado_por = $2 where id = $1 returning creado_por`, [id, U.MKT2]), [{ creado_por: U.MKT }],
      `otro usuario se apropió de una fila de ${tabla}`);
  }
  igual(await filas(U.MKT2, "update public.rrss_proyectos set titulo = 'Retocado' where id = $1 returning creado_por", [pf.id]), [{ creado_por: U.MKT }],
    "al cambiar otro el trabajo, cambió su autor");
  // Sin usuario (un arreglo a mano como postgres) se respeta el indicado.
  igual((await q("insert into public.rrss_proyectos (marca, canal, tipo, creado_por) values ('touza', 'instagram', 'reel', $1) returning creado_por", [U.MKT2])).rows,
    [{ creado_por: U.MKT2 }], "como postgres no se respetó el creado_por indicado");
}

// ─── 4. CHECK ───────────────────────────────────────────────────────────────
{
  const proy = (marca, canal, tipo, estilo = "elegante") =>
    q("insert into public.rrss_proyectos (marca, canal, tipo, estilo) values ($1, $2, $3, $4)", [marca, canal, tipo, estilo]);
  await falla(proy("otra-marca", "instagram", "reel"), /rrss_proyectos_marca_check/, "marca rara");
  await falla(proy("touza", "tiktok", "reel"), /rrss_proyectos_canal_check/, "canal raro");
  await falla(proy("touza", "instagram", "video"), /rrss_proyectos_tipo_check/, "tipo raro");
  await falla(proy("touza", "instagram", "reel", "barroco"), /rrss_proyectos_estilo_check/, "estilo raro");
  await falla(q("insert into public.rrss_proyectos (marca, canal, tipo, instrucciones) values ('touza', 'instagram', 'reel', repeat('a', 1001))"),
    /rrss_proyectos_instrucciones_check/, "instrucciones de más de 1000 caracteres");
  await falla(q("insert into public.rrss_proyectos (marca, canal, tipo, textos) values ('touza', 'instagram', 'reel', '[]')"),
    /rrss_proyectos_textos_check/, "textos que no son un objeto");

  const u1 = randomUUID(), u2 = randomUUID();
  const arch = (ruta, bytes = 1000, tipo = "foto", mime = "image/jpeg") =>
    q("insert into public.rrss_archivos (proyecto_id, tipo, ruta, mime, bytes) values ($1, $2, $3, $4, $5)", [P1.id, tipo, ruta, mime, bytes]);
  for (const mala of ["otra/cosa.jpg", `originales/abc/${u2}.jpg`, `originales/${u1}/${u2}.exe`, `originales/${u1}/../${u2}.jpg`,
    `/originales/${u1}/${u2}.jpg`, `previas/${u1}/${u2}.jpg`, `originales/${u1}/${u2}.jpg.php`]) {
    await falla(arch(mala), /rrss_archivos_ruta_check/, `ruta de original admitida: ${mala}`);
  }
  await falla(arch(`originales/${u1}/${u2}.jpg`, 52428801), /rrss_archivos_bytes_check/, "original de más de 50 MB");
  await falla(arch(`originales/${u1}/${u2}.jpg`, 0), /rrss_archivos_bytes_check/, "original vacío");
  await falla(arch(`originales/${u1}/${u2}.jpg`, 1000, "audio"), /rrss_archivos_tipo_check/, "tipo de archivo raro");
  await falla(arch(`originales/${u1}/${u2}.jpg`, 1000, "foto", "application/pdf"), /rrss_archivos_mime_check/, "mime raro");
  await arch(`originales/${u1}/${u2}.mov`, 52428800, "video", "video/quicktime"); // justo 50 MB: vale
  comprobaciones++;
  await falla(arch(`originales/${u1}/${u2}.mov`, 1000, "video", "video/quicktime"), /rrss_archivos_ruta_key/, "dos archivos con la misma ruta");

  const res = (ruta, indice = 0, portada = null) =>
    q("insert into public.rrss_resultados (proyecto_id, indice, medio, ruta, portada_ruta, ancho, alto, bytes) values ($1, $2, 'foto', $3, $4, 1080, 1350, 1000)",
      [P1.id, indice, ruta, portada]);
  await falla(res(`originales/${u1}/${u2}.jpg`), /rrss_resultados_ruta_check/, "resultado fuera de resultados/");
  await falla(res(`resultados/${u1}/${u2}/1.png`, 1), /rrss_resultados_ruta_check/, "resultado en PNG");
  await falla(res(`resultados/${u1}/${u2}/20.jpg`, 20), /rrss_resultados_indice_check/, "pieza 20 (el máximo es 19)");
  await falla(res(`resultados/${u1}/${u2}/1.mp4`, 1, `resultados/${u1}/${u2}/1.jpg`), /rrss_resultados_portada_ruta_check/, "portada sin «-portada»");
  // Una sola vigente por pieza: la de la sección 3 (pieza 0) choca; al dejarla de vigente, entra.
  await falla(res(`resultados/${u1}/${u2}/0.jpg`), /rrss_resultados_vigente/, "dos resultados vigentes de la misma pieza");
  await q("update public.rrss_resultados set vigente = false where proyecto_id = $1 and indice = 0", [P1.id]);
  await res(`resultados/${u1}/${u2}/0.jpg`);
  comprobaciones++;

  await falla(q("insert into public.rrss_ideas (marca, canal, propuestas) values ('touza', 'instagram', '{}')"),
    /rrss_ideas_propuestas_check/, "propuestas que no son una lista");
  await falla(q("insert into public.rrss_ideas (marca, canal, propuestas) values ('touza', 'tiktok', '[]')"), /rrss_ideas_canal_check/, "idea con canal raro");
  const pc = (await q(INSERTAR_PROYECTO)).rows[0].id;
  await falla(q("insert into public.rrss_generaciones (proyecto_id, medio, plan) values ($1, 'audio', '{}')", [pc]),
    /rrss_generaciones_medio_check/, "generación de medio raro");
  await falla(q("insert into public.rrss_generaciones (proyecto_id, medio, plan, piezas) values ($1, 'foto', '{}', '{}')", [pc]),
    /rrss_generaciones_piezas_check/, "generación con una lista de piezas vacía");
  await falla(como(U.MKT, () => q("insert into public.rrss_ia_peticiones (accion) values ('borrar-todo')")),
    /rrss_ia_peticiones_accion_check/, "petición a la IA con una acción rara");
}

// ─── 5. Generaciones: siempre «pendiente», del servidor, una activa por trabajo
const generar = (u, proyecto, medio, { atrasada = false } = {}) => como(u, async () => (await q(
  `insert into public.rrss_generaciones (proyecto_id, medio, plan${atrasada ? ", created_at" : ""})
   values ($1, $2, '{"piezas":[]}'${atrasada ? ", now() - interval '2 days'" : ""}) returning id, estado, creado_por`, [proyecto, medio])).rows[0]);
const P2 = (await filas(U.MKT, "insert into public.rrss_proyectos (marca, canal, tipo, origen) values ('touza', 'facebook', 'publicacion', 'facebook') returning id"))[0].id;
const g1 = (await filas(U.MKT,
  `insert into public.rrss_generaciones (proyecto_id, medio, plan, estado, creado_por, intentos, lease_hasta, created_at)
   values ($1, 'foto', '{"piezas":[]}', 'listo', $2, 7, now() + interval '1 hour', now() - interval '3 days')
   returning id, estado, creado_por, intentos, lease_hasta, created_at >= ${DIA} as de_hoy`, [P2, U.MKT2]))[0];
igual({ ...g1, id: undefined }, { id: undefined, estado: "pendiente", creado_por: U.MKT, intentos: 0, lease_hasta: null, de_hoy: true },
  "el cliente falseó estado, creado_por, intentos, lease_hasta o created_at al crear la generación");
await falla(generar(U.MKT2, P2, "foto"), /rrss_generaciones_una_activa/, "dos generaciones pendientes del mismo trabajo");
igual(await filas(U.MKT, "update public.rrss_generaciones set estado = 'procesando', lease_hasta = now() + interval '6 minutes', intentos = 1 where id = $1 returning estado",
  [g1.id]), [{ estado: "procesando" }], "«Editar» (el motor) no pudo reclamar la generación");
await falla(generar(U.MKT, P2, "foto"), /rrss_generaciones_una_activa/, "otra generación mientras una se procesa");
await falla(como(U.MKT, () => q("update public.rrss_generaciones set intentos = 0 where id = $1", [g1.id])), /los intentos de una generación no bajan/,
  "bajaron los intentos de una generación");
await falla(como(U.MKT, () => q("update public.rrss_generaciones set estado = 'pendiente' where id = $1", [g1.id])), /no puede volver a «pendiente»/,
  "una generación en proceso volvió a «pendiente»");
// Solo las columnas del estado: lo demás ni se puede pedir…
for (const [col, valor] of [["created_at", "now() - interval '2 days'"], ["creado_por", `'${U.MKT2}'`], ["medio", "'video'"], ["plan", "'{\"otro\":1}'"],
  ["piezas", "'{0}'"], ["proyecto_id", `'${P1.id}'`], ["updated_at", "now()"]]) {
  await falla(como(U.MKT, () => q(`update public.rrss_generaciones set ${col} = ${valor} where id = $1`, [g1.id])), /permission denied/,
    `«Editar» cambió ${col} de una generación`);
}
// …y aunque alguien se salte la grant (postgres), el disparador las deja como estaban.
{
  const congeladas = "select proyecto_id, medio, plan, piezas, creado_por, created_at::text from public.rrss_generaciones where id = $1";
  const antes = (await q(congeladas, [g1.id])).rows[0];
  await q(`update public.rrss_generaciones set proyecto_id = $2, medio = 'video', plan = '{"otro":1}', piezas = '{0}', creado_por = $3,
    created_at = now() - interval '2 days' where id = $1`, [g1.id, P1.id, U.MKT2]);
  igual((await q(congeladas, [g1.id])).rows[0], antes, "el disparador no congeló trabajo, medio, plan, piezas, autor o fecha de la generación");
}
{
  const p3 = (await q(INSERTAR_PROYECTO)).rows[0].id;
  await falla(generar(U.VER, p3, "foto"), /row-level security/, "con «Ver» se crean generaciones");
  await falla(generar(U.OTRA, p3, "foto"), /row-level security/, "otra sección crea generaciones");
  await falla(generar(U.BLOQ, p3, "foto"), /row-level security/, "un usuario bloqueado crea generaciones");
  await falla(como(null, () => q("insert into public.rrss_generaciones (proyecto_id, medio, plan) values ($1, 'foto', '{}')", [p3]), "anon"),
    /permission denied/, "anon crea generaciones");
}
igual((await filas(U.VER, "update public.rrss_generaciones set estado = 'cancelado' returning id")).length, 0, "con «Ver» se cambian generaciones");
igual(await como(U.OTRA, () => n("select count(*)::int n from public.rrss_generaciones")), 0, "otra sección ve las generaciones");
igual(await como(U.VER, () => n("select count(*)::int n from public.rrss_generaciones where id = $1", [g1.id])), 1, "con «Ver» no se ven las generaciones");
// El motor la termina: procesando → listo con todas las columnas del estado.
igual(await filas(U.MKT,
  `update public.rrss_generaciones set estado = 'listo', progreso = '{"fraccion":1,"paso":"Listo"}', avisos = '{"Sin audio"}', error = null,
   lease_hasta = null, intentos = 2, terminado_at = now() where id = $1 and estado = 'procesando'
   returning estado, progreso, avisos, intentos, lease_hasta, terminado_at is not null as terminada, updated_at > created_at as tocado`, [g1.id]),
[{ estado: "listo", progreso: { fraccion: 1, paso: "Listo" }, avisos: ["Sin audio"], intentos: 2, lease_hasta: null, terminada: true, tocado: true }],
"el motor no pudo terminar la generación o updated_at no se movió");
// Terminada, no vuelve a ejecutarse: ni «pendiente» ni «procesando» con el lease vencido (el motor la reclamaría sin pasar por el tope).
await falla(como(U.MKT, () => q("update public.rrss_generaciones set estado = 'pendiente' where id = $1", [g1.id])), /no puede volver a «pendiente»/,
  "una generación terminada volvió a «pendiente»");
await falla(como(U.MKT, () => q("update public.rrss_generaciones set estado = 'procesando', lease_hasta = now() - interval '1 minute' where id = $1", [g1.id])),
  /no vuelve a ejecutarse/, "una generación terminada volvió a «procesando» (el motor la repetiría sin pasar por el tope)");
const g2 = await generar(U.MKT2, P2, "foto");
igual({ estado: g2.estado, creado_por: g2.creado_por }, { estado: "pendiente", creado_por: U.MKT2 }, "después de una lista no se pudo generar otra");
// «Cancelar» (desde pendiente o desde procesando) y el «error» del motor sí funcionan.
{
  const p4 = (await q(INSERTAR_PROYECTO)).rows[0].id;
  const cancelar = (id) => filas(U.MKT, "update public.rrss_generaciones set estado = 'cancelado', terminado_at = now() where id = $1 and estado in ('pendiente', 'procesando') returning estado", [id]);
  const g3 = await generar(U.MKT, p4, "foto");
  igual(await cancelar(g3.id), [{ estado: "cancelado" }], "no se pudo cancelar una generación pendiente");
  await falla(como(U.MKT, () => q("update public.rrss_generaciones set estado = 'pendiente' where id = $1", [g3.id])), /no puede volver a «pendiente»/,
    "una generación cancelada volvió a «pendiente»");
  await falla(como(U.MKT, () => q("update public.rrss_generaciones set estado = 'procesando', lease_hasta = null where id = $1", [g3.id])), /no vuelve a ejecutarse/,
    "una generación cancelada volvió a ejecutarse");
  const g4 = await generar(U.MKT, p4, "foto");
  igual(g4.estado, "pendiente", "tras cancelar no se pudo pedir otra");
  await como(U.MKT, () => q("update public.rrss_generaciones set estado = 'procesando', intentos = 1, lease_hasta = now() + interval '6 minutes' where id = $1", [g4.id]));
  igual(await cancelar(g4.id), [{ estado: "cancelado" }], "no se pudo cancelar una generación en proceso");
  const g5 = await generar(U.MKT, p4, "foto");
  igual(await filas(U.MKT, "update public.rrss_generaciones set estado = 'error', error = 'Se ha intentado 3 veces sin terminar', terminado_at = now() where id = $1 and estado in ('pendiente', 'procesando') returning estado",
    [g5.id]), [{ estado: "error" }], "el motor no pudo dar por fallida una generación pendiente");
}
// Nadie borra generaciones desde el panel.
await falla(como(U.MKT, () => q("delete from public.rrss_generaciones where id = $1", [g1.id])), /permission denied/, "«Editar» borra generaciones");
igual(await n("select count(*)::int n from public.rrss_generaciones where id = $1", [g1.id]), 1, "«Editar» borró una generación");

// ─── 6. Topes diarios de generaciones (día de Madrid) ───────────────────────
const PSEMILLA = (await q(INSERTAR_PROYECTO)).rows[0].id;
async function sinDisparador(tabla, disparador, sql, params) {
  await db.exec(`alter table public.${tabla} disable trigger ${disparador}`);
  try {
    await q(sql, params);
  } finally {
    await db.exec(`alter table public.${tabla} enable trigger ${disparador}`);
  }
}
// Siembra filas «listo» (no activas) sin pasar por el disparador del tope.
const sembrarGeneraciones = (usuario, medio, cuantas, cuando) => sinDisparador("rrss_generaciones", "rrss_generaciones_cupo",
  `insert into public.rrss_generaciones (proyecto_id, medio, plan, estado, creado_por, created_at)
   select $1, $2, '{}', 'listo', $3, ${cuando} from generate_series(1, $4::int)`, [PSEMILLA, medio, usuario, cuantas]);
const trabajos = async (cuantos) =>
  (await q("insert into public.rrss_proyectos (marca, canal, tipo) select 'touza', 'instagram', 'reel' from generate_series(1, $1::int) returning id", [cuantos]))
    .rows.map((r) => r.id);
const deHoy = (medio, usuario = null) => n(
  `select count(*)::int n from public.rrss_generaciones where medio = $1 and ($2::uuid is null or creado_por = $2) and created_at >= ${DIA}`, [medio, usuario]);

// 20 vídeos por usuario (aunque el cliente mande un created_at viejo).
{
  const ps = await trabajos(21);
  for (let i = 0; i < 20; i++) await generar(U.MKT, ps[i], "video", { atrasada: i % 2 === 0 });
  comprobaciones++;
  igual(await deHoy("video", U.MKT), 20, "los 20 vídeos no cuentan como de hoy");
  await falla(generar(U.MKT, ps[20], "video", { atrasada: true }), /rrss_cupo: has llegado al tope de 20 vídeos por hoy/,
    "pasó el vídeo 21 del día (o un created_at viejo se saltó el tope)");
  igual((await generar(U.MKT, ps[20], "foto")).estado, "pendiente", "el tope de vídeo bloqueó las fotos");
}

// 40 vídeos al día entre todos; lo de ayer no cuenta.
{
  const ps = await trabajos(2);
  await sembrarGeneraciones(U.MKT2, "video", 50, AYER);
  igual((await generar(U.MKT3, ps[0], "video")).estado, "pendiente", "los vídeos de ayer cuentan para el tope total");
  await sembrarGeneraciones(U.MKT2, "video", 40 - (await deHoy("video")), DIA); // justo al empezar el día de Madrid: cuentan
  igual(await deHoy("video"), 40, "la siembra no dejó 40 vídeos hoy");
  await falla(generar(U.MKT3, ps[1], "video"), /rrss_cupo: se ha llegado al tope de 40 vídeos por hoy entre todos/,
    "pasó el vídeo 41 del día entre todos");
  igual((await generar(U.MKT3, ps[1], "foto")).estado, "pendiente", "el tope total de vídeo bloqueó las fotos");
}

// 120 ediciones de fotos por usuario; lo de ayer no cuenta.
{
  const ps = await trabajos(2);
  await sembrarGeneraciones(U.MKT2, "foto", 200, AYER);
  await sembrarGeneraciones(U.MKT2, "foto", 119 - (await deHoy("foto", U.MKT2)), "now()");
  igual((await generar(U.MKT2, ps[0], "foto", { atrasada: true })).estado, "pendiente", "no pasó la foto 120 del día (¿contó lo de ayer?)");
  igual(await deHoy("foto", U.MKT2), 120, "la foto 120 no cuenta como de hoy");
  await falla(generar(U.MKT2, ps[1], "foto"), /rrss_cupo: has llegado al tope de 120 ediciones de fotos por hoy/, "pasó la foto 121 del día");
  igual((await generar(U.MKT3, ps[1], "foto")).estado, "pendiente", "el tope de fotos de uno bloqueó a otro");
}

// ─── 7. Peticiones a la IA: de quien las hace y con tope diario ─────────────
const pedir = (u, { creadoPor = null, atrasada = false, proyecto = P2 } = {}, rol = "authenticated") => como(u, async () => (await q(
  `insert into public.rrss_ia_peticiones (accion, proyecto_id, modelo, ok${creadoPor ? ", creado_por" : ""}${atrasada ? ", created_at" : ""})
   values ('proponer', $1, 'gpt-5.6-luna', true${creadoPor ? `, '${creadoPor}'` : ""}${atrasada ? ", now() - interval '2 days'" : ""})
   returning id::int, creado_por, created_at >= ${DIA} as de_hoy`, [proyecto])).rows[0], rol);
const pet = await pedir(U.MKT, { creadoPor: U.MKT2, atrasada: true });
igual({ creado_por: pet.creado_por, de_hoy: pet.de_hoy }, { creado_por: U.MKT, de_hoy: true },
  "el cliente falseó creado_por o created_at de la petición a la IA");
await falla(pedir(U.VER), /row-level security/, "con «Ver» se gasta IA");
await falla(pedir(U.OTRA), /row-level security/, "otra sección gasta IA");
await falla(pedir(U.BLOQ), /row-level security/, "un usuario bloqueado gasta IA");
await falla(pedir(null, {}, "anon"), /permission denied/, "anon gasta IA");
igual(await como(U.VER, () => n("select count(*)::int n from public.rrss_ia_peticiones")), 1, "con «Ver» no se ven las peticiones a la IA");
igual(await como(U.OTRA, () => n("select count(*)::int n from public.rrss_ia_peticiones")), 0, "otra sección ve las peticiones a la IA");
igual((await filas(U.MKT2, "update public.rrss_ia_peticiones set ok = false where id = $1 returning id", [pet.id])).length, 0,
  "otro usuario cambió la petición a la IA de otro");
igual(await filas(U.MKT, "update public.rrss_ia_peticiones set ok = false where id = $1 returning ok", [pet.id]), [{ ok: false }],
  "quien pidió no pudo anotar el resultado");
// Solo «ok» se cambia: ni el autor, ni la fecha (el cupo), ni la acción.
await falla(como(U.MKT, () => q("update public.rrss_ia_peticiones set creado_por = $2 where id = $1", [pet.id, U.MKT2])), /permission denied/,
  "se pasó una petición a la IA a otro usuario");
await falla(como(U.MKT, () => q("update public.rrss_ia_peticiones set created_at = now() - interval '2 days' where id = $1", [pet.id])), /permission denied/,
  "se cambió la fecha de una petición a la IA (y con ella el cupo)");
await falla(como(U.MKT, () => q("update public.rrss_ia_peticiones set accion = 'ideas', modelo = 'otro' where id = $1", [pet.id])), /permission denied/,
  "se cambió la acción o el modelo de una petición a la IA");
await falla(como(U.MKT, () => q("delete from public.rrss_ia_peticiones where id = $1", [pet.id])), /permission denied/, "se borran peticiones a la IA");
igual(await n("select count(*)::int n from public.rrss_ia_peticiones where id = $1", [pet.id]), 1, "se borró una petición a la IA (y con ella el cupo)");
{
  const sembrarPeticiones = (usuario, cuantas, cuando) => sinDisparador("rrss_ia_peticiones", "rrss_ia_peticiones_cupo",
    `insert into public.rrss_ia_peticiones (accion, creado_por, created_at) select 'textos', $1, ${cuando} from generate_series(1, $2::int)`, [usuario, cuantas]);
  await sembrarPeticiones(U.MKT, 100, AYER);
  await sembrarPeticiones(U.MKT, 78, "now()"); // con la de antes, 79 hoy
  igual((await pedir(U.MKT, { atrasada: true })).de_hoy, true, "no pasó la petición 80 del día (¿contó lo de ayer?)");
  await falla(pedir(U.MKT), /rrss_cupo_ia: has llegado al tope de 80 peticiones a la IA por hoy/, "pasó la petición 81 del día");
  igual((await pedir(U.MKT2)).creado_por, U.MKT2, "el tope de IA de uno bloqueó a otro");
}

// ─── 8. Cubo privado «rrss» ─────────────────────────────────────────────────
{
  const subir = (u, nombre, rol) => como(u, () => q("insert into storage.objects (bucket_id, name) values ('rrss', $1)", [nombre]), rol);
  const objetos = (u, rol, sesionId) => como(u, () => n("select count(*)::int n from storage.objects where bucket_id = 'rrss'"), rol, sesionId);
  const [p, a, g] = [P1.id, randomUUID(), randomUUID()];
  const buenas = [`originales/${p}/${a}.jpg`, `originales/${p}/${a}.mov`, `previas/${p}/${a}.jpg`, `previas/${p}/${a}-hoja.jpg`,
    `audio/${p}/${a}.m4a`, `resultados/${p}/${g}/0.jpg`, `resultados/${p}/${g}/12.mp4`, `resultados/${p}/${g}/0-portada.jpg`];
  for (const r of buenas) await subir(U.MKT, r);
  comprobaciones++;
  for (const mala of ["otra/cosa.jpg", `originales/${p}/${a}.exe`, `originales/${p}/../${a}.jpg`, `previas/${p}/${a}.png`,
    `audio/${p}/${a}.mp3`, `resultados/${p}/${g}/0.png`, `resultados/${p}/${g}/100.jpg`, `resultados/${p}/0.jpg`]) {
    await falla(subir(U.MKT, mala), /row-level security/, `«Editar» subió a una ruta no admitida: ${mala}`);
  }
  igual(await objetos(U.VER), buenas.length, "con «Ver» no se ve el cubo");
  await falla(subir(U.VER, `originales/${p}/${randomUUID()}.jpg`), /row-level security/, "con «Ver» se sube al cubo");
  igual((await filas(U.VER, "update storage.objects set owner = null where bucket_id = 'rrss' returning id")).length, 0, "con «Ver» se cambia el cubo");
  igual((await filas(U.VER, "delete from storage.objects where bucket_id = 'rrss' returning id")).length, 0, "con «Ver» se borra del cubo");
  igual(await objetos(U.OTRA), 0, "otra sección ve el cubo");
  await falla(subir(U.OTRA, `originales/${p}/${randomUUID()}.jpg`), /row-level security/, "otra sección sube al cubo");
  // Usuario bloqueado (con permiso de «Editar») o sesión inexistente: nada, como en las tablas.
  igual(await objetos(U.BLOQ), 0, "un usuario bloqueado ve el cubo");
  igual(await objetos(U.MKT, undefined, "b0000000-0000-0000-0000-0000000000ff"), 0, "con una sesión que no existe se ve el cubo");
  await falla(subir(U.BLOQ, `originales/${p}/${randomUUID()}.jpg`), /row-level security/, "un usuario bloqueado sube al cubo");
  igual((await filas(U.BLOQ, "update storage.objects set owner = null where bucket_id = 'rrss' returning id")).length, 0, "un usuario bloqueado cambia el cubo");
  igual((await filas(U.BLOQ, "delete from storage.objects where bucket_id = 'rrss' returning id")).length, 0, "un usuario bloqueado borra del cubo");
  igual(await n("select count(*)::int n from storage.objects where bucket_id = 'rrss'"), buenas.length, "faltan objetos tras los intentos de borrado");
  igual(await objetos(null, "anon"), 0, "anon ve el cubo");
  await falla(subir(null, `originales/${p}/${randomUUID()}.jpg`, "anon"), /row-level security/, "anon sube al cubo");
  // Sobrescribir (x-upsert) solo dentro de las rutas admitidas.
  await falla(como(U.MKT, () => q("update storage.objects set name = 'otra/cosa.jpg' where bucket_id = 'rrss' and name = $1", [buenas[0]])),
    /row-level security/, "«Editar» movió un objeto a una ruta no admitida");
  igual((await filas(U.MKT, "update storage.objects set owner = auth.uid() where bucket_id = 'rrss' and name = $1 returning id", [buenas[0]])).length, 1,
    "«Editar» no pudo sobrescribir un objeto (x-upsert)");
  igual((await filas(U.MKT, "delete from storage.objects where bucket_id = 'rrss' and name = $1 returning id", [buenas.at(-1)])).length, 1,
    "«Editar» no pudo borrar del cubo");
}

// ─── 9. Borrar un trabajo se lleva sus archivos, generaciones y resultados ──
{
  await filas(U.MKT, ...INSERTAR_ARCHIVO(P2));
  await filas(U.MKT, ...INSERTAR_RESULTADO(P2, g2.id));
  const antes = (await q(`select (select count(*)::int from public.rrss_archivos where proyecto_id = $1) archivos,
    (select count(*)::int from public.rrss_generaciones where proyecto_id = $1) generaciones,
    (select count(*)::int from public.rrss_resultados where proyecto_id = $1) resultados`, [P2])).rows[0];
  ok(antes.archivos === 1 && antes.generaciones === 2 && antes.resultados === 1, `el trabajo no tenía lo esperado antes de borrarlo: ${JSON.stringify(antes)}`);
  igual((await filas(U.MKT, "delete from public.rrss_proyectos where id = $1 returning id", [P2])).length, 1, "«Editar» no pudo borrar el trabajo");
  igual((await q(`select (select count(*)::int from public.rrss_archivos where proyecto_id = $1) archivos,
    (select count(*)::int from public.rrss_generaciones where proyecto_id = $1) generaciones,
    (select count(*)::int from public.rrss_resultados where proyecto_id = $1) resultados`, [P2])).rows[0],
  { archivos: 0, generaciones: 0, resultados: 0 }, "borrar el trabajo dejó archivos, generaciones o resultados");
  igual((await q("select proyecto_id from public.rrss_ia_peticiones where id = $1", [pet.id])).rows, [{ proyecto_id: null }],
    "la petición a la IA no se quedó (sin trabajo) para el cupo");
}

// ─── 10. Auditoría: trabajos, archivos, resultados e ideas; no generaciones ─
{
  igual((await q("select accion, actor from public.audit_log where tabla = 'rrss_proyectos' and detalles->>'id' = $1 order by id", [P1.id])).rows.slice(0, 2),
    [{ accion: "insert", actor: U.MKT }, { accion: "update", actor: U.MKT }], "no se auditó el alta o el cambio del trabajo");
  igual((await q("select accion from public.audit_log where tabla = 'rrss_proyectos' and detalles->>'id' = $1 and accion = 'delete'", [P2])).rows,
    [{ accion: "delete" }], "no se auditó el borrado del trabajo");
  const auditadas = (await q("select distinct tabla from public.audit_log where tabla like 'rrss\\_%' order by 1")).rows.map((r) => r.tabla);
  igual(auditadas, ["rrss_archivos", "rrss_ideas", "rrss_proyectos", "rrss_resultados"], "tablas auditadas de RRSS (las generaciones y peticiones no van)");
}

// ─── 11. Baja de un usuario: su autoría queda NULL, sin referencias colgando ─
// (admin-delete-user borra de auth.users; los «on delete set null» no pueden
// chocar con los disparadores que congelan creado_por).
{
  const pb = (await filas(U.BAJA, "insert into public.rrss_proyectos (marca, canal, tipo) values ('touza', 'instagram', 'reel') returning id"))[0].id;
  const ab = randomUUID();
  await filas(U.BAJA, ...INSERTAR_ARCHIVO(pb, ab));
  const ib = (await filas(U.BAJA, INSERTAR_IDEA.replace("returning creado_por", "returning id")))[0].id;
  const gb = await generar(U.BAJA, pb, "foto");
  await como(U.BAJA, () => q("update public.rrss_generaciones set estado = 'procesando', intentos = 1, lease_hasta = now() + interval '6 minutes' where id = $1", [gb.id]));
  const petb = await pedir(U.BAJA, { proyecto: pb });
  await q("delete from auth.users where id = $1", [U.BAJA]);
  igual((await q(`select (select creado_por from public.rrss_proyectos where id = $1) p, (select creado_por from public.rrss_archivos where id = $2) a,
      (select creado_por from public.rrss_ideas where id = $3) i, (select creado_por from public.rrss_generaciones where id = $4) g,
      (select estado from public.rrss_generaciones where id = $4) estado, (select count(*)::int from public.rrss_ia_peticiones where id = $5) peticiones`,
    [pb, ab, ib, gb.id, petb.id])).rows[0],
  { p: null, a: null, i: null, g: null, estado: "procesando", peticiones: 0 },
  "tras la baja, alguna fila sigue apuntando al usuario (o la generación cambió de estado, o quedaron sus peticiones)");
  igual(await n(`select count(*)::int n from (
      select creado_por from public.rrss_proyectos union all select creado_por from public.rrss_archivos union all select creado_por from public.rrss_ideas
      union all select creado_por from public.rrss_generaciones union all select creado_por from public.rrss_ia_peticiones) t
    where creado_por is not null and not exists (select 1 from auth.users u where u.id = t.creado_por)`), 0, "hay creado_por que apuntan a usuarios que no existen");
}

// ─── 12. Rollback ───────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q(LISTAR_TABLAS)).rows, [], "el rollback dejó tablas de RRSS");
igual((await q(`select to_regprocedure('public.rrss_comprobar_cupo_generacion()') is null a, to_regprocedure('public.rrss_comprobar_cupo_ia()') is null b,
    to_regprocedure('public.rrss_ruta_valida(text)') is null c, to_regprocedure('public.rrss_proteger_generacion()') is null e,
    to_regprocedure('public.rrss_fijar_autor()') is null f, to_regprocedure('public.update_updated_at_column()') is not null d`)).rows[0],
  { a: true, b: true, c: true, d: true, e: true, f: true }, "el rollback dejó funciones de RRSS o borró update_updated_at_column");
igual(await n("select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'rrss\\_%'"), 0, "el rollback dejó políticas del cubo");
igual(await n("select count(*)::int n from public.ia_funciones where funcion = 'rrss-ia'"), 0, "el rollback dejó «rrss-ia» en ia_funciones");
igual(await n("select count(*)::int n from storage.buckets where id = 'rrss'"), 1, "el rollback borró el cubo con ficheros dentro");
await q("delete from storage.objects where bucket_id = 'rrss'");
await db.exec(ROLLBACK); // otra vez, con el cubo ya vacío
igual(await n("select count(*)::int n from storage.buckets where id = 'rrss'"), 0, "el rollback no borró el cubo vacío");
await db.exec(MIGRACION); // se puede volver a aplicar
igual((await q(LISTAR_TABLAS)).rows.map((r) => r.tablename), TABLAS, "no se pudo volver a aplicar tras el rollback");
igual((await q("select public from storage.buckets where id = 'rrss'")).rows, [{ public: false }], "tras el rollback no volvió el cubo privado");
igual(await n("select count(*)::int n from public.ia_funciones where funcion = 'rrss-ia'"), 1, "tras el rollback no volvió «rrss-ia»");

await db.close();
console.log(`rrss: ${comprobaciones} comprobaciones OK`);
