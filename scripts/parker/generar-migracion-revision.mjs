// Genera la migración de datos de la revisión Parker del 08/11/2026 a partir del
// fichero revisable docs/revision-parker-2026-11-08/revision.json:
//
//   node scripts/parker/generar-migracion-revision.mjs
//
// Escribe (y sobrescribe):
//   supabase/migrations/20261118110000_vinos_puntuacion_parker_revision_datos.sql
//   supabase/rollbacks/20261118110000_vinos_puntuacion_parker_revision_datos_ROLLBACK.sql
//
// La migración:
//   1. Pone "Vinos".anada (añada que se sirve) a los vinos cuyo nombre de carta
//      lleva el año, y sin_anada a los NV con la edición en el nombre. Solo si
//      el panel no tiene ya una añada puesta (no pisa lo que haya puesto el dueño).
//   2. Inserta una fila por (vino, añada) en vinos_puntuacion_parker con el
//      resultado de la revisión (verificada, revision o no_localizada, con
//      fuente, cita, motivo…). ON CONFLICT DO NOTHING: no pisa lo que ya haya.
//   3. El trigger recalcula lo que enseña la web.
// Solo toca ids que existen (la demo tiene 6 vinos menos que producción).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRADA = path.join(RAIZ, "docs", "revision-parker-2026-11-08", "revision.json");
const MIGRACION = path.join(RAIZ, "supabase", "migrations", "20261118110000_vinos_puntuacion_parker_revision_datos.sql");
const ROLLBACK = path.join(RAIZ, "supabase", "rollbacks", "20261118110000_vinos_puntuacion_parker_revision_datos_ROLLBACK.sql");

/** Literal SQL de texto (o null). */
export function lit(v) {
  if (v === null || v === undefined || v === "") return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "null");
const bool = (v) => (v === true ? "true" : "false");

const COLUMNAS = [
  "vino_id", "anada", "sin_anada", "estado", "motivo", "puntos_texto", "puntos_min", "puntos_max", "provisional",
  "vino_evaluado", "entidad", "critico", "fecha_valoracion", "fuente_nombre", "fuente_url", "fuente_tipo", "cita",
  "fecha_consulta", "discrepancias", "notas", "origen",
];

export function filaSql(vino, f) {
  return `(${[
    lit(vino.id), num(f.anada), bool(f.sin_anada), lit(f.estado), lit(f.motivo), lit(f.puntos_texto),
    num(f.puntos_min), num(f.puntos_max), bool(f.provisional), lit(f.vino_evaluado),
    lit(f.entidad || "Robert Parker Wine Advocate"), lit(f.critico), lit(f.fecha_valoracion), lit(f.fuente_nombre),
    lit(f.fuente_url), lit(f.fuente_tipo), lit(f.cita), f.fecha_consulta ? `${lit(f.fecha_consulta)}::date` : "null",
    `${lit(JSON.stringify(Array.isArray(f.discrepancias) ? f.discrepancias : []))}::jsonb`, lit(f.notas), "'revision'",
  ].join(", ")})`;
}

export function generar(revision) {
  const vinos = Array.isArray(revision) ? revision : [];
  const anadas = vinos.filter((v) => typeof v.anada_servida === "number");
  const nv = vinos.filter((v) => v.sin_anada === true);
  const filas = vinos.flatMap((v) => (Array.isArray(v.filas) ? v.filas : []).map((f) => ({ v, f })));
  const cuenta = (e) => filas.filter(({ f }) => f.estado === e).length;
  const comentario = (v) => `-- ${String(v.nombre ?? "").replace(/\s+/g, " ").slice(0, 70)}`;

  const valoresAnadas = anadas.map((v, i) => `    (${lit(v.id)}, ${v.anada_servida})${i < anadas.length - 1 ? "," : ""}  ${comentario(v)}`);
  const valoresFilas = filas.map(({ v, f }, i) => `  ${filaSql(v, f)}${i < filas.length - 1 ? "," : ""}`);

  const migracion = `set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261118110000_vinos_puntuacion_parker_revision_datos — Revisión Parker de la
-- carta (consulta del 08/11/2026)
-- ===========================================================================
-- GENERADO por scripts/parker/generar-migracion-revision.mjs a partir de
-- docs/revision-parker-2026-11-08/revision.json (el informe por vino está en
-- docs/revision-parker-2026-11-08/INFORME.md). No editar a mano: cambiar el
-- JSON y volver a generar.
--
-- 1. "Vinos".anada (añada que se sirve) = el año del nombre de la carta, en
--    ${anadas.length} vinos; sin_anada en ${nv.length} vinos NV con la edición en el nombre. Solo
--    si no tienen ya añada ni «sin añada» (no pisa lo puesto en el panel).
-- 2. ${filas.length} filas en vinos_puntuacion_parker: ${cuenta("verificada")} verificadas, ${cuenta("revision")} pendientes de
--    revisión y ${cuenta("no_localizada")} no localizadas (con motivo). ON CONFLICT DO NOTHING.
-- 3. El trigger vinos_parker_publicado recalcula lo que ve la web: solo las
--    verificadas, definitivas y de la añada que se sirve.
--
-- Solo toca ids que existen: la demo tiene 6 vinos menos que producción.
-- APLICAR (una a una, nunca \`db push\`), DESPUÉS de 20261118103000: demo
-- primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo tras
-- aceptar el PR y con el «sí» del dueño. Idempotente. Tiene que terminar en
-- «vinos_puntuacion_parker_revision_datos: …».
-- Deshacer: supabase/rollbacks/20261118110000_vinos_puntuacion_parker_revision_datos_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.vinos_puntuacion_parker') is null then
    raise exception 'vinos_puntuacion_parker_revision_datos: falta la tabla vinos_puntuacion_parker (aplica antes 20261118103000_vinos_puntuacion_parker_fuentes). No se ha cambiado nada.';
  end if;
end
$$;

-- 1. Añada que se sirve (del nombre de la carta) y vinos sin añada.
${anadas.length ? `update public."Vinos" v
   set anada = d.anada
  from (values
${valoresAnadas.join("\n")}
  ) as d(id, anada)
 where v.id = d.id
   and v.anada is null
   and not v.sin_anada;` : "-- (ningún vino con añada en el nombre)"}

${nv.length ? `update public."Vinos"
   set sin_anada = true
 where id in (${nv.map((v) => lit(v.id)).join(", ")})
   and anada is null
   and not sin_anada;` : "-- (ningún vino sin añada con la edición identificada)"}

-- 2. Resultado de la revisión, una fila por vino y añada.
${filas.length ? `insert into public.vinos_puntuacion_parker (${COLUMNAS.join(", ")})
select d.vino_id, d.anada::smallint, d.sin_anada, d.estado, d.motivo, d.puntos_texto, d.puntos_min::smallint,
       d.puntos_max::smallint, d.provisional, d.vino_evaluado, d.entidad, d.critico, d.fecha_valoracion,
       d.fuente_nombre, d.fuente_url, d.fuente_tipo, d.cita, d.fecha_consulta, d.discrepancias, d.notas, d.origen
  from (values
${valoresFilas.join("\n")}
  ) as d(${COLUMNAS.join(", ")})
 where exists (select 1 from public."Vinos" v where v.id = d.vino_id)
on conflict (vino_id, clave_anada) do nothing;` : "-- (sin filas)"}

do $$
declare
  n_pub integer;
  n_ver integer;
  n_rev integer;
  n_nol integer;
begin
  select count(*) into n_pub from public."Vinos" where puntuacion_parker is not null;
  select count(*) filter (where estado = 'verificada'), count(*) filter (where estado = 'revision'),
         count(*) filter (where estado = 'no_localizada')
    into n_ver, n_rev, n_nol
    from public.vinos_puntuacion_parker where origen = 'revision';
  raise notice 'vinos_puntuacion_parker_revision_datos: % verificadas, % en revisión, % no localizadas; % vinos con puntuación en la web',
    n_ver, n_rev, n_nol, n_pub;
end
$$;

commit;
`;

  const rollback = `set client_encoding = 'UTF8';
-- ROLLBACK de 20261118110000_vinos_puntuacion_parker_revision_datos.sql
-- (GENERADO por scripts/parker/generar-migracion-revision.mjs). Aplicar a mano
-- SOLO si hay que deshacerlo.
--
-- Borra las filas de la revisión (origen = 'revision') y quita la añada que se
-- sirve / «sin añada» a los vinos donde la puso la revisión, si siguen con ese
-- valor. Las filas que se hayan añadido después desde el panel (foto, búsqueda,
-- a mano) se quedan. El trigger recalcula lo que ve la web. Se puede aplicar
-- dos veces.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.vinos_puntuacion_parker') is null then
    raise notice 'vinos_puntuacion_parker_revision_datos: no hay tabla, nada que deshacer';
    return;
  end if;
  delete from public.vinos_puntuacion_parker where origen = 'revision';
${anadas.length ? `  update public."Vinos" v
     set anada = null
    from (values
${anadas.map((v, i) => `      (${lit(v.id)}, ${v.anada_servida})${i < anadas.length - 1 ? "," : ""}`).join("\n")}
    ) as d(id, anada)
   where v.id = d.id
     and v.anada = d.anada;` : ""}
${nv.length ? `  update public."Vinos" set sin_anada = false where id in (${nv.map((v) => lit(v.id)).join(", ")}) and sin_anada;` : ""}
  raise notice 'vinos_puntuacion_parker_revision_datos: rollback aplicado';
end
$$;

commit;
`;
  return { migracion, rollback };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entrada = process.argv[2] ? path.resolve(process.argv[2]) : ENTRADA;
  const revision = JSON.parse(await readFile(entrada, "utf8"));
  const { migracion, rollback } = generar(revision.vinos ?? revision);
  await writeFile(MIGRACION, migracion);
  await writeFile(ROLLBACK, rollback);
  console.log(`Escritos:\n  ${path.relative(RAIZ, MIGRACION)}\n  ${path.relative(RAIZ, ROLLBACK)}`);
}
