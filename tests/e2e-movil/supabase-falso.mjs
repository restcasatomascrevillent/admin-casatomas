// Supabase falso para las pruebas e2e móviles del panel.
//
// Intercepta con Playwright TODAS las peticiones a *.supabase.co (auth, REST, RPC, funciones, storage y realtime) y las
// responde en memoria con datos sintéticos (datos-sinteticos.mjs). Nada sale a Internet: no hay `route.continue()` hacia
// Supabase y las escrituras se aceptan sin persistir. Cualquier otro host externo se corta.
//
// Es la versión mínima y sin datos reales del mock que se usó en la auditoría móvil (QA, 02/11/2026).

export const EMAIL = "e2e-movil@sim.casatomas.test";
export const USER_ID = "00000000-0000-4000-8000-00000000e2e1";

const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const exp = () => Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const jwt = () => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, role: "authenticated", aud: "authenticated", email: EMAIL, exp: exp() })}.${b64u("firma-falsa")}`;
const usuario = () => ({ id: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
const sesion = () => ({ access_token: jwt(), token_type: "bearer", expires_in: 315360000, expires_at: exp(), refresh_token: "refresh-falso", user: usuario() });

/** Clave de localStorage donde supabase-js guarda la sesión: `sb-<primera etiqueta del host>-auth-token`. */
export const claveSesion = (urlSupabase) => `sb-${new URL(urlSupabase).hostname.split(".")[0]}-auth-token`;

// ───────── mini-evaluador PostgREST (lo que usa el panel: eq/neq/gt/lt/in/is/like/ilike/or/and/order/limit/offset/select con relaciones) ─────────
const ES_FECHA = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)?)?$/;
const cmp = (a, b) => {
  if (a == null) return null;
  if (typeof a === "number") return a - Number(b);
  if (typeof a === "boolean") return String(a) === b ? 0 : 1;
  if (typeof a === "string" && ES_FECHA.test(a) && ES_FECHA.test(b)) {
    const f = (x) => Date.parse(x.length === 10 ? `${x}T00:00:00Z` : x);
    if (!Number.isNaN(f(a)) && !Number.isNaN(f(b))) return f(a) - f(b);
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const like = (pat, ci) => new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".") + "$", ci ? "is" : "s");
const lista = (v) => { const m = /^\((.*)\)$/s.exec(v); const c = m ? m[1] : v; return c ? c.split(",").map((x) => x.trim().replace(/^"(.*)"$/, "$1")) : []; };
function op(fila, col, o, v) {
  let neg = false;
  if (o.startsWith("not.")) { neg = true; o = o.slice(4); }
  const a = fila[col];
  const r = ({
    eq: () => a != null && cmp(a, v) === 0, neq: () => a == null || cmp(a, v) !== 0, gt: () => a != null && cmp(a, v) > 0, gte: () => a != null && cmp(a, v) >= 0,
    lt: () => a != null && cmp(a, v) < 0, lte: () => a != null && cmp(a, v) <= 0, like: () => a != null && like(v, false).test(String(a)), ilike: () => a != null && like(v, true).test(String(a)),
    is: () => (v === "null" ? a == null : v === "true" ? a === true : v === "false" ? a === false : false), in: () => a != null && lista(v).some((x) => cmp(a, x) === 0),
    cs: () => Array.isArray(a) && lista(v.replace(/^\{/, "(").replace(/\}$/, ")")).every((x) => a.map(String).includes(x)),
  }[o] ?? (() => true))();
  return neg ? !r : r;
}
function partir(s) { const o = []; let d = 0, i0 = 0, q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"') q = !q; if (q) continue; if (c === "(") d++; else if (c === ")") d--; else if (c === "," && d === 0) { o.push(s.slice(i0, i)); i0 = i + 1; } } o.push(s.slice(i0)); return o.filter(Boolean); }
function cond(fila, c) {
  const m = /^(not\.)?(and|or)\((.*)\)$/s.exec(c);
  if (m) { const p = partir(m[3]).map((x) => cond(fila, x)); const r = m[2] === "and" ? p.every(Boolean) : p.some(Boolean); return m[1] ? !r : r; }
  const i = c.indexOf("."); const rest = c.slice(i + 1); const j = rest.match(/^(not\.)?([a-z]+)\./);
  return j ? op(fila, c.slice(0, i), (j[1] ?? "") + j[2], rest.slice(j[0].length)) : true;
}
function parseSelect(sel) {
  const cols = [], rels = []; let d = 0, i0 = 0; const tr = [];
  for (let i = 0; i < sel.length; i++) { if (sel[i] === "(") d++; else if (sel[i] === ")") d--; else if (sel[i] === "," && d === 0) { tr.push(sel.slice(i0, i)); i0 = i + 1; } }
  tr.push(sel.slice(i0));
  for (const t0 of tr) { const t = t0.trim(); if (!t) continue; const m = /^(?:(\w+):)?(\w+)(?:!(\w+))?\s*\(([\s\S]*)\)$/.exec(t); if (m) rels.push({ alias: m[1] ?? m[2], tabla: m[2], inner: m[3] === "inner", sel: m[4] }); else cols.push(t); }
  return { cols, rels };
}
const FK = { mesas: "mesa_id", reservas: "reserva_id", facturas: "factura_id", espacios_reserva: "espacio_id" };
export function consultar(tablas, nombre, params) {
  const base = (tablas[nombre] ?? []).map((f) => ({ ...f }));
  const sel = params.get("select") ?? "*"; const { cols, rels } = parseSelect(sel);
  const reservados = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "returning"]);
  const filtros = [...params.entries()].filter(([k]) => !reservados.has(k));
  let filas = base.map((f) => { for (const r of rels) { const fk = FK[r.tabla] ?? `${r.tabla.replace(/s$/, "")}_id`; f[r.alias] = (tablas[r.tabla] ?? []).find((x) => x.id === f[fk]) ?? null; } return f; });
  filas = filas.filter((f) => {
    for (const [k, v] of filtros) {
      if (k === "or" || k === "and") { if (!cond(f, `${k}${v}`)) return false; }
      else if (k.includes(".") && !k.includes("->")) { const [rel, col] = k.split("."); if (!f[rel] || !cond(f[rel], `${col}.${v}`)) return false; }
      else if (!cond(f, `${k}.${v}`)) return false;
    }
    return rels.every((r) => !r.inner || f[r.alias]);
  });
  const orden = params.get("order");
  if (orden) {
    const cl = orden.split(",").map((o) => { const [col, ...m] = o.split("."); return { col, desc: m.includes("desc") }; });
    filas.sort((a, b) => { for (const c of cl) { const x = a[c.col], y = b[c.col]; if (x == null && y == null) continue; if (x == null) return 1; if (y == null) return -1; const r = typeof x === "number" ? x - y : cmp(String(x), String(y)); if (r) return c.desc ? -r : r; } return 0; });
  }
  const total = filas.length; const off = Number(params.get("offset") ?? 0); const lim = params.get("limit");
  if (off) filas = filas.slice(off); if (lim != null) filas = filas.slice(0, Number(lim));
  if (cols.length && !cols.includes("*")) filas = filas.map((f) => { const o = {}; for (const c of cols) { const m = /^(\w+):(\w+)$/.exec(c); o[m ? m[1] : c.replace(/::\w+$/, "")] = f[m ? m[2] : c.replace(/::\w+$/, "")]; } for (const r of rels) o[r.alias] = f[r.alias]; return o; });
  else filas = filas.map((f) => { const o = { ...f }; for (const r of rels) o[r.alias] = f[r.alias]; return o; });
  return { filas, total, off };
}

// ───────── instalación ─────────
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS", "access-control-expose-headers": "content-range, content-type" };
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#c9a77c"/></svg>`;
const SOLO_LECTURA = /^(version_auditoria|listar_|metricas_|detalle_|trafico_|ia_|gasto_|tipo_cambio|estadisticas_|get_|servicios_cerrados|cotejo|albaranes_|facturas_candidatas|newsletter_estadisticas|productos_|proveedores_|ocr_resumen|oficiososia_facturacion_leer)/;

/**
 * @param context contexto de Playwright
 * @param opts { urlSupabase, tablas, rpc, funciones, sesion=true, toursVistos=true }
 */
export async function instalarSupabaseFalso(context, { urlSupabase, tablas, rpc = {}, funciones = {}, sesion: conSesion = true, toursVistos = true }) {
  const escrituras = [];
  const sinMock = new Set();
  let js = "try{";
  if (conSesion) js += `localStorage.setItem(${JSON.stringify(claveSesion(urlSupabase))},${JSON.stringify(JSON.stringify(sesion()))});`;
  // Los tours guiados salen solos la primera vez y tapan la pantalla.
  if (toursVistos) for (const t of ["facturas", "gestor-web"]) js += `localStorage.setItem(${JSON.stringify(`ayuda:tour-visto:${t}:${USER_ID}`)},"1");`;
  await context.addInitScript(js + "}catch(e){}");

  await context.route(/^https?:\/\/[^/]*supabase\.(co|in)\//, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method(); const p = u.pathname;
    const json = (status, cuerpo, cab = {}) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", ...cab }, body: cuerpo === undefined ? "" : JSON.stringify(cuerpo) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (p.startsWith("/auth/v1/")) {
      const s = p.slice(9);
      if (s === "user") return conSesion ? json(200, usuario()) : json(401, { code: 401, msg: "sin sesión" });
      if (s === "token") return json(200, sesion());
      if (s === "logout") return route.fulfill({ status: 204, headers: CORS });
      return json(200, {});
    }
    if (p.startsWith("/rest/v1/rpc/")) {
      const n = p.slice(13);
      let args = {}; try { args = m === "GET" ? Object.fromEntries(u.searchParams) : JSON.parse(req.postData() || "{}"); } catch { /* sin cuerpo */ }
      if (!SOLO_LECTURA.test(n)) escrituras.push(`rpc ${n}`);
      const h = rpc[n];
      if (!h) { sinMock.add(`rpc ${n}`); return n === "version_auditoria_panel" ? json(200, 2) : route.fulfill({ status: 204, headers: CORS }); }
      const r = await h(args);
      return r == null ? route.fulfill({ status: 204, headers: CORS }) : json(200, r);
    }
    if (p.startsWith("/rest/v1/")) {
      const t = decodeURIComponent(p.slice(9));
      if (m === "GET" || m === "HEAD") {
        if (!(t in tablas)) sinMock.add(`tabla ${t}`);
        const { filas, total, off } = consultar(tablas, t, u.searchParams);
        const cab = { "content-range": filas.length ? `${off}-${off + filas.length - 1}/${/count=/.test(req.headers().prefer ?? "") ? total : "*"}` : `*/${total}` };
        if (m === "HEAD") return route.fulfill({ status: 200, headers: { ...CORS, ...cab } });
        if ((req.headers().accept ?? "").includes("vnd.pgrst.object")) return filas.length === 1 ? json(200, filas[0], cab) : json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return json(200, filas, cab);
      }
      escrituras.push(`${m} ${t}`);
      let c = null; try { c = JSON.parse(req.postData() || "null"); } catch { /* sin cuerpo */ }
      if (/return=representation/.test(req.headers().prefer ?? "")) { const eco = (Array.isArray(c) ? c : c ? [c] : []).map((f, i) => ({ id: 900000 + i, ...f })); return json(m === "POST" ? 201 : 200, (req.headers().accept ?? "").includes("vnd.pgrst.object") ? eco[0] ?? {} : eco); }
      return route.fulfill({ status: m === "POST" ? 201 : 204, headers: CORS });
    }
    if (p.startsWith("/functions/v1/")) { const n = p.slice(14).split("/")[0]; const h = funciones[n]; return json(200, h ? await h(req) : {}); }
    if (p.startsWith("/storage/v1/")) return m === "GET" || m === "HEAD" ? route.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/svg+xml" }, body: SVG }) : json(200, { Key: "mock", path: "mock", id: "mock" });
    sinMock.add(`${m} ${p}`);
    return json(200, {});
  });

  // Realtime: apretón de manos mínimo de Phoenix, sin salir a Internet.
  await context.routeWebSocket?.(/supabase\.(co|in)\/realtime/, (ws) => {
    ws.onMessage((msg) => {
      try {
        const [jr, ref, topic, ev] = JSON.parse(String(msg));
        if (ev === "phx_join") ws.send(JSON.stringify([jr, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: [] } }]));
        else if (ev === "heartbeat") ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
        else if (ev === "phx_leave") ws.send(JSON.stringify([jr, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      } catch { /* mensaje no Phoenix */ }
    });
  });

  // Hermético: cualquier otro host externo se corta (fuentes, analítica…).
  await context.route((u) => !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !/supabase\.(co|in)$/.test(u.hostname) && !/^(data|blob|about):/.test(u.protocol), (r) => r.abort("blockedbyclient"));

  return { escrituras, sinMock };
}
