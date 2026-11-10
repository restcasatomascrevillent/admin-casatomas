// Genera los scripts de datos «añadas en el nombre + Parker aplicado» del
// 10/11/2026 a partir del fichero revisable
// docs/anadas-parker-2026-11-10/cambios.json:
//
//   node scripts/parker/generar-sql-anadas.mjs
//
// Escribe (y sobrescribe), en supabase/seeds/:
//   20261110_vinos_anadas_parker_demo.sql            (+ _ROLLBACK.sql)
//   20261110_vinos_anadas_parker_produccion.sql      (+ _ROLLBACK.sql)
//
// Qué hacen los scripts (los dos iguales salvo la cabecera: la demo es una
// copia de producción y los ids son los mismos):
//   1. "Vinos": nombre (y nombre_en / nombre_fr) con la añada que se ve en la
//      foto de la etiqueta, y "Vinos".anada = esa añada (o sin_anada en los NV).
//      Solo si la fila sigue como se vio al preparar el cambio (mismo nombre,
//      misma añada): si alguien la ha tocado después, se salta y se avisa.
//      Las traducciones solo se cambian si seguían siendo las de antes.
//   2. vinos_puntuacion_parker: filas nuevas o corregidas (por vino y añada),
//      solo si la fila sigue como estaba (mismo estado y puntos) o no existe.
//   3. Los triggers de la migración 20261118103000 recalculan lo que enseña la
//      web (puntuacion_parker*): solo la verificada, definitiva y de la añada
//      que se sirve.
// Idempotentes: una segunda pasada no cambia nada. La vuelta atrás deja los
// valores anteriores solo en las filas que siguen con los valores nuevos.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRADA = path.join(RAIZ, "docs", "anadas-parker-2026-11-10", "cambios.json");
const SALIDA = path.join(RAIZ, "supabase", "seeds");

/**
 * Misma regla que nombreConAnada() de src/components/carta/parker/parker.ts
 * (lo comprueba scripts/__tests__/generar-sql-anadas.test.ts): cambia el último
 * año del nombre o añade la añada al final, delante de «(Magnum)».
 */
const FORMATO_FINAL = /\s*\((?:magnum|doble magnum|jeroboam|rehoboam|matusal[eé]n|imperial|media botella|medio|37[,.]5 ?cl|150 ?cl|1[,.]5 ?l)\)\s*$/i;
export function nombreConAnada(nombre, anada) {
  const base = String(nombre ?? "").replace(/\s+/g, " ").trim();
  if (!base || typeof anada !== "number" || !Number.isInteger(anada) || anada < 1900 || anada > 2100) return base;
  const anos = [...base.matchAll(/\b(?:19|20)\d{2}\b/g)];
  const ultimo = anos[anos.length - 1];
  if (ultimo?.index !== undefined) return base.slice(0, ultimo.index) + String(anada) + base.slice(ultimo.index + ultimo[0].length);
  const formato = FORMATO_FINAL.exec(base);
  if (formato) return `${base.slice(0, formato.index).trim()} ${anada} ${formato[0].trim()}`;
  return `${base} ${anada}`;
}

/** Literal SQL de texto (o null). */
export function lit(v) {
  if (v === null || v === undefined) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "null");
const bool = (v) => (v === true ? "true" : "false");
const fecha = (v) => (v ? `${lit(v)}::date` : "null");
const jsonb = (v) => `${lit(JSON.stringify(Array.isArray(v) ? v : []))}::jsonb`;

/** Columnas de vinos_puntuacion_parker que escriben los scripts. */
export const COLUMNAS_PARKER = [
  "estado", "motivo", "puntos_texto", "puntos_min", "puntos_max", "provisional", "vino_evaluado", "entidad",
  "critico", "fecha_valoracion", "fuente_nombre", "fuente_url", "fuente_tipo", "cita", "fecha_consulta",
  "discrepancias", "notas", "origen",
];

function valorParker(col, f) {
  const v = f[col];
  if (["puntos_min", "puntos_max"].includes(col)) return num(v);
  if (col === "provisional") return bool(v);
  if (col === "fecha_consulta") return fecha(v);
  if (col === "discrepancias") return jsonb(v);
  if (col === "entidad") return lit(v || "Robert Parker Wine Advocate");
  if (col === "origen") return lit(v || "revision");
  return lit(v ?? null);
}

/** Condición «la fila sigue como `f`» (estado y puntos). */
function filaComo(alias, f) {
  return `${alias}.estado = ${lit(f.estado)} and ${alias}.puntos_texto is not distinct from ${lit(f.puntos_texto ?? null)}`
    + ` and ${alias}.provisional = ${bool(f.provisional)}`;
}

const claveAnada = (p) => (typeof p.anada === "number" ? String(p.anada) : p.sin_anada ? "0" : "-1");

function sqlVino(v, ida) {
  const [de, a] = ida ? ["antes", "despues"] : ["despues", "antes"];
  const traduccion = (col) =>
    v[`${col}_${de}`] === v[`${col}_${a}`]
      ? ""
      : `,\n         ${col} = case when ${col} is not distinct from ${lit(v[`${col}_${de}`])} then ${lit(v[`${col}_${a}`])} else ${col} end`;
  return `  -- ${String(v[`nombre_${de}`]).slice(0, 70)} → ${String(v[`nombre_${a}`]).slice(0, 70)}
  update public."Vinos"
     set nombre = ${lit(v[`nombre_${a}`])}${traduccion("nombre_en")}${traduccion("nombre_fr")},
         anada = ${num(v[`anada_${a}`])},
         sin_anada = ${bool(v[`sin_anada_${a}`])}
   where id = ${lit(v.id)}
     and nombre = ${lit(v[`nombre_${de}`])}
     and anada is not distinct from ${num(v[`anada_${de}`])}
     and sin_anada = ${bool(v[`sin_anada_${de}`])};
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = ${lit(v.id)} and nombre = ${lit(v[`nombre_${a}`])}
                  and anada is not distinct from ${num(v[`anada_${a}`])} and sin_anada = ${bool(v[`sin_anada_${a}`])}) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = ${lit(v.id)}) then v_saltados := array_append(v_saltados, ${lit(`${v.id} (${v[`nombre_${de}`]})`)});
  end if;
`;
}

function sqlParkerIda(p) {
  const d = p.despues;
  const asignaciones = COLUMNAS_PARKER.map((c) => `${c} = ${valorParker(c, d)}`).join(",\n         ");
  const insert = `  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, ${COLUMNAS_PARKER.join(", ")})
  select ${lit(p.vino_id)}, ${num(p.anada)}, ${bool(p.sin_anada)}, ${COLUMNAS_PARKER.map((c) => valorParker(c, d)).join(", ")}
   where exists (select 1 from public."Vinos" where id = ${lit(p.vino_id)})
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;`;
  if (!p.antes) return `  -- ${p.nombre} ${p.sin_anada ? "NV" : p.anada}: nueva (${d.estado} ${d.puntos_texto ?? "—"})\n${insert}\n`;
  return `  -- ${p.nombre} ${p.sin_anada ? "NV" : p.anada}: ${p.antes.estado} ${p.antes.puntos_texto ?? "—"} → ${d.estado} ${d.puntos_texto ?? "—"}
  update public.vinos_puntuacion_parker p
     set ${asignaciones}
   where p.vino_id = ${lit(p.vino_id)} and p.clave_anada = ${claveAnada(p)} and ${filaComo("p", p.antes)};
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = ${lit(p.vino_id)} and p.clave_anada = ${claveAnada(p)}) then
  ${insert.replace(/\n/g, "\n  ")}
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = ${lit(p.vino_id)} and p.clave_anada = ${claveAnada(p)} and ${filaComo("p", d)})
        and exists (select 1 from public."Vinos" where id = ${lit(p.vino_id)}) then
    v_saltados := array_append(v_saltados, ${lit(`Parker ${p.vino_id} ${p.sin_anada ? "NV" : p.anada} (${p.nombre})`)});
  end if;
`;
}

function sqlParkerVuelta(p) {
  const d = p.despues;
  if (!p.antes) {
    return `  -- ${p.nombre} ${p.sin_anada ? "NV" : p.anada}: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = ${lit(p.vino_id)} and p.clave_anada = ${claveAnada(p)} and ${filaComo("p", d)};
  get diagnostics n = row_count;
  v_parker := v_parker + n;
`;
  }
  const asignaciones = COLUMNAS_PARKER.map((c) => `${c} = ${valorParker(c, p.antes)}`).join(",\n         ");
  return `  -- ${p.nombre} ${p.sin_anada ? "NV" : p.anada}: vuelve a ${p.antes.estado} ${p.antes.puntos_texto ?? "—"}
  update public.vinos_puntuacion_parker p
     set ${asignaciones}
   where p.vino_id = ${lit(p.vino_id)} and p.clave_anada = ${claveAnada(p)} and ${filaComo("p", d)};
  get diagnostics n = row_count;
  v_parker := v_parker + n;
`;
}

function cabecera(entorno, ida, datos) {
  const ref = entorno === "demo" ? "sfonaclosuafvlhutkon (demo)" : "haqmmdfdzzatdnrrcgez (PRODUCCIÓN)";
  const nombre = `20261110_vinos_anadas_parker_${entorno}${ida ? "" : "_ROLLBACK"}`;
  return `set client_encoding = 'UTF8';
-- ===========================================================================
-- ${nombre}
-- ${ida ? "Añadas en el nombre según las fotos de las etiquetas y puntuaciones Parker aplicadas" : "VUELTA ATRÁS de 20261110_vinos_anadas_parker_" + entorno + ".sql"}
-- Proyecto: ${ref}
-- ===========================================================================
-- GENERADO por scripts/parker/generar-sql-anadas.mjs a partir de
-- docs/anadas-parker-2026-11-10/cambios.json (informe: INFORME.md en la misma
-- carpeta). No editar a mano: cambiar el JSON y volver a generar.
--
-- ${datos.vinos.length} vinos (nombre + añada que se sirve) y ${datos.parker.length} filas de vinos_puntuacion_parker.
-- ${ida ? "Solo cambia las filas que siguen como se vieron al preparar el cambio (consulta a la\n-- demo del 10/11/2026, copia de producción); las demás se saltan y se listan al final." : "Solo deshace las filas que siguen con los valores nuevos; las demás se dejan."}
-- Idempotente. ${entorno === "produccion" ? "Aplicar SOLO tras aceptar la release y con el «sí» del dueño.\n-- Requiere las migraciones 20261118103000 y 20261118110000 (Parker con fuente)." : "Requiere las migraciones 20261118103000 y 20261118110000 (Parker con fuente)."}
-- Aplicar en el SQL editor de Supabase (o psql), una vez. Termina con un
-- aviso «${nombre}: …» con lo que ha cambiado.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer;
  v_vinos integer := 0;
  v_ya integer := 0;
  v_parker integer := 0;
  v_saltados text[] := '{}';
begin
  if to_regclass('public.vinos_puntuacion_parker') is null
     or to_regprocedure('public.vinos_parker_calculado(text, smallint, boolean)') is null then
    raise exception '${nombre}: falta la migración 20261118103000_vinos_puntuacion_parker_fuentes. No se ha cambiado nada.';
  end if;
`;
}

function pie(nombre) {
  return `
  raise notice '${nombre}: % vinos cambiados, % ya estaban, % cambios en puntuaciones Parker.', v_vinos, v_ya, v_parker;
  if cardinality(v_saltados) > 0 then
    raise notice '${nombre}: % saltados porque alguien los cambió después (revisar a mano): %',
      cardinality(v_saltados), array_to_string(v_saltados, '; ');
  end if;
end;
$$;

commit;
`;
}

export function generar(datos) {
  const salida = {};
  for (const entorno of ["demo", "produccion"]) {
    const base = `20261110_vinos_anadas_parker_${entorno}`;
    salida[`${base}.sql`] =
      cabecera(entorno, true, datos)
      + "\n  -- ─── 1. Nombre y añada que se sirve ───\n"
      + datos.vinos.map((v) => sqlVino(v, true)).join("\n")
      + "\n  -- ─── 2. Puntuaciones Parker ───\n"
      + datos.parker.map(sqlParkerIda).join("\n")
      + pie(base);
    salida[`${base}_ROLLBACK.sql`] =
      cabecera(entorno, false, datos)
      + "\n  -- ─── 1. Puntuaciones Parker ───\n"
      + datos.parker.map(sqlParkerVuelta).join("\n")
      + "\n  -- ─── 2. Nombre y añada anteriores ───\n"
      + datos.vinos.map((v) => sqlVino(v, false)).join("\n")
      + pie(`${base}_ROLLBACK`);
  }
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const datos = JSON.parse(await readFile(ENTRADA, "utf8"));
  const salida = generar(datos);
  for (const [fichero, sql] of Object.entries(salida)) {
    await writeFile(path.join(SALIDA, fichero), sql);
    console.log(`escrito supabase/seeds/${fichero}`);
  }
}
