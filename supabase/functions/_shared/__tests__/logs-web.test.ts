/**
 * Super Admin › Logs: saneado, huella, clasificación, catálogo y registro de
 * errores del servidor (supabase/functions/_shared/logs-web/*).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hostDe, pareceDatoPersonal, sanearPila, sanearPropiedades, sanearRuta, sanearTexto } from "../logs-web/saneado";
import { calcularHuella, marcoPrincipal, normalizarMensaje, textoHuella, uuidDeTexto } from "../logs-web/huella";
import { clasificarProcedencia, dispositivoDe, entornoDeOrigen, entornoDeSupabase, esBot, navegadorDe, soDe } from "../logs-web/clasificacion";
import { CATALOGO_NAVEGADOR, normalizarEndpoint, normalizarLote, TIPOS_SERVIDOR } from "../logs-web/eventos";
import { eventoErrorServidor, registrarErrorServidor } from "../logs-web/servidor";

const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const UA_WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("saneado: nada personal sale hacia la BD, Linear u OpenAI", () => {
  const sucio = "Fallo para ana.garcia@gmail.com tel +34 600 123 456 dni 12345678Z token=abc123 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U "
    + "url https://web.es/reserva/respuesta?token=SECRETO123&email=x@y.z id 0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d tarjeta 4111 1111 1111 1111 sk_live_abcdefghijklmnop";
  it("quita correos, teléfonos, DNI, tokens, consultas de URL, UUID y tarjetas", () => {
    const s = sanearTexto(sucio, 1000)!;
    expect(s).not.toMatch(/ana\.garcia|600 123|12345678|abc123|eyJ|SECRETO|x@y|0b1c2d3e|4111|sk_live/);
    expect(s).toContain("[email]");
    expect(s).toContain("https://web.es/reserva/respuesta");
    expect(pareceDatoPersonal(s)).toBe(false);
    expect(pareceDatoPersonal(sucio)).toBe(true);
  });
  it("conserva lo técnico útil (mensaje, versión, fichero de la pila)", () => {
    expect(sanearTexto("TypeError: Cannot read properties of undefined (reading 'precio') v0.40")).toBe("TypeError: Cannot read properties of undefined (reading 'precio') v0.40");
    const pila = sanearPila("TypeError: x\n    at CartaVinos (https://web.es/assets/CartaVinos-B7x9Qa1c.js?v=2:1:2345)\n    at u (https://web.es/assets/index-DdS8x9.js:9:10)")!;
    expect(pila).toContain("CartaVinos-B7x9Qa1c.js:1:2345");
    expect(pila).not.toContain("?v=2");
  });
  it("rutas: solo el pathname y los identificadores como :id", () => {
    expect(sanearRuta("https://web.es/regala/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d?session_id=cs_test_123#x")).toBe("/regala/:id");
    expect(sanearRuta("/reserva/respuesta?token=abc")).toBe("/reserva/respuesta");
    expect(sanearRuta("/carta/entrantes-frios/")).toBe("/carta/entrantes-frios");
    expect(sanearRuta("/pedido/123456")).toBe("/pedido/:id");
    expect(sanearRuta("/x/ana@gmail.com")).toBe("/x/:email");
  });
  it("propiedades: solo claves permitidas y valores primitivos", () => {
    const p = sanearPropiedades({ carta: "vinos", email: "a@b.es", nombre: "Ana", anidado: { x: 1 }, n: 3, id: "ana@b.es" }, new Set(["carta", "n", "id"]));
    expect(p).toEqual({ carta: "vinos", n: 3, id: "[email]" });
  });
  it("host del referente, sin ruta", () => {
    expect(hostDe("https://www.google.es/search?q=restaurante+casa+tomas")).toBe("google.es");
    expect(hostDe("javascript:alert(1)")).toBeNull();
  });
});

describe("huella estable", () => {
  it("igual para repeticiones con números, ids, hash de Vite y línea distintos", async () => {
    const a = await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: "TypeError: Cannot read 'precio' of undefined at 123",
      pila: "TypeError\n at CartaVinos (https://web.es/assets/CartaVinos-B7x9Qa1c.js:1:2345)" });
    const b = await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: "TypeError: Cannot read 'nombre' of undefined at 98",
      pila: "TypeError\n at CartaVinos (https://web.es/assets/CartaVinos-Zz81kQop.js:3:11)" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });
  it("distinta si cambia la función, el tipo o la ruta de un 404", async () => {
    const base = { fuente: "navegador", mensaje: "TypeError: x is null" };
    const h1 = await calcularHuella({ ...base, tipo: "error_js", pila: " at CartaVinos (https://w/a/CartaVinos-B7x9Qa1c.js:1:2)" });
    const h2 = await calcularHuella({ ...base, tipo: "error_js", pila: " at Reservas (https://w/a/Reservas-B7x9Qa1c.js:1:2)" });
    const h3 = await calcularHuella({ ...base, tipo: "error_promesa", pila: " at CartaVinos (https://w/a/CartaVinos-B7x9Qa1c.js:1:2)" });
    expect(new Set([h1, h2, h3]).size).toBe(3);
    expect(await calcularHuella({ tipo: "error_404", fuente: "navegador", ruta: "/carta/a" }))
      .not.toBe(await calcularHuella({ tipo: "error_404", fuente: "navegador", ruta: "/carta/b" }));
  });
  it("marco principal sin hash ni línea y salta node_modules", () => {
    expect(marcoPrincipal("Error\n at x (https://w/node_modules/react/a.js:1:1)\n at CartaVinos (https://w/assets/CartaVinos-B7x9Qa1c.js:1:2)"))
      .toBe("CartaVinos@/assets/CartaVinos.js");
    expect(normalizarMensaje("Error 500 en 'reserva 42'")).toBe("error # en '…'");
    expect(textoHuella({ tipo: "error_peticion", fuente: "navegador", objetivo: "reservas-web/crear", codigo: 503 })).toBe("navegador|error_peticion|reservas-web/crear|503");
  });
  it("uuid determinista con forma v4", async () => {
    const u = await uuidDeTexto("cron:42");
    expect(u).toBe(await uuidDeTexto("cron:42"));
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("clasificación", () => {
  it("entorno por origen; lo desconocido no entra", () => {
    expect(entornoDeOrigen("https://restaurantecasatomascrevillente.es")).toBe("produccion");
    expect(entornoDeOrigen("https://web-casatomas-git-staging-casa-tomas.vercel.app")).toBe("demo");
    expect(entornoDeOrigen("http://localhost:4173")).toBe("local");
    expect(entornoDeOrigen("https://evil.example")).toBeNull();
    expect(entornoDeOrigen("https://web-casatomas-git-staging-casa-tomas.vercel.app.evil.com")).toBeNull();
    expect(entornoDeOrigen(null)).toBeNull();
    expect(entornoDeOrigen("https://nuevo.es", "https://nuevo.es=produccion")).toBe("produccion");
    expect(entornoDeSupabase("https://sfonaclosuafvlhutkon.supabase.co")).toBe("demo");
  });
  it("bots y dispositivo por User-Agent", () => {
    expect(esBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(esBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36")).toBe(true);
    expect(esBot(UA_IPHONE)).toBe(false);
    expect(esBot("")).toBe(true);
    expect(dispositivoDe(UA_IPHONE)).toBe("movil");
    expect(dispositivoDe(UA_MAC, true)).toBe("tablet");
    expect(dispositivoDe(UA_MAC, false)).toBe("escritorio");
    expect([navegadorDe(UA_WIN_CHROME), soDe(UA_WIN_CHROME), navegadorDe(UA_IPHONE), soDe(UA_IPHONE)]).toEqual(["Chrome", "Windows", "Safari", "iOS"]);
  });
  it("procedencia: QR > campaña > buscador/red social/enlace > directo", () => {
    expect(clasificarProcedencia({ qr: "Mesa-12", referente: "google.es" })).toEqual({ origen_tipo: "qr", origen_detalle: "qr", campana: "mesa-12" });
    expect(clasificarProcedencia({ utm_source: "instagram", utm_medium: "social", utm_campaign: "Navidad" }).origen_tipo).toBe("campana");
    expect(clasificarProcedencia({ utm_medium: "qr", utm_campaign: "carta" }).origen_tipo).toBe("qr");
    expect(clasificarProcedencia({ referente: "https://www.google.com/" }).origen_tipo).toBe("buscador");
    expect(clasificarProcedencia({ referente: "l.instagram.com" }).origen_tipo).toBe("red_social");
    expect(clasificarProcedencia({ referente: "restaurantecasatomascrevillente.es" }).origen_tipo).toBe("interno");
    expect(clasificarProcedencia({ referente: "blog.ejemplo.com" })).toEqual({ origen_tipo: "enlace", origen_detalle: "blog.ejemplo.com", campana: null });
    expect(clasificarProcedencia({}).origen_tipo).toBe("directo");
  });
});

describe("catálogo: el código y la migración dicen lo mismo", () => {
  const todo = readFileSync(resolve(__dirname, "../../../migrations/20261118100000_logs_web.sql"), "utf8");
  const sql = todo.slice(todo.indexOf("insert into public.web_eventos_catalogo"), todo.indexOf("on conflict (tipo)"));
  const filas = [...sql.matchAll(/\('([a-z0-9_]+)',\s+'(actividad|operacion|tecnico|error)',\s+'([a-z_]+)',/g)].map((m) => ({ tipo: m[1], categoria: m[2], fuente: m[3] }));
  it("mismos tipos del navegador con la misma categoría", () => {
    const delNavegador = filas.filter((f) => f.fuente === "navegador");
    expect(delNavegador.map((f) => f.tipo).sort()).toEqual(Object.keys(CATALOGO_NAVEGADOR).sort());
    for (const f of delNavegador) expect(CATALOGO_NAVEGADOR[f.tipo].categoria, f.tipo).toBe(f.categoria);
  });
  it("los del servidor no se aceptan del navegador", () => {
    expect(filas.filter((f) => f.fuente !== "navegador").map((f) => f.tipo).sort()).toEqual([...TIPOS_SERVIDOR].sort());
    for (const t of TIPOS_SERVIDOR) expect(CATALOGO_NAVEGADOR[t]).toBeUndefined();
  });
  it("los errores no requieren consentimiento; la actividad sí", () => {
    for (const [tipo, d] of Object.entries(CATALOGO_NAVEGADOR)) expect(d.consentimiento, tipo).toBe(d.categoria !== "error");
  });
});

describe("normalizarLote", () => {
  const ctx = { entorno: "produccion" as const, proyecto: "casa-tomas-story", esBot: false, dispositivo: "movil", navegador: "Safari", so: "iOS", ahora: new Date("2026-11-08T12:00:00Z") };
  const id = () => crypto.randomUUID();
  it("sin consentimiento: solo errores y sin visitante", async () => {
    const r = await normalizarLote({
      contexto: { consentimiento: false },
      eventos: [
        { id: id(), tipo: "pagina_vista", ruta: "/", sesion: id(), visitante: id() },
        { id: id(), tipo: "error_js", ruta: "/carta", sesion: id(), visitante: id(), error: { mensaje: "boom para a@b.es", pila: " at X (https://w/a.js:1:1)" } },
      ],
    }, ctx);
    expect(r.sinConsentimiento).toBe(1);
    expect(r.eventos).toHaveLength(1);
    expect(r.eventos[0]).toMatchObject({ tipo: "error_js", visitante_id: null, consentimiento: false, gravedad: "error", mensaje: "boom para [email]" });
    expect(r.eventos[0].huella).toMatch(/^[a-f0-9]{32}$/);
  });
  it("rechaza tipos del servidor, ids no válidos, acciones fuera de lista y claves no permitidas", async () => {
    const r = await normalizarLote({
      contexto: { consentimiento: true },
      eventos: [
        { id: id(), tipo: "reserva_creada_bd" },
        { id: "no-uuid", tipo: "clic" },
        { id: id(), tipo: "formulario", accion: "borrar_todo" },
        { id: id(), tipo: "formulario", accion: "inicio", objetivo: "reserva", props: { campos: 2, nombre: "Ana", telefono: "600123123" } },
      ],
    }, ctx);
    expect(r.rechazados).toBe(3);
    expect(r.eventos[0].propiedades).toEqual({ campos: 2 });
  });
  it("clasifica la procedencia y no guarda referente ni utm crudos", async () => {
    const r = await normalizarLote({
      contexto: { consentimiento: true, version: "0.40", despliegue: "abc1234" },
      eventos: [{ id: id(), tipo: "pagina_vista", ruta: "/?utm_source=x", props: { referente: "https://www.google.es/search?q=x", navegacion: "inicial", idioma: "es", vista_id: id() } }],
    }, ctx);
    const e = r.eventos[0];
    expect(e.ruta).toBe("/");
    expect(e.propiedades).toMatchObject({ origen_tipo: "buscador", origen_detalle: "google.es", idioma: "es", navegacion: "inicial" });
    expect(e.propiedades).not.toHaveProperty("referente");
    expect([e.version, e.despliegue]).toEqual(["0.40", "abc1234"]);
  });
  it("una petición fallida a reservas-web/crear es crítica; la hora se acota", async () => {
    const r = await normalizarLote({
      contexto: { consentimiento: false },
      eventos: [{ id: id(), tipo: "error_peticion", t: "2099-01-01T00:00:00Z", props: { endpoint: "https://x.supabase.co/functions/v1/reservas-web/crear?a=1", status: 503 } }],
    }, ctx);
    expect(r.eventos[0].gravedad).toBe("critico");
    expect(r.eventos[0].propiedades.endpoint).toBe("reservas-web/crear");
    expect(Date.parse(r.eventos[0].ocurrido_en)).toBeLessThanOrEqual(ctx.ahora.getTime() + 300_000);
    expect(normalizarEndpoint("cheques-regalo-web/crear")).toBe("cheques-regalo-web/crear");
    expect(normalizarEndpoint("https://x.supabase.co/rest/v1/configuracion_tienda?select=*")).toBe("rest:configuracion_tienda");
    expect(normalizarEndpoint("rest:configuracion_tienda")).toBe("rest:configuracion_tienda");
    expect(normalizarEndpoint("https://evil/../x y")).toBeNull();
  });
  it("como mucho 50 por lote", async () => {
    const r = await normalizarLote({ contexto: { consentimiento: true }, eventos: Array.from({ length: 60 }, () => ({ id: id(), tipo: "clic", objetivo: "x" })) }, ctx);
    expect([r.eventos.length, r.rechazados]).toEqual([50, 10]);
  });
});

describe("errores del servidor", () => {
  it("evento crítico para reservas-web/crear, sin cuerpo", async () => {
    const e = await eventoErrorServidor({ fuente: "reservas-web", subruta: "/crear", status: 500, mensaje: "fallo con ana@x.es", duracionMs: 120 });
    expect(e).toMatchObject({ tipo: "error_servidor", fuente: "servidor", objetivo: "reservas-web/crear", gravedad: "critico" });
    expect(e.mensaje).toBe("reservas-web/crear: fallo con [email]");
  });
  it("solo llama a un proyecto real de Supabase y nunca lanza", async () => {
    const fetchFn = vi.fn(async () => new Response("{}"));
    const env = (u: string) => (n: string) => ({ SUPABASE_URL: u, SUPABASE_SERVICE_ROLE_KEY: "srv" } as Record<string, string>)[n];
    await registrarErrorServidor({ fuente: "x", subruta: "", status: 500, mensaje: null, duracionMs: 1 }, env("https://ejemplo.supabase.co"), fetchFn as never);
    expect(fetchFn).not.toHaveBeenCalled();
    await registrarErrorServidor({ fuente: "x", subruta: "", status: 500, mensaje: null, duracionMs: 1 }, env("https://sfonaclosuafvlhutkon.supabase.co"), fetchFn as never);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sfonaclosuafvlhutkon.supabase.co/rest/v1/rpc/web_logs_ingerir");
    expect(JSON.parse(String(init.body)).p_ctx).toEqual({ entorno: "demo" });
    const roto = vi.fn(async () => { throw new Error("red caída"); });
    await expect(registrarErrorServidor({ fuente: "x", subruta: "", status: 500, mensaje: null, duracionMs: 1 }, env("https://sfonaclosuafvlhutkon.supabase.co"), roto as never)).resolves.toBeUndefined();
    await registrarErrorServidor({ fuente: "registrar-actividad-web", subruta: "", status: 503, mensaje: null, duracionMs: 1 }, env("https://sfonaclosuafvlhutkon.supabase.co"), fetchFn as never);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
