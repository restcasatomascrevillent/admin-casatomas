/**
 * Rellena "Platos".drive_folder_id y "Vinos".drive_folder_id emparejando cada
 * plato o vino con su carpeta del árbol de Drive de Casa Tomás
 * (MARKETING/Platos/<NN Categoría>/<plato> y MARKETING/Vinos/<Tipo>/<vino>).
 * Mudanza del Drive del 15/11/2026: ver casatomas-recursos/drive/PLAN-MUDANZA.md
 * (paso 7) y docs/instagram-fotos.md. Necesita la migración
 * 20261201120000_carta_drive_folder_id (las columnas).
 *
 * De dónde salen las carpetas (id de Drive, ruta y, si lo hay, plato_id):
 *   --csv <ruta>   el inventario estructura-drive.csv (columnas ruta,id,tipo,plato_id,categoria).
 *                  Por defecto casatomas-recursos/drive/estructura-drive.csv si existe.
 *   --funcion      pregunta a la Edge Function instagram-drive (listar_platos): solo Platos,
 *                  no Vinos (no tienen listado propio). Hace falta sesión del panel.
 *
 * Cómo se empareja (sin tildes ni mayúsculas):
 *   1. Por plato_id, si el CSV lo trae y esa ficha existe.
 *   2. Por nombre exacto. Si hay varias carpetas o varias fichas con el mismo
 *      nombre, desempata la categoría (sin el «NN » del prefijo); si aun así
 *      queda más de una, NO se empareja y se avisa.
 *   Una ficha que ya tiene un id distinto no se toca (salvo --sobrescribir).
 *
 * POR DEFECTO SOLO SIMULA: cuenta y enseña qué escribiría, sin tocar nada.
 * Para escribir hay que pedirlo: --aplicar.
 *
 * AUTENTICACIÓN para leer las fichas (y escribirlas con --aplicar): sin
 * service_role, con la sesión de una cuenta del panel con «Editar» en la carta
 * (misma RLS que el panel): PANEL_JWT=<access_token> o PANEL_EMAIL + PANEL_PASSWORD,
 * más SUPABASE_URL y SUPABASE_ANON_KEY. Nunca se imprimen. Sin sesión se puede
 * simular con --fichas <json> (lista de { tabla, id, nombre, categoria, drive_folder_id }).
 *
 * USO (desde la raíz del repo; primero en la DEMO; producción solo con el «sí» del dueño):
 *
 *   # Simular (no escribe nada):
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… PANEL_JWT=… node scripts/carta/vincular-carpetas-drive.mjs --csv ../casatomas-recursos/drive/estructura-drive.csv
 *
 *   # Escribir de verdad:
 *   … node scripts/carta/vincular-carpetas-drive.mjs --csv … --aplicar [--detalle] [--sobrescribir]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RE_ID_CARPETA = /^[A-Za-z0-9_-]{10,200}$/;
const CSV_POR_DEFECTO = "../casatomas-recursos/drive/estructura-drive.csv";

// ── Lógica pura (se prueba con vitest) ───────────────────────────────────────

/** Sin tildes, en minúsculas y con los espacios colapsados. */
export function normalizar(t) {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** «03 Entrantes fríos» → «Entrantes fríos». */
export const sinPrefijoNumero = (t) => String(t ?? "").replace(/^\s*\d+\s+/, "").trim();

/** CSV con comillas («"a,b"», «""»), BOM y saltos \r\n → matriz de filas. */
export function parsearCsv(texto) {
  const t = String(texto).replace(/^﻿/, "");
  const filas = [];
  let fila = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === ",") {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      campo = "";
      if (fila.some((c) => c !== "")) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo);
  if (fila.some((c) => c !== "")) filas.push(fila);
  return filas;
}

/**
 * Carpetas de plato y de vino del inventario estructura-drive.csv: las que
 * están en MARKETING/Platos/<categoría>/<plato> y MARKETING/Vinos/<tipo>/<vino>
 * (cuatro tramos de ruta; las subcarpetas «Vídeos» y las categorías no cuentan).
 */
export function carpetasDeCsv(texto) {
  const filas = parsearCsv(texto);
  if (!filas.length) return [];
  const cab = filas[0].map((c) => c.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  const iRuta = col("ruta");
  const iId = col("id");
  const iPlato = col("plato_id");
  if (iRuta < 0 || iId < 0) throw new Error("El CSV tiene que traer las columnas «ruta» e «id»");
  const salida = [];
  for (const f of filas.slice(1)) {
    const tramos = String(f[iRuta] ?? "").split("/").map((x) => x.trim());
    const id = String(f[iId] ?? "").trim();
    if (tramos.length !== 4 || tramos[0].toLowerCase() !== "marketing" || !RE_ID_CARPETA.test(id)) continue;
    const tabla = tramos[1] === "Platos" ? "Platos" : tramos[1] === "Vinos" ? "Vinos" : null;
    if (!tabla) continue;
    const platoId = iPlato >= 0 ? String(f[iPlato] ?? "").trim() : "";
    salida.push({ tabla, carpetaId: id, nombre: tramos[3], categoria: tramos[2], ruta: tramos.join("/"), fichaId: platoId || null });
  }
  return salida;
}

/** Carpetas del árbol que devuelve instagram-drive · listar_platos (solo Platos). */
export function carpetasDeFuncion(respuesta) {
  const salida = [];
  for (const cat of respuesta?.categorias ?? []) {
    for (const p of cat.platos ?? []) {
      if (!RE_ID_CARPETA.test(String(p.id ?? ""))) continue;
      salida.push({ tabla: "Platos", carpetaId: p.id, nombre: p.nombre, categoria: cat.nombre, ruta: `MARKETING/Platos/${cat.nombre}/${p.nombre}`, fichaId: null });
    }
  }
  return salida;
}

/**
 * Empareja fichas ({ tabla, id, nombre, categoria, drive_folder_id }) con
 * carpetas (de carpetasDeCsv / carpetasDeFuncion). Devuelve:
 *   escribir      [{ tabla, id, nombre, carpetaId, ruta, por, antes }]  (lo que se guardaría)
 *   yaVinculadas  fichas que ya tienen justo ese id
 *   distintas     fichas con otro id guardado (no se tocan sin --sobrescribir): se escriben solo si `sobrescribir`
 *   ambiguas      [{ tabla, id, nombre, carpetas }]  (varias candidatas: no se empareja)
 *   sinCarpeta    fichas sin carpeta
 *   carpetasSinFicha  carpetas que no encajan con ninguna ficha
 */
export function emparejar(fichas, carpetas, { sobrescribir = false } = {}) {
  const resultado = { escribir: [], yaVinculadas: [], distintas: [], ambiguas: [], sinCarpeta: [], carpetasSinFicha: [] };
  const usadas = new Set();
  const porId = new Map(fichas.map((f) => [`${f.tabla}|${f.id}`, f]));
  const asignada = new Map(); // tabla|ficha → carpetaId
  const registrar = (f, c, por) => {
    asignada.set(`${f.tabla}|${f.id}`, c.carpetaId);
    usadas.add(c.carpetaId);
    const antes = f.drive_folder_id ?? null;
    const fila = { tabla: f.tabla, id: f.id, nombre: f.nombre ?? "", carpetaId: c.carpetaId, ruta: c.ruta, por, antes };
    if (antes === c.carpetaId) resultado.yaVinculadas.push(fila);
    else if (antes) {
      resultado.distintas.push(fila);
      if (sobrescribir) resultado.escribir.push(fila);
    } else resultado.escribir.push(fila);
  };

  // 1. Por id de ficha que trae el CSV.
  for (const c of carpetas) {
    if (!c.fichaId) continue;
    const f = porId.get(`${c.tabla}|${c.fichaId}`);
    if (f && !asignada.has(`${f.tabla}|${f.id}`) && !usadas.has(c.carpetaId)) registrar(f, c, "plato_id");
  }

  // 2. Por nombre (y categoría para desempatar).
  const libres = carpetas.filter((c) => !usadas.has(c.carpetaId));
  for (const f of fichas) {
    if (asignada.has(`${f.tabla}|${f.id}`)) continue;
    const nombre = normalizar(f.nombre);
    if (!nombre) {
      resultado.sinCarpeta.push(f);
      continue;
    }
    let candidatas = libres.filter((c) => c.tabla === f.tabla && normalizar(c.nombre) === nombre && !usadas.has(c.carpetaId));
    if (candidatas.length > 1 && f.categoria) {
      const cat = normalizar(sinPrefijoNumero(f.categoria));
      const filtradas = candidatas.filter((c) => normalizar(sinPrefijoNumero(c.categoria)) === cat);
      if (filtradas.length) candidatas = filtradas;
    }
    if (candidatas.length === 0) {
      resultado.sinCarpeta.push(f);
      continue;
    }
    // Otra ficha con el mismo nombre (y categoría) compite por la misma carpeta: ambiguo.
    const hermanas = fichas.filter(
      (g) => g.tabla === f.tabla && g.id !== f.id && normalizar(g.nombre) === nombre && !asignada.has(`${g.tabla}|${g.id}`) && (!f.categoria || normalizar(sinPrefijoNumero(g.categoria ?? "")) === normalizar(sinPrefijoNumero(f.categoria))),
    );
    if (candidatas.length > 1 || (hermanas.length > 0 && candidatas.length < hermanas.length + 1)) {
      resultado.ambiguas.push({ tabla: f.tabla, id: f.id, nombre: f.nombre ?? "", carpetas: candidatas.map((c) => c.ruta) });
      continue;
    }
    registrar(f, candidatas[0], "nombre");
  }
  resultado.carpetasSinFicha = carpetas.filter((c) => !usadas.has(c.carpetaId));
  return resultado;
}

export const informe = (r, { detalle = false } = {}) => {
  const l = [];
  const por = (xs, p) => xs.filter((x) => x.por === p).length;
  l.push(`Se guardaría la carpeta en ${r.escribir.length} fichas (${por(r.escribir, "plato_id")} por plato_id, ${por(r.escribir, "nombre")} por nombre).`);
  l.push(`Ya vinculadas: ${r.yaVinculadas.length}. Con otra carpeta guardada: ${r.distintas.length}. Ambiguas (no se tocan): ${r.ambiguas.length}.`);
  l.push(`Fichas sin carpeta: ${r.sinCarpeta.length}. Carpetas sin ficha: ${r.carpetasSinFicha.length}.`);
  if (detalle) {
    for (const x of r.escribir) l.push(`  + ${x.tabla} ${x.id} «${x.nombre}» → ${x.carpetaId} (${x.por})${x.antes ? ` [antes ${x.antes}]` : ""}`);
    for (const x of r.distintas) l.push(`  ! ${x.tabla} ${x.id} «${x.nombre}» ya tiene otra carpeta (${x.antes}); la del árbol es ${x.carpetaId}`);
    for (const x of r.ambiguas) l.push(`  ? ${x.tabla} ${x.id} «${x.nombre}»: ${x.carpetas.join(" | ")}`);
    for (const x of r.sinCarpeta) l.push(`  - sin carpeta: ${x.tabla} ${x.id} «${x.nombre ?? ""}»`);
    for (const x of r.carpetasSinFicha) l.push(`  · carpeta sin ficha: ${x.ruta} (${x.carpetaId})`);
  }
  return l.join("\n");
};

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
    async fichas() {
      const salida = [];
      for (const tabla of ["Platos", "Vinos"]) {
        const r = await fetch(`${url}/rest/v1/${tabla}?select=id,nombre,categoria,drive_folder_id&limit=5000`, { headers: cab({ Accept: "application/json" }) });
        if (!r.ok) throw new Error(`No se pudo leer ${tabla} (${r.status})${r.status === 400 ? ": ¿está aplicada la migración 20261201120000_carta_drive_folder_id?" : ""}`);
        for (const f of await r.json()) salida.push({ tabla, id: String(f.id), nombre: f.nombre ?? "", categoria: f.categoria ?? "", drive_folder_id: f.drive_folder_id ?? null });
      }
      return salida;
    },
    async funcion() {
      const r = await fetch(`${url}/functions/v1/instagram-drive`, { method: "POST", headers: cab({ "Content-Type": "application/json" }), body: JSON.stringify({ accion: "listar_platos", marca: "casa-tomas" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(`instagram-drive · listar_platos respondió ${r.status}: ${j.error ?? "sin detalle"}`);
      return j;
    },
    async guardar(tabla, id, carpetaId) {
      const r = await fetch(`${url}/rest/v1/${tabla}?id=eq.${encodeURIComponent(id)}&select=id`, {
        method: "PATCH",
        headers: cab({ "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({ drive_folder_id: carpetaId }),
      });
      if (!r.ok) return false;
      const filas = await r.json().catch(() => []);
      return Array.isArray(filas) && filas.length > 0;
    },
  };
}

function argumentos(argv) {
  const valor = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    aplicar: argv.includes("--aplicar"),
    detalle: argv.includes("--detalle"),
    sobrescribir: argv.includes("--sobrescribir"),
    funcion: argv.includes("--funcion"),
    csv: valor("--csv"),
    fichas: valor("--fichas"),
  };
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.aplicar && a.fichas) throw new Error("--aplicar lee y escribe en vivo: no se puede usar con --fichas");
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY?.trim();
  const necesitaRed = !a.fichas || a.funcion;
  let c = null;
  if (necesitaRed) {
    if (!url || !anon) throw new Error("Faltan SUPABASE_URL y SUPABASE_ANON_KEY (o usa --fichas <json> y --csv <ruta>)");
    c = cliente(url, anon, await tokenPanel(url, anon));
  }
  const fichas = a.fichas ? JSON.parse(readFileSync(a.fichas, "utf8")) : await c.fichas();
  let carpetas;
  if (a.funcion) carpetas = carpetasDeFuncion(await c.funcion());
  else {
    const ruta = a.csv ?? (existsSync(CSV_POR_DEFECTO) ? CSV_POR_DEFECTO : null);
    if (!ruta) throw new Error("Indica de dónde salen las carpetas: --csv <estructura-drive.csv> o --funcion");
    carpetas = carpetasDeCsv(readFileSync(ruta, "utf8"));
  }
  const r = emparejar(fichas, carpetas, { sobrescribir: a.sobrescribir });
  console.log(a.aplicar ? "== APLICAR ==" : "== SIMULACIÓN (no se escribe nada; para guardar de verdad: --aplicar) ==");
  console.log(`${carpetas.length} carpetas de plato o vino y ${fichas.length} fichas.`);
  console.log(informe(r, { detalle: a.detalle || a.aplicar }));
  if (!a.aplicar) return;
  let bien = 0;
  for (const x of r.escribir) {
    const ok = await c.guardar(x.tabla, x.id, x.carpetaId).catch(() => false);
    console.log(`${ok ? "OK   " : "FALLO"} ${x.tabla} ${x.id} «${x.nombre}»`);
    if (ok) bien++;
  }
  console.log(`${bien}/${r.escribir.length} fichas con su carpeta guardada.`);
  if (bien < r.escribir.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(`ERROR: ${e?.message ?? e}`);
    process.exit(1);
  });
}
