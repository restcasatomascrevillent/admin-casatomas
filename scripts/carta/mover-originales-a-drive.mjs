/**
 * Mueve a Google Drive los ORIGINALES de la carta que aún están en Supabase
 * (decisión del dueño, 08/11/2026: «En Supabase no quiero guardar más que el
 * sticker, para no pasarme de memoria»). Ver docs/instagram-fotos.md,
 * «En Supabase solo el sticker».
 *
 *   - Fotos: `<id>.<ext>` en la raíz de los buckets `platos` y `vinos` que NO
 *     son la foto de la web de ninguna ficha, sino su original: el que se
 *     deduce del sticker (`<id>-carta-<ext>.webp` → `<id>.<ext>`) o cualquier
 *     `<id de la ficha>.<ext>`. Van a marketing/carta/<marca>/<nombre>-<id>.jpg
 *     con instagram-drive · subir_original (la misma Edge Function y la misma
 *     conversión que el panel: JPEG, EXIF aplicado, ≤ 4000 px, ≤ 8 MB) y se
 *     anotan en carta_fotos_originales. Si una ficha tiene varios, sube el de
 *     más píxeles; borra todos.
 *   - Vídeos: `platos/videos-originales/<id>.<ext>` → marketing/carta/<marca>/videos/
 *     con subir_original_video.
 *   - Nunca toca: las fotos de la web (las que apunta `imagen_url`), los
 *     stickers, los vídeos de la web, `pendientes/` y los ficheros que no son
 *     de ninguna ficha («huérfanos»: solo se listan).
 *   - Comprueba en Drive (descargar_original con comprobar: tamaño y medidas)
 *     y SOLO entonces borra del bucket, si ninguna ficha lo usa en ese momento.
 *     Si una ficha ya tenía original en Drive, no se sube otra vez: se
 *     comprueba que está y se borra el del bucket.
 *
 * AUTENTICACIÓN: sin service_role. La sesión de una cuenta del panel con
 * «Editar» en la carta (la misma RLS y los mismos permisos que el panel):
 * PANEL_JWT=<access_token> o PANEL_EMAIL + PANEL_PASSWORD, además de
 * SUPABASE_URL y SUPABASE_ANON_KEY. Las claves y el token NUNCA se imprimen.
 *
 * USO (desde la raíz del repo; primero en la DEMO; producción solo con el «sí» del dueño):
 *
 *   # Por defecto SIMULA: lista qué movería y cuántos MB liberaría, sin tocar nada.
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… PANEL_JWT=… node scripts/carta/mover-originales-a-drive.mjs
 *
 *   # Simular sin sesión, con el inventario de una consulta de SOLO LECTURA:
 *   node scripts/carta/mover-originales-a-drive.mjs --sql > inventario.sql
 *   npx supabase db query --linked -f inventario.sql -o json > inventario.json
 *   node scripts/carta/mover-originales-a-drive.mjs --inventario inventario.json
 *
 *   # Mover de verdad (hay que pedirlo explícitamente):
 *   … node scripts/carta/mover-originales-a-drive.mjs --aplicar [--limite 5] [--detalle]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BUCKETS = { platos: "Platos", vinos: "Vinos" };
export const CARPETA_VIDEOS = "videos-originales";
const RE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const RE_FOTO = /^([^/]+)\.(jpe?g|png|webp)$/i;
const RE_VIDEO = /^videos-originales\/([A-Za-z0-9_-]{1,100})\.(mp4|mov|m4v|webm|3gp|mkv)$/i;
const RE_CARTA = /-carta(?:-([a-z0-9]+))?\.(webp|jpe?g|png)$/i;
const TIPOS_VIDEO = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", mkv: "video/x-matroska" };

/** Consulta de SOLO LECTURA para `--inventario` (una fila JSON por objeto, ficha u original). */
export const SQL_INVENTARIO = `-- Inventario para scripts/carta/mover-originales-a-drive.mjs (solo lectura)
select jsonb_build_object('t','objeto','bucket',bucket_id,'ruta',name,'bytes',coalesce((metadata->>'size')::bigint,0)) as fila
  from storage.objects where bucket_id in ('platos','vinos')
union all
select jsonb_build_object('t','ficha','tabla','Platos','id',id::text,'nombre',nombre,'imagen_url',imagen_url,'video_url',video_url,'restaurante',restaurante,'touza',touza)
  from public."Platos"
union all
select jsonb_build_object('t','ficha','tabla','Vinos','id',id::text,'nombre',nombre,'imagen_url',imagen_url,'restaurante',restaurante,'touza',touza)
  from public."Vinos"
union all
select jsonb_build_object('t','original','tabla',case when plato_id is not null then 'Platos' else 'Vinos' end,'id',coalesce(plato_id,vino_id),'drive_id',drive_id)
  from public.carta_fotos_originales;
`;

// ── Lógica pura (se prueba con vitest) ───────────────────────────────────────

/** Ruta dentro del bucket de una URL pública (`…/object/public/<bucket>/<ruta>?t=…`). */
export function rutaDeUrl(url, bucket) {
  if (!url) return null;
  const limpia = String(url).split("?")[0].split("#")[0];
  const marca = `/object/public/${bucket}/`;
  const i = limpia.indexOf(marca);
  if (i < 0) return null;
  try {
    return decodeURIComponent(limpia.slice(i + marca.length)) || null;
  } catch {
    return null;
  }
}

/** Original que se deduce del sticker (`a-carta-jpg.webp` → `a.jpg`), como rutaOriginalDesdeCarta del panel. */
export function originalDeSticker(ruta) {
  if (!ruta) return null;
  const m = RE_CARTA.exec(ruta);
  if (!m || !m[1] || m[1] === "sinext") return null;
  return `${ruta.slice(0, m.index)}.${m[1]}`;
}

/** Filas del JSON de `supabase db query -o json` (o un array) → inventario. */
export function inventarioDeJson(texto) {
  const j = JSON.parse(texto);
  const filas = (Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : []).map((f) => (f && typeof f.fila === "object" ? f.fila : f));
  const inv = { objetos: [], fichas: [], originales: [] };
  for (const f of filas) {
    if (!f || typeof f !== "object") continue;
    if (f.t === "objeto") inv.objetos.push({ bucket: String(f.bucket), ruta: String(f.ruta), bytes: Number(f.bytes) || 0 });
    else if (f.t === "ficha") inv.fichas.push({ tabla: f.tabla, id: String(f.id), nombre: f.nombre ?? "", imagen_url: f.imagen_url ?? null, video_url: f.video_url ?? null });
    else if (f.t === "original") inv.originales.push({ tabla: f.tabla, id: String(f.id), drive_id: f.drive_id ?? null });
  }
  return inv;
}

/**
 * Qué se movería. Devuelve grupos por ficha ({ tabla, id, nombre, tipo, bucket,
 * candidatos: [{ ruta, bytes }], yaEnDrive }), lo que está en uso, los
 * huérfanos y un resumen. Un fichero que es original de varias fichas
 * (la Magnum comparte foto) sale en cada una y se borra una sola vez.
 */
export function planificar({ objetos, fichas, originales = [] }) {
  const porTabla = { Platos: new Map(), Vinos: new Map() };
  for (const f of fichas) if (porTabla[f.tabla]) porTabla[f.tabla].set(f.id, f);
  const conOriginal = new Set(originales.filter((o) => o.drive_id).map((o) => `${o.tabla}|${o.id}`));
  const grupos = new Map();
  const enUso = [];
  const huerfanos = [];
  const ignorados = [];
  const grupo = (tabla, ficha, tipo, bucket) => {
    const clave = `${tipo}|${tabla}|${ficha.id}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { tabla, id: ficha.id, nombre: ficha.nombre ?? "", tipo, bucket, candidatos: [], yaEnDrive: tipo === "foto" && conOriginal.has(`${tabla}|${ficha.id}`) });
    }
    return grupos.get(clave);
  };

  for (const o of objetos) {
    const tabla = BUCKETS[o.bucket];
    if (!tabla) continue;
    const fichasTabla = [...porTabla[tabla].values()];
    const video = o.bucket === "platos" ? RE_VIDEO.exec(o.ruta) : null;
    if (video) {
      const ficha = porTabla.Platos.get(video[1]);
      if (ficha) grupo("Platos", ficha, "video", o.bucket).candidatos.push({ ruta: o.ruta, bytes: o.bytes });
      else huerfanos.push(o);
      continue;
    }
    const foto = RE_FOTO.exec(o.ruta);
    if (!foto || o.ruta.includes("/") || RE_CARTA.test(o.ruta) || /-video\.[a-z0-9]+$/i.test(o.ruta)) {
      ignorados.push(o);
      continue;
    }
    const usada = fichasTabla.filter((f) => rutaDeUrl(f.imagen_url, o.bucket) === o.ruta);
    if (usada.length) {
      enUso.push({ ...o, fichas: usada.map((f) => f.id) });
      continue;
    }
    const duenas = fichasTabla.filter((f) => originalDeSticker(rutaDeUrl(f.imagen_url, o.bucket)) === o.ruta || f.id === foto[1]);
    if (!duenas.length) {
      huerfanos.push(o);
      continue;
    }
    for (const f of duenas) grupo(tabla, f, "foto", o.bucket).candidatos.push({ ruta: o.ruta, bytes: o.bytes });
  }

  const lista = [...grupos.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.tabla.localeCompare(b.tabla) || String(a.nombre).localeCompare(String(b.nombre)));
  for (const g of lista) {
    g.candidatos.sort((a, b) => b.bytes - a.bytes);
    // En la simulación, el más pesado; al aplicar, el de más píxeles.
    g.principal = g.candidatos[0]?.ruta ?? null;
  }
  const unicos = new Map();
  for (const g of lista) for (const c of g.candidatos) unicos.set(`${g.bucket}/${c.ruta}`, c.bytes);
  const suma = (xs) => xs.reduce((s, x) => s + x, 0);
  const porBucket = {};
  for (const [clave, bytes] of unicos) {
    const b = clave.split("/")[0];
    const tipo = clave.includes(`/${CARPETA_VIDEOS}/`) ? "videos" : "fotos";
    const k = `${b}·${tipo}`;
    porBucket[k] ??= { ficheros: 0, bytes: 0 };
    porBucket[k].ficheros++;
    porBucket[k].bytes += bytes;
  }
  return {
    grupos: lista,
    enUso,
    huerfanos,
    ignorados,
    resumen: {
      fichas: lista.length,
      subidas: lista.filter((g) => !g.yaEnDrive).length,
      ficheros: unicos.size,
      bytes: suma([...unicos.values()]),
      porBucket,
      huerfanos: { ficheros: huerfanos.length, bytes: suma(huerfanos.map((h) => h.bytes)) },
      enUso: { ficheros: enUso.length, bytes: suma(enUso.map((h) => h.bytes)) },
    },
  };
}

export const mb = (b) => (b / 1024 / 1024).toFixed(2);

/** Informe de texto de un plan. */
export function informe(plan, { detalle = false } = {}) {
  const r = plan.resumen;
  const l = [];
  l.push(`Originales en Supabase que pasarían a Google Drive: ${r.ficheros} ficheros, ${mb(r.bytes)} MB (de ${r.fichas} fichas; ${r.subidas} subidas a Drive).`);
  for (const [k, v] of Object.entries(r.porBucket).sort()) l.push(`  · ${k}: ${v.ficheros} ficheros, ${mb(v.bytes)} MB`);
  l.push(`No se tocan: ${r.enUso.ficheros} fotos de la web sin sticker (${mb(r.enUso.bytes)} MB) y ${r.huerfanos.ficheros} huérfanos sin ficha (${mb(r.huerfanos.bytes)} MB).`);
  if (detalle) {
    for (const g of plan.grupos) {
      const extra = g.yaEnDrive ? " [ya en Drive: solo se borra]" : "";
      l.push(`  ${g.tipo} ${g.tabla} ${g.id} «${g.nombre}»${extra}: ${g.candidatos.map((c) => `${c.ruta} (${mb(c.bytes)} MB)${c.ruta === g.principal ? " ← sube" : ""}`).join(", ")}`);
    }
    for (const h of plan.huerfanos) l.push(`  huérfano ${h.bucket}/${h.ruta} (${mb(h.bytes)} MB)`);
  }
  return l.join("\n");
}

/**
 * ¿Lo que dice Drive (descargar_original con comprobar) cuadra con lo subido?
 * El tamaño tiene que ser el mismo; las medidas, si Drive ya las sabe.
 */
export function cuadra(info, subido) {
  if (!info || !subido) return false;
  if (Number(info.bytes) !== Number(subido.bytes)) return false;
  if (subido.ancho && info.ancho && (info.ancho !== subido.ancho || info.alto !== subido.alto)) return false;
  return true;
}

/** Rutas que se pueden borrar: todas las fichas que las tenían quedaron bien en Drive. */
export function rutasBorrables(plan, correctas) {
  const fallan = new Set();
  const todas = new Map();
  for (const g of plan.grupos) {
    const ok = correctas.has(`${g.tipo}|${g.tabla}|${g.id}`);
    for (const c of g.candidatos) {
      const k = `${g.bucket}/${c.ruta}`;
      todas.set(k, { bucket: g.bucket, ruta: c.ruta });
      if (!ok) fallan.add(k);
    }
  }
  return [...todas.entries()].filter(([k]) => !fallan.has(k)).map(([, v]) => v);
}

// ── Red (solo con sesión) ─────────────────────────────────────────────────────

async function tokenPanel(url, anon) {
  if (process.env.PANEL_JWT?.trim()) return process.env.PANEL_JWT.trim();
  const email = process.env.PANEL_EMAIL?.trim();
  const clave = process.env.PANEL_PASSWORD;
  if (!email || !clave) throw new Error("Falta PANEL_JWT (o PANEL_EMAIL + PANEL_PASSWORD) de una cuenta con «Editar» en la carta");
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: clave }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`No se pudo entrar en el panel (${r.status})`);
  return j.access_token;
}

function cliente(url, anon, token) {
  const cab = (extra = {}) => ({ apikey: anon, Authorization: `Bearer ${token}`, ...extra });
  return {
    async rest(ruta) {
      const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cab({ Accept: "application/json" }) });
      if (!r.ok) throw new Error(`REST ${ruta.split("?")[0]} respondió ${r.status}`);
      return r.json();
    },
    async listar(bucket, prefijo = "") {
      const salida = [];
      for (let offset = 0; ; offset += 1000) {
        const r = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
          method: "POST",
          headers: cab({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefix: prefijo, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
        });
        if (!r.ok) throw new Error(`No se pudo listar ${bucket}/${prefijo} (${r.status})`);
        const pagina = await r.json();
        // Las carpetas salen con id null: no son ficheros.
        for (const o of pagina) if (o.id) salida.push({ bucket, ruta: prefijo ? `${prefijo}/${o.name}` : o.name, bytes: Number(o.metadata?.size) || 0 });
        if (pagina.length < 1000) break;
      }
      return salida;
    },
    async bajar(bucket, ruta) {
      const r = await fetch(`${url}/storage/v1/object/public/${bucket}/${ruta.split("/").map(encodeURIComponent).join("/")}`);
      if (!r.ok) throw new Error(`No se pudo bajar ${bucket}/${ruta} (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    },
    async drive(accion, init) {
      const r = await fetch(`${url}/functions/v1/instagram-drive?accion=${accion}`, { ...init, headers: cab(init.headers ?? {}) });
      const j = await r.json().catch(() => ({}));
      return { estado: r.status, j };
    },
    async borrar(bucket, rutas) {
      const r = await fetch(`${url}/storage/v1/object/${bucket}`, { method: "DELETE", headers: cab({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: rutas }) });
      if (!r.ok) throw new Error(`No se pudo borrar en ${bucket} (${r.status})`);
      const j = await r.json().catch(() => []);
      return Array.isArray(j) ? j.length : 0;
    },
  };
}

async function inventarioEnVivo(c) {
  const objetos = [...(await c.listar("platos")), ...(await c.listar("platos", CARPETA_VIDEOS)), ...(await c.listar("vinos"))];
  const platos = await c.rest("Platos?select=id,nombre,imagen_url,video_url");
  const vinos = await c.rest("Vinos?select=id,nombre,imagen_url");
  const originales = await c.rest("carta_fotos_originales?select=plato_id,vino_id,drive_id").catch(() => []);
  return {
    objetos,
    fichas: [...platos.map((f) => ({ tabla: "Platos", ...f, id: String(f.id) })), ...vinos.map((f) => ({ tabla: "Vinos", ...f, id: String(f.id) }))],
    originales: originales.map((o) => ({ tabla: o.plato_id ? "Platos" : "Vinos", id: String(o.plato_id ?? o.vino_id), drive_id: o.drive_id })),
  };
}

const comprobar = (c, g) =>
  c.drive("descargar_original", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabla: g.tabla, id: g.id, tipo: g.tipo, comprobar: true }) });

/** Sube a Drive el original de un grupo y comprueba que está. true si quedó bien. */
async function moverGrupo(c, g, sharp, convertir) {
  if (g.yaEnDrive) {
    const { estado, j } = await comprobar(c, g);
    if (estado === 200 && j.ok) return { ok: true, texto: "ya estaba en Drive" };
    return { ok: false, texto: `anotado en carta_fotos_originales pero Drive no lo da (${j.error ?? estado})` };
  }
  if (g.tipo === "video") {
    const principal = g.candidatos[0];
    const bytes = await c.bajar(g.bucket, principal.ruta);
    const ext = principal.ruta.split(".").pop().toLowerCase();
    const form = new FormData();
    form.set("tabla", "Platos");
    form.set("id", g.id);
    form.set("archivo", new Blob([bytes], { type: TIPOS_VIDEO[ext] ?? "video/mp4" }), `${g.id}.${ext}`);
    const sub = await c.drive("subir_original_video", { method: "POST", body: form });
    if (sub.estado !== 200 || !sub.j.ok) return { ok: false, texto: `no se pudo subir (${sub.j.error ?? sub.estado})` };
    const { estado, j } = await comprobar(c, g);
    return estado === 200 && cuadra(j, { bytes: bytes.byteLength }) ? { ok: true, texto: `vídeo ${mb(bytes.byteLength)} MB en Drive` } : { ok: false, texto: "Drive no devuelve el mismo tamaño" };
  }
  // Foto: la de más píxeles (a igualdad, la más pesada).
  let mejor = null;
  for (const cand of g.candidatos) {
    const bytes = await c.bajar(g.bucket, cand.ruta);
    const m = await sharp(bytes, { failOn: "none" }).metadata().catch(() => null);
    const px = (m?.width ?? 0) * (m?.height ?? 0);
    if (!mejor || px > mejor.px || (px === mejor.px && bytes.byteLength > mejor.bytes.byteLength)) mejor = { ruta: cand.ruta, bytes, px };
  }
  if (!mejor || mejor.px === 0) return { ok: false, texto: "ningún candidato es una imagen legible" };
  const jpeg = await convertir(mejor.bytes, sharp);
  const form = new FormData();
  form.set("tabla", g.tabla);
  form.set("id", g.id);
  form.set("archivo", new Blob([jpeg.bytes], { type: "image/jpeg" }), "original.jpg");
  const sub = await c.drive("subir_original", { method: "POST", body: form });
  if (sub.estado !== 200 || !sub.j.ok) return { ok: false, texto: `no se pudo subir ${mejor.ruta} (${sub.j.error ?? sub.estado})` };
  const { estado, j } = await comprobar(c, g);
  if (estado !== 200 || !cuadra(j, { bytes: jpeg.bytes.byteLength, ancho: jpeg.ancho, alto: jpeg.alto })) return { ok: false, texto: "Drive no devuelve el mismo tamaño o medidas" };
  return { ok: true, texto: `${mejor.ruta} → ${sub.j.marca}/${sub.j.nombre} (${jpeg.ancho}×${jpeg.alto})` };
}

function argumentos(argv) {
  const valor = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    aplicar: argv.includes("--aplicar"),
    sql: argv.includes("--sql"),
    detalle: argv.includes("--detalle"),
    inventario: valor("--inventario"),
    limite: valor("--limite") ? Math.max(1, Number(valor("--limite")) || 1) : Infinity,
  };
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.sql) {
    process.stdout.write(SQL_INVENTARIO);
    return;
  }
  if (a.aplicar && a.inventario) throw new Error("--aplicar lee el estado en vivo: no se puede usar con --inventario");
  let inv;
  let c = null;
  if (a.inventario) inv = inventarioDeJson(readFileSync(a.inventario, "utf8"));
  else {
    const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
    const anon = process.env.SUPABASE_ANON_KEY?.trim();
    if (!url || !anon) throw new Error("Faltan SUPABASE_URL y SUPABASE_ANON_KEY (o usa --inventario <json>)");
    c = cliente(url, anon, await tokenPanel(url, anon));
    inv = await inventarioEnVivo(c);
  }
  const plan = planificar(inv);
  console.log(a.aplicar ? "== APLICAR ==" : "== SIMULACIÓN (no se toca nada; para mover de verdad: --aplicar) ==");
  console.log(informe(plan, { detalle: a.detalle || a.aplicar }));
  if (!a.aplicar) return;

  const sharp = (await import("sharp")).default;
  // La misma conversión que importar-originales (y que el panel). Import diferido: ese fichero lleva shebang.
  const { convertir } = await import("../instagram/importar-originales.mjs");
  const correctas = new Set();
  let n = 0;
  for (const g of plan.grupos) {
    if (n++ >= a.limite) break;
    const r = await moverGrupo(c, g, sharp, convertir).catch((e) => ({ ok: false, texto: e?.message ?? String(e) }));
    console.log(`${r.ok ? "OK   " : "FALLO"} ${g.tipo} ${g.tabla} ${g.id}: ${r.texto}`);
    if (r.ok) correctas.add(`${g.tipo}|${g.tabla}|${g.id}`);
  }
  // Antes de borrar, el estado de AHORA: nada que una ficha use como foto de la web.
  const vivo = await inventarioEnVivo(c);
  const usadas = new Set();
  for (const f of vivo.fichas) {
    for (const b of Object.keys(BUCKETS)) {
      const r = rutaDeUrl(f.imagen_url, b);
      if (r) usadas.add(`${b}/${r}`);
    }
    const v = rutaDeUrl(f.video_url, "platos");
    if (v) usadas.add(`platos/${v}`);
  }
  const borrar = rutasBorrables(plan, correctas).filter((x) => !usadas.has(`${x.bucket}/${x.ruta}`));
  let borrados = 0;
  let liberados = 0;
  const bytesDe = new Map(inv.objetos.map((o) => [`${o.bucket}/${o.ruta}`, o.bytes]));
  for (const b of Object.keys(BUCKETS)) {
    const rutas = borrar.filter((x) => x.bucket === b).map((x) => x.ruta);
    for (let i = 0; i < rutas.length; i += 100) {
      const trozo = rutas.slice(i, i + 100);
      borrados += await c.borrar(b, trozo);
      liberados += trozo.reduce((s, r) => s + (bytesDe.get(`${b}/${r}`) ?? 0), 0);
    }
  }
  console.log(`${correctas.size}/${Math.min(plan.grupos.length, a.limite)} fichas con su original en Drive; ${borrados} ficheros borrados del bucket (${mb(liberados)} MB).`);
  if (correctas.size < Math.min(plan.grupos.length, a.limite)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(`ERROR: ${e?.message ?? e}`);
    process.exit(1);
  });
}
