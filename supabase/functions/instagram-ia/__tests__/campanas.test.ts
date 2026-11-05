// @vitest-environment node
/**
 * instagram-ia, fase 2 (proponer_campana e ideas_semana) sin red: Supabase
 * (Auth, permiso, cupo, guía, contexto por RPC, registro de sugerencias y de
 * campañas) y OpenAI simulados. Nunca llama a OpenAI de verdad.
 *
 * Cubre: entrada (semanas, fechas, pasado), contexto sin precios ni datos
 * personales, plato inexistente bloqueado, TOUZA con «reservar» bloqueado (y
 * reintento), fechas fuera de rango, foto que no está en la biblioteca →
 * «falta foto», emoji corregidos, 422, guardado de la campaña y registro de
 * uso con disparador campana:<uuid>, cupo, migración sin aplicar e ideas de
 * la semana.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { manejarIA, OPENAI } from "../ia.ts";
import { hoyMadrid, validarEntradaPlanificacion } from "../campanas.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import type { AcumuladorUso, OpcionesRegistro } from "../../_shared/registrar-uso-ia.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const CLAVE = "sk-clave-de-openai-de-pruebas-0123456789";
const USUARIO = "11111111-1111-4111-8111-111111111111";
const CAMPANA = "22222222-2222-4222-8222-222222222222";
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica", OPENAI_API_KEY: CLAVE };
const AHORA = new Date("2026-11-05T10:00:00Z");
const DRIVE = "drive:FotoDelPulpo0001";

const GUIA = { version: 2, guia: "Cálido, familiar y honesto. Sin emoji.", hashtags_base: ["#CasaTomás", "#Crevillent"], ctas: ["Reservar mesa", "Ver carta"] };
const CONTEXTO_CT = {
  marca: "casa-tomas",
  carta: [
    { id: "pulpo", nombre: "Pulpo a la gallega", categoria: "Del mar", featured: true, tiene_foto: true, descripcion: "Con cachelos", alergenos_oficiales: ["moluscos"], sin_gluten_disponible: false },
    { id: "croquetas", nombre: "Croquetas de jamón", categoria: "Entrantes", featured: false, tiene_foto: false },
  ],
  novedades: [{ titulo: "Menú de castañas", desde: "2026-11-01", hasta: "2026-11-30" }],
  fechas: [{ titulo: "San Martín y la matanza", desde: "2026-11-11", hasta: "2026-11-11", verificacion: "verificada" }],
  fotos: [{ id: DRIVE, tipo: "plato", descripcion: "Pulpo en plato de madera" }],
  metricas: { publicaciones: 4, por: { franja: [{ clave: "12:00-14:00", tasa: 7.5 }] } },
  historial: [],
};
const CONTEXTO_TZ = {
  ...CONTEXTO_CT,
  marca: "touza",
  carta: [{ id: "vermu", nombre: "Vermú de la casa", categoria: "Barra", featured: true, tiene_foto: false }],
  novedades: [],
  fotos: [],
};

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null };
const resp = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cab } });
const respuestaOpenAI = (datos: unknown) =>
  resp(200, {
    choices: [{ message: { content: JSON.stringify(datos) } }],
    usage: { prompt_tokens: 6000, completion_tokens: 3000, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } },
  });

interface Escenario {
  usadasHoy?: number;
  contexto?: [number, unknown];
  openai?: Response[];
  campana?: [number, unknown];
}

function falso(e: Escenario = {}) {
  const llamadas: Llamada[] = [];
  const cola = [...(e.openai ?? [])];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cabeceras = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const cuerpo = typeof init.body === "string" ? init.body : null;
    llamadas.push({ url, metodo, cabeceras, cuerpo });
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: USUARIO });
    if (url === `${SB}/rest/v1/rpc/can_edit_section` || url === `${SB}/rest/v1/rpc/can_read_section`) return resp(200, true);
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`) && metodo === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-range": `*/${e.usadasHoy ?? 0}` } });
    }
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`) && metodo === "POST") return resp(201, [{ id: "99999999-9999-4999-8999-999999999999" }]);
    if (url.startsWith(`${SB}/rest/v1/instagram_guias_marca`)) return resp(200, [GUIA]);
    if (url === `${SB}/rest/v1/rpc/instagram_ia_contexto`) {
      if (e.contexto) return resp(...e.contexto);
      const marca = JSON.parse(cuerpo ?? "{}").p_marca;
      return resp(200, marca === "touza" ? CONTEXTO_TZ : CONTEXTO_CT);
    }
    if (url.startsWith(`${SB}/rest/v1/instagram_campanas`) && metodo === "POST") return resp(...(e.campana ?? [201, [{ id: CAMPANA }]]));
    if (url === `${OPENAI}/chat/completions`) {
      const r = cola.shift();
      if (!r) throw new Error("llamada a OpenAI no prevista");
      return r;
    }
    throw new Error(`fetch no previsto: ${metodo} ${url}`);
  });
  return { f, llamadas, openai: () => llamadas.filter((l) => l.url.startsWith(OPENAI)) };
}

const peticion = (cuerpo: unknown) =>
  new Request("https://x.supabase.co/functions/v1/instagram-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
  });

const PIDE = { accion: "proponer_campana", marca: "casa-tomas", desde: "2026-11-09", semanas: 3, piezasPorSemana: 2, objetivo: "Llenar los mediodías. Dudas a ana@correo.es" };

const pieza = (n: number, extra: Record<string, unknown> = {}) => ({
  fecha: `2026-11-${String(9 + n * 3).padStart(2, "0")}`,
  hora: "13:00",
  formato: "post",
  plantilla: "ct-foto-titular",
  plato_id: "pulpo",
  foto_sugerida: DRIVE,
  antetitulo: "Esta semana",
  titular: `El pulpo de casa ${n}`,
  gancho: `Gancho ${n}.`,
  caption: `Gancho ${n}. Pulpo a la gallega, como en casa. Te esperamos.`,
  hashtags: ["#CasaTomás", "#Crevillent", "#CocinaGallega", "#Pulpo", "#Otoño"],
  alt_text: "Pulpo en rodajas con pimentón sobre patatas cocidas.",
  por_que: "Es el plato destacado y noviembre pide cuchara.",
  fase: n < 3 ? 0 : 1,
  encargo_sugerido: "",
  ...extra,
});

const campana = (piezas: unknown[], extra: Record<string, unknown> = {}) => ({
  titulo: "Otoño en casa",
  objetivo: "Llenar los mediodías de entre semana.",
  publico: "Familias de Crevillent.",
  mensaje: "El otoño gallego llega a la mesa.",
  razonamiento: "San Martín cae en miércoles y el pulpo es el plato destacado.",
  fases: [
    { nombre: "Anuncio", desde: "2026-11-09", hasta: "2026-11-15" },
    { nombre: "Plato a plato", desde: "2026-11-16", hasta: "2026-12-31" },
  ],
  piezas,
  ...extra,
});

let registros: Array<{ uso: AcumuladorUso; opciones: OpcionesRegistro }>;
const registrar = async (uso: AcumuladorUso, opciones: OpcionesRegistro) => {
  registros.push({ uso, opciones });
};
const deps = (f: typeof fetch) => ({ env: ENV, fetch: f, registrar, ahora: () => AHORA });

beforeEach(() => {
  olvidarSecretos();
  registros = [];
});
afterEach(() => vi.restoreAllMocks());

describe("instagram-ia: entrada de la planificación", () => {
  it("valida semanas, piezas por semana, fechas y el objetivo (sin datos personales)", () => {
    expect(hoyMadrid(AHORA)).toBe("2026-11-05");
    expect(validarEntradaPlanificacion({ ...PIDE, semanas: 5 }, AHORA).ok).toBe(false);
    expect(validarEntradaPlanificacion({ ...PIDE, semanas: 1 }, AHORA).ok).toBe(false);
    expect(validarEntradaPlanificacion({ ...PIDE, piezasPorSemana: 9 }, AHORA).ok).toBe(false);
    expect(validarEntradaPlanificacion({ ...PIDE, desde: "2026-11-01" }, AHORA)).toEqual({ ok: false, error: "La campaña no puede empezar en el pasado" });
    expect(validarEntradaPlanificacion({ ...PIDE, desde: "2027-03-01" }, AHORA).ok).toBe(false);
    expect(validarEntradaPlanificacion({ ...PIDE, desde: "2026-02-30" }, AHORA).ok).toBe(false);
    expect(validarEntradaPlanificacion({ ...PIDE, objetivo: "x".repeat(501) }, AHORA).ok).toBe(false);
    const ok = validarEntradaPlanificacion(PIDE, AHORA);
    expect(ok.ok && ok.entrada).toEqual({
      accion: "proponer_campana", marca: "casa-tomas", desde: "2026-11-09", hasta: "2026-11-29", semanas: 3, piezasPorSemana: 2,
      objetivo: "Llenar los mediodías. Dudas a [correo]",
    });
    const defecto = validarEntradaPlanificacion({ accion: "proponer_campana", marca: "touza" }, AHORA);
    expect(defecto.ok && defecto.entrada).toMatchObject({ desde: "2026-11-06", hasta: "2026-11-26", semanas: 3, piezasPorSemana: 3 });
    const ideas = validarEntradaPlanificacion({ accion: "ideas_semana", marca: "touza", semana: "2026-11-12" }, AHORA);
    expect(ideas.ok && ideas.entrada).toEqual({ accion: "ideas_semana", marca: "touza", desde: "2026-11-09", hasta: "2026-11-15" });
    expect(validarEntradaPlanificacion({ accion: "ideas_semana", marca: "touza", semana: "2026-10-01" }, AHORA).ok).toBe(false);
  });
});

describe("instagram-ia: proponer_campana", () => {
  it("campaña validada y guardada: contexto sin precios ni datos personales, falta foto, emoji corregidos, uso con campana:<uuid>", async () => {
    const { f, llamadas, openai } = falso({
      openai: [
        respuestaOpenAI(
          campana(
            [
              pieza(3, { titular: "Croquetas de la casa", plato_id: "croquetas", foto_sugerida: "", caption: "Gancho 3. Croquetas de jamón para compartir. Te esperamos." }),
              pieza(0),
              pieza(1, { foto_sugerida: "drive:OtraFotoQueNoExiste", formato: "story" }),
              pieza(2, { plantilla: "ct-tipografica", foto_sugerida: "", plato_id: "", titular: "Noches de otoño", caption: "Gancho 2. El otoño se vive en la mesa. Te esperamos." }),
            ],
            { titulo: "Otoño en casa 🍂" },
          ),
        ),
      ],
    });
    const r = await manejarIA(peticion(PIDE), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, accion: "proponer_campana", campanaId: CAMPANA, versionGuia: 2 });
    expect(j.campana.titulo).toBe("Otoño en casa");
    expect(j.avisos.join(" ")).toMatch(/emoji/);
    expect(j.campana.piezas.map((p: { fecha: string }) => p.fecha)).toEqual(["2026-11-09", "2026-11-12", "2026-11-15", "2026-11-18"]);
    const [p0, p1, p2, p3] = j.campana.piezas;
    expect(p0).toMatchObject({ platoId: "pulpo", plato: { id: "pulpo", nombre: "Pulpo a la gallega" }, foto: DRIVE, faltaFoto: false });
    expect(p1).toMatchObject({ foto: null, faltaFoto: true, formato: "story" });
    expect(p1.avisos.join(" ")).toMatch(/falta foto/);
    expect(p2).toMatchObject({ plantilla: "ct-tipografica", foto: null, faltaFoto: false, platoId: null });
    expect(p3).toMatchObject({ platoId: "croquetas", faltaFoto: true });
    expect(j.campana.fases[1].hasta).toBe("2026-11-29"); // recortada al final de la campaña

    // Lo que ve el modelo: carta sin precio ni alérgenos, fechas, fotos y métricas; sin el correo.
    const cuerpo = JSON.parse(openai()[0].cuerpo!);
    expect(cuerpo).toMatchObject({ model: "gpt-5.6-luna", max_completion_tokens: 8000, response_format: { type: "json_schema", json_schema: { name: "campana_instagram" } } });
    const usuario = cuerpo.messages[1].content as string;
    for (const t of ["<<<DATOS", "Pulpo a la gallega", "San Martín y la matanza", DRIVE, "12:00-14:00", "Menú de castañas", "Llenar los mediodías"]) expect(usuario).toContain(t);
    expect(usuario).not.toMatch(/ana@correo|precio|moluscos/);
    expect(cuerpo.messages[0].content).toMatch(/plato_id.*SOLO un «id»/);

    // Contexto por RPC con el JWT del usuario; campaña guardada como propuesta.
    const rpc = llamadas.find((l) => l.url.endsWith("/rpc/instagram_ia_contexto"))!;
    expect(rpc.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    expect(JSON.parse(rpc.cuerpo!)).toEqual({ p_marca: "casa-tomas", p_desde: "2026-11-09", p_hasta: "2026-11-29" });
    const fila = JSON.parse(llamadas.find((l) => l.metodo === "POST" && l.url.includes("instagram_campanas"))!.cuerpo!);
    expect(fila).toMatchObject({ marca: "casa-tomas", titulo: "Otoño en casa", desde: "2026-11-09", hasta: "2026-11-29", peticion: "Llenar los mediodías. Dudas a [correo]", sugerencia_id: "99999999-9999-4999-8999-999999999999" });
    expect(fila.propuesta.piezas).toHaveLength(4);
    expect(fila).not.toHaveProperty("estado");
    const sug = JSON.parse(llamadas.find((l) => l.metodo === "POST" && l.url.includes("instagram_sugerencias_ia"))!.cuerpo!);
    expect(sug).toMatchObject({ tipo: "proponer_campana", variantes: 1, tokens_entrada: 6000 });

    expect(registros).toHaveLength(1);
    expect(registros[0].opciones.disparador).toBe(`campana:${CAMPANA}`);
    expect(registros[0].uso).toMatchObject({ funcion: "instagram-ia", llamadas: 1, estado: "ok" });
    expect(JSON.stringify(j)).not.toContain(CLAVE);
  });

  it("plato inexistente y fecha fuera de rango: esas piezas se descartan", async () => {
    const { f } = falso({
      openai: [
        respuestaOpenAI(campana([
          pieza(0),
          pieza(1),
          pieza(2),
          pieza(3, { plato_id: "percebes-inventados" }),
          pieza(4, { fecha: "2026-12-20" }),
        ])),
      ],
    });
    const j = await (await manejarIA(peticion(PIDE), deps(f))).json();
    expect(j.ok).toBe(true);
    expect(j.campana.piezas).toHaveLength(3);
    const motivos = j.descartadas.flatMap((d: { motivos: string[] }) => d.motivos).join(" ");
    expect(motivos).toMatch(/«percebes-inventados» no está en la carta activa/);
    expect(motivos).toMatch(/2026-12-20 cae fuera de la campaña/);
  });

  it("plato por nombre que no está en la carta (aunque el id sea bueno) también se bloquea", async () => {
    const { f } = falso({
      openai: [respuestaOpenAI(campana([pieza(0), pieza(1), pieza(2, { caption: "Gancho 2. Pulpo a la gallega y bogavante del día. Te esperamos." }), pieza(3)]))],
    });
    const j = await (await manejarIA(peticion(PIDE), deps(f))).json();
    expect(j.campana.piezas).toHaveLength(3);
    expect(j.descartadas.flatMap((d: { motivos: string[] }) => d.motivos).join(" ")).toMatch(/bogavante/);
  });

  it("TOUZA con «reservar» se bloquea; reintenta con los motivos y acepta la segunda", async () => {
    // (Un razonamiento que hablara del pulpo también se bloquearía: no está en la carta de TOUZA.)
    const RAZON_TZ = "Los jueves son la noche más floja de la semana.";
    const tz = (n: number, extra: Record<string, unknown> = {}) =>
      pieza(n, {
        plantilla: "tz-foto-titular",
        plato_id: "vermu",
        foto_sugerida: "",
        titular: `La barra de TOUZA ${n}`,
        caption: `Gancho ${n}. Vermú de la casa en la barra de Touza.`,
        hashtags: ["#TOUZA", "#Crevillent", "#Coctelería", "#Vermú", "#Noche"],
        alt_text: "Copa de vermú sobre la barra.",
        por_que: "Los jueves son la noche más floja.",
        ...extra,
      });
    const mala = campana([tz(0), tz(1, { caption: "Gancho 1. Reserva ya tu sitio en la barra." }), tz(2)], { mensaje: "Reserva tu mesa en TOUZA", razonamiento: RAZON_TZ });
    const buena = campana([tz(0), tz(1), tz(2)], { titulo: "Jueves en la barra", mensaje: "La noche empieza en la barra.", razonamiento: RAZON_TZ });
    const { f, openai } = falso({ openai: [respuestaOpenAI(mala), respuestaOpenAI(buena)] });
    const r = await manejarIA(peticion({ ...PIDE, marca: "touza" }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.campana.titulo).toBe("Jueves en la barra");
    expect(j.campana.piezas[0].caption).toContain("TOUZA");
    expect(openai()).toHaveLength(2);
    const reintento = JSON.parse(openai()[1].cuerpo!).messages.at(-1).content as string;
    expect(reintento).toMatch(/TOUZA no admite reservas/);
    expect(JSON.stringify(j.campana)).not.toMatch(/reserv/i);
    expect(registros[0].uso.llamadas).toBe(2);
  });

  it("si tampoco pasa al reintento: 422 con los motivos y sin guardar la campaña", async () => {
    const mala = campana([pieza(0, { fecha: "2027-01-10" }), pieza(1, { plato_id: "nada" })]);
    const { f, llamadas } = falso({ openai: [respuestaOpenAI(mala), respuestaOpenAI(mala)] });
    const r = await manejarIA(peticion(PIDE), deps(f));
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.descartadas[0].donde).toBe("Campaña");
    expect(llamadas.some((l) => l.url.includes("instagram_campanas"))).toBe(false);
    expect(registros[0].opciones.disparador).toBe(`usuario:${USUARIO}`);
  });

  it("cupo agotado 429, migración sin aplicar 503 y fallo al guardar 502, sin gastar de más", async () => {
    const cupo = falso({ usadasHoy: 100 });
    expect((await manejarIA(peticion(PIDE), deps(cupo.f))).status).toBe(429);
    expect(cupo.openai()).toHaveLength(0);

    const sinMig = falso({ contexto: [404, { code: "PGRST202", message: "Could not find the function public.instagram_ia_contexto" }] });
    const r = await manejarIA(peticion(PIDE), deps(sinMig.f));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/20261109000000_instagram_campanas/);
    expect(sinMig.openai()).toHaveLength(0);

    const noGuarda = falso({ openai: [respuestaOpenAI(campana([pieza(0), pieza(1), pieza(2)]))], campana: [500, { message: "x" }] });
    const r2 = await manejarIA(peticion(PIDE), deps(noGuarda.f));
    expect(r2.status).toBe(502);
    expect(registros.at(-1)!.uso.estado).toBe("error");
  });

  it("400 con la entrada mal (sin llamar a OpenAI)", async () => {
    const { f, openai } = falso();
    const r = await manejarIA(peticion({ ...PIDE, semanas: 6 }), deps(f));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/semanas/);
    expect(openai()).toHaveLength(0);
  });
});

describe("instagram-ia: ideas_semana", () => {
  it("ideas validadas de la semana; la del plato inexistente y la de otra semana se descartan", async () => {
    const idea = (n: number, extra: Record<string, unknown> = {}) => ({
      fecha: "2026-11-11",
      titulo: `Idea ${n}`,
      idea: "San Martín: el pulpo a la gallega como plato de la semana.",
      motivo: "fecha_senalada",
      formato: "post",
      plantilla: "ct-foto-titular",
      plato_id: "pulpo",
      gancho: "A cada casa le llega su San Martín.",
      ...extra,
    });
    const { f, openai, llamadas } = falso({
      openai: [respuestaOpenAI({ ideas: [idea(1), idea(2, { plato_id: "langosta" }), idea(3, { fecha: "2026-11-20" }), idea(4, { titulo: "Idea 4 ✨", plato_id: "" })] })],
    });
    const r = await manejarIA(peticion({ accion: "ideas_semana", marca: "casa-tomas", semana: "2026-11-11" }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, accion: "ideas_semana", desde: "2026-11-09", hasta: "2026-11-15" });
    expect(j.ideas.map((i: { titulo: string }) => i.titulo)).toEqual(["Idea 1", "Idea 4"]);
    expect(j.ideas[1].avisos.join(" ")).toMatch(/emoji/);
    expect(j.descartadas).toHaveLength(2);
    expect(j.fechas[0].titulo).toBe("San Martín y la matanza");
    expect(JSON.parse(openai()[0].cuerpo!).response_format.json_schema.name).toBe("ideas_semana_instagram");
    expect(llamadas.some((l) => l.url.includes("instagram_campanas"))).toBe(false);
    expect(JSON.parse(llamadas.find((l) => l.metodo === "POST" && l.url.includes("instagram_sugerencias_ia"))!.cuerpo!)).toMatchObject({ tipo: "ideas_semana", variantes: 2 });
  });
});
