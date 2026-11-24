// «N documentos con avisos sin revisar» sin la carga histórica (migración 20261221100000),
// contra un Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:avisos-historicos:db
//
// facturas_alertas_candidatas, facturas_alertas_tras_verificar y avisos_telegram_datos_semanal
// reales son enormes y necesitan medio esquema: aquí se sustituyen por funciones mínimas que
// llevan COPIADO el texto exacto del filtro de avisos que tienen en las migraciones reales (el
// test comprueba que ese texto sigue en ellas), porque la migración las parchea sobre su
// definición. Cubre: la regla (a mano o por la bandeja cuenta; importado de ≤ 90 días cuenta;
// importado antiguo no), las tres funciones, que aplicarla dos veces no duplica, que sin la
// función semanal también funciona, que falla sin tocar nada si falta el texto esperado, saltos
// de línea CRLF y el rollback. La igualdad con producción (389 → 97) se comprobó con SELECT.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261221100000_avisos_sin_carga_historica.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261221100000_avisos_sin_carga_historica_ROLLBACK.sql", "utf8");
const ALERTAS = await readFile("supabase/migrations/20261130200000_decidir_hoy_recalculo.sql", "utf8");
const VERIFICAR = await readFile("supabase/migrations/20261130140000_facturas_avisos_al_verificar.sql", "utf8");
const SEMANAL = (await readFile("supabase/migrations/20261209400000_telegram_avisos_utiles.sql", "utf8")).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

let comprobaciones = 0;
const igual = (v, e, m) => { assert.deepEqual(v, e, m); comprobaciones++; };
const ok = (v, m) => { assert.ok(v, m); comprobaciones++; };

// Los filtros reales que parchea la migración.
const FILTRO_CREATED = "and fa.created_at < (v_hoy::timestamp - make_interval(days => v_av_d))";
ok(ALERTAS.includes(FILTRO_CREATED), "candidatas real: filtro de created_at");
ok(VERIFICAR.includes(FILTRO_CREATED), "tras_verificar real: filtro de created_at");
const FILTRO_SEMANAL = "and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)\n       and jsonb_typeof(fa.alertas_validacion) = 'array'";
ok(SEMANAL.includes(FILTRO_SEMANAL), "semanal real: filtro de documentos con avisos");

const CON_AVISOS = `jsonb_typeof(fa.alertas_validacion) = 'array'
       and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a where coalesce(a ->> 'codigo', '') <> 'extraccion_historica')`;
const cuerpoCandidatas = (nl = "\n") => `
create or replace function public.facturas_alertas_candidatas(p_hoy date default current_date)
returns table(cuantos int) language plpgsql stable set search_path to 'public' as $f$
declare v_hoy date := p_hoy; v_av_d int := 7;
begin
  return query select count(*)::int from facturas fa
   where not coalesce(fa.verificada, false)${nl}       ${FILTRO_CREATED}${nl}       and ${CON_AVISOS};
end $f$;
create or replace function public.facturas_alertas_tras_verificar(p_ids bigint[])
returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_hoy date := current_date; v_av_d int := 7; v_n int; v_docs jsonb;
begin
  select count(*) into v_n from facturas fa
   where not coalesce(fa.verificada, false)${nl}     ${FILTRO_CREATED}${nl}     and ${CON_AVISOS};
  select jsonb_agg(z.id) into v_docs from (select fa.id from facturas fa
   where not coalesce(fa.verificada, false)${nl}       ${FILTRO_CREATED}${nl}       and ${CON_AVISOS} order by fa.id limit 20) z;
  return v_n * 1000 + coalesce(jsonb_array_length(v_docs), 0);
end $f$;`;
const cuerpoSemanal = (nl = "\n") => `
create or replace function public.avisos_telegram_datos_semanal(p_hoy date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_hoy date := coalesce(p_hoy, current_date); v_n int;
begin
  with doc as (
    select fa.id from public.facturas fa
     where not coalesce(fa.verificada, false)${nl}       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)${nl}       and ${CON_AVISOS}
  ) select count(*) into v_n from doc;
  return v_n;
end $f$;`;

async function nuevaBase({ semanal = true, crlf = false } = {}) {
  const db = new PGlite();
  const nl = crlf ? "\r\n" : "\n";
  await db.exec(`
    create table public.facturas (
      id bigint primary key, tipo text default 'factura', fecha date, verificada boolean default false,
      created_at timestamp default now(), import_clave text, facturado_en_id bigint, alertas_validacion jsonb);
    ${cuerpoCandidatas(nl)}
    ${semanal ? cuerpoSemanal(nl) : ""}
  `);
  const av = `'[{"codigo":"descuadre_linea","severidad":"media"}]'::jsonb`;
  const hist = `'[{"codigo":"extraccion_historica"}]'::jsonb`;
  await db.exec(`
    insert into public.facturas (id, fecha, verificada, created_at, import_clave, alertas_validacion) values
      (1, current_date - 3,   false, now() - interval '10 days', null,    ${av}),   -- a mano, reciente: cuenta
      (2, current_date - 200, false, now() - interval '10 days', 'zip:2', ${av}),   -- carga histórica antigua: NO
      (3, current_date - 30,  false, now() - interval '10 days', 'zip:3', ${av}),   -- importada reciente: cuenta
      (4, current_date - 300, false, now() - interval '10 days', null,    ${av}),   -- a mano, antigua: cuenta
      (5, current_date - 3,   true,  now() - interval '10 days', null,    ${av}),   -- verificada: NO
      (6, current_date - 3,   false, now() - interval '3 days',  null,    ${av}),   -- de hace 3 días: NO en el resumen (7 días), SÍ en el semanal
      (7, current_date - 3,   false, now() - interval '10 days', null,    ${hist}), -- solo nota histórica: NO
      (8, current_date - 400, false, now() - interval '10 days', 'zip:8', ${av});   -- histórica antigua: NO`);
  return db;
}
const resumen = async (db) => (await db.query(`select cuantos from public.facturas_alertas_candidatas(current_date)`)).rows[0].cuantos;
const verificar = async (db) => (await db.query(`select public.facturas_alertas_tras_verificar(null) as r`)).rows[0].r;
const semanal = async (db) => (await db.query(`select public.avisos_telegram_datos_semanal() as r`)).rows[0].r;
const definicion = async (db, firma) => (await db.query(`select pg_get_functiondef('${firma}'::regprocedure) as d`)).rows[0].d;
const hayFuncion = async (db, nombre) => (await db.query(`select 1 from pg_proc where proname = '${nombre}'`)).rows.length;

// ─── 1. Antes y después ─────────────────────────────────────────────────────
{
  const db = await nuevaBase();
  igual(await resumen(db), 5, "antes: cuentan 1, 2, 3, 4 y 8");
  igual(await verificar(db), 5005, "antes: tras_verificar cuenta 5 y lista 5");
  igual(await semanal(db), 6, "antes: el semanal cuenta 1, 2, 3, 4, 6 y 8");
  await db.exec(MIGRACION);
  igual(await resumen(db), 3, "después: 1, 3 y 4 (la histórica antigua, 2 y 8, ya no)");
  igual(await verificar(db), 3003, "después: tras_verificar, igual");
  igual(await semanal(db), 4, "después: el semanal, 1, 3, 4 y 6");
  ok((await definicion(db, "public.facturas_alertas_candidatas(date)")).includes("facturas_aviso_accionable"), "candidatas parcheada");
  // Idempotente: otra vez no duplica la condición.
  await db.exec(MIGRACION);
  const d = await definicion(db, "public.facturas_alertas_candidatas(date)");
  igual(d.split("facturas_aviso_accionable").length - 1, 1, "aplicada dos veces: una sola condición");
  igual(await resumen(db), 3, "sigue igual");
  // La regla en sí.
  const r = (await db.query(`select public.facturas_aviso_accionable(null, current_date - 500, current_date) a,
                                    public.facturas_aviso_accionable('zip', current_date - 91, current_date) b,
                                    public.facturas_aviso_accionable('zip', current_date - 90, current_date) c,
                                    public.facturas_aviso_accionable('zip', current_date, current_date) d`)).rows[0];
  igual(r, { a: true, b: false, c: true, d: true }, "regla: a mano siempre; importado solo ≤ 90 días");
  // Rollback.
  await db.exec(ROLLBACK);
  igual(await resumen(db), 5, "rollback: vuelve a contar todo");
  igual(await semanal(db), 6, "rollback: el semanal también");
  ok(!(await definicion(db, "public.facturas_alertas_tras_verificar(bigint[])")).includes("facturas_aviso_accionable"), "rollback: sin la condición");
  igual(await hayFuncion(db, "facturas_aviso_accionable"), 0, "rollback: sin la función de la regla");
  await db.exec(ROLLBACK); // el rollback también es repetible
  await db.exec(MIGRACION); // y se puede volver a aplicar
  igual(await resumen(db), 3, "otra vez aplicada");
  await db.close();
}

// ─── 2. Sin la función semanal (producción aún no la tiene) ─────────────────
{
  const db = await nuevaBase({ semanal: false });
  await db.exec(MIGRACION);
  igual(await resumen(db), 3, "sin semanal: el resumen se arregla igual");
  igual(await hayFuncion(db, "avisos_telegram_datos_semanal"), 0, "no inventa la función semanal");
  await db.close();
}

// ─── 3. Saltos de línea CRLF en la definición guardada ──────────────────────
{
  const db = await nuevaBase({ crlf: true });
  await db.exec(MIGRACION);
  igual(await resumen(db), 3, "CRLF: resumen");
  igual(await semanal(db), 4, "CRLF: semanal");
  await db.exec(ROLLBACK);
  igual(await semanal(db), 6, "CRLF: rollback");
  await db.close();
}

// ─── 4. Si falta el texto esperado, falla y no cambia nada ──────────────────
{
  const db = await nuevaBase();
  await db.exec(`create or replace function public.facturas_alertas_tras_verificar(p_ids bigint[]) returns int language sql as $f$ select 1 $f$;`);
  await assert.rejects(db.exec(MIGRACION), /no tiene el texto esperado/, "falla con un mensaje claro");
  comprobaciones++;
  await db.exec("rollback"); // como hace el ejecutor real al fallar una migración con begin
  igual(await resumen(db), 5, "no ha tocado candidatas (la transacción se deshace)");
  igual(await hayFuncion(db, "facturas_aviso_accionable"), 0, "ni ha dejado la función de la regla");
  await db.close();
}

console.log(`test-avisos-historicos: OK (${comprobaciones} comprobaciones)`);
