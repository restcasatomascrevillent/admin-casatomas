// Tienda de vinos (escaparate): configuracion_tienda y tienda_marcar_vinos
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:tienda:db
//
// Cubre: la migración REAL 20261103150000 aplicada dos veces (idempotente y
// sin pisar lo editado), que se para si falta algo de lo que depende, la
// fórmula del precio (mismos casos que el panel), la RLS (anon y authenticated
// leen; nadie escribe salvo la sección tienda con edición y sesión de panel
// viva; nadie inserta ni borra), las columnas editables, los CHECK, la
// normalización del trigger, la auditoría, poner y quitar vinos sin pisarse,
// el interruptor del Super Admin y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261103150000_tienda_vinos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261103150000_tienda_vinos_ROLLBACK.sql", "utf8");
const { casos: CASOS_PRECIO } = JSON.parse(await readFile("src/lib/__tests__/fixtures/tienda-precios.json", "utf8"));

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase con lo que ya existe en la demo: permisos por
// sección (has_section_permission / can_*_section, con el super admin siempre
// dentro), sesión de panel viva, "Vinos" y una auditoría reducida.
const VINOS = `create table public."Vinos" (id text primary key, nombre text, categoria text, precio_eur double precision,
    activado boolean, restaurante boolean default true);`;
const ANDAMIAJE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  grant usage on schema public, auth, private to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

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
    public.can_read_section(text), public.can_write_section(text) to anon, authenticated, service_role;
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer set search_path = '' as $f$
    select auth.uid() is not null and exists (
      select 1 from auth.users u where u.id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and exists (select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id')) $f$;
  revoke all on function private.sesion_panel_permitida() from public;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  create table public.audit_log (id bigserial primary key, tabla text, accion text, actor uuid, detalles jsonb);
  create function public.fn_registrar_auditoria() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if auth.uid() is null and auth.role() = 'anon' then
      if TG_OP = 'DELETE' then return old; end if; return new;
    end if;
    insert into public.audit_log (tabla, accion, actor, detalles)
      values (TG_TABLE_NAME, lower(TG_OP), auth.uid(), case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
    if TG_OP = 'DELETE' then return old; end if; return new;
  end $f$;

  create table public.admin_feature_toggles (id uuid primary key default gen_random_uuid(), section_key text not null unique, label text not null, enabled boolean not null default true);
  ${VINOS}
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  EDITA: "a0000000-0000-0000-0000-000000000002",
  VE: "a0000000-0000-0000-0000-000000000003",
  NADA: "a0000000-0000-0000-0000-000000000004",
  BLOQ: "a0000000-0000-0000-0000-000000000005",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.EDITA}', 'edita@t', null), ('${U.VE}', 've@t', null),
    ('${U.NADA}', 'nada@t', null), ('${U.BLOQ}', 'bloq@t', now() + interval '1 day');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.EDITA}', 'tienda', true, true), ('${U.VE}', 'tienda', true, false),
    ('${U.NADA}', 'cheques', true, true), ('${U.BLOQ}', 'tienda', true, true);
`;

// Si falta algo de lo que depende, se para sin crear nada.
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE.replace(VINOS, `create table public."Vinos" (id text primary key, precio_eur double precision, activado boolean);`));
  await assert.rejects(otra.exec(MIGRACION), /falta public\."Vinos"\.restaurante/, "no se paró sin Vinos.restaurante"); comprobaciones++;
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.configuracion_tienda') t")).rows[0].t, null, "la migración abortada dejó la tabla");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(MIGRACION);
await db.exec("update public.configuracion_tienda set aviso = 'Editado por el dueño', descuento_pct = 25");
await db.exec(MIGRACION); // idempotente y sin pisar lo editado
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated", session_id: sesion(u) })}', true);`);
    }
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
const n = async (sql) => (await q(sql)).rows[0].n;

// ─── 1. Estructura, semilla e idempotencia ─────────────────────────────────
const columnas = (await q(`select column_name c from information_schema.columns
  where table_schema = 'public' and table_name = 'configuracion_tienda' order by ordinal_position`)).rows.map((r) => r.c);
igual(columnas, ["id", "activa", "descuento_pct", "vinos_excluidos", "aviso", "recogida", "updated_at", "updated_by"], "columnas del contrato con la web");
const cfg = (await q("select * from public.configuracion_tienda")).rows;
igual(cfg.length, 1, "configuracion_tienda no tiene exactamente una fila");
igual([cfg[0].activa, cfg[0].vinos_excluidos, cfg[0].recogida], [true, [], null], "valores por defecto de la semilla");
igual([cfg[0].aviso, Number(cfg[0].descuento_pct)], ["Editado por el dueño", 25], "reaplicar la migración pisó lo editado");
await assert.rejects(q("insert into public.configuracion_tienda (id) values (false)"), /violates check constraint/, "segunda fila aceptada"); comprobaciones++;
igual((await q("select column_default d from information_schema.columns where table_name = 'configuracion_tienda' and column_name = 'descuento_pct'")).rows[0].d, "30", "descuento por defecto");
igual((await q("select enabled from public.admin_feature_toggles where section_key = 'tienda'")).rows, [{ enabled: true }], "interruptor de Tienda");
igual(await n("select count(*)::int n from public.admin_feature_toggles"), 1, "reaplicar duplicó el interruptor");
igual(await n("select count(*)::int n from pg_trigger where tgrelid = 'public.configuracion_tienda'::regclass and tgname = 'trg_auditoria'"), 1, "configuracion_tienda sin auditoría");
await q("update public.configuracion_tienda set descuento_pct = 30, aviso = null");

// ─── 2. Precio de tienda: los mismos casos que el panel ─────────────────────
for (const c of CASOS_PRECIO) {
  const r = (await q("select public.tienda_precio_venta($1::double precision::numeric, $2) p", [c.precio, c.descuento])).rows[0].p;
  igual(Number(r), c.esperado, `precio de tienda de ${c.precio} con ${c.descuento} %`);
}
igual((await como(null, () => q("select public.tienda_precio_venta(24, 30)::float8 p"), "anon")).rows[0].p, 16.8, "anon no puede calcular el precio");

// ─── 3. Lectura pública, escritura solo con la sección tienda ───────────────
const leida = (await como(null, () => q("select activa, descuento_pct::float8 d, vinos_excluidos, aviso, recogida from public.configuracion_tienda"), "anon")).rows;
igual(leida, [{ activa: true, d: 30, vinos_excluidos: [], aviso: null, recogida: null }], "anon no lee la configuración");
igual((await como(U.NADA, () => q("select count(*)::int n from public.configuracion_tienda"))).rows[0].n, 1, "un usuario del panel sin la sección no la lee");
for (const sql of [
  "update public.configuracion_tienda set descuento_pct = 90",
  "insert into public.configuracion_tienda (id) values (true)",
  "delete from public.configuracion_tienda",
  "truncate public.configuracion_tienda",
]) await rechaza(null, sql, /permission denied/, `anon pudo: ${sql}`, "anon");
igual((await q("select descuento_pct::float8 d from public.configuracion_tienda")).rows[0].d, 30, "anon cambió la configuración");

const editar = (u, set) => como(u, () => q(`update public.configuracion_tienda set ${set} where id returning updated_by`));
igual((await editar(U.NADA, "descuento_pct = 50")).rows.length, 0, "sin la sección tienda cambió la configuración");
igual((await editar(U.VE, "descuento_pct = 50")).rows.length, 0, "con tienda solo «Ver» cambió la configuración");
igual((await editar(U.BLOQ, "descuento_pct = 50")).rows.length, 0, "un usuario bloqueado cambió la configuración");
const auditAntes = await n("select count(*)::int n from public.audit_log where tabla = 'configuracion_tienda'");
igual((await editar(U.EDITA, "descuento_pct = 25, activa = false, recogida = '  De martes a domingo, pregunta en la barra  '")).rows[0].updated_by,
  U.EDITA, "updated_by no es quien editó");
igual(await n(`select count(*)::int n from public.audit_log where tabla = 'configuracion_tienda' and actor = '${U.EDITA}'`), 1, "el cambio no quedó auditado con su autor");
igual(await n("select count(*)::int n from public.audit_log where tabla = 'configuracion_tienda'"), auditAntes + 1, "auditoría de más o de menos");
igual((await q("select recogida, activa from public.configuracion_tienda")).rows[0], { recogida: "De martes a domingo, pregunta en la barra", activa: false }, "recogida sin recortar");
igual((await editar(U.SA, "descuento_pct = 30, activa = true")).rows.length, 1, "el super admin no pudo editar");
await rechaza(U.EDITA, "update public.configuracion_tienda set updated_by = null", /permission denied/, "se falseó updated_by");
await rechaza(U.EDITA, "update public.configuracion_tienda set updated_at = now() - interval '1 year'", /permission denied/, "se falseó updated_at");
await rechaza(U.EDITA, "update public.configuracion_tienda set id = false", /permission denied/, "se cambió el id");
await rechaza(U.SA, "delete from public.configuracion_tienda", /permission denied/, "se borró la configuración desde el panel");
await rechaza(U.SA, "insert into public.configuracion_tienda (id) values (true)", /permission denied/, "se insertó configuración desde el panel");
for (const [set, msg] of [
  ["descuento_pct = 95", "descuento > 90"], ["descuento_pct = -1", "descuento negativo"],
  [`aviso = repeat('x', 501)`, "aviso > 500"], [`recogida = repeat('x', 501)`, "recogida > 500"],
]) {
  await assert.rejects(editar(U.EDITA, set), /violates check constraint/, `${msg} aceptado`); comprobaciones++;
}
await editar(U.EDITA, `vinos_excluidos = array['excluido', ' excluido ', '', 'zzz', 'excluido'], aviso = '   '`);
igual((await q("select vinos_excluidos v, aviso from public.configuracion_tienda")).rows[0], { v: ["excluido", "zzz"], aviso: null }, "el trigger no normalizó");

// ─── 4. Poner y quitar vinos de la venta ────────────────────────────────────
const marcar = (u, ids, venta) => como(u, () => q("select public.tienda_marcar_vinos($1::text[], $2) r", [ids, venta])).then((r) => r.rows[0].r);
igual(await marcar(U.EDITA, ["rioja", "cava"], false), ["cava", "excluido", "rioja", "zzz"], "quitar de la venta");
igual(await marcar(U.EDITA, ["albarino"], false), ["albarino", "cava", "excluido", "rioja", "zzz"], "un segundo cambio pisó el primero");
igual(await marcar(U.SA, ["rioja", "zzz", " ", "rioja", null], true), ["albarino", "cava", "excluido"], "volver a poner a la venta");
igual(await marcar(U.EDITA, ["no_estaba"], true), ["albarino", "cava", "excluido"], "poner a la venta uno que no estaba quitado");
await assert.rejects(marcar(U.VE, ["cava"], true), /No tienes permiso/, "con tienda «Ver» se puso un vino"); comprobaciones++;
await assert.rejects(marcar(U.NADA, ["cava"], true), /No tienes permiso/, "sin la sección tienda se puso un vino"); comprobaciones++;
await assert.rejects(marcar(U.BLOQ, ["cava"], true), /No tienes permiso/, "un usuario bloqueado puso un vino"); comprobaciones++;
await assert.rejects(marcar(U.EDITA, [], false), /no válida/, "lista vacía aceptada"); comprobaciones++;
await assert.rejects(marcar(U.EDITA, ["x"], null), /no válida/, "sin decir si va a la venta"); comprobaciones++;
await rechaza(null, "select public.tienda_marcar_vinos(array['cava'], true)", /permission denied/, "anon puso un vino", "anon");
igual((await q("select vinos_excluidos v from public.configuracion_tienda")).rows[0].v, ["albarino", "cava", "excluido"], "un intento sin permiso cambió la lista");

// ─── 5. Rollback ────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.configuracion_tienda') t")).rows[0].t, null, "el rollback no borró la tabla");
igual(await n("select count(*)::int n from pg_proc where proname in ('tienda_marcar_vinos', 'tienda_precio_venta', 'configuracion_tienda_al_editar')"), 0, "el rollback dejó funciones");
igual(await n("select count(*)::int n from public.admin_feature_toggles where section_key = 'tienda'"), 0, "el rollback dejó el interruptor");
ok((await q(`select to_regclass('public."Vinos"') t`)).rows[0].t !== null, "el rollback tocó Vinos");
await db.exec(MIGRACION); // se puede volver a aplicar
igual((await q("select activa, descuento_pct::float8 d, vinos_excluidos v from public.configuracion_tienda")).rows, [{ activa: true, d: 30, v: [] }], "reaplicar tras el rollback");

await db.close();
console.log(`test-tienda: ${comprobaciones} comprobaciones OK`);
