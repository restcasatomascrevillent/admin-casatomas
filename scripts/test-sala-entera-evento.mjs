// «Evento: sala entera» (09/11/2026) contra un Postgres en memoria (PGlite).
// Nunca toca Supabase.
//
//   npm run test:sala-evento:db
//
// Aplica las migraciones REALES 20261009110000 (salas_cerradas_servicio) y
// 20261119100000 (dos veces: idempotente) sobre la validar_capacidad_reserva
// anterior (la del rollback) y cubre: el evento resta la sala del aforo de su
// turno, el evento no consume aforo, otra reserva no puede entrar en la sala,
// cancelar / «No vino» / borrar libera la sala, cambiar día, hora o sala mueve
// el cierre, el cierre de Organizar (sin reserva) no cambia el aforo, y el
// rollback deja todo como estaba.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const SALAS = await readFile("supabase/migrations/20261009110000_salas_cerradas_servicio.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261119100000_sala_entera_evento.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261119100000_sala_entera_evento_ROLLBACK.sql", "utf8");

// La validar_capacidad_reserva anterior está, tal cual, dentro del rollback.
const funcionAnterior = /CREATE OR REPLACE FUNCTION public\.validar_capacidad_reserva\(\)[\s\S]*?\$function\$;/.exec(ROLLBACK)?.[0];
assert.ok(funcionAnterior, "el rollback trae la validar_capacidad_reserva anterior");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const falla = async (promesa, re, msg) => {
  await assert.rejects(promesa, re, msg);
  comprobaciones++;
};

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create function public.can_read_section(text) returns boolean language sql as $$ select true $$;
  create function public.can_write_section(text) returns boolean language sql as $$ select true $$;
  create function public.fn_registrar_auditoria() returns trigger language plpgsql as $$ begin return null; end $$;

  create table public.espacios_reserva (
    id uuid primary key, nombre text, capacidad_maxima int, activa boolean default true, caracteristicas jsonb default '{}'
  );
  create table public.reservas (
    id uuid primary key default gen_random_uuid(),
    nombre text, fecha date, hora time, numero_comensales int,
    estado varchar default 'confirmada', marca text not null default 'casa_tomas', espacio_id uuid
  );
  insert into public.espacios_reserva values
    ('00000000-0000-0000-0000-0000000000c1', 'Comedor', 50, true, '{"marca":"casa_tomas"}'),
    ('00000000-0000-0000-0000-0000000000c2', 'Salón', 50, true, '{"marca":"casa_tomas"}'),
    ('00000000-0000-0000-0000-0000000000c3', 'Terraza', 50, true, '{"marca":"casa_tomas"}'),
    ('00000000-0000-0000-0000-0000000000c4', 'Reservado', 14, true, '{"marca":"casa_tomas","privada":true}');
`);
const COMEDOR = "00000000-0000-0000-0000-0000000000c1";
const SALON = "00000000-0000-0000-0000-0000000000c2";
const TERRAZA = "00000000-0000-0000-0000-0000000000c3";

await db.exec(SALAS);
await db.exec(funcionAnterior);
await db.exec(`create trigger trg_validar_capacidad before insert or update of fecha, hora, numero_comensales, estado, marca, espacio_id
  on public.reservas for each row execute function public.validar_capacidad_reserva();`);

await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente
comprobaciones++;

const DIA = "2026-12-12";
let n = 0;
const alta = async (comensales, { sala = null, hora = "14:00", fecha = DIA, estado = "confirmada" } = {}) => {
  n++;
  const { rows } = await db.query(
    `insert into public.reservas (nombre, fecha, hora, numero_comensales, espacio_id, estado) values ($1, $2, $3, $4, $5, $6) returning id`,
    [`Reserva ${n}`, fecha, hora, comensales, sala, estado],
  );
  return rows[0].id;
};
const cerrarPorEvento = (reservaId, sala, { fecha = DIA, turno = "comida", motivo = null } = {}) =>
  db.query(`insert into public.salas_cerradas_servicio (espacio_id, fecha, turno, reserva_id, motivo) values ($1, $2, $3, $4, $5)`, [
    sala, fecha, turno, reservaId, motivo,
  ]);
const cierres = async () =>
  (await db.query(`select espacio_id, fecha::text fecha, turno, reserva_id, motivo from public.salas_cerradas_servicio order by fecha, turno`)).rows;
const limpiar = () => db.exec(`delete from public.salas_cerradas_servicio; delete from public.reservas;`);

// --- 1. El evento resta la sala del aforo de su turno ------------------------
const evento = await alta(40, { sala: SALON });
await cerrarPorEvento(evento, SALON);
ok((await cierres())[0].motivo === "Reserva 1", "sin motivo, el cierre toma el nombre de la reserva");
await alta(100, { sala: COMEDOR });
await falla(alta(1, { sala: TERRAZA }), /Aforo superado.*Capacidad total: 100/, "con el Salón cerrado, la comida tiene 100 plazas");
await alta(50, { sala: TERRAZA, hora: "21:00" }); // la cena tiene las 150
comprobaciones++;

// --- 2. Los 40 del evento no consumen aforo ----------------------------------
// (100 en el Comedor + 40 del evento = 140 < 150, pero el aforo es 100 y está lleno:
// si el evento contara, ni siquiera se habría podido llegar a 100.)
await db.exec(`update public.reservas set numero_comensales = 60 where id = '${evento}'`);
ok(true, "el evento puede subir de comensales sin chocar con el aforo");

// --- 3. Otra reserva no puede entrar en la sala del evento -------------------
await falla(alta(2, { sala: SALON }), /La sala Salón está cerrada por un evento ese día/, "alta en la sala del evento");
await db.exec(`update public.reservas set numero_comensales = 90 where espacio_id = '${COMEDOR}'`);
const otra = await alta(2, { sala: COMEDOR });
await falla(db.exec(`update public.reservas set espacio_id = '${SALON}' where id = '${otra}'`), /cerrada por un evento/, "mover otra reserva a la sala del evento");
await alta(2, { sala: SALON, hora: "21:30" }); // en la cena el Salón está abierto
comprobaciones++;

// --- 4. Cancelar el evento libera la sala ------------------------------------
await db.exec(`update public.reservas set estado = 'cancelada' where id = '${evento}'`);
ok((await cierres()).length === 0, "cancelar el evento borra el cierre");
await alta(2, { sala: SALON });
ok(true, "con el evento cancelado se puede reservar en el Salón");

// «No vino» y borrar también liberan.
await limpiar();
const ev2 = await alta(30, { sala: SALON });
await cerrarPorEvento(ev2, SALON);
await db.exec(`update public.reservas set estado = 'no_show' where id = '${ev2}'`);
ok((await cierres()).length === 0, "«No vino» borra el cierre");
const ev3 = await alta(30, { sala: SALON, hora: "13:30" });
await cerrarPorEvento(ev3, SALON);
await db.exec(`delete from public.reservas where id = '${ev3}'`);
ok((await cierres()).length === 0, "borrar la reserva borra el cierre");

// --- 5. El cierre sigue a la reserva -----------------------------------------
await limpiar();
const ev4 = await alta(30, { sala: SALON });
await cerrarPorEvento(ev4, SALON);
await db.exec(`update public.reservas set fecha = '2026-12-13' where id = '${ev4}'`);
let c = await cierres();
ok(c.length === 1 && c[0].fecha === "2026-12-13" && c[0].turno === "comida", "cambiar el día mueve el cierre");
await db.exec(`update public.reservas set hora = '21:00' where id = '${ev4}'`);
c = await cierres();
ok(c.length === 1 && c[0].turno === "cena", "cambiar la hora de turno mueve el cierre");
// Un cierre de Organizar en el destino no estorba.
await db.exec(`insert into public.salas_cerradas_servicio (espacio_id, fecha, turno) values ('${TERRAZA}', '2026-12-13', 'cena')`);
await db.exec(`update public.reservas set espacio_id = '${TERRAZA}' where id = '${ev4}'`);
c = await cierres();
ok(c.length === 1 && c[0].espacio_id === TERRAZA && c[0].reserva_id === ev4, "cambiar la sala mueve el cierre (y absorbe el de Organizar)");
await db.exec(`update public.reservas set numero_comensales = 31 where id = '${ev4}'`);
ok((await cierres()).length === 1, "cambiar los comensales del evento no toca el cierre");
await db.exec(`update public.reservas set espacio_id = null where id = '${ev4}'`);
ok((await cierres()).length === 0, "quitarle la sala al evento abre la sala");

// No se puede mover el evento a una sala con otras reservas.
await limpiar();
const ev5 = await alta(20, { sala: SALON });
await cerrarPorEvento(ev5, SALON);
await alta(4, { sala: COMEDOR });
await falla(db.exec(`update public.reservas set espacio_id = '${COMEDOR}' where id = '${ev5}'`), /La sala Comedor tiene 1 reserva/, "mover el evento a una sala ocupada");

// --- 6. Al poner el cierre ---------------------------------------------------
await limpiar();
const ev6 = await alta(10, { sala: SALON });
await alta(4, { sala: SALON, hora: "14:30" });
await falla(cerrarPorEvento(ev6, SALON), /La sala Salón tiene 1 reserva/, "no se cierra una sala con otras reservas");
await limpiar();
const ev7 = await alta(10, { sala: SALON });
await alta(105, { sala: COMEDOR });
await falla(cerrarPorEvento(ev7, SALON), /Aforo superado si se cierra la sala Salón/, "no se cierra si el resto no cabe");
await falla(cerrarPorEvento(ev7, TERRAZA), /tiene que ser en la sala/, "el cierre va en la sala de su reserva");
await limpiar();
const ev8 = await alta(10, { sala: SALON });
const ev9 = await alta(10, { sala: COMEDOR });
await cerrarPorEvento(ev8, SALON);
await falla(
  db.query(
    `insert into public.salas_cerradas_servicio (espacio_id, fecha, turno, reserva_id) values ($1, $2, 'comida', $3)
     on conflict (espacio_id, fecha, turno) do update set reserva_id = excluded.reserva_id`,
    [SALON, DIA, ev9],
  ),
  /ya está cerrada por otro evento|tiene que ser en la sala/,
  "no se pisa el evento de otra reserva",
);
// Upsert sobre un cierre de Organizar: pasa a ser del evento.
await limpiar();
await db.exec(`insert into public.salas_cerradas_servicio (espacio_id, fecha, turno) values ('${SALON}', '${DIA}', 'comida')`);
const ev10 = await alta(10, { sala: SALON });
await db.query(
  `insert into public.salas_cerradas_servicio (espacio_id, fecha, turno, reserva_id, motivo) values ($1, $2, 'comida', $3, 'Boda')
   on conflict (espacio_id, fecha, turno) do update set reserva_id = excluded.reserva_id, motivo = excluded.motivo`,
  [SALON, DIA, ev10],
);
c = await cierres();
ok(c.length === 1 && c[0].reserva_id === ev10 && c[0].motivo === "Boda", "un cierre de Organizar se convierte en el del evento");

// --- 7. Un cierre de Organizar (sin reserva) NO cambia el aforo ---------------
await limpiar();
await db.exec(`insert into public.salas_cerradas_servicio (espacio_id, fecha, turno) values ('${SALON}', '${DIA}', 'comida')`);
await alta(150, { sala: COMEDOR });
ok(true, "con el Salón cerrado desde Organizar el aforo sigue en 150");
await alta(2, { sala: SALON, hora: "21:00" });
comprobaciones++;

// --- 8. Rollback --------------------------------------------------------------
await limpiar();
const ev11 = await alta(10, { sala: SALON });
await cerrarPorEvento(ev11, SALON);
await db.exec(`insert into public.salas_cerradas_servicio (espacio_id, fecha, turno) values ('${TERRAZA}', '${DIA}', 'cena')`);
await db.exec(ROLLBACK);
await db.exec(ROLLBACK); // idempotente
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'salas_cerradas_servicio' and column_name in ('reserva_id', 'motivo')`)).rows;
ok(cols.length === 0, "el rollback quita las columnas");
ok((await db.query(`select count(*)::int n from public.salas_cerradas_servicio`)).rows[0].n === 1, "el rollback borra los cierres de evento y deja los de Organizar");
const def = (await db.query(`select pg_get_functiondef('public.validar_capacidad_reserva'::regproc) d`)).rows[0].d;
ok(!def.includes("salas_cerradas_servicio"), "el rollback deja validar_capacidad_reserva sin eventos");
await alta(2, { sala: SALON });
ok(true, "tras el rollback, el Salón vuelve a admitir reservas");

console.log(`✔ Evento con la sala entera: ${comprobaciones} comprobaciones`);
