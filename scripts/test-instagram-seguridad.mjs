// Bloque A de la evaluación de seguridad de Instagram (migración
// 20261111000000_instagram_seguridad) contra un Postgres en memoria (PGlite)
// con TODAS las migraciones reales de Instagram. Nunca toca Supabase.
//
//   · A2: quien solo VE Marketing lee, pero no crea ni cambia piezas, no sube,
//     no programa, no gasta IA ni encola vídeos; quien EDITA, sí.
//   · A7: la agencia sube solo a sus encargos en curso, con límites, y no lee
//     los reels del restaurante.
//   · A6: el trabajador de render (sección instagram_render) solo reclama,
//     sube SUS ficheros, termina y borra los vídeos viejos huérfanos.
//   · A5: limpieza del cubo de vídeo. A8: cupo de IA atómico, pieza
//     programada o publicada protegida, aviso de encargo una vez.
//
//   npm run test:instagram-seguridad:db
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const leer = (r) => readFile(r, "utf8");
const INSTAGRAM = await Promise.all([
  "20261105090000_instagram",
  "20261105120000_instagram_fotos",
  "20261105150000_instagram_drive",
  "20261106100000_instagram_metricas",
  "20261106110000_instagram_programacion",
  "20261107000000_instagram_publicacion_servidor",
  "20261107010000_instagram_limpieza_bucket",
  "20261108000000_instagram_ia",
  "20261109000000_instagram_campanas",
  "20261109100000_instagram_video",
  "20261110000000_instagram_aprender",
  "20261110100000_instagram_encargos",
].map((m) => leer(`supabase/migrations/${m}.sql`)));
const MIGRACION = await leer("supabase/migrations/20261111000000_instagram_seguridad.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261111000000_instagram_seguridad_ROLLBACK.sql");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Andamiaje de Supabase. OJO: can_write_section mira «view» (como en el panel
// real, 20260918120000) y can_edit_section mira «edit» (20261001170000).
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
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_edit_section(_section text) returns boolean language sql stable security definer set search_path = ''
    as $f$ select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  grant execute on function public.is_super_admin(uuid), public.has_section_permission(uuid, text, text),
    public.can_read_section(text), public.can_write_section(text), public.can_edit_section(text) to authenticated, service_role;
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
    bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid(),
    metadata jsonb, created_at timestamptz not null default now(), unique (bucket_id, name));
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
`;

const U = {
  SA: "a0000000-0000-0000-0000-000000000001",
  EDI: "a0000000-0000-0000-0000-000000000002", // Marketing: ver y editar
  VER: "a0000000-0000-0000-0000-000000000003", // Marketing: solo ver
  AGE: "a0000000-0000-0000-0000-000000000004", // Agencia: ver y editar
  AGV: "a0000000-0000-0000-0000-000000000005", // Agencia: solo ver
  REN: "a0000000-0000-0000-0000-000000000006", // Trabajador de render: solo instagram_render (editar)
  RNV: "a0000000-0000-0000-0000-000000000007", // instagram_render solo ver
};
const sesion = (u) => u.replace(/^a/, "b");
const DATOS = `
  insert into auth.users (id, email) values
    ('${U.SA}', 'sa@t'), ('${U.EDI}', 'edi@t'), ('${U.VER}', 'ver@t'), ('${U.AGE}', 'age@t'), ('${U.AGV}', 'agv@t'),
    ('${U.REN}', 'render@t'), ('${U.RNV}', 'rnv@t');
  insert into auth.sessions (id, user_id) select ('b' || substr(id::text, 2))::uuid, id from auth.users;
  insert into public.super_admins values ('${U.SA}');
  insert into public.user_permissions values
    ('${U.EDI}', 'marketing', true, true), ('${U.VER}', 'marketing', true, false),
    ('${U.AGE}', 'instagram_agencia', true, true), ('${U.AGV}', 'instagram_agencia', true, false),
    ('${U.REN}', 'instagram_render', true, true), ('${U.RNV}', 'instagram_render', true, false);
`;

// ─── 0. Sin can_edit_section se para sin cambiar nada ───────────────────────
{
  const otra = new PGlite();
  await otra.exec(ANDAMIAJE.replace(/create function public\.can_edit_section[\s\S]*?\$f\$;/, "").replace(", public.can_edit_section(text)", ""));
  for (const m of INSTAGRAM) await otra.exec(m);
  await falla(otra.exec(MIGRACION), /instagram_seguridad: falta public\.can_edit_section/, "no se paró sin can_edit_section");
  await otra.exec("rollback");
  igual((await otra.query("select to_regclass('public.instagram_ia_cupo') t")).rows[0].t, null, "la migración abortada dejó tablas");
  await otra.close();
}

const db = new PGlite();
await db.exec(ANDAMIAJE);
await db.exec(DATOS);
for (const m of INSTAGRAM) await db.exec(m);
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const q = (sql, params) => db.query(sql, params);
const n = async (sql, params) => (await q(sql, params)).rows[0].n;

async function como(u, fn) {
  await db.exec("begin");
  try {
    if (u === "service") {
      await db.exec(`set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
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
const rpc = (u, fn, args = []) =>
  como(u, () => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args)).then((r) => r.rows[0].r);
const subir = (u, bucket, nombre, bytes = 1000) =>
  como(u, () => q("insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)", [bucket, nombre, JSON.stringify({ size: bytes })]));
const objeto = (bucket, nombre, horas = 0, bytes = 1000) =>
  q("insert into storage.objects (bucket_id, name, metadata, created_at) values ($1, $2, $3, now() - make_interval(hours => $4))",
    [bucket, nombre, JSON.stringify({ size: bytes }), horas]);
const ve = (u, bucket, nombre) =>
  como(u, () => n("select count(*)::int n from storage.objects where bucket_id = $1 and name = $2", [bucket, nombre]));
const MES = new Date().toISOString().slice(0, 7);

// ─── 1. A2: tablas y cubos ──────────────────────────────────────────────────
const P1 = "c0000000-0000-4000-8000-000000000001";
await como(U.EDI, () => q("insert into public.instagram_piezas (id, marca, plantilla, formato, caption) values ($1, 'touza', 'touza-foto', 'post', 'hola')", [P1]));
igual(await como(U.VER, () => n("select count(*)::int n from public.instagram_piezas")), 1, "quien solo ve no lee las piezas");
await falla(como(U.VER, () => q("insert into public.instagram_piezas (marca, plantilla, formato) values ('touza', 'touza-foto', 'post')")),
  /row-level security/, "quien solo ve creó una pieza");
igual(await como(U.VER, () => (q("update public.instagram_piezas set caption = 'x' where id = $1 returning id", [P1])).then((r) => r.rows.length)), 0, "quien solo ve cambió una pieza");
igual(await como(U.VER, () => (q("delete from public.instagram_piezas where id = $1 returning id", [P1])).then((r) => r.rows.length)), 0, "quien solo ve borró una pieza");
await falla(subir(U.VER, "instagram", `piezas/${MES}/x.jpg`), /row-level security/, "quien solo ve subió al cubo instagram");
await falla(subir(U.VER, "instagram-video", `audio/${P1}.mp3`), /row-level security/, "quien solo ve subió al cubo de vídeo");
await subir(U.EDI, "instagram", `piezas/${MES}/${P1}.jpg`);
comprobaciones++;
await como(U.EDI, () => q("update public.instagram_piezas set imagen_ruta = $2, estado = 'generada' where id = $1", [P1, `piezas/${MES}/${P1}.jpg`]));
igual(await ve(U.VER, "instagram", `piezas/${MES}/${P1}.jpg`), 1, "quien solo ve no ve el cubo");
igual(await como(U.VER, () => (q("delete from storage.objects where bucket_id = 'instagram' returning id")).then((r) => r.rows.length)), 0, "quien solo ve borró del cubo");

// Programar, IA, encolar, campañas y guías: «Editar».
const MANANA = new Date(Date.now() + 26 * 3600_000).toISOString();
await falla(rpc(U.VER, "instagram_programar", [P1, MANANA]), /hace falta «Editar»/, "quien solo ve programó");
await falla(rpc(U.VER, "instagram_ia_reservar_cupo", [5, null]), /hace falta «Editar»/, "quien solo ve gastó IA");
const REEL = { marca: "casa-tomas", base: "del-mar", escenas: [{ id: "e1", foto: "drive:abc" }], cierre: { frase: "Hola" } };
const FOTOS = { "drive:abc": "https://sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/instagram/tmp/x.jpg" };
const encolar = (u, pieza) => rpc(u, "instagram_render_encolar", [pieza, "casa-tomas", JSON.stringify(REEL), JSON.stringify(FOTOS), null, null, null]);
await falla(encolar(U.VER, null), /hace falta «Editar»/, "quien solo ve encoló un vídeo");
await falla(rpc(U.VER, "instagram_descartar_campana", ["c0000000-0000-4000-8000-0000000000ff"]), /hace falta «Editar»/, "quien solo ve descartó una campaña");
igual(await como(U.VER, () => (q("update public.instagram_guias_marca set guia = 'x' returning marca")).then((r) => r.rows.length)), 0, "quien solo ve cambió la guía");
await falla(como(U.VER, () => q("insert into public.instagram_sugerencias_ia (tipo, marca, entrada, salida, modelo) values ('sugerir_texto', 'touza', '{}', '{}', 'm')")),
  /row-level security|violates/, "quien solo ve guardó una sugerencia");
const prog = await rpc(U.EDI, "instagram_programar", [P1, MANANA]);
ok(prog.ok, "quien edita no pudo programar");
const cupo = await rpc(U.EDI, "instagram_ia_reservar_cupo", [2, null]);
igual([cupo.ok, cupo.usadas], [true, 1], "quien edita no pudo reservar cupo de IA");

// Ninguna política ni función de Instagram sigue con can_write_section.
igual(await n(`select count(*)::int n from pg_policies where (tablename like 'instagram%' or tablename = 'marketing_fechas' or policyname like 'ig\\_%')
  and (coalesce(qual, '') like '%can_write_section%' or coalesce(with_check, '') like '%can_write_section%')`), 0, "quedan políticas con can_write_section");

// ─── 2. A8: pieza programada o publicada ────────────────────────────────────
await falla(como(U.EDI, () => q("update public.instagram_piezas set marca = 'casa-tomas' where id = $1", [P1])),
  /publicación programada/, "cambió la marca de una pieza programada");
await falla(como(U.EDI, () => q("update public.instagram_piezas set datos = '{\"a\":1}' where id = $1", [P1])),
  /publicación programada/, "cambió la imagen de una pieza programada");
await como(U.EDI, () => q("update public.instagram_piezas set caption = 'otro texto' where id = $1", [P1]));
comprobaciones++;
igual(await como(U.EDI, () => (q("update storage.objects set metadata = '{}' where bucket_id = 'instagram' and name = $1 returning id", [`piezas/${MES}/${P1}.jpg`])).then((r) => r.rows.length)),
  0, "sustituyó el JPEG de una pieza programada");
igual(await como(U.EDI, () => (q("delete from storage.objects where bucket_id = 'instagram' and name = $1 returning id", [`piezas/${MES}/${P1}.jpg`])).then((r) => r.rows.length)),
  0, "borró el JPEG de una pieza programada");
const idProg = prog.programacion.id;
await rpc(U.EDI, "instagram_cancelar_programacion", [idProg]);
await como(U.EDI, () => q("update public.instagram_piezas set marca = 'casa-tomas' where id = $1", [P1]));
comprobaciones++;
// Publicada (la escribe el servidor): no se borra desde el panel.
await como("service", () => q("update public.instagram_piezas set estado = 'publicada', media_id = '1799', permalink = 'https://instagram.com/p/x' where id = $1", [P1]));
await falla(como(U.EDI, () => q("delete from public.instagram_piezas where id = $1", [P1])), /ya está publicada/, "borró una pieza publicada");
await como("service", () => q("delete from public.instagram_piezas where id = $1", [P1]));
comprobaciones++;
// Publicándose (cerrojo): no se borra.
const P2 = "c0000000-0000-4000-8000-000000000002";
await como(U.EDI, () => q("insert into public.instagram_piezas (id, marca, plantilla, formato) values ($1, 'touza', 'touza-foto', 'post')", [P2]));
await como("service", () => q("select public.instagram_pieza_reservar_publicacion($1, 120, false)", [P2]));
await falla(como(U.EDI, () => q("delete from public.instagram_piezas where id = $1", [P2])), /se está publicando/, "borró una pieza que se publica");

// ─── 3. A8: cupo de IA atómico (cuenta cada intento, también los fallidos) ──
const c2 = await rpc(U.EDI, "instagram_ia_reservar_cupo", [2, null]);
const c3 = await rpc(U.EDI, "instagram_ia_reservar_cupo", [2, null]);
igual([c2.ok, c3.ok, c3.motivo], [true, false, "usuario"], "el cupo por usuario no corta");
const g = await rpc(U.SA, "instagram_ia_reservar_cupo", [50, 2]);
igual([g.ok, g.motivo], [false, "global"], "el tope global no corta");
igual(await como(U.EDI, () => n("select count(*)::int n from public.instagram_ia_cupo")).catch(() => "sin acceso"), "sin acceso", "el panel lee la tabla del cupo");

// ─── 4. A7: agencia ─────────────────────────────────────────────────────────
const FECHA = (await q("select (public.instagram_encargo_hoy() + 10)::text d")).rows[0].d;
const nuevoEncargo = async (formato) => {
  const r = await rpc(U.EDI, "instagram_encargo_guardar", [null, JSON.stringify({ marca: "touza", modo: "oficiosos", formato, titulo: `E ${formato}`, idea: "algo", fecha_deseada: FECHA })]);
  await rpc(U.EDI, "instagram_encargo_enviar", [r.encargo.id]);
  return r.encargo.id;
};
const E1 = await nuevoEncargo("post");
const E2 = await nuevoEncargo("post");
const EV = await nuevoEncargo("reel");
await falla(rpc(U.AGV, "instagram_encargo_aceptar", [E1, null, null]), /«Editar» en Instagram · Agencia/, "la agencia de solo ver aceptó");
await rpc(U.AGE, "instagram_encargo_aceptar", [E1, null, null]);
await rpc(U.AGE, "instagram_encargo_aceptar", [EV, null, null]);
const jpg = (e, i) => `encargos/${e}/v1-${String(i).padStart(8, "0")}.jpg`;
await subir(U.AGE, "instagram", jpg(E1, 1));
comprobaciones++;
await falla(subir(U.AGV, "instagram", jpg(E1, 2)), /row-level security/, "la agencia de solo ver subió");
await falla(subir(U.AGE, "instagram", jpg(E2, 1)), /row-level security/, "la agencia subió a un encargo sin aceptar");
await falla(subir(U.AGE, "instagram", jpg("c0000000-0000-4000-8000-0000000000aa", 1)), /row-level security/, "la agencia subió a un encargo que no existe");
await falla(subir(U.AGE, "instagram", `encargos/${E1}/otra.jpg`), /row-level security/, "la agencia subió con una ruta libre");
await falla(subir(U.AGE, "instagram-video", `reels/${MES}/${E1}-00000001.mp4`), /row-level security/, "la agencia subió vídeo a un encargo de imagen");
await subir(U.AGE, "instagram-video", `reels/${MES}/${EV}-00000001.mp4`, 10 * 1024 * 1024);
comprobaciones++;
for (let i = 2; i <= 20; i++) await subir(U.AGE, "instagram", jpg(E1, i));
await falla(subir(U.AGE, "instagram", jpg(E1, 21)), /row-level security/, "la agencia pasó de 20 ficheros por encargo");
await objeto("instagram-video", `reels/${MES}/${EV}-000000ff.mp4`, 0, 395 * 1024 * 1024);
await falla(subir(U.AGE, "instagram-video", `reels/${MES}/${EV}-00000002.mp4`), /row-level security/, "la agencia pasó de 400 MB por encargo");
// Lee sus entregas, pero no los reels del restaurante.
const PR = "c0000000-0000-4000-8000-000000000003";
await objeto("instagram-video", `reels/${MES}/${PR}-0000000a.mp4`, 48);
igual(await ve(U.AGE, "instagram-video", `reels/${MES}/${PR}-0000000a.mp4`), 0, "la agencia ve los reels del restaurante");
igual(await ve(U.AGE, "instagram-video", `reels/${MES}/${EV}-00000001.mp4`), 1, "la agencia no ve su entrega");
igual(await ve(U.AGV, "instagram", jpg(E1, 1)), 1, "la agencia de solo ver no ve las entregas");
igual(await como(U.AGE, () => n("select count(*)::int n from public.instagram_piezas")), 0, "la agencia ve las piezas del restaurante");

// ─── 5. A6: trabajador de render ────────────────────────────────────────────
const enc = await encolar(U.EDI, null);
const PV = enc.piezaId;
await falla(rpc(U.EDI, "instagram_render_reclamar", [null, null]), /Instagram · Render/, "Marketing reclamó como trabajador");
await falla(rpc(U.RNV, "instagram_render_reclamar", [null, null]), /Instagram · Render/, "render de solo ver reclamó");
const trabajo = (await como(U.REN, () => q("select * from public.instagram_render_reclamar('equipo', null)"))).rows[0];
igual(trabajo.pieza_id, PV, "el trabajador no reclamó el trabajo");
igual(await como(U.REN, () => n("select count(*)::int n from public.instagram_trabajos_render")), 1, "el trabajador no ve la cola");
igual(await como(U.REN, () => n("select count(*)::int n from public.instagram_piezas")), 0, "el trabajador lee las piezas");
await falla(como(U.REN, () => q("insert into public.instagram_piezas (marca, plantilla, formato) values ('touza', 'touza-foto', 'post')")),
  /row-level security/, "el trabajador creó una pieza");
await falla(rpc(U.REN, "instagram_programar", [PV, MANANA]), /hace falta «Editar»/, "el trabajador programó");
await falla(rpc(U.REN, "instagram_ia_reservar_cupo", [5, null]), /hace falta «Editar»/, "el trabajador gastó IA");
await falla(subir(U.REN, "instagram", `piezas/${MES}/x.jpg`), /row-level security/, "el trabajador subió al cubo instagram");
const base = `reels/${MES}/${PV}-${trabajo.id.replace(/-/g, "").slice(0, 8)}`;
await falla(subir(U.REN, "instagram-video", `reels/${MES}/${PR}-${trabajo.id.replace(/-/g, "").slice(0, 8)}.mp4`), /row-level security/, "el trabajador subió a otra pieza");
await falla(subir(U.REN, "instagram-video", `audio/${PV}.mp3`), /row-level security/, "el trabajador subió audio");
// Un vídeo viejo de la misma pieza (de un render anterior) que ya no usa nadie.
const viejo = `reels/2026-10/${PV}-0000beef.mp4`;
await objeto("instagram-video", viejo, 48);
await subir(U.REN, "instagram-video", `${base}.mp4`, 5_000_000);
await subir(U.REN, "instagram-video", `${base}.jpg`, 50_000);
comprobaciones++;
igual(await ve(U.REN, "instagram-video", `reels/${MES}/${PR}-0000000a.mp4`), 0, "el trabajador ve otros reels");
const fin = await rpc(U.REN, "instagram_render_terminar", [trabajo.id, true, null, `${base}.mp4`, `${base}.jpg`, 12, 5_000_000, "[]"]);
igual([fin.piezaAlDia, fin.anteriores], [true, [viejo]], "terminar no devolvió el vídeo anterior");
igual(await como(U.REN, () => (q("delete from storage.objects where bucket_id = 'instagram-video' and name = $1 returning id", [`${base}.mp4`])).then((r) => r.rows.length)),
  0, "el trabajador borró el vídeo en uso");
igual(await como(U.REN, () => (q("delete from storage.objects where bucket_id = 'instagram-video' and name = $1 returning id", [`reels/${MES}/${PR}-0000000a.mp4`])).then((r) => r.rows.length)),
  0, "el trabajador borró un vídeo de otra pieza");
igual(await como(U.REN, () => (q("delete from storage.objects where bucket_id = 'instagram-video' and name = $1 returning id", [viejo])).then((r) => r.rows.length)),
  1, "el trabajador no pudo borrar el vídeo viejo");
await falla(subir(U.REN, "instagram-video", `${base}-2.mp4`), /row-level security/, "el trabajador subió con el trabajo ya cerrado");

// ─── 6. A5: limpieza del cubo de vídeo ──────────────────────────────────────
const PP = "c0000000-0000-4000-8000-000000000004";
const vPub = `reels/2026-09/${PP}-00000001.mp4`;
await q(`insert into public.instagram_piezas (id, marca, plantilla, formato, tipo_medio, estado, media_id, video_ruta, portada_ruta)
  values ($1, 'touza', 'del-mar', 'reel', 'reel', 'publicada', '42', $2, $3)`, [PP, vPub, vPub.replace(".mp4", ".jpg")]);
await q("alter table public.instagram_piezas disable trigger user");
await q("update public.instagram_piezas set publicada_at = now() - interval '31 days' where id = $1", [PP]);
await q("alter table public.instagram_piezas enable trigger user");
await objeto("instagram-video", vPub, 31 * 24);
const huerfano = `reels/2026-09/${PR}-0000000b.mp4`;
await objeto("instagram-video", huerfano, 30);
await objeto("instagram-video", `reels/${MES}/${PR}-0000000c.mp4`, 1); // reciente: se respeta
await objeto("instagram-video", `audio/${PR}.mp3`, 100); // no es de reels/
await falla(rpc(U.EDI, "instagram_video_reclamar_caducados", [30, 24, 100]), /permission denied/, "el panel lanzó la limpieza");
const limpia = (await como("service", () => q("select * from public.instagram_video_reclamar_caducados(30, 24, 100) order by ruta"))).rows;
const rutas = limpia.map((r) => `${r.motivo}:${r.ruta}`);
ok(rutas.includes(`publicada:${vPub}`) && rutas.includes(`publicada:${vPub.replace(".mp4", ".jpg")}`), "no devolvió el reel publicado hace 31 días");
ok(rutas.includes(`huerfano:${huerfano}`), "no devolvió el vídeo huérfano");
ok(rutas.includes(`huerfano:reels/${MES}/${PR}-0000000a.mp4`), "no devolvió el huérfano del restaurante");
ok(!rutas.some((r) => r.includes("0000000c") || r.includes("audio/") || r.includes(`${base}`) || r.includes(`${EV}-0000000`)),
  `devolvió algo que no tocaba: ${rutas.join(", ")}`);
ok((await q("select video_borrado_at from public.instagram_piezas where id = $1", [PP])).rows[0].video_borrado_at, "no marcó video_borrado_at");
igual((await como("service", () => q("select * from public.instagram_video_reclamar_caducados(30, 24, 100) where motivo = 'publicada'"))).rows.length, 0,
  "volvió a devolver el reel publicado");

// ─── 7. A8: aviso del encargo una sola vez ──────────────────────────────────
const ev = (await q("select id from public.instagram_encargo_eventos order by created_at desc limit 1")).rows[0].id;
const marcar = () => q("update public.instagram_encargo_eventos set notificado_at = now() where id = $1 and notificado_at is null returning id", [ev]);
igual([(await marcar()).rows.length, (await marcar()).rows.length], [1, 0], "el aviso se puede marcar dos veces");

// ─── 8. Rollback y vuelta a aplicar ─────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual(await n(`select count(*)::int n from pg_policies where tablename like 'instagram%' and (coalesce(qual, '') like '%can_edit_section%' or coalesce(with_check, '') like '%can_edit_section%')`),
  0, "el rollback dejó can_edit_section");
await db.exec(MIGRACION);
igual(await n(`select count(*)::int n from pg_policies where tablename like 'instagram%' and (coalesce(qual, '') like '%can_write_section%' or coalesce(with_check, '') like '%can_write_section%')`),
  0, "no se volvió a aplicar tras el rollback");

await db.close();
console.log(`test-instagram-seguridad: ${comprobaciones} comprobaciones OK`);
