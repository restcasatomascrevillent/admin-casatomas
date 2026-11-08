#!/usr/bin/env node
/**
 * Originales de las fotos de la carta que YA existían (antes del 08/11/2026
 * solo se guardaba la versión web): sube a Google Drive, como ORIGINALES de
 * platos (o vinos), las fotos de una carpeta local según un CSV
 * `id_plato,fichero`. Usa la misma Edge Function que el panel
 * (instagram-drive · subir_original): misma carpeta marketing/carta/<marca>,
 * mismo nombre <plato>-<id>.jpg, misma fila en carta_fotos_originales y los
 * mismos permisos («Editar» en la carta). Ver docs/instagram-fotos.md.
 *
 * Cada foto se convierte con sharp como en el panel: orientación EXIF
 * aplicada, JPEG calidad 92 (baja si pasa de 8 MB), lado mayor ≤ 4000 px
 * (nunca amplía), sin metadatos.
 *
 * USO (desde la raíz del repo; las claves y el token NUNCA se imprimen):
 *
 *   1) Proponer emparejamientos por nombre de fichero y de plato (no sube nada):
 *      node scripts/instagram/importar-originales.mjs --sugerir --carpeta <dir> \
 *        [--platos platos.json] [--salida sugerencias.csv] [--solo a.jpg,b.jpg]
 *      Los platos activos salen de --platos (la salida JSON de
 *      `npx supabase db query --linked "select id, nombre, categoria, imagen_url is not null as con_foto from public.\"Platos\" where activado"`
 *      o un array) o, si no se da, de SUPABASE_URL + SUPABASE_ANON_KEY (la
 *      lectura pública de la carta). REVISA el CSV a mano antes de subir.
 *
 *   2) Subir según el CSV revisado:
 *      SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=… PANEL_JWT=<sesión del panel> \
 *        node scripts/instagram/importar-originales.mjs --csv sugerencias.csv --carpeta <dir> [--simular]
 *      (o PANEL_EMAIL + PANEL_PASSWORD en vez de PANEL_JWT; la cuenta necesita
 *      «Editar» en la carta). Columnas: id_plato, fichero y, opcional, tabla
 *      (Platos | Vinos; por defecto Platos). Las filas sin id_plato se saltan.
 *      Primero en la DEMO; producción solo con el «sí» del dueño.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LADO_MAXIMO = 4000;
export const MAX_BYTES = 8 * 1024 * 1024;
const EXTENSIONES = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"]);
const RE_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** Palabras que no ayudan a emparejar. */
const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "a", "al", "en", "e", "o", "foto", "img", "plato"]);

// ── Emparejar por nombre ─────────────────────────────────────────────────────

/** «Chuletón de vaca» → ["chuleton", "vaca"] (sin tildes, minúsculas, sin palabras vacías ni plurales). */
export function palabras(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p) && !/^\d+$/.test(p))
    .map((p) => (p.length > 4 ? p.replace(/(es|s)$/, "") : p));
}

/** Parecido de dos palabras: 1 iguales; 0,8 si una empieza por la otra (≥ 5 letras: «tartar»/«tartare»); si no, 0. */
function parecido(a, b) {
  if (a === b) return 1;
  const [c, l] = a.length <= b.length ? [a, b] : [b, a];
  return c.length >= 5 && l.startsWith(c) ? 0.8 : 0;
}

/**
 * Puntuación 0..1 de un fichero frente a un plato y su `cobertura` (parte de
 * las palabras del fichero que están en el nombre del plato; la categoría
 * cuenta poco), penalizando un poco los nombres de plato muy largos.
 */
export function puntuar(fichero, plato) {
  const pf = palabras(path.parse(fichero).name);
  if (!pf.length) return { puntos: 0, cobertura: 0 };
  const pn = palabras(plato.nombre);
  const pc = palabras(plato.categoria);
  let s = 0;
  for (const p of pf) {
    const enNombre = Math.max(0, ...pn.map((q) => parecido(p, q)));
    s += enNombre || 0.25 * Math.max(0, ...pc.map((q) => parecido(p, q)));
  }
  const cobertura = s / pf.length;
  if (cobertura === 0) return { puntos: 0, cobertura: 0 };
  const ruido = pn.length ? Math.min(1, pf.length / pn.length) : 0;
  return { puntos: Math.round((cobertura * 0.85 + ruido * 0.15) * 1000) / 1000, cobertura };
}

/**
 * Mejores platos para cada fichero. Solo se sugiere si casa MÁS de la mitad
 * de las palabras del fichero (cobertura ≥ `minimo`): «vitrina-gallega» no
 * se empareja con «Ostras gallegas» por una sola palabra.
 */
export function sugerir(ficheros, platos, { minimo = 0.6, alternativas = 3 } = {}) {
  return ficheros.map((fichero) => {
    const orden = platos
      .map((p) => ({ plato: p, ...puntuar(fichero, p) }))
      .filter((x) => x.cobertura >= minimo)
      // A igualdad, mejor un plato que ya tiene foto en la web (los que no, no salen en Instagram).
      .sort((a, b) => b.puntos + (b.plato.conFoto ? 0.02 : 0) - (a.puntos + (a.plato.conFoto ? 0.02 : 0)) || String(a.plato.nombre).length - String(b.plato.nombre).length);
    return { fichero, mejor: orden[0] ?? null, otras: orden.slice(1, 1 + alternativas) };
  });
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const celda = (v) => {
  const t = String(v ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV de sugerencias: id_plato,fichero (lo que lee la subida) + columnas de ayuda para revisar. */
export function csvSugerencias(s) {
  const filas = [["id_plato", "fichero", "tabla", "nombre_plato", "puntuacion", "foto_en_la_web", "alternativas"]];
  for (const x of s) {
    filas.push([
      x.mejor?.plato.id ?? "",
      x.fichero,
      "Platos",
      x.mejor?.plato.nombre ?? "(sin plato parecido: rellena id_plato o borra la fila)",
      x.mejor ? x.mejor.puntos.toFixed(2) : "",
      x.mejor?.plato.conFoto == null ? "" : x.mejor.plato.conFoto ? "sí" : "no",
      x.otras.map((o) => `${o.plato.nombre} [${o.plato.id}] ${o.puntos.toFixed(2)}`).join(" | "),
    ]);
  }
  return filas.map((f) => f.map(celda).join(",")).join("\n") + "\n";
}

/** CSV sencillo (comillas dobles, comas) → objetos por cabecera. */
export function leerCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let comillas = false;
  const t = String(texto).replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  const [cab = [], ...resto] = filas;
  const claves = cab.map((c) => c.trim().toLowerCase());
  return resto.map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] ?? "").trim()])));
}

/** Filas válidas para subir (y los problemas de las demás). */
export function filasParaSubir(filas) {
  const validas = [];
  const problemas = [];
  filas.forEach((f, i) => {
    const n = i + 2; // línea del CSV (con cabecera)
    if (!f.id_plato) return; // sin plato: se salta (lo deja así --sugerir)
    const tabla = f.tabla || "Platos";
    if (!RE_ID.test(f.id_plato)) problemas.push(`línea ${n}: id_plato no válido`);
    else if (tabla !== "Platos" && tabla !== "Vinos") problemas.push(`línea ${n}: tabla tiene que ser Platos o Vinos`);
    else if (!f.fichero || f.fichero.includes("..") || path.isAbsolute(f.fichero)) problemas.push(`línea ${n}: fichero no válido`);
    else validas.push({ id: f.id_plato, fichero: f.fichero, tabla });
  });
  return { validas, problemas };
}

/** Platos de un JSON: array, o la salida de `supabase db query` ({ rows: [...] }). */
export function platosDeJson(texto) {
  const j = JSON.parse(texto);
  const filas = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : [];
  return filas.filter((p) => p && RE_ID.test(String(p.id ?? "")) && p.nombre).map((p) => ({ id: String(p.id), nombre: String(p.nombre), categoria: p.categoria ?? "", conFoto: typeof p.con_foto === "boolean" ? p.con_foto : "imagen_url" in p ? !!p.imagen_url : null }));
}

// ── Subida ───────────────────────────────────────────────────────────────────

/** Foto → JPEG original (sharp): EXIF aplicado, ≤ 4000 px, ≤ 8 MB. */
export async function convertir(ruta, sharp) {
  for (const calidad of [92, 86, 80, 72]) {
    const { data, info } = await sharp(ruta, { failOn: "none" })
      .rotate() // orientación EXIF
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: calidad, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength <= MAX_BYTES) return { bytes: data, ancho: info.width, alto: info.height };
  }
  throw new Error("pesa más de 8 MB incluso comprimida");
}

async function tokenPanel(url, anon) {
  if (process.env.PANEL_JWT?.trim()) return process.env.PANEL_JWT.trim();
  const email = process.env.PANEL_EMAIL?.trim();
  const clave = process.env.PANEL_PASSWORD;
  if (!email || !clave) throw new Error("Falta PANEL_JWT (o PANEL_EMAIL + PANEL_PASSWORD)");
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: clave }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`No se pudo entrar en el panel (${r.status})`);
  return j.access_token;
}

async function platosPublicos(url, anon) {
  const r = await fetch(`${url}/rest/v1/Platos?activado=eq.true&select=id,nombre,categoria,imagen_url&order=nombre`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!r.ok) throw new Error(`No se pudieron leer los platos (${r.status})`);
  return platosDeJson(await r.text());
}

function argumentos(argv) {
  const opcion = (n) => argv.includes(n);
  const valor = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { sugerir: opcion("--sugerir"), simular: opcion("--simular"), carpeta: valor("--carpeta"), csv: valor("--csv"), platos: valor("--platos"), salida: valor("--salida"), solo: valor("--solo") };
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (!a.carpeta || !existsSync(a.carpeta)) throw new Error("Falta --carpeta <dir> con las fotos");
  const solo = a.solo ? new Set(a.solo.split(",").map((x) => x.trim()).filter(Boolean)) : null;
  const ficheros = readdirSync(a.carpeta).filter((f) => EXTENSIONES.has(path.extname(f).toLowerCase()) && (!solo || solo.has(f))).sort();
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY?.trim();

  if (a.sugerir) {
    const platos = a.platos ? platosDeJson(readFileSync(a.platos, "utf8")) : url && anon ? await platosPublicos(url, anon) : null;
    if (!platos) throw new Error("Falta --platos <json> (o SUPABASE_URL + SUPABASE_ANON_KEY)");
    const s = sugerir(ficheros, platos);
    const csv = csvSugerencias(s);
    const salida = a.salida ?? "originales-sugerencias.csv";
    writeFileSync(salida, csv, "utf8");
    const con = s.filter((x) => x.mejor).length;
    console.log(`${ficheros.length} fotos, ${platos.length} platos activos: ${con} con sugerencia, ${ficheros.length - con} sin plato parecido.`);
    console.log(`CSV: ${path.resolve(salida)} (revísalo antes de subir con --csv).`);
    return;
  }

  if (!a.csv) throw new Error("Falta --csv <fichero> (o --sugerir)");
  const { validas, problemas } = filasParaSubir(leerCsv(readFileSync(a.csv, "utf8")));
  if (problemas.length) throw new Error(`CSV con problemas:\n  ${problemas.join("\n  ")}`);
  for (const v of validas) if (!existsSync(path.join(a.carpeta, v.fichero))) throw new Error(`No existe ${v.fichero} en ${a.carpeta}`);
  const sharp = (await import("sharp")).default;
  if (!a.simular && (!url || !anon)) throw new Error("Faltan SUPABASE_URL y SUPABASE_ANON_KEY");
  const token = a.simular ? null : await tokenPanel(url, anon);
  let bien = 0;
  for (const v of validas) {
    const { bytes, ancho, alto } = await convertir(path.join(a.carpeta, v.fichero), sharp);
    if (a.simular) {
      console.log(`[simular] ${v.fichero} → ${v.tabla} ${v.id} (${ancho}×${alto}, ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }
    const form = new FormData();
    form.set("tabla", v.tabla);
    form.set("id", v.id);
    form.set("archivo", new Blob([bytes], { type: "image/jpeg" }), "original.jpg");
    const r = await fetch(`${url}/functions/v1/instagram-drive?accion=subir_original`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${token}` }, body: form });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      bien++;
      console.log(`OK ${v.fichero} → ${j.marca}/${j.nombre} (${ancho}×${alto}${j.reemplazado ? ", reemplazado" : ""})`);
    } else console.error(`FALLO ${v.fichero} → ${v.id}: ${j.error ?? `HTTP ${r.status}`}`);
  }
  if (!a.simular) console.log(`${bien}/${validas.length} originales subidos.`);
  if (!a.simular && bien < validas.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(`ERROR: ${e?.message ?? e}`);
    process.exit(1);
  });
}

