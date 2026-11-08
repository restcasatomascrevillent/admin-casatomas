// @vitest-environment node
/**
 * Fase 3: «Qué funciona» en el contexto de la IA, sin red (Supabase y OpenAI
 * simulados). El resumen solo lleva conclusiones con muestra suficiente y sus
 * cifras reales; con pocos datos no hay conclusiones; sugerir_texto,
 * proponer_campana e ideas_semana lo reciben como datos; las frases con un
 * porcentaje que no sale de ahí se quitan; y sin la migración todo sigue
 * como antes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { manejarIA, OPENAI } from "../ia.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import {
  cifrasPermitidas,
  igUserIdDeMarca,
  quitarCifrasInventadas,
  resumenQueFuncionaIA,
  type QueFuncionaBD,
} from "../../_shared/instagram/que-funciona.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const CLAVE = "sk-clave-de-openai-de-pruebas-0123456789";
const IG = "17841400000000001";
const IG_TOUZA = "17841400000000009";
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica", OPENAI_API_KEY: CLAVE, IG_USER_ID: IG, IG_USER_ID_TOUZA: IG_TOUZA, INSTAGRAM_ENTORNO: "demo" };
const AHORA = new Date("2026-11-05T10:00:00Z");
const MARTES = "Los martes funcionan mejor: 9 % de interacción en 4 publicaciones, frente al 5,5 % de media.";

const grupo = (clave: string, n: number, tasa: number, suficiente = n >= 3) => ({
  clave, publicaciones: n, alcance_medio: 1000, tasa, guardados_por_alcance: 1.25, suficiente, orden: 0,
});

/** Lo que devuelve la RPC con 12 publicaciones (como en la prueba PGlite). */
const QF: QueFuncionaBD = {
  periodo_dias: 90,
  minimo: 3,
  publicaciones: 12,
  con_pieza: 8,
  tasa_media: 5.5,
  guardados_media: 0.8,
  suficiente: true,
  aviso: null,
  por: {
    dia: [grupo("martes", 4, 9), grupo("jueves", 4, 4), grupo("domingo", 1, 30)],
    hashtag: [grupo("#cocido", 4, 9)],
  },
  conclusiones: [
    { eje: "dia", estado: "mejor", clave: "martes", publicaciones: 4, tasa: 9, tasa_media: 5.5, texto: MARTES },
    { eje: "plantilla", estado: "parecido", tasa_media: 5.5, texto: "Por plantilla no hay diferencias claras todavía." },
    { eje: "tipo_foto", estado: "faltan_datos", tasa_media: 5.5, texto: "Por tipo de foto faltan datos: hacen falta al menos 3 publicaciones en dos grupos distintos." },
  ],
  mejores: [{ media_id: "101", fecha: "2026-10-27", formato: "reel", gancho: "Cocido de los martes", alcance: 1000, tasa: 9 }],
  peores: [{ media_id: "301", fecha: "2026-10-31", formato: "post", plantilla: "ct-tipografica", alcance: 800, tasa: 3 }],
};

const POCOS: QueFuncionaBD = {
  ...QF,
  publicaciones: 2,
  suficiente: false,
  aviso: "Solo hay 2 publicaciones con datos en los últimos 90 días: hacen falta al menos 6 para sacar conclusiones.",
  por: { formato: [grupo("reel", 2, 9)] },
  conclusiones: [{ eje: "dia", estado: "faltan_datos", tasa_media: 9, texto: "Por día de la semana faltan datos: …" }],
  mejores: [],
  peores: [],
};

describe("«Qué funciona» para la IA (lógica pura)", () => {
  it("resumen: solo conclusiones «mejor» y grupos con muestra; sin métricas de cada publicación", () => {
    const r = resumenQueFuncionaIA(QF)!;
    expect(r.conclusiones).toEqual([MARTES]);
    expect(r.sin_conclusion).toHaveLength(2);
    expect(r.por.dia.map((g) => g.clave)).toEqual(["martes", "jueves"]); // el domingo (1 publicación) no
    expect(r.mejores[0]).toEqual({ fecha: "2026-10-27", formato: "reel", plantilla: undefined, gancho: "Cocido de los martes", tasa: 9 });
    expect(JSON.stringify(r)).not.toContain("media_id");
  });

  it("con pocos datos: ninguna conclusión, ningún grupo y el aviso", () => {
    const r = resumenQueFuncionaIA(POCOS)!;
    expect(r).toMatchObject({ suficiente: false, conclusiones: [], por: {}, mejores: [], peores: [] });
    expect(r.aviso).toMatch(/hacen falta al menos 6/);
    expect(resumenQueFuncionaIA(null)).toBeNull();
  });

  it("cuenta de la marca: la propia o la general, solo dígitos", () => {
    expect(igUserIdDeMarca(ENV, "touza")).toBe(IG_TOUZA);
    expect(igUserIdDeMarca(ENV, "casa-tomas")).toBe(IG);
    expect(igUserIdDeMarca({ IG_USER_ID: "@oficiososia" }, "casa-tomas")).toBeNull();
  });

  it("quita las frases con porcentajes inventados y deja las de los datos", () => {
    const p = cifrasPermitidas(QF);
    const t = "Los martes funcionan mejor: 9 % de interacción. Además, las historias dan un 25 % más. San Martín cae en miércoles.";
    expect(quitarCifrasInventadas(t, p)).toEqual({ texto: "Los martes funcionan mejor: 9 % de interacción. San Martín cae en miércoles.", quitadas: 1 });
    expect(quitarCifrasInventadas("Frente al 5,5 % de media.", p).quitadas).toBe(0);
    expect(quitarCifrasInventadas("Sin cifras.", p)).toEqual({ texto: "Sin cifras.", quitadas: 0 });
    // Sin «Qué funciona», ningún porcentaje vale.
    expect(quitarCifrasInventadas("Sube un 12 por ciento. Bien.", cifrasPermitidas(null))).toEqual({ texto: "Bien.", quitadas: 1 });
  });
});

// ── Con la función entera ───────────────────────────────────────────────────

type Llamada = { url: string; metodo: string; cuerpo: string | null };
const resp = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cab } });
const respuestaOpenAI = (datos: unknown) =>
  resp(200, {
    choices: [{ message: { content: JSON.stringify(datos) } }],
    usage: { prompt_tokens: 3000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } },
  });

const GUIA = { version: 2, guia: "Cálido y honesto.", hashtags_base: ["#CasaTomás", "#Crevillent"], ctas: ["Reservar mesa"] };
const CONTEXTO = {
  carta: [{ id: "pulpo", nombre: "Pulpo a la gallega", categoria: "Del mar", featured: true, tiene_foto: true }],
  novedades: [],
  fechas: [],
  fotos: [],
  metricas: { publicaciones: 1, por: { franja: [{ clave: "12:00-14:00", tasa: 7.5 }] } },
  historial: [],
};

function falso(o: { qf?: [number, unknown]; openai: Response[] }) {
  const llamadas: Llamada[] = [];
  const cola = [...o.openai];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cuerpo = typeof init.body === "string" ? init.body : null;
    llamadas.push({ url, metodo, cuerpo });
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "11111111-1111-4111-8111-111111111111" });
    if (url === `${SB}/rest/v1/rpc/can_edit_section` || url === `${SB}/rest/v1/rpc/can_read_section`) return resp(200, true);
    if (url === `${SB}/rest/v1/rpc/instagram_ia_reservar_cupo`) return resp(200, { ok: true, usadas: 1, cupo: 100 });
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`) && metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`) && metodo === "POST") return resp(201, [{ id: "99999999-9999-4999-8999-999999999999" }]);
    if (url.startsWith(`${SB}/rest/v1/instagram_guias_marca`)) return resp(200, [GUIA]);
    if (url.startsWith(`${SB}/rest/v1/Platos?select=nombre`)) return resp(200, [{ nombre: "Pulpo a la gallega" }]);
    if (url === `${SB}/rest/v1/rpc/instagram_ia_contexto`) return resp(200, CONTEXTO);
    if (url === `${SB}/rest/v1/rpc/instagram_que_funciona`) return resp(...(o.qf ?? [200, QF]));
    if (url.startsWith(`${SB}/rest/v1/instagram_campanas`) && metodo === "POST") return resp(201, [{ id: "22222222-2222-4222-8222-222222222222" }]);
    if (url === `${OPENAI}/chat/completions`) {
      const r = cola.shift();
      if (!r) throw new Error("llamada a OpenAI no prevista");
      return r;
    }
    throw new Error(`fetch no previsto: ${metodo} ${url}`);
  });
  const datosEnviados = () => {
    const cuerpo = JSON.parse(llamadas.find((l) => l.url.startsWith(OPENAI))!.cuerpo!);
    const usuario = cuerpo.messages.find((m: { role: string }) => m.role === "user").content as string;
    return { sistema: cuerpo.messages[0].content as string, datos: JSON.parse(usuario.split("<<<DATOS")[1].split("DATOS>>>")[0]) };
  };
  return { f, llamadas, datosEnviados };
}

const peticion = (cuerpo: unknown) =>
  new Request("https://x.supabase.co/functions/v1/instagram-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
  });
const deps = (f: typeof fetch) => ({ env: ENV, fetch: f, registrar: async () => {}, ahora: () => AHORA });

const pieza = (n: number, porQue: string) => ({
  fecha: `2026-11-${String(10 + n * 7).padStart(2, "0")}`,
  hora: "13:00",
  formato: "post",
  plantilla: "ct-portada",
  plato_id: "pulpo",
  foto_sugerida: "carta:pulpo",
  antetitulo: "",
  titular: `El pulpo de casa ${n}`,
  gancho: `Gancho ${n}.`,
  caption: `Gancho ${n}. Pulpo a la gallega, como en casa. Te esperamos.`,
  hashtags: ["#CasaTomás", "#Crevillent", "#CocinaGallega", "#Pulpo", "#Otoño"],
  alt_text: "Pulpo en rodajas sobre patatas.",
  por_que: porQue,
  fase: 0,
  encargo_sugerido: "",
});

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("«Qué funciona» en instagram-ia", () => {
  it("proponer_campana: el modelo recibe las conclusiones reales y se quitan los porcentajes inventados", async () => {
    const { f, llamadas, datosEnviados } = falso({
      openai: [
        respuestaOpenAI({
          titulo: "Martes de pulpo",
          objetivo: "Llenar los martes a mediodía.",
          publico: "Familias de Crevillent.",
          mensaje: "El martes, pulpo.",
          razonamiento: "Los martes funcionan mejor: 9 % de interacción frente al 5,5 % de media. Los reels suben un 40 % el alcance. Noviembre pide cuchara.",
          fases: [{ nombre: "Martes", desde: "2026-11-09", hasta: "2026-11-29" }],
          piezas: [pieza(0, "Martes a mediodía: 9 % de interacción."), pieza(1, "Es el día con un 70 % más de alcance.")],
        }),
      ],
    });
    const r = await manejarIA(peticion({ accion: "proponer_campana", marca: "casa-tomas", desde: "2026-11-09", semanas: 3, piezasPorSemana: 1 }), deps(f));
    const j = await r.json();
    expect(r.status).toBe(200);
    // La RPC se pide con la cuenta de la marca y 90 días.
    const rpc = llamadas.find((l) => l.url.endsWith("/rpc/instagram_que_funciona"))!;
    expect(JSON.parse(rpc.cuerpo!)).toEqual({ p_marca: "casa-tomas", p_ig_user_id: IG, p_dias: 90 });
    const { datos, sistema } = datosEnviados();
    expect(datos.metricas.conclusiones).toEqual([MARTES]);
    expect(datos.metricas.por.dia.map((g: { clave: string }) => g.clave)).toEqual(["martes", "jueves"]);
    expect(sistema).toMatch(/NUNCA cites un porcentaje o una cifra que no esté en DATOS\.metricas/);
    // Lo inventado (40 %, 70 %) se quita; lo real (9 %, 5,5 %) se queda.
    expect(j.campana.razonamiento).toBe("Los martes funcionan mejor: 9 % de interacción frente al 5,5 % de media. Noviembre pide cuchara.");
    expect(j.campana.piezas.map((p: { porQue: string }) => p.porQue)).toEqual(["Martes a mediodía: 9 % de interacción.", ""]);
    expect(j.avisos.join(" ")).toMatch(/Se han quitado 2 frase\(s\) con cifras/);
  });

  it("ideas_semana: también recibe «Qué funciona»; con pocos datos, ninguna conclusión", async () => {
    const { f, datosEnviados } = falso({
      qf: [200, POCOS],
      openai: [
        respuestaOpenAI({
          ideas: [
            { fecha: "2026-11-10", titulo: "Martes", idea: "Los martes dan un 9 % de interacción. Pulpo.", motivo: "metricas", formato: "post", plantilla: "ct-portada", plato_id: "pulpo", gancho: "Martes de pulpo." },
          ],
        }),
      ],
    });
    const r = await manejarIA(peticion({ accion: "ideas_semana", marca: "casa-tomas", semana: "2026-11-10" }), deps(f));
    expect(r.status).toBe(200);
    const { datos } = datosEnviados();
    expect(datos.metricas).toMatchObject({ suficiente: false, conclusiones: [], por: {} });
    expect(datos.metricas.aviso).toMatch(/faltan|hacen falta/);
    const j = await r.json();
    // Con pocos datos, ni el 9 % vale: no hay conclusiones que citar.
    expect(j.ideas[0].idea).toBe("Pulpo.");
  });

  it("sugerir_texto: «Qué funciona» como datos y la regla de no citar métricas en el texto", async () => {
    const buena = (n: number) => ({
      gancho: `Gancho ${n}.`,
      caption: `Gancho ${n}. Pulpo a la gallega, como en casa. Te esperamos.`,
      hashtags: ["#CasaTomás", "#Crevillent", "#Pulpo", "#Cocido", "#Otoño"],
      alt_text: "Pulpo sobre patatas.",
      platos_citados: ["Pulpo a la gallega"],
    });
    const { f, datosEnviados } = falso({ openai: [respuestaOpenAI({ variantes: [buena(1), buena(2), buena(3)] })] });
    const r = await manejarIA(peticion({ accion: "sugerir_texto", marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular" }), deps(f));
    expect(r.status).toBe(200);
    const { datos, sistema } = datosEnviados();
    expect(datos.que_funciona.conclusiones).toEqual([MARTES]);
    expect(datos.que_funciona.por.hashtag[0].clave).toBe("#cocido");
    expect(sistema).toMatch(/NUNCA menciones métricas, porcentajes/);
  });

  it("sin la migración (404 de la RPC): todo sigue como antes", async () => {
    const texto = falso({
      qf: [404, { code: "PGRST202", message: "Could not find the function public.instagram_que_funciona" }],
      openai: [respuestaOpenAI({ variantes: [1, 2, 3].map((n) => ({ gancho: `G${n}.`, caption: `G${n}. Pulpo a la gallega, como en casa. Te esperamos siempre.`, hashtags: ["#CasaTomás"], alt_text: "Pulpo.", platos_citados: [] })) })],
    });
    const r = await manejarIA(peticion({ accion: "sugerir_texto", marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular" }), deps(texto.f));
    expect(r.status).toBe(200);
    expect("que_funciona" in texto.datosEnviados().datos).toBe(false);

    const ideas = falso({
      qf: [404, { code: "PGRST202" }],
      openai: [respuestaOpenAI({ ideas: [{ fecha: "2026-11-10", titulo: "Martes", idea: "Pulpo.", motivo: "plato", formato: "post", plantilla: "ct-portada", plato_id: "pulpo", gancho: "Martes de pulpo." }] })],
    });
    const r2 = await manejarIA(peticion({ accion: "ideas_semana", marca: "casa-tomas", semana: "2026-11-10" }), deps(ideas.f));
    expect(r2.status).toBe(200);
    // El resumen de la fase 2 (instagram_ia_contexto).
    expect(ideas.datosEnviados().datos.metricas).toEqual(CONTEXTO.metricas);
  });
});
