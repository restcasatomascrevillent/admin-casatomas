// «Sentar fuera» (reservas.fuera_*, 10/11/2026) contra un Postgres en memoria
// (PGlite). Nunca toca Supabase.
//
//   npm run test:sentar-fuera:db
//
// Aplica la migración REAL 20261122171500 dos veces (idempotente) sobre un
// andamiaje con lo que la rodea en la demo: reservas con sus políticas de
// sección (UPDATE solo con «Editar»), el trigger que limpia la llegada, mesas
// asignadas (asignaciones_mesa) y cierres de sala por evento. Demuestra:
//   · sentar fuera = «Llegó» SIN sala ni mesas (no cuenta en ninguna sala), con
//     la sala de antes guardada;
//   · cambiar el sitio no pierde la sala de antes; textos normalizados;
//   · deshacer la llegada (o «No vino», o quitar el sitio, o darle una sala)
//     la devuelve dentro, a su sala;
//   · fuera solo con «Llegó» (INSERT o UPDATE con otro estado: 23514);
//   · un usuario con solo «Ver» (o tipo «Reservas») no puede sentarla fuera;
//   · el rollback devuelve la sala a las que están fuera y quita las columnas.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261122171500_reservas_sentar_fuera.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261122171500_reservas_sentar_fuera_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const EDITA = "a0000000-0000-0000-0000-000000000001";
const VER = "a0000000-0000-0000-0000-000000000002";
const COMEDOR = "e0000000-0000-0000-0000-000000000001";
const TERRAZA = "e0000000-0000-0000-0000-000000000002";
const M1 = "f0000000-0000-0000-0000-000000000001";
const R = (n) => `d0000000-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
`);
await db.exec(`
  grant usage on schema public, auth to anon, authenticated;
  create table public.editores (user_id uuid primary key);
  insert into public.editores values ('${EDITA}');
  create function public.can_edit_section(_s text) returns boolean language sql stable security definer set search_path = public
    as $f$ select exists (select 1 from public.editores where user_id = auth.uid()) $f$;
  grant execute on function public.can_edit_section(text) to authenticated;

  create table public.espacios_reserva (id uuid primary key, nombre text);
  insert into public.espacios_reserva values ('${COMEDOR}', 'Comedor'), ('${TERRAZA}', 'Terraza');
  create table public.reservas (
    id uuid primary key, nombre text, fecha date default current_date, hora time default '21:00',
    numero_comensales int default 2, estado varchar default 'pendiente',
    espacio_id uuid references public.espacios_reserva(id) on delete set null,
    llegada_at timestamptz, salida_at timestamptz,
    constraint reservas_estado_check check (estado in ('pendiente','verificada','confirmada','cancelada','completada','no_show')));
  create table public.asignaciones_mesa (id serial primary key, reserva_id uuid references public.reservas(id) on delete cascade, mesa_id uuid);
  create table public.salas_cerradas_servicio (espacio_id uuid, fecha date, turno text, reserva_id uuid);

  -- Como en la demo (20260923180000 + 20260926150000).
  create function public.fn_reservas_limpiar_llegada() returns trigger language plpgsql set search_path to 'public' as $f$
  begin
    if new.estado is distinct from 'completada' then
      if new.llegada_at is not null then new.llegada_at := null; end if;
      if new.salida_at is not null then new.salida_at := null; end if;
    end if;
    return new;
  end; $f$;
  create trigger trg_reservas_limpiar_llegada before update of estado, llegada_at, salida_at on public.reservas
    for each row execute function public.fn_reservas_limpiar_llegada();

  -- Políticas de sección (simplificadas): ver todos; crear y modificar solo con «Editar».
  alter table public.reservas enable row level security;
  create policy reservas_select on public.reservas for select to authenticated using (true);
  create policy reservas_insert_seccion on public.reservas for insert to authenticated with check (public.can_edit_section('reservas'));
  create policy reservas_update_seccion on public.reservas for update to authenticated
    using (public.can_edit_section('reservas')) with check (public.can_edit_section('reservas'));
  grant select, insert, update on public.reservas to authenticated;

  insert into public.reservas (id, nombre, estado, espacio_id) values
    ('${R(1)}', 'García', 'confirmada', '${COMEDOR}'),
    ('${R(2)}', 'López', 'completada', '${TERRAZA}'),
    ('${R(3)}', 'Pérez', 'confirmada', '${COMEDOR}');
  insert into public.asignaciones_mesa (reserva_id, mesa_id) values ('${R(1)}', '${M1}'), ('${R(2)}', '${M1}');
  insert into public.salas_cerradas_servicio values ('${COMEDOR}', current_date, 'cena', '${R(1)}');
`);

// ─── La migración, dos veces ────────────────────────────────────────────────
await db.exec(MIGRACION);
await db.exec(MIGRACION);

const como = async (uid, sql) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '{"sub":"${uid}"}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role; reset request.jwt.claims;`);
  }
};
const fila = async (id) =>
  (await db.query(`select estado, espacio_id, fuera_lugar, fuera_mesa, fuera_espacio_previo_id, fuera_at, llegada_at
                     from public.reservas where id = $1`, [id])).rows[0];
const mesas = async (id) => (await db.query(`select count(*)::int n from public.asignaciones_mesa where reserva_id = $1`, [id])).rows[0].n;

// ─── Sentar fuera (lo que escribe el panel) ─────────────────────────────────
const r1 = await como(EDITA, `update public.reservas
  set estado = 'completada', llegada_at = now(), espacio_id = null, fuera_lugar = '  Touza ', fuera_mesa = ' 4 '
  where id = '${R(1)}' and estado in ('confirmada') returning id`);
igual(r1.rows.length, 1, "quien puede editar la sienta fuera");
let f = await fila(R(1));
igual([f.estado, f.espacio_id, f.fuera_lugar, f.fuera_mesa], ["completada", null, "Touza", "4"], "fuera: Llegó, sin sala, textos limpios");
igual(f.fuera_espacio_previo_id, COMEDOR, "se guarda la sala de antes");
ok(f.fuera_at && f.llegada_at, "con hora de fuera y de llegada");
igual(await mesas(R(1)), 0, "se le quitan las mesas");
igual((await db.query(`select count(*)::int n from public.salas_cerradas_servicio where reserva_id = '${R(1)}'`)).rows[0].n, 0,
  "se reabre la sala cerrada por su evento");

// Sin mandar espacio_id (otro cliente): el trigger la saca igual de la sala.
await como(EDITA, `update public.reservas set fuera_lugar = 'Terraza Touza' where id = '${R(2)}'`);
f = await fila(R(2));
igual([f.espacio_id, f.fuera_lugar, f.fuera_espacio_previo_id], [null, "Terraza Touza", TERRAZA], "una sentada dentro pasa fuera aunque no se mande la sala");
igual(await mesas(R(2)), 0, "y pierde su mesa");

// ─── Cambiar el sitio ───────────────────────────────────────────────────────
const antes = (await fila(R(1))).fuera_at;
await como(EDITA, `update public.reservas set fuera_lugar = 'Terraza Touza', fuera_mesa = '', espacio_id = null, fuera_espacio_previo_id = null where id = '${R(1)}'`);
f = await fila(R(1));
igual([f.fuera_lugar, f.fuera_mesa, f.fuera_espacio_previo_id], ["Terraza Touza", null, COMEDOR], "cambiar el sitio conserva la sala de antes; mesa vacía = NULL");
igual(String(f.fuera_at), String(antes), "y la hora en que se sentó fuera");

// ─── Volver dentro ──────────────────────────────────────────────────────────
// Deshacer la llegada (el chip): vuelve a confirmada y a su sala.
await como(EDITA, `update public.reservas set estado = 'confirmada', llegada_at = null where id = '${R(1)}'`);
f = await fila(R(1));
igual([f.estado, f.espacio_id, f.fuera_lugar, f.fuera_mesa, f.fuera_espacio_previo_id, f.fuera_at, f.llegada_at],
  ["confirmada", COMEDOR, null, null, null, null, null], "deshacer la llegada la devuelve a su sala y borra lo de fuera");

// Quitar el sitio y seguir «Llegó» (sentarla dentro, sin mesa).
await como(EDITA, `update public.reservas set fuera_lugar = null where id = '${R(2)}'`);
f = await fila(R(2));
igual([f.estado, f.espacio_id, f.fuera_lugar], ["completada", TERRAZA, null], "quitar el sitio: sigue Llegó y vuelve a su sala");

// Darle una sala estando fuera = volver dentro, a esa sala.
await como(EDITA, `update public.reservas set fuera_lugar = 'Touza' where id = '${R(2)}'`);
await como(EDITA, `update public.reservas set espacio_id = '${COMEDOR}' where id = '${R(2)}'`);
f = await fila(R(2));
igual([f.espacio_id, f.fuera_lugar, f.fuera_espacio_previo_id], [COMEDOR, null, null], "darle una sala la devuelve dentro");

// «No vino» estando fuera: también vuelve.
await como(EDITA, `update public.reservas set fuera_lugar = 'Touza' where id = '${R(2)}'`);
await como(EDITA, `update public.reservas set estado = 'no_show' where id = '${R(2)}'`);
f = await fila(R(2));
igual([f.estado, f.espacio_id, f.fuera_lugar], ["no_show", COMEDOR, null], "«No vino» borra lo de fuera");

// ─── Solo con «Llegó» ───────────────────────────────────────────────────────
await falla(como(EDITA, `update public.reservas set fuera_lugar = 'Touza' where id = '${R(3)}'`), /Llegó|23514|check/i,
  "no se puede dejar fuera una reserva que no ha llegado");
await falla(como(EDITA, `insert into public.reservas (id, nombre, estado, fuera_lugar) values ('${R(4)}', 'X', 'pendiente', 'Touza')`),
  /Llegó|23514|check/i, "ni darla de alta fuera sin «Llegó»");
await como(EDITA, `insert into public.reservas (id, nombre, estado, espacio_id, fuera_lugar) values ('${R(5)}', 'Sin reserva', 'completada', '${TERRAZA}', 'Touza')`);
f = await fila(R(5));
igual([f.espacio_id, f.fuera_lugar, f.fuera_espacio_previo_id], [null, "Touza", TERRAZA], "un alta ya sentada fuera tampoco queda en la sala");
await falla(db.exec(`update public.reservas set fuera_lugar = '${"x".repeat(61)}' where id = '${R(5)}'`), /fuera_lugar_largo|check/i,
  "el sitio tiene un máximo de 60 letras");

// ─── Permisos ───────────────────────────────────────────────────────────────
const r3 = await como(VER, `update public.reservas set estado = 'completada', fuera_lugar = 'Touza' where id = '${R(3)}' returning id`);
igual(r3.rows.length, 0, "con solo «Ver» (o tipo «Reservas») no se puede sentar fuera");
igual((await fila(R(3))).fuera_lugar, null, "y no se ha tocado nada");
ok(!(await db.query(`select has_function_privilege('authenticated', 'public.fn_reservas_sentada_fuera()', 'EXECUTE') p`)).rows[0].p,
  "la función del trigger no se puede llamar suelta");

// ─── Rollback ───────────────────────────────────────────────────────────────
await como(EDITA, `update public.reservas set estado = 'completada', fuera_lugar = 'Touza' where id = '${R(3)}'`);
igual((await fila(R(3))).espacio_id, null, "antes del rollback, fuera y sin sala");
await db.exec(ROLLBACK);
const r3d = (await db.query(`select espacio_id, estado from public.reservas where id = '${R(3)}'`)).rows[0];
igual([r3d.espacio_id, r3d.estado], [COMEDOR, "completada"], "el rollback le devuelve la sala a las que estaban fuera");
const cols = (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'reservas' and column_name like 'fuera\\_%'`)).rows[0].n;
igual(cols, 0, "el rollback quita las columnas");
await db.exec(ROLLBACK);
comprobaciones++;

console.log(`✔ reservas «Sentar fuera»: ${comprobaciones} comprobaciones`);
