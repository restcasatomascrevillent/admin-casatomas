#!/usr/bin/env node
/**
 * Sube al bucket público «instagram» de Supabase las FOTOS de la biblioteca
 * de las piezas de Instagram desde el prototipo instagram-studio, y regenera
 * el catálogo de src/lib/instagram/fotos.ts con las medidas REALES de lo que
 * se sube:
 *
 *   fotos/<marca>/<nombre>.jpg   (JPEG sRGB, lado mayor ≤ 2560 px, calidad 90,
 *                                 4:4:4; con sharp)
 *
 * Fuentes y logos NO van al bucket (decisión del dueño, para no llenarlo):
 * están en el propio panel, public/instagram/fuentes y public/instagram/logos.
 *
 * Idempotente: x-upsert (volver a ejecutarlo sobrescribe con lo mismo).
 * Necesita la migración 20261105090000_instagram.sql aplicada (crea el bucket).
 *
 * USO (desde la raíz del repo; la clave NUNCA se imprime):
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/instagram/subir-recursos.mjs
 *
 * Opciones:
 *   --origen <dir>     carpeta assets/ del prototipo (por defecto
 *                      ../instagram-studio/assets o ../../instagram-studio/assets)
 *   --solo-catalogo    no sube nada: solo convierte en memoria y regenera fotos.ts
 *   --simular          no sube nada ni escribe fotos.ts: lista lo que haría
 *
 * Sin sharp (dependencia del repo) las fotos se suben en su formato original
 * con las medidas de fotos.json, y se avisa.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOTOS_TS = path.join(RAIZ, "src", "lib", "instagram", "fotos.ts");
const BUCKET = "instagram";
const LADO_MAXIMO = 2560;
const CALIDAD = 90;
const MAX_BYTES = 8 * 1024 * 1024; // límite del bucket
const FONDO = { "casa-tomas": "#ffffff", touza: "#0a0a0a" };
// Criterios de aptitud (los mismos que el prototipo: src/marca/fotos.ts).
const POST = { ancho: 1080, alto: 1350 };
const STORY = { ancho: 1080, alto: 1920 };
const AMPLIACION_MAXIMA = 1.05;

const args = process.argv.slice(2);
const opcion = (n) => args.includes(n);
const valor = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const SIMULAR = opcion("--simular");
const SOLO_CATALOGO = opcion("--solo-catalogo");

function salir(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
}

// ── Origen ───────────────────────────────────────────────────────────────────
const candidatos = [valor("--origen"), path.join(RAIZ, "..", "instagram-studio", "assets"), path.join(RAIZ, "..", "..", "instagram-studio", "assets")].filter(Boolean);
const ORIGEN = candidatos.map((c) => path.resolve(c)).find((c) => existsSync(path.join(c, "fotos", "fotos.json")));
if (!ORIGEN) salir(`no encuentro la carpeta assets/ del prototipo (probadas: ${candidatos.join(", ")}). Usa --origen <dir>.`);

// ── Destino ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const SUBIR = !SIMULAR && !SOLO_CATALOGO;
if (SUBIR) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)) {
    salir("falta SUPABASE_URL (https://<ref>.supabase.co) en el entorno");
  }
  if (!CLAVE) salir("falta SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEY) en el entorno");
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("AVISO: sharp no está disponible: las fotos se suben sin convertir (formato original).");
}

const TIPOS = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const tipoDe = (f) => TIPOS[path.extname(f).toLowerCase()] ?? salir(`tipo de fichero no previsto: ${f}`);

/** Ficheros a subir: { ruta (en el bucket), cuerpo (Buffer), tipo }. */
const subidas = [];

// Fotos: JPEG sRGB y catálogo con las medidas reales.
const escala = (a, h, la, lh) => Math.max(la / a, lh / h);
const aptaPost = (a, h) => (h >= a && Math.min(a, h) >= POST.ancho) || escala(a, h, POST.ancho, POST.alto) <= AMPLIACION_MAXIMA;
const aptaStory = (a, h) => escala(a, h, STORY.ancho, STORY.alto) <= AMPLIACION_MAXIMA;

const fotosJson = JSON.parse(readFileSync(path.join(ORIGEN, "fotos", "fotos.json"), "utf8"));
const catalogo = [];
for (const f of fotosJson) {
  const original = path.join(ORIGEN, "fotos", ...f.ruta.split("/"));
  if (!existsSync(original)) salir(`falta la foto ${original}`);
  const nombre = path.basename(f.ruta, path.extname(f.ruta));
  let cuerpo;
  let ruta;
  let ancho = f.ancho;
  let alto = f.alto;
  if (sharp) {
    cuerpo = await sharp(original)
      .rotate()
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
      .flatten({ background: FONDO[f.marca] ?? "#ffffff" })
      .toColourspace("srgb")
      .withIccProfile("srgb")
      .jpeg({ quality: CALIDAD, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    const meta = await sharp(cuerpo).metadata();
    ancho = meta.width;
    alto = meta.height;
    ruta = `fotos/${f.marca}/${nombre}.jpg`;
  } else {
    cuerpo = readFileSync(original);
    ruta = `fotos/${f.marca}/${path.basename(f.ruta)}`;
  }
  if (cuerpo.length > MAX_BYTES) salir(`${ruta} ocupa ${(cuerpo.length / 1048576).toFixed(1)} MB (máximo 8 MB)`);
  subidas.push({ ruta, cuerpo, tipo: tipoDe(ruta) });
  catalogo.push({
    id: f.id,
    marca: f.marca,
    ruta,
    ancho,
    alto,
    tipo: f.tipo,
    aptaPost: aptaPost(ancho, alto),
    aptaStory: aptaStory(ancho, alto),
    descripcion: f.descripcion,
  });
}

// ── Catálogo en src/lib/instagram/fotos.ts ──────────────────────────────────
const INICIO = "// <catalogo>";
const FIN = "// </catalogo>";
function bloqueCatalogo() {
  const filas = catalogo.map((c) => `  ${JSON.stringify(c).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/","/g, '", "').replace(/,"/g, ', "').replace(/":/g, '": ')},`);
  return [
    `${INICIO} — generado por scripts/instagram/subir-recursos.mjs: no editar a mano.`,
    "export const FOTOS: readonly Foto[] = [",
    ...filas,
    "];",
    FIN,
  ].join("\n");
}
if (!SIMULAR) {
  const actual = readFileSync(FOTOS_TS, "utf8");
  const i = actual.indexOf(INICIO);
  const j = actual.indexOf(FIN);
  if (i < 0 || j < i) salir(`${FOTOS_TS} no tiene los marcadores ${INICIO} … ${FIN}`);
  const nuevo = actual.slice(0, i) + bloqueCatalogo() + actual.slice(j + FIN.length);
  if (nuevo !== actual) {
    writeFileSync(FOTOS_TS, nuevo);
    console.log(`Catálogo actualizado: ${path.relative(RAIZ, FOTOS_TS)} (${catalogo.length} fotos)`);
  } else {
    console.log(`Catálogo sin cambios (${catalogo.length} fotos)`);
  }
}

// ── Subida ───────────────────────────────────────────────────────────────────
const total = subidas.reduce((s, x) => s + x.cuerpo.length, 0);
console.log(`${subidas.length} ficheros (${(total / 1048576).toFixed(1)} MB) desde ${ORIGEN}`);
if (!SUBIR) {
  for (const s of subidas) console.log(`  ${SIMULAR ? "[simulado] " : "[no se sube] "}${s.ruta} (${s.tipo}, ${(s.cuerpo.length / 1024).toFixed(0)} KB)`);
  process.exit(0);
}

const cabeceras = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };
// El bucket tiene que existir (lo crea la migración): error claro si no.
const cubo = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: cabeceras });
if (!cubo.ok) salir(`el bucket «${BUCKET}» no existe o la clave no vale (HTTP ${cubo.status}). ¿Está aplicada 20261105090000_instagram.sql?`);

let fallos = 0;
for (const s of subidas) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${s.ruta.split("/").map(encodeURIComponent).join("/")}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { ...cabeceras, "Content-Type": s.tipo, "x-upsert": "true", "cache-control": "max-age=3600" },
    body: s.cuerpo,
  });
  if (r.ok) {
    console.log(`  OK ${s.ruta}`);
  } else {
    fallos++;
    console.error(`  FALLO ${s.ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}
if (fallos) salir(`${fallos} de ${subidas.length} ficheros no se han subido`);
console.log(`Listo: ${subidas.length} ficheros en ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`);
