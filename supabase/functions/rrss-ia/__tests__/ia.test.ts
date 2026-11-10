// @vitest-environment node
/**
 * Edge Function rrss-ia sin red: Supabase (Auth, permiso, tablas rrss_*,
 * guía, carta, Storage firmado) y OpenAI simulados. Comprueba la separación
 * de instrucciones (sistema / DATOS / USUARIO), la fidelidad (lo creativo
 * solo con permiso), los validadores (precios y promociones inventadas), el
 * cupo, el guardado y que la clave nunca sale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { manejarRrssIA, OPENAI, MODELO_POR_DEFECTO } from "../ia.ts";
import { ORIENTACION } from "../prompts.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { comprobar } from "../../../../scripts/rrss/copiar-contratos.mjs";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const CLAVE = "sk-clave-de-openai-de-pruebas-0123456789";
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica", OPENAI_API_KEY: CLAVE };
const P = "11111111-1111-4111-8111-111111111111";
const F1 = "22222222-2222-4222-8222-222222222222";
const F2 = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444444";

type Llamada = { url: string; metodo: string; cuerpo: unknown };

interface Escenario {
  permiso?: boolean;
  proyecto?: Record<string, unknown>;
  archivos?: Record<string, unknown>[];
  cupo?: boolean;
  openai?: (cuerpo: Record<string, unknown>) => Response;
}

const resp = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const respuestaModelo = (datos: unknown) => resp(200, { choices: [{ message: { content: JSON.stringify(datos) } }], usage: { prompt_tokens: 2000, completion_tokens: 500 } });

function montar(e: Escenario = {}) {
  const llamadas: Llamada[] = [];
  const proyecto = { id: P, marca: "casa-tomas", canal: "instagram", tipo: "carrusel", estilo: "natural", instrucciones: "Arroces de domingo", permitir_creativo: false, titulo: "", plan: null, textos: {}, ...(e.proyecto ?? {}) };
  const archivos = e.archivos ?? [
    { id: F1, tipo: "foto", estado: "listo", orden: 0, ancho: 3000, alto: 4000, duracion_s: null, analisis: { previa_ruta: `previas/${P}/${F1}.jpg` } },
    { id: F2, tipo: "foto", estado: "listo", orden: 1, ancho: 3000, alto: 4000, duracion_s: null, analisis: { previa_ruta: `previas/${P}/${F2}.jpg` } },
  ];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    let cuerpo: unknown = null;
    if (typeof init.body === "string") {
      try {
        cuerpo = JSON.parse(init.body);
      } catch {
        cuerpo = init.body;
      }
    } else if (init.body instanceof FormData) cuerpo = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<archivo>"]));
    llamadas.push({ url, metodo, cuerpo });
    if (url.startsWith(OPENAI)) {
      if (url.endsWith("/audio/transcriptions")) return resp(200, { text: "hola", segments: [{ start: 0.5, end: 2.1, text: " Bienvenidos a Casa Tomás" }, { start: 2.5, end: 3, text: "...", no_speech_prob: 0.95 }] });
      return e.openai ? e.openai(cuerpo as Record<string, unknown>) : resp(500, {});
    }
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "usuario-1" });
    if (url === `${SB}/rest/v1/rpc/can_edit_section`) return resp(200, e.permiso ?? true);
    if (url.startsWith(`${SB}/rest/v1/rrss_ia_peticiones`)) {
      if (metodo === "POST") return e.cupo === false ? resp(400, { message: "rrss_cupo_ia: has llegado al tope" }) : resp(201, [{ id: 7 }]);
      return resp(204, null);
    }
    if (url.startsWith(`${SB}/rest/v1/rrss_proyectos`)) return metodo === "GET" ? resp(200, [proyecto]) : new Response(null, { status: 204 });
    if (url.startsWith(`${SB}/rest/v1/rrss_archivos`)) return metodo === "GET" ? resp(200, archivos.map((a) => ({ proyecto_id: P, ...a }))) : new Response(null, { status: 204 });
    if (url.startsWith(`${SB}/rest/v1/rrss_ideas`)) return resp(201, [{ id: "idea-1" }]);
    if (url.startsWith(`${SB}/rest/v1/instagram_guias_marca`)) return resp(200, [{ version: 1, guia: "Cálido y honesto.", hashtags_base: ["#CasaTomás"], ctas: ["Reservar mesa"] }]);
    if (url.startsWith(`${SB}/rest/v1/Platos`)) return resp(200, [{ nombre: "Arroz del señorito" }, { nombre: "Gamba roja" }]);
    if (url.startsWith(`${SB}/rest/v1/Vinos`)) return resp(200, []);
    if (url.startsWith(`${SB}/storage/v1/object/sign/rrss/`)) return resp(200, { signedURL: `/object/sign/rrss/${url.split("/rrss/")[1]}?token=firma` });
    if (url.startsWith(`${SB}/storage/v1/object/authenticated/rrss/audio/`)) return new Response(new Uint8Array([1, 2, 3]));
    return resp(404, { message: "no simulado" });
  });
  const registrar = vi.fn(async () => undefined);
  const pedir = (cuerpo: unknown) =>
    manejarRrssIA(new Request(`${SB}/functions/v1/rrss-ia`, { method: "POST", headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }), { env: ENV, fetch: f as unknown as typeof fetch, registrar });
  return { pedir, llamadas, registrar };
}

const PLAN_MODELO = {
  resumen: "Carrusel de arroces de domingo con luz cálida.",
  preguntas: [],
  estilo: "moderno",
  fotos: [
    { archivo: F1, correccion: { exposicion: 0.9, contraste: 0.1, saturacion: 0, temperatura: 0.2, nitidez: 0.3 }, autoNiveles: false, encuadre: { x: 0.5, y: 0.6, zoom: 1.2 }, rotulos: { antetitulo: "Domingo", titulo: "Arroz del señorito a 18 €", subtitulo: null, cta: "Reserva", posicion: "abajo" }, logo: true, creativo: "fondo-marca", altText: "Paella de arroz", nota: "Más luz" },
    { archivo: F2, correccion: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 }, autoNiveles: true, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, rotulos: null, logo: false, creativo: "ninguno", altText: "Gamba roja", nota: "" },
    { archivo: "inventado", correccion: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 }, autoNiveles: false, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, rotulos: null, logo: false, creativo: "ninguno", altText: "", nota: "" },
  ],
  video: null,
  textos: { caption: "Los domingos huelen a arroz. Hoy con un 20% de descuento. Ven a por el tuyo.", hashtags: ["#arroz", "#crevillent", "#domingo", "#arroces", "#alicante", "#sobran"], titular: "Arroces de domingo" },
  avisos: [],
};

beforeEach(() => olvidarSecretos());

describe("rrss-ia", () => {
  it("sin «Editar» en Marketing: 403 y no llama a OpenAI", async () => {
    const { pedir, llamadas } = montar({ permiso: false });
    const r = await pedir({ accion: "proponer", proyectoId: P });
    expect(r.status).toBe(403);
    expect(llamadas.some((l) => l.url.startsWith(OPENAI))).toBe(false);
  });

  it("proponer: instrucciones en tres capas, la IA ve las fotos y el plan sale normalizado y revisado", async () => {
    let enviado: Record<string, unknown> = {};
    const { pedir, llamadas, registrar } = montar({ openai: (c) => ((enviado = c), respuestaModelo(PLAN_MODELO)) });
    const r = await pedir({ accion: "proponer", proyectoId: P });
    const j = await r.json();
    expect(r.status).toBe(200);
    const mensajes = enviado.messages as Array<{ role: string; content: unknown }>;
    // 1. Sistema: la orientación permanente, sin datos del usuario.
    expect(mensajes[0].role).toBe("system");
    expect(String(mensajes[0].content)).toContain(ORIENTACION);
    expect(String(mensajes[0].content)).not.toContain("Arroces de domingo");
    // 2. Datos y 3. instrucciones del usuario, cada una en su bloque.
    const partes = mensajes[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(partes[0].text).toMatch(/^<<<DATOS\n[\s\S]*DATOS>>>$/);
    expect(partes[0].text).toContain("Arroz del señorito");
    expect(partes.at(-1)?.text).toMatch(/^<<<USUARIO\nArroces de domingo\nUSUARIO>>>$/);
    // La IA ve las previas por URL firmada.
    const imagenes = partes.filter((p) => p.type === "image_url");
    expect(imagenes).toHaveLength(2);
    expect(imagenes[0].image_url!.url).toBe(`${SB}/storage/v1/object/sign/rrss/previas/${P}/${F1}.jpg?token=firma`);
    expect((enviado.response_format as { json_schema: { name: string } }).json_schema.name).toBe("rrss_plan_edicion");
    // Plan: el estilo lo elige el usuario, la corrección es suave, lo creativo no se aplica sin permiso y se quita lo inventado.
    expect(j.plan.estilo).toBe("natural");
    expect(j.plan.piezas).toHaveLength(2);
    expect(j.plan.piezas[0].correccion.exposicion).toBe(0.6);
    expect(j.plan.piezas[0].creativo).toBe("ninguno");
    expect(j.plan.piezas[0].rotulos.titulo).toBe("");
    expect(j.plan.textos.caption).toBe("Los domingos huelen a arroz. Ven a por el tuyo.");
    expect(j.plan.textos.hashtags).toHaveLength(5);
    expect(j.avisos.join(" ")).toMatch(/no están permitidas las transformaciones creativas/);
    expect(j.avisos.join(" ")).toMatch(/promoción que no habías pedido/);
    expect(j.avisos.join(" ")).toMatch(/precio que no viene de tus instrucciones/);
    // Guardado del plan y de los textos, cupo y coste.
    const guardado = llamadas.find((l) => l.metodo === "PATCH" && l.url.startsWith(`${SB}/rest/v1/rrss_proyectos`));
    expect((guardado?.cuerpo as { plan_ia: unknown }).plan_ia).toBeTruthy();
    expect(llamadas.some((l) => l.metodo === "POST" && l.url.includes("rrss_ia_peticiones"))).toBe(true);
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(j)).not.toContain(CLAVE);
    expect(j.modelo).toBe(MODELO_POR_DEFECTO);
  });

  it("con las transformaciones creativas permitidas, el fondo de marca se mantiene", async () => {
    const { pedir } = montar({ proyecto: { permitir_creativo: true }, openai: () => respuestaModelo(PLAN_MODELO) });
    const j = await (await pedir({ accion: "proponer", proyectoId: P })).json();
    expect(j.plan.piezas[0].creativo).toBe("fondo-marca");
  });

  it("archivos sin terminar de prepararse: 409", async () => {
    const { pedir } = montar({ archivos: [{ id: F1, tipo: "foto", estado: "analizando", orden: 0, analisis: {} }] });
    expect((await pedir({ accion: "proponer", proyectoId: P })).status).toBe(409);
  });

  it("cupo diario agotado: 429 sin llamar a OpenAI", async () => {
    const { pedir, llamadas } = montar({ cupo: false });
    const r = await pedir({ accion: "proponer", proyectoId: P });
    expect(r.status).toBe(429);
    expect(llamadas.some((l) => l.url.startsWith(OPENAI))).toBe(false);
  });

  it("OpenAI sin saldo: 502 con el motivo legible", async () => {
    const { pedir } = montar({ openai: () => resp(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } }) });
    const r = await pedir({ accion: "proponer", proyectoId: P });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/sin saldo/);
  });

  it("vídeo: la IA ve la hoja de contactos y las tomas se ajustan a la duración del clip", async () => {
    const { pedir } = montar({
      proyecto: { tipo: "reel" },
      archivos: [{ id: V1, tipo: "video", estado: "listo", orden: 0, ancho: 1080, alto: 1920, duracion_s: 8, analisis: { hoja_ruta: `previas/${P}/${V1}-hoja.jpg`, hoja_instantes: [0.4, 1.3], transcripcion: [{ inicio: 1, fin: 3, texto: "Hola" }] } }],
      openai: () => respuestaModelo({ ...PLAN_MODELO, fotos: [], video: { tomas: [{ archivo: V1, inicio: 2, fin: 20, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "ninguno", motivo: "gancho" }], titulos: [{ texto: "Domingo de arroz", inicio: 0, fin: 2, posicion: "abajo" }], subtitulos: true, transicion: "fundido", duracionTransicion: 0.5, audio: "original", correccion: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 }, cierre: { mostrar: true, titulo: null, cta: "Ven el domingo" }, logo: true, nota: "" } }),
    });
    const j = await (await pedir({ accion: "proponer", proyectoId: P })).json();
    const v = j.plan.piezas[0];
    expect(v.tipo).toBe("video");
    expect(v.tomas[0].fin).toBe(8);
    expect(v.subtitulos).toBe(true);
    expect(j.avisos.join(" ")).toMatch(/pasaba del final del clip/);
  });

  it("ideas para grabar sin archivos: propuestas concretas guardadas y sin promociones inventadas", async () => {
    let enviado: Record<string, unknown> = {};
    const { pedir } = montar({
      openai: (c) => (
        (enviado = c),
        respuestaModelo({
          preguntas: [],
          ideas: [{ titulo: "La gamba en 15 segundos", idea: "Del hielo a la plancha", objetivo: "Dar a conocer la gamba", formato: "reel", gancho: "La gamba chisporrotea", guion: ["Hielo", "Plancha", "Plato"], planos: [{ descripcion: "Gambas en hielo", duracion_s: 3, orientacion: "vertical", luz: "Ventana", encuadre: "Cenital", movimiento: "Fijo" }], duracion_total_s: 15, texto_pantalla: ["Gamba roja"], voz_en_off: null, material: ["Gambas", "Plancha limpia"], copy: "La gamba roja, recién hecha. 2x1 los martes.", cta: "Ven a probarla" }],
        })
      ),
    });
    const r = await pedir({ accion: "ideas", marca: "casa-tomas", canal: "instagram", promocionar: { tipo: "plato", detalle: "La gamba roja" }, material: "un móvil" });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.id).toBe("idea-1");
    expect(j.ideas[0].planos[0].orientacion).toBe("vertical");
    expect(j.ideas[0].copy).toBe("La gamba roja, recién hecha.");
    const usuario = String((enviado.messages as Array<{ content: unknown }>)[1].content);
    expect(usuario).toMatch(/<<<USUARIO\nQuiero promocionar: plato\.\nDetalle: La gamba roja\nMaterial disponible: un móvil\nUSUARIO>>>/);
  });

  it("transcribir: manda el audio a OpenAI y guarda los segmentos con voz", async () => {
    const { pedir, llamadas } = montar({ archivos: [{ id: V1, tipo: "video", estado: "listo", orden: 0, analisis: { audio_ruta: `audio/${P}/${V1}.m4a` } }] });
    const r = await pedir({ accion: "transcribir", archivoId: V1 });
    const j = await r.json();
    expect(j.segmentos).toEqual([{ inicio: 0.5, fin: 2.1, texto: "Bienvenidos a Casa Tomás" }]);
    const envio = llamadas.find((l) => l.url.endsWith("/audio/transcriptions"));
    expect(envio?.cuerpo).toMatchObject({ model: "whisper-1", response_format: "verbose_json", language: "es", file: "<archivo>" });
    const guardado = llamadas.find((l) => l.metodo === "PATCH" && l.url.includes("rrss_archivos"));
    expect((guardado?.cuerpo as { analisis: { transcripcion: unknown[] } }).analisis.transcripcion).toHaveLength(1);
  });

  it("pieza: rehace solo esa foto y conserva las demás", async () => {
    const planActual = { estilo: "natural", piezas: [{ tipo: "foto", archivo: F1, rotulos: { titulo: "Uno", posicion: "auto" } }, { tipo: "foto", archivo: F2, rotulos: { titulo: "Dos", posicion: "auto" } }], textos: { caption: "x", hashtags: [], titular: "t" } };
    const { pedir } = montar({ proyecto: { plan: planActual }, openai: () => respuestaModelo({ foto: { ...PLAN_MODELO.fotos[1], rotulos: { antetitulo: null, titulo: "Gamba roja", subtitulo: null, cta: null, posicion: "arriba" } }, avisos: [] }) });
    const j = await (await pedir({ accion: "pieza", proyectoId: P, indice: 1, indicacion: "Más cerca" })).json();
    expect(j.plan.piezas[0].rotulos.titulo).toBe("Uno");
    expect(j.plan.piezas[1].rotulos.titulo).toBe("Gamba roja");
    expect(j.plan.piezas[1].archivo).toBe(F2);
  });

  it("las copias de los contratos de src/lib/rrss están al día", () => {
    expect(comprobar()).toEqual([]);
  });
});
