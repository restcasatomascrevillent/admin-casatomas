// Super Admin › Servicios: servicios_contratados, servicios_uso y sus RPC
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:servicios:db
//
// Cubre: la migración REAL 20261103120000 aplicada dos veces (idempotente y
// sin pisar lo editado), la lista de exclusión de auditoría (servicios_uso sin
// trigger; servicios_contratados auditada), RLS solo super admin (y sesión de
// panel viva), columnas editables, validación de los límites y de las URL,
// quién editó, la última lectura por proveedor, las métricas de Supabase solo
// para service_role y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261103120000_servicios_contratados.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261103120000_servicios_contratados_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase + una versión reducida del sistema de auditoría
// con la MISMA forma de lista de exclusión que 20261007220000/20261009100000
// ('ia_uso', … dentro de NOT IN), para comprobar que la migración la amplía.
const LISTA = `'audit_log','ia_uso','openai_uso_diario','metricas'`;
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema storage;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz, last_sign_in_at timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid, updated_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), name text, metadata jsonb);
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.super_admins (user_id uuid primary key);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  grant execute on function public.is_super_admin(uuid) to authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.envios_email_reserva (id uuid primary key default gen_random_uuid(), resultado text, creado_at timestamptz default now(), enviado_at timestamptz);
  create table public.newsletter_envios (id uuid primary key default gen_random_uuid(), canal text, estado text, total_destinatarios int, created_at timestamptz default now());
  create table public.newsletter_suscriptores (id uuid primary key default gen_random_uuid(), email text, activo boolean);

  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.audit_log (tabla, accion, actor) values (TG_TABLE_NAME, lower(TG_OP), auth.uid());
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;
  create function public.instalar_auditoria_panel() returns void language plpgsql security definer set search_path = public as $f$
  declare r record;
  begin
    for r in select c.relname as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public' and c.relname not in (${LISTA})
    loop
      execute format('drop trigger if exists trg_auditoria on public.%I', r.tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_registrar_auditoria()', r.tabla);
    end loop;
  end $f$;
  create function public.fn_audit_nueva_tabla() returns event_trigger language plpgsql security definer set search_path = pg_catalog as $f$
  declare r record;
  begin
    for r in select c.relname as tabla from pg_event_trigger_ddl_commands() d join pg_class c on c.oid = d.objid
      join pg_namespace n on n.oid = c.relnamespace
      where d.object_type = 'table' and c.relkind = 'r' and n.nspname = 'public' and c.relname not in (${LISTA})
    loop
      execute format('drop trigger if exists trg_auditoria on public.%I', r.tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_registrar_auditoria()', r.tabla);
    end loop;
  end $f$;
  create event trigger audit_panel_nuevas_tablas on ddl_command_end when tag in ('CREATE TABLE') execute function public.fn_audit_nueva_tabla();
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  STAFF: "a0000000-0000-0000-0000-000000000002",
  SA_BLOQ: "a0000000-0000-0000-0000-000000000003",
  SA2: "a0000000-0000-0000-0000-000000000004",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until, last_sign_in_at) values
    ('${U.SA}', 'sa@t', null, now()), ('${U.STAFF}', 'staff@t', null, now() - interval '70 days'),
    ('${U.SA_BLOQ}', 'bloq@t', now() + interval '1 day', null), ('${U.SA2}', 'sa2@t', null, null);
  insert into auth.sessions (id, user_id, updated_at) values
    ('${sesion(U.SA)}', '${U.SA}', now()), ('${sesion(U.STAFF)}', '${U.STAFF}', now() - interval '70 days'),
    ('${sesion(U.SA_BLOQ)}', '${U.SA_BLOQ}', now() - interval '70 days'), ('${sesion(U.SA2)}', '${U.SA2}', now());
  insert into public.super_admins values ('${U.SA}'), ('${U.SA_BLOQ}'), ('${U.SA2}');
  insert into storage.objects (name, metadata) values ('a.jpg', '{"size": 1000}'), ('b.jpg', '{"size": 2500}'), ('c', '{"size": "x"}'), ('d', null);
  insert into public.envios_email_reserva (resultado, enviado_at) values
    ('enviado', now()), ('enviado', now()), ('fallido', now()), ('enviado', now() - interval '40 days'), ('pendiente', null);
  insert into public.newsletter_envios (canal, estado, total_destinatarios) values
    ('transaccional', 'completado', 7), ('transaccional', 'fallido', 50), ('broadcast', 'completado', 300);
  insert into public.newsletter_suscriptores (email, activo) values ('x@t', true), ('y@t', true), ('z@t', false);
`;

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "service_role") await db.exec("set local role service_role;");
    else if (rol === "anon") await db.exec("set local role anon;");
    else await db.exec(`set local role authenticated;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    throw e;
  }
}
const rechaza = async (u, sql, patron, msg, rol) => {
  await assert.rejects(como(u, () => q(sql), rol), patron, msg);
  comprobaciones++;
};

// 1. Auditoría: la lista de exclusión crece y solo se audita la configuración.
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await q(`select pg_get_functiondef('public.${fn}'::regproc) d`)).rows[0].d;
  ok(def.includes("'servicios_uso'"), `${fn} no excluye servicios_uso`);
  igual(def.split("'servicios_uso'").length - 1, 1, `${fn}: servicios_uso repetido tras aplicar dos veces`);
}
const triggers = async (tabla) => (await q(`select count(*)::int n from pg_trigger where tgrelid = 'public.${tabla}'::regclass and tgname = 'trg_auditoria'`)).rows[0].n;
igual(await triggers("servicios_contratados"), 1, "servicios_contratados sin trigger de auditoría");
igual(await triggers("servicios_uso"), 0, "servicios_uso con trigger de auditoría (es un dato derivado)");
await q("select public.instalar_auditoria_panel()");
igual(await triggers("servicios_uso"), 0, "reinstalar la auditoría vuelve a poner el trigger en servicios_uso");

// 2. Semilla.
const proveedores = (await q("select proveedor from public.servicios_contratados order by proveedor")).rows.map((r) => r.proveedor);
igual(proveedores, ["github", "resend", "stripe", "supabase", "vercel"], "semilla de proveedores");
const vercel = (await q("select * from public.servicios_contratados where proveedor = 'vercel'")).rows[0];
igual([vercel.plan, Number(vercel.precio_mensual), vercel.ciclo], ["Hobby", 0, "gratuito"], "plan de Vercel");
igual(vercel.limites.peticiones_cdn.limite, 1000000, "límite de peticiones de Vercel");
ok(/^https:\/\/vercel\.com\/docs\//.test(vercel.limites.peticiones_cdn.fuente), "límite de Vercel sin fuente oficial");
igual((await q("select limites->'bd_tamano'->>'limite' l from public.servicios_contratados where proveedor = 'supabase'")).rows[0].l, "500", "límite de BD de Supabase");
igual((await q("select limites from public.servicios_contratados where proveedor = 'stripe'")).rows[0].limites, {}, "Stripe no tiene límites");

// 3. RLS: solo super admin con sesión viva.
igual((await como(U.SA, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 5, "el super admin no ve los servicios");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 0, "un usuario normal ve los servicios");
igual((await como(U.SA_BLOQ, () => q("select count(*)::int n from public.servicios_contratados"))).rows[0].n, 0, "un super admin bloqueado ve los servicios");
await rechaza(null, "select * from public.servicios_contratados", /permission denied/, "anon lee los servicios", "anon");

// 4. Edición: columnas permitidas, quién y cuándo, y auditoría.
const antes = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados'")).rows[0].n;
const editado = await como(U.SA, () => q(`update public.servicios_contratados set plan = 'Pro', precio_mensual = 20, notas = 'Subimos de plan',
  limites = jsonb_set(limites, '{peticiones_cdn,limite}', '10000000') where proveedor = 'vercel' returning plan, actualizado_por, actualizado_en`));
igual(editado.rows.length, 1, "el super admin no pudo editar");
igual(editado.rows[0].actualizado_por, U.SA, "actualizado_por no es quien editó");
ok(new Date(editado.rows[0].actualizado_en) >= new Date(vercel.actualizado_en), "actualizado_en no avanza");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados'")).rows[0].n, antes + 1, "la edición no quedó auditada");
igual((await como(U.STAFF, () => q("update public.servicios_contratados set plan = 'X' where proveedor = 'vercel' returning 1"))).rows.length, 0, "un usuario normal editó");
igual((await como(U.SA_BLOQ, () => q("update public.servicios_contratados set plan = 'X' where proveedor = 'vercel' returning 1"))).rows.length, 0, "un super admin bloqueado editó");
await rechaza(U.SA, "update public.servicios_contratados set proveedor = 'otro' where proveedor = 'vercel'", /permission denied/, "se cambió el proveedor");
await rechaza(U.SA, "update public.servicios_contratados set actualizado_por = null where proveedor = 'vercel'", /permission denied/, "se falseó actualizado_por");
await rechaza(U.SA, "insert into public.servicios_contratados (proveedor, nombre) values ('nuevo', 'Nuevo')", /permission denied/, "el super admin dio de alta un proveedor");
await rechaza(U.SA, "delete from public.servicios_contratados where proveedor = 'stripe'", /permission denied/, "el super admin borró un proveedor");
await assert.rejects(q("update public.servicios_contratados set proveedor = 'otro' where proveedor = 'vercel'"), /no se puede cambiar/, "service_role cambió el proveedor"); comprobaciones++;

// 5. Validación.
const invalido = async (set, msg) => {
  await assert.rejects(como(U.SA, () => q(`update public.servicios_contratados set ${set} where proveedor = 'github'`)), /violates check constraint/, msg);
  comprobaciones++;
};
await invalido(`limites = '{"x": {"limite": -1}}'`, "límite negativo aceptado");
await invalido(`limites = '{"x": {"limite": "mucho"}}'`, "límite de texto aceptado");
await invalido(`limites = '{"Mayus": {"limite": 1}}'`, "clave de métrica con mayúsculas aceptada");
await invalido(`limites = '{"x": {"limite": 1, "fuente": "http://inseguro.test"}}'`, "fuente sin https aceptada");
await invalido(`limites = '{"x": {"limite": 1, "fuente": "javascript:alert(1)"}}'`, "fuente javascript: aceptada");
await invalido(`limites = '[]'`, "límites que no son un objeto aceptados");
await invalido(`panel_url = 'javascript:alert(1)'`, "enlace al panel sin https aceptado");
await invalido(`precio_mensual = -5`, "precio negativo aceptado");
await invalido(`moneda = 'euros'`, "moneda no ISO aceptada");
await invalido(`ciclo = 'semanal'`, "ciclo desconocido aceptado");
await invalido(`nombre = '  '`, "nombre vacío aceptado");
const valido = await como(U.SA, () => q(`update public.servicios_contratados set limites = '{"a": {"limite": null, "etiqueta": "Sin dato"}, "b": {"limite": 2.5, "unidad": "GB", "fuente": "https://docs.github.com/x", "orden": 1}}' where proveedor = 'github' returning limites`));
igual(valido.rows[0].limites.a.limite, null, "límite vacío (sin dato) rechazado");

// 6. Lecturas: solo service_role escribe; la última por proveedor.
await rechaza(U.SA, "insert into public.servicios_uso (proveedor, metricas) values ('vercel', '{}')", /permission denied/, "el navegador escribió una lectura");
await como(null, () => q(`insert into public.servicios_uso (proveedor, tomado_en, metricas, error, detalles) values
  ('vercel', now() - interval '1 hour', '{"peticiones_cdn": {"valor": 1}}', null, '{}'),
  ('vercel', now() - interval '5 minutes', '{"peticiones_cdn": {"valor": 2}}', null, '{}'),
  ('resend', now(), '{}', 'falta_secreto', '{"secreto": "RESEND_API_KEY"}')`), "service_role");
await assert.rejects(como(null, () => q("insert into public.servicios_uso (proveedor, error) values ('vercel', 'Mensaje con espacios')"), "service_role"), /violates check constraint/, "error libre aceptado (solo códigos)"); comprobaciones++;
const ultimas = (await como(U.SA, () => q("select proveedor, metricas, error, detalles from public.servicios_uso_ultimas() order by proveedor"))).rows;
igual(ultimas.map((r) => r.proveedor), ["resend", "vercel"], "última lectura por proveedor");
igual(ultimas[1].metricas.peticiones_cdn.valor, 2, "servicios_uso_ultimas no devuelve la más reciente");
igual(ultimas[0].detalles.secreto, "RESEND_API_KEY", "detalles de la lectura");
igual((await como(U.STAFF, () => q("select count(*)::int n from public.servicios_uso_ultimas()"))).rows[0].n, 0, "un usuario normal ve las lecturas");
igual((await como(U.SA_BLOQ, () => q("select count(*)::int n from public.servicios_uso"))).rows[0].n, 0, "un super admin bloqueado ve las lecturas");
igual((await q("select count(*)::int n from public.audit_log where tabla = 'servicios_uso'")).rows[0].n, 0, "las lecturas se auditan");

// 7. Métricas de Supabase: solo service_role.
await rechaza(U.SA, "select public.servicios_metricas_supabase()", /permission denied/, "el navegador llamó a servicios_metricas_supabase");
const m = (await como(null, () => q("select public.servicios_metricas_supabase() m"), "service_role")).rows[0].m;
ok(m.bd_bytes > 0, "sin tamaño de BD");
igual([m.storage_bytes, m.storage_objetos], [3500, 4], "Storage mal sumado (tamaños raros cuentan 0)");
igual(m.usuarios_activos_mes, 2, "usuarios activos del mes (inicio de sesión o sesión renovada este mes)");
igual(m.usuarios_total, 4, "usuarios totales");
igual([m.correos_reservas_mes, m.correos_reservas_hoy], [2, 2], "correos de reservas enviados");
igual([m.correos_newsletter_mes, m.contactos_newsletter], [7, 2], "newsletter transaccional y contactos activos");

// 8. Rollback y reaplicación.
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.servicios_contratados') t, to_regclass('public.servicios_uso') u, to_regprocedure('public.servicios_metricas_supabase()') f")).rows[0], { t: null, u: null, f: null }, "el rollback deja restos");
await db.exec(MIGRACION);
igual((await q("select count(*)::int n from public.servicios_contratados")).rows[0].n, 5, "no se pudo reaplicar tras el rollback");

// 9. Sin el event trigger (como la demo, copia de producción): la migración
// pone igualmente trg_auditoria en la configuración, y solo uno.
await db.exec("drop event trigger audit_panel_nuevas_tablas");
await db.exec(ROLLBACK);
await db.exec(MIGRACION);
igual(await triggers("servicios_contratados"), 1, "sin event trigger, servicios_contratados queda sin auditar");
igual(await triggers("servicios_uso"), 0, "sin event trigger, servicios_uso acabó auditada");
await db.exec(MIGRACION);
igual((await q("select count(*)::int n from pg_trigger where tgrelid = 'public.servicios_contratados'::regclass and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure")).rows[0].n, 1, "trigger de auditoría duplicado al reaplicar");
const antesSemilla = (await q("select count(*)::int n from public.audit_log where tabla = 'servicios_contratados' and accion = 'insert'")).rows[0].n;
ok(antesSemilla >= 5, "la semilla no quedó auditada (el trigger debe ir antes de la semilla)");

// 10. Reaplicar con datos no pisa lo editado.
await como(U.SA, () => q("update public.servicios_contratados set plan = 'Pro' where proveedor = 'resend'"));
await db.exec(MIGRACION);
igual((await q("select plan from public.servicios_contratados where proveedor = 'resend'")).rows[0].plan, "Pro", "reaplicar la migración pisó el plan editado");

console.log(`servicios_contratados (PGlite): ${comprobaciones} comprobaciones OK`);
