// @vitest-environment node
/**
 * instagram-ia · «montar_pieza» sin red (Supabase y OpenAI simulados; nunca
 * se llama a OpenAI de verdad): 1 foto → post; 6 fotos → carrusel ordenado;
 * plantilla inexistente → corregida; rótulos que no caben → descartada;
 * foto ajena → 400; mismo cupo y mismo registro de coste. Y la copia del
 * contrato (_shared/instagram/montar.ts) igual a src/lib/instagram/montar.ts.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { manejarIA, OPENAI } from "../ia.ts";
import { formatoFinal, fotoCubre, horaValida, LEMA_CIERRE, papelDe, plantillasMontar } from "../montar.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import type { AcumuladorUso, OpcionesRegistro } from "../../_shared/registrar-uso-ia.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const USUARIO = "11111111-1111-4111-8111-111111111111";
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica", OPENAI_API_KEY: "sk-clave-de-openai-de-pruebas-0123456789" };
const AHORA = new Date("2026-11-05T10:00:00Z");
const GUIA = { version: 3, guia: "Cálido, familiar y honesto.", hashtags_base: ["#CasaTomás", "#Crevillent"], ctas: ["Reservar mesa", "Ver carta"] };

const uuid = (n: number) => `0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a${String(n).padStart(2, "0")}`;
const tmp = (n: number) => `${SB}/storage/v1/object/public/instagram/tmp/${uuid(n)}.jpg`;
const foto = (n: number) => ({ id: `drive:FotoDeDrive000${n}`, url: tmp(n) });

const resp = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cab } });
const respuestaOpenAI = (datos: unknown) =>
  resp(200, { choices: [{ message: { content: JSON.stringify(datos) } }], usage: { prompt_tokens: 4000, completion_tokens: 600 } });

const diapo = (n: number, titular: string, o: Record<string, unknown> = {}) => ({
  foto: n,
  plantilla: "ct-foto-titular",
  antetitulo: "Del mar",
  titular,
  cita: "",
  cta: "",
  pie: "",
  alt_text: `Foto ${n} de marisco sobre hielo.`,
  ...o,
});
const montaje = (diapositivas: unknown[], o: Record<string, unknown> = {}) => ({
  resumen: "6 fotos de marisco fresco: centolla, nécoras y percebes.",
  diapositivas,
  gancho: "Hoy el Cantábrico viene a Crevillent.",
  caption:
    "Hoy el Cantábrico viene a Crevillent. Centolla, nécoras y percebes recién llegados, al punto y sin más adorno que el agua de mar. Ven con hambre y sin prisa.",
  hashtags: ["#Marisco", "#Crevillent", "#CasaTomás", "#Centolla"],
  platos_citados: [],
  hora_sugerida: "2026-11-07T13:00",
  ...o,
});

function falso(openai: Response[] = []) {
  const llamadas: Array<{ url: string; metodo: string; cuerpo: string | null }> = [];
  const cola = [...openai];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    llamadas.push({ url, metodo, cuerpo: typeof init.body === "string" ? init.body : null });
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: USUARIO });
    if (url === `${SB}/rest/v1/rpc/can_write_section` || url === `${SB}/rest/v1/rpc/can_edit_section` || url === `${SB}/rest/v1/rpc/can_read_section`) return resp(200, true);
    if (url === `${SB}/rest/v1/rpc/instagram_ia_reservar_cupo`) return resp(404, { code: "PGRST202" });
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`) && metodo === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
    if (url.startsWith(`${SB}/rest/v1/instagram_sugerencias_ia`)) return resp(201, [{ id: "99999999-9999-4999-8999-999999999999" }]);
    if (url.startsWith(`${SB}/rest/v1/instagram_guias_marca`)) return resp(200, [GUIA]);
    if (url.startsWith(`${SB}/rest/v1/Platos?select=nombre`)) return resp(200, [{ nombre: "Chuletón de vaca" }, { nombre: "Centolla cocida" }, { nombre: "Nécoras" }, { nombre: "Percebes" }]);
    if (url.startsWith(`${SB}/rest/v1/Vinos?select=`)) return resp(200, [{ id: "v1", nombre: "Pazo de Señoráns", denominacion_origen: "D.O. Rías Baixas", ingredientes: "Albariño" }]);
    if (url === `${SB}/rest/v1/rpc/instagram_ia_contexto`) return resp(200, { carta: [], fechas: [{ titulo: "Puente", desde: "2026-12-06", hasta: "2026-12-08" }], novedades: [] });
    if (url.startsWith(`${SB}/rest/v1/rpc/instagram_que_funciona`)) return resp(404, { code: "PGRST202" });
    if (url === `${OPENAI}/chat/completions`) {
      const r = cola.shift();
      if (!r) throw new Error("llamada a OpenAI no prevista");
      return r;
    }
    throw new Error(`fetch no previsto: ${metodo} ${url}`);
  });
  return { f, llamadas, openai: () => llamadas.filter((l) => l.url.startsWith(OPENAI)).map((l) => JSON.parse(l.cuerpo!)) };
}

const peticion = (cuerpo: unknown) =>
  new Request("https://x.supabase.co/functions/v1/instagram-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
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

describe("instagram-ia · montar_pieza", () => {
  it("1 foto → post con su plantilla, rótulos, alt y texto; la IA ve la foto", async () => {
    const { f, openai, llamadas } = falso([respuestaOpenAI(montaje([diapo(1, "Centolla recién llegada")]))]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [foto(1)], indicacion: "llegó bonito del Cantábrico" }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({
      ok: true,
      formato: "post",
      diapositivas: [{ foto: "drive:FotoDeDrive0001", plantilla: "ct-portada", datos: { antetitulo: "Del mar", titular: "Centolla recién llegada" }, altText: "Foto 1 de marisco sobre hielo." }],
      hashtags: ["#Marisco", "#Crevillent", "#CasaTomás", "#Centolla"],
      horaSugerida: "2026-11-07T13:00",
      resumen: expect.stringMatching(/marisco/),
    });
    const [llamada] = openai();
    expect(llamada.model).toBe("gpt-5.6-luna");
    expect(llamada.response_format.json_schema.name).toBe("montar_pieza_instagram");
    const imagenes = llamada.messages[1].content.filter((p: { type: string }) => p.type === "image_url");
    expect(imagenes).toEqual([{ type: "image_url", image_url: { url: tmp(1), detail: "high" } }]);
    const datos = llamada.messages[1].content[0].text as string;
    expect(datos).toContain("llegó bonito del Cantábrico");
    expect(datos).toContain("Pazo de Señoráns");
    expect(datos).toContain("Puente");
    // Mismo cupo (HEAD de instagram_sugerencias_ia) y la sugerencia se guarda como montar_pieza.
    expect(llamadas.some((l) => l.metodo === "HEAD" && l.url.includes("instagram_sugerencias_ia"))).toBe(true);
    const insert = llamadas.find((l) => l.metodo === "POST" && l.url.includes("instagram_sugerencias_ia"))!;
    expect(JSON.parse(insert.cuerpo!)).toMatchObject({ tipo: "montar_pieza", marca: "casa-tomas", variantes: 1 });
    // Mismo registro de coste.
    expect(registros).toHaveLength(1);
    expect(registros[0].uso).toMatchObject({ funcion: "instagram-ia", modelo: "gpt-5.6-luna", operacion: "chat", llamadas: 1 });
    expect(registros[0].opciones.disparador).toBe(`usuario:${USUARIO}`);
  });

  it("6 fotos → carrusel en el orden de la IA, portada primero, con «low» y sin fotos inventadas", async () => {
    const orden = [3, 1, 6, 2, 5, 4];
    const { f, openai } = falso([
      respuestaOpenAI(montaje([...orden.map((n) => diapo(n, `Marisco ${n}`)), diapo(9, "Foto que no existe"), diapo(3, "Repetida")])),
    ]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [1, 2, 3, 4, 5, 6].map(foto), formato: "auto" }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.formato).toBe("carrusel");
    expect(j.diapositivas.map((d: { foto: string }) => d.foto)).toEqual(orden.map((n) => `drive:FotoDeDrive000${n}`));
    expect(j.diapositivas[0].datos.titular).toBe("Marisco 3");
    expect(j.avisos.join(" ")).toMatch(/no es de las recibidas/);
    expect(j.avisos.join(" ")).toMatch(/dos veces/);
    const llamada = openai()[0];
    expect(llamada.messages[0].content).toMatch(/CARRUSEL con las 6 fotos/);
    const imagenes = llamada.messages[1].content.filter((p: { type: string }) => p.type === "image_url");
    expect(imagenes).toHaveLength(6);
    expect(imagenes.every((p: { image_url: { detail: string } }) => p.image_url.detail === "low")).toBe(true);
  });

  it("plantilla inexistente o sin foto → se corrige a la de foto de la marca y se avisa", async () => {
    const { f } = falso([respuestaOpenAI(montaje([diapo(1, "Centolla recién llegada", { plantilla: "ct-no-existe" }), diapo(2, "Nécoras", { plantilla: "ct-tipografica" })]))]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [foto(1), foto(2)] }), deps(f));
    const j = await r.json();
    // 2 fotos: portada y cierre (la plantilla va por el papel, diga lo que diga la IA).
    expect(j.diapositivas.map((d: { plantilla: string }) => d.plantilla)).toEqual(["ct-portada", "ct-cierre"]);
    expect(j.avisos.join(" ")).toMatch(/«ct-no-existe» no vale/);
    expect(j.avisos.join(" ")).toMatch(/«ct-tipografica» no vale/);
  });

  it("rótulos que no caben en la plantilla o precio inventado → reintento; si sigue mal, 422", async () => {
    const larga = montaje([diapo(1, "Un titular con muchas más palabras de las que caben")]);
    const conPrecio = montaje([diapo(1, "Centolla")], { caption: "Centolla a 30 € la ración, solo hoy en Casa Tomás, cocida al punto con agua de mar y laurel; ven a por ella antes de que se acabe." });
    const { f, openai } = falso([respuestaOpenAI(larga), respuestaOpenAI(conPrecio)]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [foto(1)] }), deps(f));
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.descartadas[0].motivos.join(" ")).toMatch(/6/);
    expect(j.descartadas[1].motivos.join(" ")).toMatch(/Precio/);
    expect(openai()[1].messages.at(-1).content).toMatch(/no ha pasado las comprobaciones/);
    expect(registros[0].uso.llamadas).toBe(2);
  });

  it("foto ajena → 400 «foto_no_valida» sin llamar a OpenAI; entrada mal → 400", async () => {
    for (const url of [
      "https://evil.example.com/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a01.jpg",
      `${SB}/storage/v1/object/public/instagram/fotos/casa-tomas/salon.jpg`,
      `${SB}/storage/v1/object/public/facturas/a.jpg`,
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      const { f, openai } = falso();
      const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [{ id: "drive:abc", url }] }), deps(f));
      expect(r.status, url).toBe(400);
      expect(await r.json()).toMatchObject({ ok: false, tipo: "foto_no_valida" });
      expect(openai()).toHaveLength(0);
    }
    const { f } = falso();
    const once = Array.from({ length: 11 }, (_, i) => foto(i + 1));
    expect((await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: once }), deps(f))).status).toBe(400);
    expect((await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [] }), deps(f))).status).toBe(400);
    expect((await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [foto(1)], formato: "carrusel" }), deps(f))).status).toBe(400);
    expect((await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [foto(1), foto(1)] }), deps(f))).status).toBe(400);
    expect((await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [{ id: "otro:1", url: tmp(1) }] }), deps(f))).status).toBe(400);
  });

  it("formato fijo manda: «post» con 3 fotos deja una imagen; las fotos de platos/vinos de nuestro bucket valen", async () => {
    const { f } = falso([respuestaOpenAI(montaje([diapo(2, "Centolla"), diapo(1, "Nécoras")]))]);
    const fotos = [foto(1), { id: "carta:centolla", url: `${SB}/storage/v1/object/public/platos/centolla.webp` }, foto(3)];
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos, formato: "post" }), {
      ...deps(f),
      fetch: (async (u: string | URL | Request, i?: RequestInit) =>
        String(u).startsWith(`${SB}/rest/v1/Platos?id=eq.`) ? resp(200, [{ id: "centolla", nombre: "Centolla cocida", activado: true, restaurante: true, touza: false }]) : f(u, i)) as typeof fetch,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.formato).toBe("post");
    expect(j.diapositivas).toHaveLength(1);
    expect(j.diapositivas[0].foto).toBe("carta:centolla");
    expect(j.avisos.join(" ")).toMatch(/una sola imagen/);
  });
});

describe("montar_pieza · fotos que no cubren (Foto enmarcada)", () => {
  const carta = { id: "carta:centolla", url: `${SB}/storage/v1/object/public/platos/centolla.webp` };
  const conPlato = (f: typeof fetch) =>
    (async (u: string | URL | Request, i?: RequestInit) =>
      String(u).startsWith(`${SB}/rest/v1/Platos?id=eq.`) ? resp(200, [{ id: "centolla", nombre: "Centolla cocida", activado: true, restaurante: true, touza: false }]) : f(u, i)) as typeof fetch;

  it("foto de la carta + plantilla a sangre → se corrige a la portada enmarcada y se avisa; la IA sabe que no cubre", async () => {
    const { f, openai } = falso([respuestaOpenAI(montaje([diapo(1, "Centolla recién llegada", { cita: "Centolla cocida" })]))]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos: [carta] }), { ...deps(f), fetch: conPlato(f) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.diapositivas[0]).toMatchObject({ foto: "carta:centolla", plantilla: "ct-portada-marco", datos: { titular: "Centolla recién llegada", cita: "Centolla cocida" } });
    expect(j.avisos.join(" ")).toMatch(/Foto 1 \(foto de la carta\): no cubre un post.*«ct-foto-titular».*se usa «ct-portada-marco» \(Foto enmarcada\)/);
    const [llamada] = openai();
    expect(llamada.messages[0].content).toMatch(/«cubre»: false.*usa SOLO plantillas «Foto enmarcada» \(como «ct-portada-marco»\)/);
    expect(llamada.messages[0].content).toMatch(/«ct-portada-marco» \(portada, Foto enmarcada/);
    // Las clásicas ya no se ofrecen.
    expect(llamada.messages[0].content).not.toMatch(/«ct-foto-titular»|«ct-marco»/);
    const datos = JSON.parse(llamada.messages[1].content[0].text.split("<<<DATOS")[1].split("DATOS>>>")[0]);
    expect(datos.fotos).toEqual([{ numero: 1, origen: "carta", cubre: false }]);
  });

  it("por medidas: una de Drive apaisada (1920×1080) se enmarca; una vertical grande se queda a sangre", async () => {
    const { f, openai } = falso([respuestaOpenAI(montaje([diapo(1, "Centolla recién llegada"), diapo(2, "Nécoras de la ría")]))]);
    const fotos = [
      { ...foto(1), ancho: 1920, alto: 1080 },
      { ...foto(2), ancho: 3000, alto: 4000 },
    ];
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.diapositivas.map((d: { plantilla: string }) => d.plantilla)).toEqual(["ct-portada-marco", "ct-cierre"]);
    expect(j.avisos.join(" ")).toMatch(/Foto 1 \(1920×1080\): no cubre un post/);
    const datos = JSON.parse(openai()[0].messages[1].content[0].text.split("<<<DATOS")[1].split("DATOS>>>")[0]);
    expect(datos.fotos.map((x: { cubre: boolean; medidas?: string }) => [x.medidas, x.cubre])).toEqual([
      ["1920×1080", false],
      ["3000×4000", true],
    ]);
  });

  it("plantilla inexistente con una foto de la carta (Touza, story) → «tz-portada-marco»", async () => {
    const { f } = falso([respuestaOpenAI(montaje([diapo(1, "Para empezar la noche", { plantilla: "tz-no-existe", antetitulo: "Touza" })]))]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "touza", formato: "story", fotos: [{ id: "carta:vermut", url: `${SB}/storage/v1/object/public/platos/vermut.webp` }] }), {
      ...deps(f),
      fetch: (async (u: string | URL | Request, i?: RequestInit) =>
        String(u).startsWith(`${SB}/rest/v1/Platos?id=eq.`) ? resp(200, [{ id: "vermut", nombre: "Vermut", activado: true, restaurante: false, touza: true }]) : f(u, i)) as typeof fetch,
    });
    expect(r.status).toBe(200);
    expect((await r.json()).diapositivas[0].plantilla).toBe("tz-portada-marco");
  });

  it("fotoCubre: regla de esAptaPara con medidas; sin ellas, la carta y los vinos no cubren", () => {
    expect(fotoCubre({ id: "carta:x", ancho: 1200, alto: 900 }, "post")).toBe(false);
    expect(fotoCubre({ id: "drive:x", ancho: 1080, alto: 1350 }, "post")).toBe(true);
    expect(fotoCubre({ id: "drive:x", ancho: 1080, alto: 1350 }, "story")).toBe(false);
    expect(fotoCubre({ id: "drive:x", ancho: 1030, alto: 1830 }, "story")).toBe(true);
    expect(fotoCubre({ id: "carta:x" }, "post")).toBe(false);
    expect(fotoCubre({ id: "vino:x", ancho: null, alto: null }, "story")).toBe(false);
    expect(fotoCubre({ id: "drive:x" }, "post")).toBe(true);
  });
});

describe("montar_pieza · papeles del carrusel (plantillas v2)", () => {
  it("4 fotos: portada → platos → cierre; el botón solo en la última y el cierre sin texto lleva el lema", async () => {
    const { f } = falso([
      respuestaOpenAI(
        montaje([
          diapo(2, "Del mar a la mesa", { cta: "Reservar mesa", plantilla: "ct-cierre" }),
          diapo(1, "Centolla", { cta: "Ver carta", antetitulo: "" }),
          diapo(4, "Nécoras", { antetitulo: "" }),
          diapo(3, "", { antetitulo: "", cta: "Reservar mesa" }),
        ]),
      ),
    ]);
    const fotos = [1, 2, 3, 4].map(foto);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos }), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.diapositivas.map((d: { plantilla: string }) => d.plantilla)).toEqual(["ct-portada", "ct-plato", "ct-plato", "ct-cierre"]);
    expect(j.diapositivas[0].datos.cta).toBeUndefined();
    expect(j.diapositivas[1].datos.cta).toBeUndefined();
    expect(j.diapositivas[3].datos).toEqual({ cita: LEMA_CIERRE["casa-tomas"], cta: "Reservar mesa" });
    expect(j.avisos.join(" ")).toMatch(/Imagen 1: se quita el botón «Reservar mesa»: en un carrusel va solo en la última/);
    expect(j.avisos.join(" ")).toMatch(/Imagen 2: se quita el botón «Ver carta»/);
  });

  it("Touza: el cierre nunca dice «Reservar» (se descarta y se reintenta)", async () => {
    const mal = montaje([diapo(1, "La noche empieza aquí", { antetitulo: "" }), diapo(2, "", { antetitulo: "", cta: "Reservar mesa" })]);
    const { f } = falso([respuestaOpenAI(mal), respuestaOpenAI(mal)]);
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "touza", fotos: [foto(1), foto(2)] }), deps(f));
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toMatch(/TOUZA no admite reservas/);
  });

  it("carrusel con fotos de la carta: todas enmarcadas, cada una con su papel", async () => {
    const { f } = falso([respuestaOpenAI(montaje([diapo(1, "Lo que nunca falta"), diapo(2, "Centolla", { antetitulo: "" }), diapo(3, "", { antetitulo: "" })]))]);
    const fotos = [1, 2, 3].map((n) => ({ ...foto(n), ancho: 1200, alto: 900 }));
    const r = await manejarIA(peticion({ accion: "montar_pieza", marca: "casa-tomas", fotos }), deps(f));
    expect(r.status).toBe(200);
    expect((await r.json()).diapositivas.map((d: { plantilla: string }) => d.plantilla)).toEqual(["ct-portada-marco", "ct-plato-marco", "ct-cierre-marco"]);
  });
});

describe("montar: piezas", () => {
  it("formato auto, plantillas con foto por formato y hora sugerida válida", () => {
    expect(formatoFinal("auto", 1)).toBe("post");
    expect(formatoFinal("auto", 6)).toBe("carrusel");
    expect(formatoFinal("story", 3)).toBe("story");
    // Solo las v2 con foto (sin clásicas ni las de sin foto).
    expect(plantillasMontar("casa-tomas", "carrusel").map((p) => p.id)).toEqual(["ct-cierre", "ct-cierre-marco", "ct-plato", "ct-plato-marco", "ct-portada", "ct-portada-marco"]);
    expect(plantillasMontar("touza", "story").map((p) => p.id)).toEqual(["tz-cierre", "tz-cierre-marco", "tz-plato", "tz-plato-marco", "tz-portada", "tz-portada-marco"]);
    expect([0, 1, 2, 3].map((i) => papelDe(i, 4, "carrusel"))).toEqual(["portada", "plato", "plato", "cierre"]);
    expect(papelDe(0, 1, "story")).toBe("portada");
    expect(horaValida("2026-11-07T13:00", AHORA)).toBe("2026-11-07T13:00");
    expect(horaValida("2026-10-01T13:00", AHORA)).toBeNull();
    expect(horaValida("mañana a las 2", AHORA)).toBeNull();
  });

  it("la copia del contrato en _shared es literal (salvo la importación del tipo de marca)", () => {
    const sinImport = (ruta: string) =>
      readFileSync(ruta, "utf8")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((l) => !l.startsWith("import type"))
        .join("\n");
    expect(sinImport("supabase/functions/_shared/instagram/montar.ts")).toBe(sinImport("src/lib/instagram/montar.ts"));
  });
});
