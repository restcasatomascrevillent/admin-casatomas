// reservas.cancelada_por / cancelada_at («quién canceló», 16/11/2026) contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:cancelada-por:db
//
// Aplica la migración REAL 20261205100200 dos veces (idempotente) y demuestra:
//   · lo que ya estaba cancelado queda sin autor ni hora («no consta»);
//   · un usuario del panel que cancela → 'restaurante', aunque intente decir 'cliente';
//   · la clave de servicio (web, correo, bot) → 'cliente', lo diga o no;
//   · SQL a mano sin decir nada → sin autor, pero con hora;
//   · recuperar la reserva borra autor y hora; volver a cancelarla los pone de nuevo;
//   · ya cancelada, el panel no puede cambiar quién ni cuándo;
//   · una reserva viva nunca lleva autor; valores fuera de la lista se rechazan;
//   · el aviso «Reserva cancelada» del panel dice quién la canceló (y sin autor, no dice nada);
//   · el resto de la reserva no se toca; el rollback lo quita todo y deja el aviso como estaba.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const AVISOS = await readFile("supabase/migrations/20261122160000_avisos_reservas_nuevas_canceladas.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261205100200_reservas_cancelada_por.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261205100200_reservas_cancelada_por_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const USUARIO = "a0000000-0000-0000-0000-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create table public.reservas (
    id uuid primary key, nombre text, fecha date default '2026-11-20', hora time default '21:00', numero_comensales int default 2,
    estado varchar default 'pendiente', canal text default 'web',
    constraint reservas_estado_check check (estado in ('pendiente','verificada','confirmada','cancelada','completada','no_show')));
  grant select, insert, update on public.reservas to authenticated, service_role;
  create table public.notificaciones_dashboard (id serial primary key, tipo text, titulo text, mensaje text, referencia_id uuid, referencia_tipo text, prioridad text);
  insert into public.reservas (id, nombre, estado) values
    ('d0000000-0000-0000-0000-000000000000', 'Cancelada de antes', 'cancelada'),
    ('d0000000-0000-0000-0000-000000000001', 'García', 'confirmada'), ('d0000000-0000-0000-0000-000000000002', 'López', 'verificada'), ('d0000000-0000-0000-0000-000000000003', 'Pérez', 'pendiente'),
    ('d0000000-0000-0000-0000-000000000004', 'Ruiz', 'confirmada'), ('d0000000-0000-0000-0000-000000000005', 'Sanz', 'confirmada');
`);

await db.exec(AVISOS); // el aviso «Reserva cancelada» tal como está antes de esta migración
await db.exec(MIGRACION);
await db.exec(MIGRACION); // idempotente

const avisoDe = async (n) =>
  (await db.query(`select mensaje from public.notificaciones_dashboard where tipo = 'reserva_cancelada' and referencia_id = $1 order by id desc limit 1`, [`d0000000-0000-0000-0000-00000000000${n}`])).rows[0]?.mensaje;

const fila = async (id) =>
  (await db.query(`select estado, cancelada_por, cancelada_at, nombre, numero_comensales from public.reservas where id = $1`, [id])).rows[0];
const comoPanel = async (sql) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '{"sub":"${USUARIO}","role":"authenticated"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};
const comoServicio = async (sql) => {
  await db.exec(`set role service_role; set request.jwt.claims = '{"role":"service_role"}';`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; reset request.jwt.claims;`); }
};

// Lo que ya estaba cancelado: no consta.
let r = await fila("d0000000-0000-0000-0000-000000000000");
igual([r.cancelada_por, r.cancelada_at], [null, null], "las canceladas de antes quedan sin autor ni hora");

// El panel cancela → restaurante.
await comoPanel(`update public.reservas set estado = 'cancelada' where id = 'd0000000-0000-0000-0000-000000000001'`);
r = await fila("d0000000-0000-0000-0000-000000000001");
igual(r.cancelada_por, "restaurante", "cancelar desde el panel apunta 'restaurante'");
ok(r.cancelada_at instanceof Date, "y la hora");
igual([r.nombre, r.numero_comensales], ["García", 2], "el resto de la reserva no cambia");
igual(await avisoDe(1), "García · 20/11 21:00 · 2 pers. · web · la canceló el restaurante", "el aviso del panel dice que la canceló el restaurante");

// El panel no puede hacerse pasar por el cliente.
await comoPanel(`update public.reservas set estado = 'cancelada', cancelada_por = 'cliente' where id = 'd0000000-0000-0000-0000-000000000002'`);
igual((await fila("d0000000-0000-0000-0000-000000000002")).cancelada_por, "restaurante", "desde el panel siempre es 'restaurante'");

// La clave de servicio que lo dice expresamente: cliente.
await comoServicio(`update public.reservas set estado = 'cancelada', cancelada_por = 'cliente' where id = 'd0000000-0000-0000-0000-000000000003'`);
igual((await fila("d0000000-0000-0000-0000-000000000003")).cancelada_por, "cliente", "la clave de servicio puede decir 'cliente'");

// reservas-web, emails-reserva y el bot telefónico (clave de servicio, no dicen nada): cliente.
await comoServicio(`update public.reservas set estado = 'cancelada' where id = 'd0000000-0000-0000-0000-000000000004'`);
r = await fila("d0000000-0000-0000-0000-000000000004");
igual(r.cancelada_por, "cliente", "la clave de servicio sin autor se apunta como 'cliente'");
ok(r.cancelada_at instanceof Date, "con su hora");
igual(await avisoDe(4), "Ruiz · 20/11 21:00 · 2 pers. · web · la canceló el cliente", "el aviso del panel dice que la canceló el cliente");

// SQL a mano, sin sesión: no consta quién, pero sí cuándo.
await db.exec(`update public.reservas set estado = 'cancelada' where id = 'd0000000-0000-0000-0000-000000000005'`);
r = await fila("d0000000-0000-0000-0000-000000000005");
igual(r.cancelada_por, null, "sin sesión no se inventa el autor");
ok(r.cancelada_at instanceof Date, "pero se apunta la hora");
igual(await avisoDe(5), "Sanz · 20/11 21:00 · 2 pers. · web", "sin autor, el aviso se queda como antes");

// Ya cancelada: el panel no reescribe quién ni cuándo (editar otra cosa tampoco lo cambia).
const antes = await fila("d0000000-0000-0000-0000-000000000003");
await comoPanel(`update public.reservas set nombre = 'Pérez (editada)', cancelada_por = 'restaurante', cancelada_at = '2000-01-01' where id = 'd0000000-0000-0000-0000-000000000003'`);
r = await fila("d0000000-0000-0000-0000-000000000003");
igual([r.cancelada_por, r.cancelada_at.getTime(), r.nombre], ["cliente", antes.cancelada_at.getTime(), "Pérez (editada)"],
  "editar una cancelada desde el panel conserva quién y cuándo");

// Recuperarla borra los dos datos; volver a cancelarla los vuelve a poner con el autor nuevo.
await comoPanel(`update public.reservas set estado = 'confirmada' where id = 'd0000000-0000-0000-0000-000000000003'`);
r = await fila("d0000000-0000-0000-0000-000000000003");
igual([r.estado, r.cancelada_por, r.cancelada_at], ["confirmada", null, null], "recuperar la reserva borra autor y hora");
await comoPanel(`update public.reservas set estado = 'cancelada' where id = 'd0000000-0000-0000-0000-000000000003'`);
igual((await fila("d0000000-0000-0000-0000-000000000003")).cancelada_por, "restaurante", "al volver a cancelarla consta quien lo hace ahora");

// Una reserva viva nunca lleva autor de cancelación.
await comoServicio(`insert into public.reservas (id, nombre, estado, cancelada_por) values ('d0000000-0000-0000-0000-000000000006', 'Viva', 'confirmada', 'cliente')`);
r = await fila("d0000000-0000-0000-0000-000000000006");
igual([r.cancelada_por, r.cancelada_at], [null, null], "una reserva viva no guarda autor de cancelación");
await comoPanel(`update public.reservas set cancelada_por = 'cliente' where id = 'd0000000-0000-0000-0000-000000000006'`);
igual((await fila("d0000000-0000-0000-0000-000000000006")).cancelada_por, null, "ni aunque se escriba a mano");

// Nace cancelada (alta directa).
await comoPanel(`insert into public.reservas (id, nombre, estado) values ('d0000000-0000-0000-0000-000000000007', 'Nace cancelada', 'cancelada')`);
igual((await fila("d0000000-0000-0000-0000-000000000007")).cancelada_por, "restaurante", "un alta ya cancelada desde el panel también se apunta");

// Solo los dos valores.
await falla(comoServicio(`update public.reservas set estado = 'cancelada', cancelada_por = 'otro' where id = 'd0000000-0000-0000-0000-000000000006'`), /reservas_cancelada_por_check/, "valores fuera de la lista");
igual((await fila("d0000000-0000-0000-0000-000000000006")).estado, "confirmada", "y la reserva se queda como estaba");

const comentario = (await db.query(`select col_description('public.reservas'::regclass, attnum) c from pg_attribute where attrelid = 'public.reservas'::regclass and attname = 'cancelada_por'`)).rows[0].c;
ok(/cancel/i.test(comentario ?? ""), "la columna lleva comentario");

// Rollback.
await db.exec(ROLLBACK);
const n = (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'reservas' and column_name in ('cancelada_por','cancelada_at')`)).rows[0].n;
igual(n, 0, "el rollback quita las columnas");
await comoPanel(`update public.reservas set estado = 'cancelada' where id = 'd0000000-0000-0000-0000-000000000006'`);
igual((await db.query(`select estado from public.reservas where id = 'd0000000-0000-0000-0000-000000000006'`)).rows[0].estado, "cancelada", "y cancelar sigue funcionando sin el trigger");
igual(await avisoDe(6), "Viva · 20/11 21:00 · 2 pers. · web", "y el aviso vuelve a ser el de antes");
await db.exec(ROLLBACK); // idempotente
comprobaciones++;

console.log(`✔ reservas.cancelada_por: ${comprobaciones} comprobaciones`);
