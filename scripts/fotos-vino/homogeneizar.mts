/**
 * Homogeneizar las fotos de vino YA SUBIDAS (gratis, en local):
 * botella sin fondo (rembg, recortar.py) + fondo fijo de la carta, con el
 * MISMO código de composición que el panel (src/components/carta/composicionVino.ts).
 *
 * Instalación (una vez):  cd scripts/fotos-vino && npm install
 * Pasos (desde scripts/fotos-vino; <dir> = carpeta de trabajo FUERA del repo):
 *   1. npx tsx homogeneizar.mts descargar <dir>
 *        Lee la tabla Vinos y baja las fotos sin procesar a <dir>/orig/<id>.<ext>.
 *   2. <venv>/Scripts/python -I recortar.py <dir>
 *        Quita el fondo → <dir>/sinfondo/<id>.png
 *   3. npx tsx homogeneizar.mts componer <dir> [--tema oscuro|burdeos|champan]
 *        → <dir>/carta/<id>.webp y <dir>/revision/<id>.jpg (antes | después) para mirarlas.
 *   4. npx tsx homogeneizar.mts subir <dir> [--solo id1,id2] [--aplicar]
 *        SIN --aplicar solo enseña lo que haría. CON --aplicar sube a Storage
 *        en ruta NUEVA (`<original>-carta-<ext>.webp`; el original no se toca)
 *        y cambia imagen_url (solo si no ha cambiado desde la descarga).
 *   5. npx tsx homogeneizar.mts deshacer --id <vinoId>|--todos [--aplicar]
 *        Vuelve imagen_url a la foto original (deducida del nombre).
 *   Tras subir: publicar la web (la carta se prerenderiza en build).
 *
 * Reanudable: cada paso salta lo que ya está hecho; una foto cuya imagen_url
 * ya contiene «-carta» se considera procesada.
 *
 * Entorno: SUPABASE_URL (por defecto el proyecto del panel), SUPABASE_KEY
 * (anon basta para descargar) y SUPABASE_SERVICE_ROLE_KEY (solo --aplicar).
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { componerEnLienzo, TEMAS, FONDO_ACTIVO, type NombreTema } from "../../src/components/carta/composicionVino.ts";
import { esFotoCarta, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "../../src/components/carta/rutasFotoCarta.ts";

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://jeamoczmbfsnwkfjxcyo.supabase.co").replace(/\/$/, "");
const MARCADOR = "/storage/v1/object/public/vinos/";
const CONCURRENCIA = 2;

interface Fila {
  id: string;
  nombre: string;
  imagen_url: string | null;
}
interface Entrada extends Fila {
  imagen_url: string;
  /** Ruta del objeto en el bucket `vinos`. */
  ruta: string;
}

const args = process.argv.slice(2);
const cmd = args[0];
const opcion = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const aplicar = args.includes("--aplicar");

function clave(servicio: boolean): string {
  const k = servicio ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    console.error(servicio ? "Falta SUPABASE_SERVICE_ROLE_KEY (necesaria con --aplicar)" : "Falta SUPABASE_KEY (anon) o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(2);
  }
  return k;
}

function rutaDeUrl(url: string): string | null {
  const limpia = url.split("?")[0].split("#")[0];
  const i = limpia.indexOf(MARCADOR);
  return i >= 0 ? decodeURIComponent(limpia.slice(i + MARCADOR.length)) : null;
}

async function leerVinos(): Promise<Fila[]> {
  const k = clave(false);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Vinos?select=id,nombre,imagen_url&imagen_url=not.is.null&order=nombre`, {
    headers: { apikey: k, Authorization: `Bearer ${k}` },
  });
  if (!res.ok) throw new Error(`Leer Vinos: ${res.status} ${await res.text()}`);
  return res.json();
}

async function enParalelo<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (siguiente < items.length) {
        const i = siguiente++;
        await fn(items[i], i);
      }
    }),
  );
}

const manifiesto = (dir: string) => join(dir, "manifiesto.json");
const leerManifiesto = (dir: string): Entrada[] => JSON.parse(readFileSync(manifiesto(dir), "utf8"));

async function descargar(dir: string) {
  const filas = await leerVinos();
  const entradas: Entrada[] = [];
  let procesadas = 0;
  for (const f of filas) {
    if (!f.imagen_url) continue;
    if (esFotoCarta(f.imagen_url)) {
      procesadas++;
      continue;
    }
    const ruta = rutaDeUrl(f.imagen_url);
    if (!ruta) {
      console.warn(`Salto «${f.nombre}»: la foto no está en el bucket vinos (${f.imagen_url})`);
      continue;
    }
    entradas.push({ ...f, imagen_url: f.imagen_url, ruta });
  }
  mkdirSync(join(dir, "orig"), { recursive: true });
  writeFileSync(manifiesto(dir), JSON.stringify(entradas, null, 2));
  console.log(`${filas.length} vinos con foto: ${procesadas} ya procesados, ${entradas.length} pendientes.`);
  await enParalelo(entradas, 4, async (e) => {
    const ext = e.ruta.split(".").pop() || "img";
    const destino = join(dir, "orig", `${e.id}.${ext}`);
    if (existsSync(destino)) return;
    const res = await fetch(e.imagen_url.split("?")[0]);
    if (!res.ok) {
      console.error(`ERROR descargando «${e.nombre}»: ${res.status}`);
      return;
    }
    writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  });
  console.log(`Fotos en ${join(dir, "orig")}. Siguiente: python -I recortar.py "${dir}"`);
}

async function componer(dir: string) {
  const tema = (opcion("--tema") as NombreTema | undefined) ?? FONDO_ACTIVO;
  if (!TEMAS[tema]) throw new Error(`Tema desconocido: ${tema}. Opciones: ${Object.keys(TEMAS).join(", ")}`);
  const entradas = leerManifiesto(dir);
  mkdirSync(join(dir, "carta"), { recursive: true });
  mkdirSync(join(dir, "revision"), { recursive: true });
  const origs = new Map(readdirSync(join(dir, "orig")).map((f) => [f.split(".")[0], join(dir, "orig", f)]));
  const crear = (w: number, h: number) => createCanvas(w, h) as never;
  let hechas = 0;
  for (const e of entradas) {
    const png = join(dir, "sinfondo", `${e.id}.png`);
    if (!existsSync(png)) {
      console.warn(`Sin recorte todavía: «${e.nombre}»`);
      continue;
    }
    const img = await loadImage(readFileSync(png));
    const lienzo = componerEnLienzo(crear, img as never, img.width, img.height, TEMAS[tema]) as unknown as ReturnType<typeof createCanvas> | null;
    if (!lienzo) {
      console.error(`ERROR «${e.nombre}»: el recorte salió vacío`);
      continue;
    }
    writeFileSync(join(dir, "carta", `${e.id}.webp`), lienzo.toBuffer("image/webp", 88));
    const orig = origs.get(e.id);
    if (orig) {
      const W = 450;
      const H = 600;
      const c = createCanvas(W * 2 + 12, H);
      const x = c.getContext("2d");
      x.fillStyle = "#fff";
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(await loadImage(readFileSync(orig)), 0, 0, W, H);
      x.drawImage(lienzo, W + 12, 0, W, H);
      writeFileSync(join(dir, "revision", `${e.id}.jpg`), c.toBuffer("image/jpeg", 82));
    }
    hechas++;
  }
  console.log(`${hechas} fotos compuestas con el tema «${tema}» en ${join(dir, "carta")} (revísalas en ${join(dir, "revision")}).`);
}

async function subir(dir: string) {
  const solo = opcion("--solo")?.split(",").map((s) => s.trim()).filter(Boolean);
  let entradas = leerManifiesto(dir).filter((e) => existsSync(join(dir, "carta", `${e.id}.webp`)));
  if (solo?.length) entradas = entradas.filter((e) => solo.includes(e.id));
  // Estado actual: no pisar una foto que alguien ha cambiado desde la descarga.
  const actuales = new Map((await leerVinos()).map((f) => [f.id, f.imagen_url]));
  const k = aplicar ? clave(true) : "";
  const errores: string[] = [];
  let ok = 0;
  await enParalelo(entradas, CONCURRENCIA, async (e) => {
    const actual = actuales.get(e.id);
    if (actual !== e.imagen_url) {
      console.warn(`Salto «${e.nombre}»: imagen_url ha cambiado desde la descarga`);
      return;
    }
    const destino = rutaCartaDesdeOriginal(e.ruta, "webp");
    const publica = `${SUPABASE_URL}${MARCADOR}${destino.split("/").map(encodeURIComponent).join("/")}`;
    if (!aplicar) {
      console.log(`[prueba] «${e.nombre}»: ${e.ruta} → ${destino}`);
      return;
    }
    try {
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/vinos/${destino.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "image/webp", "x-upsert": "true", "cache-control": "max-age=31536000" },
        body: readFileSync(join(dir, "carta", `${e.id}.webp`)),
      });
      if (!up.ok) throw new Error(`Storage ${up.status} ${await up.text()}`);
      const nueva = `${publica}?t=${Date.now()}`;
      const url = `${SUPABASE_URL}/rest/v1/Vinos?id=eq.${e.id}&imagen_url=eq.${encodeURIComponent(e.imagen_url)}`;
      const pa = await fetch(url, {
        method: "PATCH",
        headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ imagen_url: nueva }),
      });
      if (!pa.ok) throw new Error(`Vinos ${pa.status} ${await pa.text()}`);
      const filas = (await pa.json()) as unknown[];
      if (!filas.length) throw new Error("imagen_url cambió justo antes de actualizar; no se toca");
      ok++;
      console.log(`OK «${e.nombre}» → ${destino}`);
    } catch (err) {
      errores.push(`${e.id} «${e.nombre}»: ${(err as Error).message}`);
      console.error(`ERROR «${e.nombre}»: ${(err as Error).message}`);
    }
  });
  if (!aplicar) {
    console.log(`\nModo prueba: no se ha tocado nada. Repite con --aplicar para subir ${entradas.length} fotos.`);
    return;
  }
  console.log(`\nSubidas ${ok}/${entradas.length}. Errores: ${errores.length}`);
  errores.forEach((x) => console.log(`  - ${x}`));
  if (errores.length) console.log("Reintentar: vuelve a lanzar «subir --aplicar» (salta las ya hechas).");
  if (ok) console.log("Ahora hay que publicar la web (rebuild-webs o despliegue de casa-tomas-story): la carta se prerenderiza en build.");
}

async function deshacer() {
  const id = opcion("--id");
  const todos = args.includes("--todos");
  if (!id && !todos) throw new Error("Indica --id <vinoId> o --todos");
  const filas = (await leerVinos()).filter((f) => (todos || f.id === id) && f.imagen_url && rutaOriginalDesdeCarta(f.imagen_url));
  if (!filas.length) {
    console.log("Nada que deshacer (ningún vino con foto de carta derivada de una original).");
    return;
  }
  const k = aplicar ? clave(true) : "";
  for (const f of filas) {
    const original = `${rutaOriginalDesdeCarta(f.imagen_url)}?t=${Date.now()}`;
    if (!aplicar) {
      console.log(`[prueba] «${f.nombre}»: volvería a ${original}`);
      continue;
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Vinos?id=eq.${f.id}`, {
      method: "PATCH",
      headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imagen_url: original }),
    });
    console.log(res.ok ? `OK «${f.nombre}» vuelve a la original` : `ERROR «${f.nombre}»: ${res.status} ${await res.text()}`);
  }
}

const dir = args[1];
const ayuda = () => {
  console.log("Uso: npx tsx homogeneizar.mts <descargar|componer|subir> <dir> [opciones] | deshacer --id X|--todos [--aplicar]");
  process.exit(2);
};
if (cmd === "descargar" && dir) await descargar(dir);
else if (cmd === "componer" && dir) await componer(dir);
else if (cmd === "subir" && dir) await subir(dir);
else if (cmd === "deshacer") await deshacer();
else ayuda();
