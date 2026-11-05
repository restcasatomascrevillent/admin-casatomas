// Encargos de Instagram (fase 4): tablas, RPC de estados, permiso de la
// agencia, RLS restaurante/agencia, rondas de cambios, entregas en los cubos,
// la pieza que se crea al aprobar, los avisos (campana y destinatarios del
// push) y el trigger que pasa el encargo a «publicado», contra un Postgres en
// memoria (PGlite) con las migraciones REALES de Instagram. Nunca toca Supabase.
//
//   npm run test:instagram-encargos:db
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const BASE = await leer("supabase/migrations/20261105090000_instagram.sql");
const ANTERIORES = await Promise.all([
  "20261105120000_instagram_fotos",
  "20261105150000_instagram_drive",
  "20261106100000_instagram_metricas",
  "20261106110000_instagram_programacion",
  "20261107000000_instagram_publicacion_servidor",
  "20261107010000_instagram_limpieza_bucket",
  "20261108000000_instagram_ia",
  "20261109000000_instagram_campanas",
  "20261109100000_instagram_video",
].map((m) => leer(`supabase/migrations/${m}.sql`)));
const MIGRACION = await leer("supabase/migrations/20261110100000_instagram_encargos.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261110100000_instagram_encargos_ROLLBACK.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje mínimo de Supabase (el de scripts/test-instagram-campanas.mjs) +
// la campana del panel (notificaciones_dashboard, sección dashboard).
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

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant all on storage.objects, storage.buckets to service_role;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(p_nombre text, p_horario text, p_orden text) returns bigint language sql as $f$
    insert into cron.job (jobname, schedule, command) values (p_nombre, p_horario, p_orden)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
  create function cron.unschedule(p_nombre text) returns boolean language sql as $f$
    with b as (delete from cron.job where jobname = p_nombre returning 1) select exists (select 1 from b) $f$;
  create schema net;
  create table net.peticiones (id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds int);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
    timeout_milliseconds integer default 5000) returns bigint language sql as $f$
    insert into net.peticiones (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id $f$;
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);

  create table public."Platos" (id text primary key, nombre text, categoria text, descripcion text, precio_eur numeric,
    unidad text, featured boolean, activado boolean, restaurante boolean, touza boolean, imagen_url text,
    alergenos_oficiales jsonb, sin_gluten_disponible boolean not null default false);
  create table public.novedades (id uuid primary key default gen_random_uuid(), titulo text not null, tipo text not null,
    descripcion text, activo boolean, fecha_inicio date not null, fecha_fin date, plato_id text);
  grant select on public."Platos", public.novedades to anon, authenticated;

  create table public.notificaciones_dashboard (id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null,
    mensaje text, referencia_id uuid, referencia_tipo text, leida boolean not null default false, created_at timestamptz default now(),
    origen text, prioridad text not null default 'normal');
  alter table public.notificaciones_dashboard enable row level security;
  grant select, insert, update, delete on public.notificaciones_dashboard to authenticated;
  create policy n_select on public.notificaciones_dashboard for select to authenticated using (public.can_read_section('dashboard'));
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  MKT: "a0000000-0000-0000-0000-000000000002",
  AGE: "a0000000-0000-0000-0000-000000000003",
  AGE2: "a0000000-0000-0000-0000-000000000004",
  OTRA: "a0000000-0000-0000-0000-000000000005",
  BLOQ: "a0000000-0000-0000-0000-000000000006",
  VER: "a0000000-0000-0000-0000-000000000007",
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email, banned_until) values
    ('${U.SA}', 'sa@t', null), ('${U.MKT}', 'mkt@t', null), ('${U.AGE}', 'age@t', null), ('${U.AGE2}', 'age2@t', null),
    ('${U.OTRA}', 'otra@t', null), ('${U.BLOQ}', 'bloq@t', now() + interval '1 day'), ('${U.VER}', 'ver@t', null);
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.MKT}', 'marketing', true, true), ('${U.MKT}', 'dashboard', true, true),
    ('${U.AGE}', 'instagram_agencia', true, true), ('${U.AGE2}', 'instagram_agencia', true, true),
    ('${U.OTRA}', 'reservas', true, true),
    ('${U.BLOQ}', 'marketing', true, true), ('${U.BLOQ}', 'instagram_agencia', true, true),
    ('${U.VER}', 'marketing', true, false);
`;

// ─── 0. Sin las migraciones anteriores se para sin crear nada ───────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE);
  await otra.exec(BASE);
  await falla(otra.exec(MIGRACION), /instagram_encargos: falta instagram_piezas\.origen/, "no se paró sin lo anterior");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_encargos') t")).rows[0].t, null, "la migración abortada dejó tablas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
await db.exec(BASE);
for (const m of ANTERIORES) await db.exec(m);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;

async function como(u, fn, rol = "authenticated") {
  await db.exec("begin");
  try {
    if (rol === "anon") await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    else {
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
const rpc = (u, fn, args = []) =>
  como(u, () => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args)).then((r) => r.rows[0].r);
const encargo = async (id) => (await q("select * from public.instagram_encargos where id = $1", [id])).rows[0];
const hoy = (await q("select public.instagram_encargo_hoy()::text d")).rows[0].d;
const enDias = async (d) => (await q("select (public.instagram_encargo_hoy() + $1::int)::text d", [d])).rows[0].d;
const FECHA = await enDias(10);

// ─── 1. Ajustes y días laborables ───────────────────────────────────────────
igual((await q("select plazo_dias_laborables, rondas_incluidas, cupo_mensual from public.instagram_encargos_ajustes")).rows[0],
  { plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }, "ajustes por defecto");
igual((await q("select public.instagram_sumar_dias_laborables('2026-11-06', 1)::text d")).rows[0].d, "2026-11-09", "viernes + 1 laborable");
igual((await q("select public.instagram_sumar_dias_laborables('2026-11-06', 5)::text d")).rows[0].d, "2026-11-13", "viernes + 5 laborables");
igual((await q("select public.instagram_sumar_dias_laborables('2026-11-09', 5)::text d")).rows[0].d, "2026-11-16", "lunes + 5 laborables");
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_encargos_ajustes")), 1, "la agencia no ve los ajustes");
igual(await como(U.OTRA, () => n("select count(*)::int n from public.instagram_encargos_ajustes")), 0, "otra sección ve los ajustes");
await como(U.MKT, () => q("update public.instagram_encargos_ajustes set rondas_incluidas = 9"));
igual(await n("select rondas_incluidas n from public.instagram_encargos_ajustes"), 2, "Marketing cambió los ajustes");

// ─── 2. Sin escritura directa ───────────────────────────────────────────────
await falla(como(U.MKT, () => q("insert into public.instagram_encargos (marca, modo, formato, titulo) values ('touza', 'oficiosos', 'post', 'x')")),
  /permission denied/, "insert directo en encargos");
await falla(como(U.AGE, () => q("update public.instagram_encargos set estado = 'aprobado'")), /permission denied/, "update directo de la agencia");
await falla(como(U.MKT, () => q("insert into public.instagram_encargo_mensajes (encargo_id, lado, texto) values (gen_random_uuid(), 'restaurante', 'x')")),
  /permission denied/, "insert directo en mensajes");
await falla(como(null, () => q("select public.instagram_encargo_guardar(null, '{}'::jsonb)"), "anon"), /permission denied/, "anon guardó");
await falla(como(U.MKT, () => q("select * from public.instagram_encargo_destinatarios(gen_random_uuid())")), /permission denied/, "el panel leyó destinatarios");
await falla(como(U.MKT, () => q("select public.instagram_encargo_lado('restaurante')")), /permission denied/, "el panel llamó a la función interna");

// ─── 3. Guardar (restaurante) ───────────────────────────────────────────────
const DATOS_ENC = {
  marca: "casa-tomas", modo: "oficiosos", formato: "post", titulo: "Setas de temporada",
  idea: "De la cesta al plato", estilo: "Foto y titular", texto: "Llegan las setas",
  fotos: [{ id: "drive:abc", nombre: "Cesta" }, { id: "carta:pulpo", nombre: "Pulpo", miniatura: "https://x.supabase.co/p.jpg" }],
};
const guardar = (u, id, datos) => rpc(u, "instagram_encargo_guardar", [id, JSON.stringify(datos)]);
await falla(guardar(U.AGE, null, DATOS_ENC), /Solo el restaurante/, "la agencia creó un encargo");
await falla(guardar(U.OTRA, null, DATOS_ENC), /Solo el restaurante/, "otra sección creó un encargo");
await falla(guardar(U.VER, null, DATOS_ENC), /Solo el restaurante/, "Marketing sin edición creó un encargo");
await falla(guardar(U.BLOQ, null, DATOS_ENC), /Sesión de panel no válida/, "un bloqueado creó un encargo");
await falla(guardar(U.MKT, null, { ...DATOS_ENC, marca: "otra" }), /Elige la marca/, "marca no válida");
await falla(guardar(U.MKT, null, { ...DATOS_ENC, titulo: "  " }), /título/, "sin título");
await falla(guardar(U.MKT, null, { ...DATOS_ENC, fotos: [{ id: "drive:x", miniatura: "http://192.168.1.1/x.jpg" }] }), /no es válida/, "miniatura sin https");
await falla(guardar(U.MKT, null, { ...DATOS_ENC, fotos: Array.from({ length: 21 }, (_, i) => ({ id: `drive:${i}` })) }), /20 fotos/, "más de 20 fotos");
const g1 = await guardar(U.MKT, null, DATOS_ENC);
const E1 = g1.encargo.id;
igual([g1.encargo.estado, g1.encargo.creado_por, g1.encargo.numero > 0], ["borrador", U.MKT, true], "borrador creado");
igual(await n("select count(*)::int n from public.instagram_encargo_adjuntos where encargo_id = $1", [E1]), 2, "fotos del borrador");

// RLS: la agencia no ve los borradores; otra sección no ve nada.
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_encargos")), 0, "la agencia ve un borrador");
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_encargo_adjuntos")), 0, "la agencia ve fotos de un borrador");
igual(await como(U.OTRA, () => n("select count(*)::int n from public.instagram_encargos")), 0, "otra sección ve encargos");
igual(await como(U.MKT, () => n("select count(*)::int n from public.instagram_encargos")), 1, "el restaurante no ve su borrador");
await falla(rpc(U.AGE, "instagram_encargo_comentar", [E1, "hola"]), /No existe ese encargo/, "la agencia comentó un borrador");

// ─── 4. Enviar ──────────────────────────────────────────────────────────────
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E1]), /fecha deseada/, "envió sin fecha");
await guardar(U.MKT, E1, { ...DATOS_ENC, fecha_deseada: await enDias(-1) });
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E1]), /ya ha pasado/, "envió con fecha pasada");
await guardar(U.MKT, E1, { ...DATOS_ENC, idea: "", fecha_deseada: FECHA });
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E1]), /idea/, "envió sin idea");
await guardar(U.MKT, E1, { ...DATOS_ENC, fecha_deseada: FECHA });
await falla(rpc(U.AGE, "instagram_encargo_enviar", [E1]), /Solo el restaurante/, "la agencia envió");
const env = await rpc(U.MKT, "instagram_encargo_enviar", [E1]);
const prevista = (await q("select public.instagram_sumar_dias_laborables(public.instagram_encargo_hoy(), 5)::text d")).rows[0].d;
igual([env.encargo.estado, env.encargo.fecha_entrega_prevista, env.encargo.rondas_incluidas, env.encargo.fecha_deseada],
  ["enviado", prevista, 2, FECHA], "enviado con plazo estándar");
ok(env.eventoId, "enviar sin evento");
await falla(guardar(U.MKT, E1, DATOS_ENC), /No se puede modificar un encargo en estado «enviado»/, "modificó un enviado");
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E1]), /estado «enviado»/, "envió dos veces");
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_encargos")), 1, "la agencia no ve el enviado");
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_encargo_adjuntos")), 2, "la agencia no ve las fotos");
// Push de «enviado»: a la agencia (los dos usuarios), nunca al que lo hizo.
const dest = async (ev) => (await q("select array_agg(d order by d) a from public.instagram_encargo_destinatarios($1) d", [ev])).rows[0].a ?? [];
igual(await dest(env.eventoId), [U.AGE, U.AGE2], "destinatarios de «enviado»");
igual(await n("select count(*)::int n from public.notificaciones_dashboard"), 0, "la campana avisó al restaurante de su propio envío");

// ─── 5. Transiciones no válidas por rol ─────────────────────────────────────
await falla(rpc(U.MKT, "instagram_encargo_aceptar", [E1, null, null]), /Solo la agencia/, "el restaurante aceptó");
await falla(rpc(U.AGE, "instagram_encargo_aprobar", [E1]), /Solo el restaurante/, "la agencia aprobó");
await falla(rpc(U.AGE, "instagram_encargo_cancelar", [E1, "x"]), /Solo el restaurante/, "la agencia canceló");
await falla(rpc(U.AGE, "instagram_encargo_pedir_cambios", [E1, "x"]), /Solo el restaurante/, "la agencia pidió cambios");
await falla(rpc(U.MKT, "instagram_encargo_entregar", [E1, "x", null, null, null, null, null, null, null]), /Solo la agencia/, "el restaurante entregó");
await falla(rpc(U.AGE, "instagram_encargo_entregar", [E1, "x", null, null, null, null, null, null, null]), /No se puede entregar un encargo en estado «enviado»/, "entregó sin aceptar");
await falla(rpc(U.MKT, "instagram_encargo_aprobar", [E1]), /No se puede aprobar un encargo en estado «enviado»/, "aprobó un enviado");
await falla(rpc(U.AGE, "instagram_encargo_empezar", [E1]), /No se puede empezar/, "empezó sin aceptar");
await falla(rpc(U.BLOQ, "instagram_encargo_aceptar", [E1, null, null]), /Sesión de panel no válida/, "un bloqueado aceptó");

// ─── 6. Aceptar ─────────────────────────────────────────────────────────────
await falla(rpc(U.AGE, "instagram_encargo_aceptar", [E1, await enDias(-2), null]), /anterior a hoy/, "aceptó con entrega en el pasado");
const acep = await rpc(U.AGE, "instagram_encargo_aceptar", [E1, null, "Lo tienes el martes"]);
const esperada = (await q("select greatest(public.instagram_encargo_hoy(), least($1::date, $2::date - 2))::text d", [prevista, FECHA])).rows[0].d;
igual([acep.encargo.estado, acep.encargo.asignado_a, acep.encargo.fecha_entrega], ["aceptado", U.AGE, esperada], "aceptado con fecha por defecto");
igual(await dest(acep.eventoId), [U.MKT], "destinatarios de «aceptado»");
igual(await como(U.MKT, () => n("select count(*)::int n from public.notificaciones_dashboard where tipo = 'instagram_encargo' and referencia_id = $1", [E1])), 1,
  "la campana no avisó al restaurante");
igual(await como(U.MKT, () => n("select count(*)::int n from public.instagram_encargo_mensajes where encargo_id = $1", [E1])), 1, "el comentario al aceptar");

// ─── 7. Hilo ────────────────────────────────────────────────────────────────
const c1 = await rpc(U.MKT, "instagram_encargo_comentar", [E1, "¿Podéis sacar la cesta?", null]);
igual(await dest(c1.eventoId), [U.AGE, U.AGE2], "destinatarios de un mensaje del restaurante");
const c2 = await rpc(U.AGE, "instagram_encargo_comentar", [E1, "Sí", null]);
igual(await dest(c2.eventoId), [U.MKT], "destinatarios de un mensaje de la agencia");
await falla(rpc(U.OTRA, "instagram_encargo_comentar", [E1, "hola", null]), /Sin permiso/, "otra sección comentó");
await falla(rpc(U.MKT, "instagram_encargo_comentar", [E1, "   ", null]), /Escribe algo/, "comentario vacío");
const lados = (await q("select lado from public.instagram_encargo_mensajes where encargo_id = $1 order by created_at", [E1])).rows.map((r) => r.lado);
igual(lados, ["agencia", "restaurante", "agencia"], "lados del hilo");
// El super admin es las dos cosas: decide el lado.
const c3 = await rpc(U.SA, "instagram_encargo_comentar", [E1, "Como agencia", "agencia"]);
igual((await q("select lado from public.instagram_encargo_eventos where id = $1", [c3.eventoId])).rows[0].lado, "agencia", "lado del super admin");

// ─── 8. Entregas en el cubo ─────────────────────────────────────────────────
const JPG = (id, v, h = "abcdef01") => `encargos/${id}/v${v}-${h}.jpg`;
const subir = (u, cubo, ruta) => como(u, () => q("insert into storage.objects (bucket_id, name) values ($1, $2)", [cubo, ruta]));
const entregar = (u, id, ruta, extra = {}) => rpc(u, "instagram_encargo_entregar",
  [id, ruta, extra.portada ?? null, extra.texto ?? null, extra.nota ?? null, extra.bytes ?? null, extra.ancho ?? null, extra.alto ?? null, extra.duracion ?? null]);
await falla(subir(U.OTRA, "instagram", JPG(E1, 1)), /row-level security/, "otra sección subió una entrega");
await falla(subir(U.AGE, "instagram", "piezas/2026-11/x.jpg"), /row-level security/, "la agencia escribió en piezas/");
await falla(subir(U.AGE, "instagram-video", "audio/x.m4a"), /row-level security/, "la agencia escribió en audio/");
await falla(entregar(U.AGE, E1, "piezas/2026-11/x.jpg"), /encargos\/<encargo>/, "entregó una ruta libre");
await falla(entregar(U.AGE, E1, JPG(E1, 1)), /no está subido/, "entregó sin subir");
await subir(U.AGE, "instagram", JPG(E1, 1));
const v1 = await entregar(U.AGE, E1, JPG(E1, 1), { texto: "Llegan las setas 🍄", nota: "Primera versión", ancho: 1080, alto: 1350, bytes: 400000 });
igual([v1.encargo.estado, v1.version], ["para_revisar", 1], "entrega v1");
igual(await dest(v1.eventoId), [U.MKT], "destinatarios de la entrega");
await falla(entregar(U.AGE, E1, JPG(E1, 1)), /No se puede entregar un encargo en estado «para_revisar»/, "entregó dos veces seguidas");

// ─── 9. Rondas de cambios ───────────────────────────────────────────────────
await falla(rpc(U.MKT, "instagram_encargo_pedir_cambios", [E1, " "]), /qué hay que cambiar/, "pidió cambios sin comentario");
const r1 = await rpc(U.MKT, "instagram_encargo_pedir_cambios", [E1, "Más luz"]);
igual([r1.encargo.estado, r1.encargo.rondas_cambios, r1.rondaExtra], ["cambios_pedidos", 1, false], "ronda 1");
await falla(rpc(U.MKT, "instagram_encargo_pedir_cambios", [E1, "otra"]), /estado «cambios_pedidos»/, "pidió cambios dos veces");
const emp = await rpc(U.AGE, "instagram_encargo_empezar", [E1]);
igual(emp.encargo.estado, "en_curso", "empezar tras los cambios");
await falla(entregar(U.AGE, E1, JPG(E1, 1)), /no está subido|ya se entregó/, "reutilizó el fichero de la v1");
for (const [v, h] of [[2, "abcdef02"], [3, "abcdef03"]]) {
  await subir(U.AGE, "instagram", JPG(E1, v, h));
  igual((await entregar(U.AGE, E1, JPG(E1, v, h))).version, v, `entrega v${v}`);
  const r = await rpc(U.MKT, "instagram_encargo_pedir_cambios", [E1, `Cambio ${v}`]);
  igual([r.encargo.rondas_cambios, r.rondaExtra], [v, v > 2], `ronda ${v} (extra ${v > 2})`);
}
ok((await q("select comentario from public.instagram_encargo_eventos where encargo_id = $1 and accion = 'pedir_cambios' order by created_at desc limit 1", [E1]))
  .rows[0].comentario.startsWith("Ronda 3 de 2 incluidas (extra)"), "la ronda extra no queda en el historial");
await subir(U.AGE, "instagram", JPG(E1, 4, "abcdef04"));
await entregar(U.AGE, E1, JPG(E1, 4, "abcdef04"), { texto: "Texto final" });

// ─── 10. Aprobar crea la pieza ──────────────────────────────────────────────
const apr = await rpc(U.MKT, "instagram_encargo_aprobar", [E1]);
igual(apr.encargo.estado, "aprobado", "aprobado");
const pieza = (await q("select * from public.instagram_piezas where id = $1", [apr.piezaId])).rows[0];
igual([pieza.origen, pieza.estado, pieza.formato, pieza.tipo_medio, pieza.imagen_ruta, pieza.caption, pieza.marca, pieza.creado_por],
  ["encargo", "generada", "post", "imagen", JPG(E1, 4, "abcdef04"), "Texto final", "casa-tomas", U.MKT], "pieza del encargo");
igual(apr.encargo.pieza_id, apr.piezaId, "el encargo no apunta a la pieza");
igual(await n("select count(*)::int n from public.instagram_encargo_entregas where encargo_id = $1 and pieza_id = $2 and version = 4", [E1, apr.piezaId]), 1,
  "la versión aprobada no enlaza la pieza");
await falla(rpc(U.MKT, "instagram_encargo_aprobar", [E1]), /estado «aprobado»/, "aprobó dos veces");
await falla(rpc(U.MKT, "instagram_encargo_cancelar", [E1, "x"]), /No se puede cancelar un encargo en estado «aprobado»/, "canceló un aprobado");
// La pieza se puede programar como cualquier otra.
ok((await rpc(U.MKT, "instagram_programar", [apr.piezaId, new Date(Date.now() + 86400000).toISOString(), true])).ok, "no se pudo programar la pieza");

// ─── 11. Publicar la pieza → encargo publicado ──────────────────────────────
await q("update public.instagram_piezas set estado = 'publicada', media_id = '1790', permalink = 'https://instagram.com/p/x' where id = $1", [apr.piezaId]);
const pub = await encargo(E1);
igual([pub.estado, pub.publicado_at instanceof Date], ["publicado", true], "el encargo no pasó a publicado");
igual(await n("select count(*)::int n from public.instagram_encargo_eventos where encargo_id = $1 and accion = 'publicar' and lado = 'sistema'", [E1]), 1, "evento de publicado");

// ─── 12. Rechazar y reenviar; cancelar ──────────────────────────────────────
const E2 = (await guardar(U.MKT, null, { ...DATOS_ENC, titulo: "Navidad", fecha_deseada: FECHA })).encargo.id;
await rpc(U.MKT, "instagram_encargo_enviar", [E2]);
await falla(rpc(U.AGE, "instagram_encargo_rechazar", [E2, ""]), /motivo/, "rechazó sin motivo");
const rec = await rpc(U.AGE, "instagram_encargo_rechazar", [E2, "Faltan fotos del belén"]);
igual([rec.encargo.estado, rec.encargo.motivo], ["rechazado", "Faltan fotos del belén"], "rechazado");
await guardar(U.MKT, E2, { ...DATOS_ENC, titulo: "Navidad con belén", fecha_deseada: FECHA });
const reenv = await rpc(U.MKT, "instagram_encargo_enviar", [E2]);
igual([reenv.encargo.estado, reenv.encargo.motivo, reenv.encargo.titulo], ["enviado", null, "Navidad con belén"], "reenviado");
igual((await q("select accion from public.instagram_encargo_eventos where id = $1", [reenv.eventoId])).rows[0].accion, "reenviar", "evento de reenvío");
await falla(rpc(U.MKT, "instagram_encargo_cancelar", [E2, ""]), /motivo/, "canceló sin motivo");
const can = await rpc(U.MKT, "instagram_encargo_cancelar", [E2, "Ya no hace falta"]);
igual([can.encargo.estado, can.encargo.cerrado_at !== null], ["cancelado", true], "cancelado");
igual(await dest(can.eventoId), [U.AGE, U.AGE2], "destinatarios de la cancelación");
await falla(rpc(U.MKT, "instagram_encargo_cancelar", [E2, "otra vez"]), /estado «cancelado»/, "canceló dos veces");
await falla(rpc(U.AGE, "instagram_encargo_aceptar", [E2, null, null]), /estado «cancelado»/, "aceptó un cancelado");
// Un borrador cancelado se borra.
const E3 = (await guardar(U.MKT, null, DATOS_ENC)).encargo.id;
igual((await rpc(U.MKT, "instagram_encargo_cancelar", [E3, null])).borrado, true, "borrador no borrado");
igual(await n("select count(*)::int n from public.instagram_encargos where id = $1", [E3]), 0, "el borrador sigue");

// ─── 13. Reel a Oficiosos (MP4) ─────────────────────────────────────────────
const E4 = (await guardar(U.MKT, null, { ...DATOS_ENC, formato: "reel", titulo: "Reel del mar", fecha_deseada: FECHA })).encargo.id;
await rpc(U.MKT, "instagram_encargo_enviar", [E4]);
await rpc(U.AGE, "instagram_encargo_aceptar", [E4, await enDias(3), null]);
igual((await encargo(E4)).fecha_entrega.toISOString().slice(0, 10), await enDias(3), "fecha de entrega comprometida");
const MP4 = `reels/2026-11/${E4}-abcdef01.mp4`;
const PORTADA = `reels/2026-11/${E4}-abcdef01.jpg`;
await falla(entregar(U.AGE, E4, JPG(E4, 1)), /MP4/, "un reel entregado como JPEG");
await subir(U.AGE, "instagram-video", MP4);
await falla(entregar(U.AGE, E4, MP4, { duracion: 120 }), /entre 3 y 90/, "reel de 120 s");
await falla(entregar(U.AGE, E4, MP4, { portada: PORTADA }), /portada no está subida/, "portada sin subir");
await subir(U.AGE, "instagram-video", PORTADA);
const vr = await entregar(U.AGE, E4, MP4, { portada: PORTADA, duracion: 18.5, bytes: 12000000, ancho: 1080, alto: 1920 });
igual(vr.encargo.estado, "para_revisar", "reel entregado");
const aprR = await rpc(U.MKT, "instagram_encargo_aprobar", [E4]);
const pr = (await q("select * from public.instagram_piezas where id = $1", [aprR.piezaId])).rows[0];
igual([pr.tipo_medio, pr.formato, pr.video_ruta, pr.portada_ruta, Number(pr.duracion_s), Number(pr.video_bytes), pr.estado, pr.origen],
  ["reel", "reel", MP4, PORTADA, 18.5, 12000000, "generada", "encargo"], "pieza de reel del encargo");

// ─── 14. Automático: imagen ─────────────────────────────────────────────────
const AUTO = { marca: "touza", modo: "automatico", formato: "post", titulo: "Cóctel de otoño", texto: "Nuevo cóctel", fecha_deseada: FECHA, fotos: [] };
const E5 = (await guardar(U.MKT, null, AUTO)).encargo.id;
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E5]), /plantilla/, "automático sin plantilla");
await guardar(U.MKT, E5, { ...AUTO, plantilla: "tz-foto-titular" });
const env5 = await rpc(U.MKT, "instagram_encargo_enviar", [E5]);
igual([env5.encargo.estado, env5.encargo.fecha_entrega_prevista], ["en_curso", null], "automático enviado pasa a en curso");
await falla(rpc(U.AGE, "instagram_encargo_entregar", [E5, "x", null, null, null, null, null, null, null]), /automático/, "la agencia entregó un automático");
const PZ = "c0000000-0000-4000-8000-000000000001";
await como(U.MKT, () => q("insert into public.instagram_piezas (id, marca, plantilla, formato, estado, imagen_ruta, caption) values ($1, 'touza', 'tz-foto-titular', 'post', 'generada', 'piezas/2026-11/x.jpg', 'Nuevo cóctel')", [PZ]));
await falla(rpc(U.AGE, "instagram_encargo_vincular_pieza", [E5, PZ]), /Solo el restaurante/, "la agencia vinculó");
await falla(rpc(U.MKT, "instagram_encargo_vincular_pieza", [E1, PZ]), /estado «publicado»/, "vinculó a un publicado");
const vin = await rpc(U.MKT, "instagram_encargo_vincular_pieza", [E5, PZ]);
igual([vin.encargo.estado, vin.encargo.pieza_id], ["para_revisar", PZ], "automático listo para revisar");
igual(await dest(vin.eventoId), [U.AGE, U.AGE2], "el automático avisa a la agencia (lado restaurante)");
await falla(rpc(U.MKT, "instagram_encargo_pedir_cambios", [E5, "x"]), /editor/, "pidió cambios a un automático");
const apr5 = await rpc(U.MKT, "instagram_encargo_aprobar", [E5]);
igual([apr5.encargo.estado, apr5.piezaId], ["aprobado", PZ], "aprobar un automático enlaza su pieza");
igual((await q("select origen from public.instagram_piezas where id = $1", [PZ])).rows[0].origen, "encargo", "origen de la pieza automática");

// ─── 15. Automático: reel (el trabajador termina el MP4) ────────────────────
const E6 = (await guardar(U.MKT, null, { ...AUTO, marca: "casa-tomas", formato: "reel", base_reel: "del-mar" })).encargo.id;
await rpc(U.MKT, "instagram_encargo_enviar", [E6]);
const REEL = { marca: "casa-tomas", base: "del-mar", escenas: [{ id: "e1", foto: "drive:abc" }], cierre: { frase: "Hola" } };
const enc = (await como(U.MKT, () => q("select public.instagram_render_encolar(null, 'casa-tomas', $1, '{}'::jsonb, 'Del mar') r", [JSON.stringify(REEL)]))).rows[0].r;
const vin6 = await rpc(U.MKT, "instagram_encargo_vincular_pieza", [E6, enc.piezaId]);
igual([vin6.encargo.estado, vin6.encargo.pieza_id], ["en_curso", enc.piezaId], "reel automático en cola");
await falla(rpc(U.MKT, "instagram_encargo_vincular_pieza", [E5, enc.piezaId]), /estado «aprobado»/, "vinculó la misma pieza a otro encargo");
await q("update public.instagram_piezas set video_ruta = $2, video_bytes = 1000, duracion_s = 20, estado = 'generada' where id = $1",
  [enc.piezaId, `reels/2026-11/${enc.piezaId}-abcdef01.mp4`]);
const e6 = await encargo(E6);
igual(e6.estado, "para_revisar", "el MP4 terminado no adelantó el encargo");
igual(await n("select count(*)::int n from public.instagram_encargo_entregas where encargo_id = $1 and pieza_id = $2", [E6, enc.piezaId]), 1, "entrega del reel automático");
igual(await como(U.MKT, () => n("select count(*)::int n from public.notificaciones_dashboard where referencia_id = $1", [E6])), 1, "la campana no avisó del reel automático");

// ─── 16. Cupo mensual (solo el super admin cambia los ajustes) ──────────────
const usados = await n("select count(*)::int n from public.instagram_encargos where modo = 'oficiosos' and enviado_at is not null");
await como(U.SA, () => q("update public.instagram_encargos_ajustes set cupo_mensual = $1, plazo_dias_laborables = 3", [usados]));
igual((await q("select cupo_mensual, plazo_dias_laborables, updated_by from public.instagram_encargos_ajustes")).rows[0],
  { cupo_mensual: usados, plazo_dias_laborables: 3, updated_by: U.SA }, "el super admin no cambió los ajustes");
const E7 = (await guardar(U.MKT, null, { ...DATOS_ENC, titulo: "Uno más", fecha_deseada: FECHA })).encargo.id;
await falla(rpc(U.MKT, "instagram_encargo_enviar", [E7]), /cupo/, "se pasó del cupo");
await como(U.SA, () => q("update public.instagram_encargos_ajustes set cupo_mensual = null"));
const env7 = await rpc(U.MKT, "instagram_encargo_enviar", [E7]);
igual(env7.encargo.fecha_entrega_prevista, (await q("select public.instagram_sumar_dias_laborables(public.instagram_encargo_hoy(), 3)::text d")).rows[0].d,
  "el plazo nuevo no se aplicó");

// ─── 17. Auditoría ──────────────────────────────────────────────────────────
ok(await n("select count(*)::int n from public.audit_log where tabla = 'instagram_encargos'") > 0, "los encargos no se auditan");
ok(hoy.length === 10, "hoy");

// ─── 18. Rollback y volver a aplicar ────────────────────────────────────────
await db.exec(ROLLBACK);
igual((await q("select to_regclass('public.instagram_encargos') t")).rows[0].t, null, "el rollback dejó la tabla");
igual(await n("select count(*)::int n from pg_policies where policyname like 'ig\\_encargos\\_%'"), 0, "el rollback dejó políticas de storage");
igual(await n("select count(*)::int n from pg_trigger where tgname = 'instagram_piezas_avanzar_encargo'"), 0, "el rollback dejó el trigger");
igual(await n("select count(*)::int n from public.instagram_piezas where origen = 'encargo'"), 4, "el rollback borró piezas de encargos");
// Las piezas siguen funcionando sin los encargos.
await q("update public.instagram_piezas set estado = 'publicada' where id = $1", [PZ]);
await db.exec(MIGRACION);
comprobaciones++; // se puede volver a aplicar

await db.close();
console.log(`test-instagram-encargos: ${comprobaciones} comprobaciones OK`);
