// @vitest-environment node
/**
 * instagram-ia VE la foto (05/11/2026). Caso real del dueño: foto de Drive de
 * una botella de Domaine de la Combe con los rótulos del ejemplo («Nuestros
 * espacios / Un entorno para cada ocasión») → la IA escribía de mesas y sillas.
 * Sin red: Supabase y OpenAI simulados; nunca se llama a OpenAI de verdad.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { manejarIA, OPENAI } from "../ia.ts";
import { buscarVinoPorEtiqueta, MODELO_VISION_POR_DEFECTO, rutaTmpDeUrl, vinoParaModelo } from "../vision.ts";
import { rotulosDeEjemplo } from "../ejemplos.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import type { AcumuladorUso, OpcionesRegistro } from "../../_shared/registrar-uso-ia.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const CLAVE = "sk-clave-de-openai-de-pruebas-0123456789";
const USUARIO = "11111111-1111-4111-8111-111111111111";
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica", OPENAI_API_KEY: CLAVE };
const TMP = `${SB}/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg`;

const GUIA = { version: 3, guia: "Cálido, familiar y honesto.", hashtags_base: ["#CasaTomás", "#Crevillent"], ctas: ["Reservar mesa", "Ver carta"] };
const COMBE = {
  id: "8ae1eafd-7999-4180-93dc-362364091af0",
  nombre: "Domaine de la Combe Côtes du Rhône 2021",
  categoria: "TINTOS · OTRAS DENOMINACIONES",
  denominacion_origen: "AOC Côtes du Rhône",
  ingredientes: "Garnacha, Syrah",
  ubicacion_region: "Valle del Ródano",
  ubicacion_pais: "Francia",
  descripcion: "Elaboración: depósito. · Cata: fruta roja. · Maridaje: carnes a la brasa.",
  imagen_url: `${SB}/storage/v1/object/public/vinos/combe-carta.webp`,
  activado: true,
  restaurante: true,
  touza: false,
};
const OTRO_VINO = { ...COMBE, id: "11111111-2222-4333-8444-555555555555", nombre: "Pazo de Señoráns Albariño", denominacion_origen: "D.O. Rías Baixas", imagen_url: null };

const DESCRIPCION_VINO = {
  tipo: "vino",
  que_se_ve: "Una botella de vino tinto de pie sobre una mesa, con fondo gris.",
  texto_legible: "Domaine de la Combe · Côtes du Rhône · Appellation Côtes du Rhône Contrôlée",
  producto: "Domaine de la Combe, Côtes du Rhône",
  ambiente: "fondo gris liso, luz suave",
  alt_text: "Botella de Domaine de la Combe, Côtes du Rhône, sobre una mesa con fondo gris.",
  rotulos_casan: false,
  motivo_rotulos: "los rótulos hablan del local y la foto es una botella de vino",
};

const resp = (estado: number, cuerpo: unknown, cab: Record<string, string> = {}) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cab } });
const respuestaOpenAI = (datos: unknown) =>
  resp(200, { choices: [{ message: { content: JSON.stringify(datos) } }], usage: { prompt_tokens: 900, completion_tokens: 200 } });

const variante = (n: number) => ({
  gancho: `Domaine de la Combe, ${n}.`,
  caption: `Domaine de la Combe, ${n}. Un Côtes du Rhône de garnacha y syrah, fruta roja y nada de prisa. Ábrelo con nuestro chuletón y verás por qué lo tenemos en la carta. Te esperamos.`,
  hashtags: ["#DomaineDeLaCombe", "#CotesDuRhone", "#VinoTinto", "#Crevillent", "#CasaTomás", "#Sobra"],
  alt_text: "Botella de Domaine de la Combe, Côtes du Rhône, sobre una mesa con fondo gris.",
  platos_citados: ["Chuletón de vaca"],
});

interface Escenario {
  vinos?: unknown[];
  vino?: unknown;
  openai?: Response[];
}

function falso(e: Escenario = {}) {
  const llamadas: Array<{ url: string; metodo: string; cuerpo: string | null }> = [];
  const cola = [...(e.openai ?? [])];
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
    if (url.startsWith(`${SB}/rest/v1/Platos?select=nombre`)) return resp(200, [{ nombre: "Chuletón de vaca" }, { nombre: "Pulpo a la gallega" }]);
    if (url.startsWith(`${SB}/rest/v1/Vinos?id=eq.`)) return resp(200, e.vino === undefined ? [COMBE] : e.vino ? [e.vino] : []);
    if (url.startsWith(`${SB}/rest/v1/Vinos?select=`)) return resp(200, e.vinos ?? [OTRO_VINO, COMBE]);
    if (url.startsWith(`${SB}/rest/v1/rpc/instagram_que_funciona`)) return resp(404, { code: "PGRST202" });
    if (url === `${OPENAI}/chat/completions`) {
      const r = cola.shift();
      if (!r) throw new Error("llamada a OpenAI no prevista");
      return r;
    }
    throw new Error(`fetch no previsto: ${metodo} ${url}`);
  });
  const openai = () => llamadas.filter((l) => l.url.startsWith(OPENAI)).map((l) => JSON.parse(l.cuerpo!));
  return { f, llamadas, openai };
}

const peticion = (cuerpo: unknown) =>
  new Request("https://x.supabase.co/functions/v1/instagram-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
  });

/** La pieza del dueño: foto de Drive de la botella, con los rótulos del ejemplo. */
const PIEZA_DRIVE = {
  accion: "sugerir_texto",
  marca: "casa-tomas",
  formato: "post",
  plantilla: "ct-foto-titular",
  foto: "drive:1AbCdEfGhIjKlMnOpQrStUv",
  fotoUrl: TMP,
  textos: { antetitulo: "Nuestros espacios", titular: "Un entorno para cada ocasión" },
};

let registros: Array<{ uso: AcumuladorUso; opciones: OpcionesRegistro }>;
const registrar = async (uso: AcumuladorUso, opciones: OpcionesRegistro) => {
  registros.push({ uso, opciones });
};

beforeEach(() => {
  olvidarSecretos();
  registros = [];
});
afterEach(() => vi.restoreAllMocks());

describe("instagram-ia ve la foto", () => {
  it("foto de Drive de un vino: describe la foto, reconoce el vino de la carta y el texto lleva descripción, vino e imagen", async () => {
    const { f, openai } = falso({
      openai: [
        respuestaOpenAI(DESCRIPCION_VINO),
        respuestaOpenAI({
          rotulos_propuestos: { antetitulo: "De la bodega", titular: "Un Ródano para el chuletón", cita: "", cta: "Ver carta", pie: "" },
          variantes: [variante(1), variante(2), variante(3)],
        }),
      ],
    });
    const r = await manejarIA(peticion(PIEZA_DRIVE), { env: ENV, fetch: f, registrar });
    expect(r.status).toBe(200);
    const j = await r.json();

    // 1. Paso de visión: modelo de extraer-vino-foto, imagen con detail high y URL reconstruida.
    const [vision, textoModelo] = openai();
    expect(vision.model).toBe(MODELO_VISION_POR_DEFECTO);
    expect(vision.response_format.json_schema.name).toBe("descripcion_foto_instagram");
    const imgVision = vision.messages[1].content.find((p: { type: string }) => p.type === "image_url");
    expect(imgVision.image_url).toEqual({ url: TMP, detail: "high" });

    // 2. Modelo de texto: la imagen (detail low) y los DATOS con la descripción y el vino de la carta.
    expect(textoModelo.model).toBe("gpt-5.6-luna");
    const partes = textoModelo.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;
    expect(partes.find((p) => p.type === "image_url")!.image_url).toEqual({ url: TMP, detail: "low" });
    const datos = partes.find((p) => p.type === "text")!.text!;
    expect(datos).toContain("Una botella de vino tinto");
    expect(datos).toContain("Domaine de la Combe Côtes du Rhône 2021");
    expect(datos).toContain("AOC Côtes du Rhône");
    expect(datos).toContain("Garnacha, Syrah");
    expect(datos).toContain('"anada": "2021"');
    // Los rótulos del ejemplo NO llegan como pista.
    expect(datos).not.toContain("Nuestros espacios");
    expect(datos).toContain('"rotulos_descartados": true');
    expect(textoModelo.messages[0].content).toMatch(/LO QUE SE VE/);
    expect(textoModelo.messages[0].content).toMatch(/150 y 350 caracteres/);
    expect(textoModelo.messages[0].content).toMatch(/de 3 a 5/);
    expect(textoModelo.messages[0].content).toMatch(/elige tu ocasión/);

    // Respuesta: vino, foto vista, rótulos de ejemplo con aviso y propuesta, 5 hashtags como mucho.
    expect(j.vino).toEqual({ id: COMBE.id, nombre: COMBE.nombre });
    expect(j.foto).toMatchObject({ tipo: "vino", altText: DESCRIPCION_VINO.alt_text });
    expect(j.rotulos.aviso).toMatch(/ejemplo/);
    expect(j.rotulos.propuestos).toEqual({ antetitulo: "De la bodega", titular: "Un Ródano para el chuletón", cta: "Ver carta" });
    expect(j.avisos.join(" ")).toMatch(/coincide con «Domaine de la Combe/);
    expect(j.variantes).toHaveLength(3);
    expect(j.variantes[0].hashtags).toHaveLength(5);
    expect(j.variantes[0].avisos.join(" ")).toMatch(/5 hashtags/);

    // Coste: el texto y la visión, cada uno en su fila.
    expect(registros.map((x) => [x.uso.modelo, x.uso.operacion])).toEqual([
      ["gpt-5.6-luna", "chat"],
      ["gpt-4.1", "vision"],
    ]);
  });

  it("rótulos que no son de ejemplo pero no casan con la foto → aviso con el motivo y rótulos propuestos", async () => {
    const { f } = falso({
      openai: [
        respuestaOpenAI(DESCRIPCION_VINO),
        respuestaOpenAI({ rotulos_propuestos: { antetitulo: "", titular: "Ródano en la mesa", cita: "", cta: "", pie: "" }, variantes: [variante(1)] }),
      ],
    });
    const r = await manejarIA(peticion({ ...PIEZA_DRIVE, textos: { titular: "Las mejores croquetas" } }), { env: ENV, fetch: f, registrar });
    const j = await r.json();
    expect(j.rotulos).toEqual({ aviso: expect.stringMatching(/no casan con la foto: los rótulos hablan del local/), propuestos: { titular: "Ródano en la mesa" } });
  });

  it("rótulos de ejemplo sin foto: aviso igual (sin paso de visión)", async () => {
    const { f, openai } = falso({ openai: [respuestaOpenAI({ rotulos_propuestos: { antetitulo: "", titular: "", cita: "", cta: "", pie: "" }, variantes: [variante(1)] })] });
    const { fotoUrl: _sin, ...sinFoto } = PIEZA_DRIVE;
    const r = await manejarIA(peticion(sinFoto), { env: ENV, fetch: f, registrar });
    const j = await r.json();
    expect(openai()).toHaveLength(1);
    expect(typeof openai()[0].messages[1].content).toBe("string");
    expect(j.rotulos).toEqual({ aviso: expect.stringMatching(/«Nuestros espacios», «Un entorno para cada ocasión»/), propuestos: null });
    expect(j.foto).toBeNull();
  });

  it("vino de la carta («vino:<id>»): datos del vino y su foto del bucket «vinos» como imagen", async () => {
    const { f, openai } = falso({
      openai: [respuestaOpenAI({ ...DESCRIPCION_VINO, rotulos_casan: true, motivo_rotulos: "" }), respuestaOpenAI({ rotulos_propuestos: {}, variantes: [variante(1)] })],
    });
    const r = await manejarIA(
      peticion({ accion: "sugerir_texto", marca: "casa-tomas", plantilla: "ct-foto-titular", foto: `vino:${COMBE.id}`, textos: { titular: "Un Ródano para el chuletón" } }),
      { env: ENV, fetch: f, registrar },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.vino).toEqual({ id: COMBE.id, nombre: COMBE.nombre });
    expect(j.rotulos).toBeNull();
    const [vision, texto] = openai();
    expect(vision.messages[1].content[1].image_url.url).toBe(COMBE.imagen_url);
    const datos = texto.messages[1].content[0].text as string;
    expect(datos).toContain("Valle del Ródano, Francia");
    expect(datos).toContain("Maridaje: carnes a la brasa");
    expect(datos).not.toContain("precio");
  });

  it("vino inactivo («vino:<id>»): no entra en el contexto y se avisa", async () => {
    const { f } = falso({ vino: { ...COMBE, activado: false }, vinos: [], openai: [respuestaOpenAI(DESCRIPCION_VINO), respuestaOpenAI({ variantes: [variante(1)] })] });
    const r = await manejarIA(peticion({ ...PIEZA_DRIVE, fotoUrl: undefined, foto: `vino:${COMBE.id}`, textos: {} }), { env: ENV, fetch: f, registrar });
    const j = await r.json();
    expect(j.vino).toBeNull();
    expect(j.avisos.join(" ")).toMatch(/no está activo en la carta de vinos/);
  });

  it("URL de imagen ajena → 400 sin llamar a OpenAI", async () => {
    for (const fotoUrl of [
      "https://evil.example.com/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg",
      "https://haqmmdfdzzatdnrrcgez.supabase.co/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg",
      `${SB}/storage/v1/object/public/instagram/fotos/casa-tomas/salon-1.jpg`,
      `${SB}/storage/v1/object/public/platos/a.jpg`,
      `${SB}/storage/v1/object/public/instagram/tmp/../secreto.jpg`,
      `https://user:pw@sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg`,
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
    ]) {
      const { f, openai } = falso();
      const r = await manejarIA(peticion({ ...PIEZA_DRIVE, fotoUrl }), { env: ENV, fetch: f, registrar });
      expect(r.status, fotoUrl).toBe(400);
      expect((await r.json()).error).toMatch(/fotoUrl/);
      expect(openai()).toHaveLength(0);
    }
    expect(rutaTmpDeUrl(TMP, SB)).toBe("tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg");
  });

  it("si la visión falla, sigue con la imagen y avisa", async () => {
    const { f } = falso({ openai: [resp(500, { error: { message: "boom" } }), respuestaOpenAI({ variantes: [variante(1)] })] });
    const r = await manejarIA(peticion({ ...PIEZA_DRIVE, textos: {} }), { env: ENV, fetch: f, registrar });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.avisos.join(" ")).toMatch(/No se ha podido describir la foto/);
    expect(j.vino).toBeNull();
  });
});

describe("piezas de la visión", () => {
  it("buscarVinoPorEtiqueta: casa por las palabras que identifican el vino, sin añada ni artículos; empate o nada → null", () => {
    const vinos = [OTRO_VINO, COMBE, { ...COMBE, id: "x", nombre: "Ramón Bilbao Crianza" }];
    expect(buscarVinoPorEtiqueta("DOMAINE DE LA COMBE · Côtes du Rhône 2022", vinos)?.id).toBe(COMBE.id);
    expect(buscarVinoPorEtiqueta("Ramón Bilbao · Rioja", vinos)?.id).toBe("x");
    expect(buscarVinoPorEtiqueta("Château Margaux", vinos)).toBeNull();
    expect(buscarVinoPorEtiqueta("", vinos)).toBeNull();
    expect(buscarVinoPorEtiqueta("Combe", [{ nombre: "Combe" }, { nombre: "La Combe" }])).toBeNull();
  });

  it("vinoParaModelo: añada del nombre, región y sin precio", () => {
    expect(vinoParaModelo(COMBE)).toEqual({
      nombre: COMBE.nombre,
      tipo: COMBE.categoria,
      denominacion_origen: "AOC Côtes du Rhône",
      uva: "Garnacha, Syrah",
      region: "Valle del Ródano, Francia",
      anada: "2021",
      descripcion: COMBE.descripcion,
    });
  });

  it("rotulosDeEjemplo: detecta los del ejemplo sin mayúsculas ni tildes", () => {
    expect(rotulosDeEjemplo("casa-tomas", { antetitulo: "NUESTROS ESPACIOS", titular: "Un entorno para cada ocasion" })).toEqual(["antetitulo", "titular"]);
    expect(rotulosDeEjemplo("casa-tomas", { titular: "Un Ródano para el chuletón" })).toEqual([]);
    expect(rotulosDeEjemplo("touza", { titular: "Te esperamos en Touza" })).toEqual(["titular"]);
  });
});
