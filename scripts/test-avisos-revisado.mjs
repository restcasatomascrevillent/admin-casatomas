// Avisos: «Revisado» por sección y fuera el aviso «sin mesa» (11/11/2026). La migración REAL
// 20261124100000 y su rollback contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:avisos-revisado:db
//
// Reproduce las políticas de `notificaciones_dashboard` de producción (leer = ver «dashboard»,
// editar = editar «dashboard», la restrictiva de sesión bloqueada y la de modelos de IA) y el cron
// `reservas-aviso-sin-asignar`. Cubre: el fallo de antes (con Reservas y el panel solo en «Ver», el
// UPDATE no cambia nada y no da error); que la RPC marca los avisos de las secciones que se ven y
// solo esos; «Marcar todos» por tipos y la campana (sin filtros); sin sesión, sesión bloqueada y
// anon; los avisos de IA solo el super admin; la lectura por sección (Facturas sin el panel ve los
// suyos); que se quita el cron y se dan por revisados los «sin mesa»; y el rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261124100000_avisos_revisado_por_seccion.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261124100000_avisos_revisado_por_seccion_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const igual = (valor, esperado, nombre) => { assert.deepEqual(valor, esperado, nombre); comprobaciones++; };
const falla = async (promesa, patron, nombre) => { await assert.rejects(promesa, patron, nombre); comprobaciones++; };

const RESERVAS = "10000000-0000-0000-0000-000000000001"; // Reservas (editar) y el panel solo «Ver»: el caso del fallo
const FACTURAS = "20000000-0000-0000-0000-000000000002"; // Solo Facturas, sin el panel principal
const PANEL = "30000000-0000-0000-0000-000000000003"; // Editar el panel principal (y nada más)
const AJENO = "40000000-0000-0000-0000-000000000004"; // Sin ningún permiso
const SUPER = "50000000-0000-0000-0000-000000000005";
const BLOQUEADO = "60000000-0000-0000-0000-000000000006"; // Reservas, pero su sesión está bloqueada

const db = new PGlite();
const filas = async (texto, params) => (await db.query(texto, params)).rows;
const una = async (texto, params) => (await filas(texto, params))[0];

/** Ejecuta `fn` como usuario autenticado del panel (o sin sesión con `null`) y vuelve a superusuario. */
async function como(usuario, fn) {
  await db.exec(`set role authenticated; set test.actor = '${usuario ?? ""}';`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; set test.actor = '';");
  }
}
const marcar = (ids, tipos) =>
  una(`select public.marcar_avisos_revisados($1::uuid[], $2::text[]) as n`, [ids ?? null, tipos ?? null]).then((r) => r.n);
const leida = async (titulo) => (await una(`select leida from public.notificaciones_dashboard where titulo = $1`, [titulo])).leida;
const idDe = async (titulo) => (await una(`select id from public.notificaciones_dashboard where titulo = $1`, [titulo])).id;
const sinRevisar = async () => (await filas(`select titulo from public.notificaciones_dashboard where not leida order by titulo`)).map((f) => f.titulo);

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema private; create schema cron;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  grant usage on schema auth, private, cron to authenticated, anon;

  -- Permisos por sección como en el panel.
  create table public.super_admins (user_id uuid primary key);
  insert into public.super_admins values ('${SUPER}');
  create table public.user_permissions (user_id uuid, section_key text, can_view boolean, can_edit boolean);
  insert into public.user_permissions values
    ('${RESERVAS}', 'reservas', true, true), ('${RESERVAS}', 'dashboard', true, false),
    ('${FACTURAS}', 'facturas', true, true),
    ('${PANEL}', 'dashboard', true, true),
    ('${BLOQUEADO}', 'reservas', true, true), ('${BLOQUEADO}', 'dashboard', true, true);
  create function public.is_super_admin(_user_id uuid) returns boolean language sql stable security definer set search_path = public as $f$
    select exists (select 1 from public.super_admins where user_id = _user_id) $f$;
  create function public.has_section_permission(_user_id uuid, _section text, _permission text) returns boolean
    language sql stable security definer set search_path = public as $f$
    select case when public.is_super_admin(_user_id) then true else exists (
      select 1 from public.user_permissions where user_id = _user_id and section_key = _section
        and ((_permission = 'view' and can_view) or (_permission = 'edit' and can_edit))) end $f$;
  create function public.can_read_section(_section text) returns boolean language sql stable security definer set search_path = public as $f$
    select public.has_section_permission((select auth.uid()), _section, 'view') $f$;
  create function public.can_write_section(_section text) returns boolean language sql stable security definer set search_path = public as $f$
    select public.has_section_permission((select auth.uid()), _section, 'edit') $f$;
  -- Sesión bloqueada (la del panel: private.sesion_panel_permitida).
  create function private.sesion_panel_permitida() returns boolean language sql stable security definer as $f$
    select coalesce(nullif(current_setting('test.actor', true), '')::uuid, '00000000-0000-0000-0000-000000000000') <> '${BLOQUEADO}' $f$;
  grant execute on function private.sesion_panel_permitida() to authenticated;

  -- Cron de pg_cron, lo justo para schedule/unschedule.
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_nombre text, p_cuando text, p_orden text) returns bigint language sql as $f$
    insert into cron.job (jobname, schedule, command) values (p_nombre, p_cuando, p_orden) returning jobid $f$;
  create function cron.unschedule(p_id bigint) returns boolean language sql as $f$
    with b as (delete from cron.job where jobid = p_id returning 1) select exists (select 1 from b) $f$;
  select cron.schedule('reservas-aviso-sin-asignar', '*/15 * * * *', ' select public.fn_avisar_reservas_sin_asignar(); ');

  -- notificaciones_dashboard con las políticas de producción (11/11/2026).
  create table public.notificaciones_dashboard (
    id uuid primary key default gen_random_uuid(), tipo text not null, titulo text not null, mensaje text,
    leida boolean not null default false, referencia_id uuid, referencia_tipo text, datos jsonb,
    created_at timestamptz not null default now()
  );
  alter table public.notificaciones_dashboard enable row level security;
  create policy acceso_panel_no_bloqueado on public.notificaciones_dashboard as restrictive for all to authenticated
    using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  create policy notificaciones_dashboard_select_seccion on public.notificaciones_dashboard for select to authenticated
    using ((select public.can_read_section('dashboard')));
  create policy notificaciones_dashboard_update_seccion on public.notificaciones_dashboard for update to authenticated
    using ((select public.can_write_section('dashboard'))) with check ((select public.can_write_section('dashboard')));
  create policy notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard as restrictive for all to authenticated
    using ((tipo !~~ 'ia\\_modelo%' or (select public.is_super_admin((select auth.uid())))))
    with check ((tipo !~~ 'ia\\_modelo%' or (select public.is_super_admin((select auth.uid())))));
  grant select, insert, update, delete on public.notificaciones_dashboard to authenticated;

  insert into public.notificaciones_dashboard (tipo, titulo) values
    ('reserva_nueva', 'nueva-1'), ('reserva_nueva', 'nueva-2'), ('reserva_nueva', 'nueva-3'), ('reserva_nueva', 'nueva-4'),
    ('reserva_cancelada', 'cancelada-1'),
    ('reserva_sin_asignar', 'sin-mesa-1'), ('reserva_sin_asignar', 'sin-mesa-2'),
    ('facturas_precio_sube', 'factura-1'), ('subida_precio', 'factura-2'),
    ('ia_modelo_nuevo', 'ia-1'),
    ('sistema', 'sistema-1');
`);

// ─── 0. Antes de la migración: el fallo ─────────────────────────────────────────────────────────
await como(RESERVAS, async () => {
  const r = await db.query(`update public.notificaciones_dashboard set leida = true where titulo = 'nueva-1'`);
  igual(r.affectedRows, 0, "antes: con el panel solo en «Ver», «Revisado» no cambia nada (y no da error)");
});
igual(await leida("nueva-1"), false, "antes: el aviso sigue sin revisar");
await como(FACTURAS, async () => {
  igual((await filas(`select 1 from public.notificaciones_dashboard`)).length, 0, "antes: Facturas sin el panel no ve ningún aviso");
});

// ─── 1. Se aplica (dos veces: es idempotente) ───────────────────────────────────────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);
igual((await filas(`select 1 from cron.job where jobname = 'reservas-aviso-sin-asignar'`)).length, 0, "se quita el cron del aviso «sin mesa»");
igual([await leida("sin-mesa-1"), await leida("sin-mesa-2")], [true, true], "los «sin mesa» que quedaban se dan por revisados");
igual((await una(`select has_function_privilege('anon', 'public.marcar_avisos_revisados(uuid[], text[])', 'EXECUTE') as p`)).p, false, "anon no puede marcar avisos");
igual((await una(`select has_function_privilege('authenticated', 'public.marcar_avisos_revisados(uuid[], text[])', 'EXECUTE') as p`)).p, true, "authenticated sí");
igual(
  (await filas(`select public.seccion_aviso(t) as s from unnest(array['reserva_nueva','reserva_cancelada','facturas_precio_sube','subida_precio','original_sin_drive','ia_modelo_nuevo','instagram_encargo']) t`)).map((f) => f.s),
  ["reservas", "reservas", "facturas", "facturas", "facturas", "dashboard", "dashboard"],
  "cada tipo de aviso va a su sección",
);

// ─── 2. «Revisado» con Reservas y el panel solo en «Ver» ────────────────────────────────────────
const nueva1 = await idDe("nueva-1");
const factura1 = await idDe("factura-1");
await como(RESERVAS, async () => {
  igual(await marcar([nueva1]), 1, "con Reservas, «Revisado» marca el aviso de reserva");
  igual(await marcar([nueva1]), 0, "marcarlo otra vez no cuenta (ya estaba revisado)");
  igual(await marcar([factura1]), 0, "un aviso de Facturas no lo marca quien no ve Facturas");
});
igual([await leida("nueva-1"), await leida("factura-1")], [true, false], "solo cambia el de reservas");

// «Marcar todos» de la sección: solo esos tipos.
await como(RESERVAS, async () => {
  igual(await marcar(null, ["reserva_nueva", "reserva_cancelada"]), 4, "«Marcar todos» de Reservas marca los cuatro que quedaban");
});
igual(await sinRevisar(), ["factura-1", "factura-2", "ia-1", "sistema-1"], "los de otras secciones siguen sin revisar");

// ─── 3. Facturas sin el panel: ve y marca solo los suyos ────────────────────────────────────────
await como(FACTURAS, async () => {
  igual(
    (await filas(`select titulo from public.notificaciones_dashboard order by titulo`)).map((f) => f.titulo),
    ["factura-1", "factura-2"],
    "Facturas sin el panel ve los avisos de Facturas (y solo esos)",
  );
  igual(await marcar(), 2, "la campana (sin filtros) marca solo lo que ve: los dos de Facturas");
});
igual(await sinRevisar(), ["ia-1", "sistema-1"], "el de sistema y el de IA siguen sin revisar");

// ─── 4. Sin permisos, sin sesión, sesión bloqueada ──────────────────────────────────────────────
await db.exec(`update public.notificaciones_dashboard set leida = false where titulo in ('nueva-2', 'factura-1')`);
await como(AJENO, async () => {
  igual(await marcar(), 0, "sin permisos no marca nada");
  igual((await filas(`select 1 from public.notificaciones_dashboard`)).length, 0, "y no ve ningún aviso");
});
const nueva2 = await idDe("nueva-2");
await como(null, async () => {
  await falla(marcar([nueva2]), /iniciar sesión/, "sin sesión no se marca");
});
await como(BLOQUEADO, async () => {
  await falla(marcar(null, ["reserva_nueva"]), /no permitida/, "con la sesión bloqueada no se marca");
});
igual(await leida("nueva-2"), false, "nueva-2 sigue sin revisar");
await db.exec(`set role anon;`);
await falla(db.query(`select public.marcar_avisos_revisados(null, null)`), /permission denied/, "anon no puede llamar a la RPC");
await db.exec(`reset role;`);

// ─── 5. Avisos de modelos de IA: solo el super admin ────────────────────────────────────────────
await como(PANEL, async () => {
  igual(await marcar(), 1, "editar el panel marca solo el de sistema (ni reservas, ni facturas, ni IA)");
});
igual(await sinRevisar(), ["factura-1", "ia-1", "nueva-2"], "PANEL no toca el de IA ni los de secciones que no ve");
await como(SUPER, async () => {
  igual(await marcar(), 3, "el super admin marca todo, también el de IA");
});
igual(await sinRevisar(), [], "todo revisado");

// ─── 6. Rollback (idempotente) ──────────────────────────────────────────────────────────────────
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
igual((await filas(`select schedule from cron.job where jobname = 'reservas-aviso-sin-asignar'`)).map((f) => f.schedule), ["*/15 * * * *"], "el rollback vuelve a programar el cron (una vez)");
igual((await una(`select to_regprocedure('public.marcar_avisos_revisados(uuid[], text[])') is null as no`)).no, true, "el rollback borra la RPC");
await como(FACTURAS, async () => {
  igual((await filas(`select 1 from public.notificaciones_dashboard`)).length, 0, "tras el rollback, Facturas sin el panel vuelve a no ver avisos");
});

// ─── 7. Se puede volver a aplicar ───────────────────────────────────────────────────────────────
await db.exec(MIGRACION);
await db.exec(`update public.notificaciones_dashboard set leida = false where titulo = 'nueva-3'`);
const nueva3 = await idDe("nueva-3");
await como(RESERVAS, async () => {
  igual(await marcar([nueva3]), 1, "reaplicada, «Revisado» vuelve a funcionar");
});
igual((await filas(`select 1 from cron.job where jobname = 'reservas-aviso-sin-asignar'`)).length, 0, "reaplicada, el cron vuelve a quitarse");

await db.close();
console.log(`test-avisos-revisado: ${comprobaciones} comprobaciones superadas`);
