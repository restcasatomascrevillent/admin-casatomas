/**
 * Lógica pura de Crear: estado (fotos, orden, montaje, texto, bloqueos),
 * normalización de «Montar con IA» y prepararYPublicar con la API simulada.
 */
import { describe, expect, it } from "vitest";
import {
  AJUSTE_SIN_FOTO,
  ajusteDe,
  alternarFoto,
  aplicarMontaje,
  captionFinal,
  estadoDesdePieza,
  estadoInicial,
  formatoEfectivo,
  motivoNoPublicar,
  moverFoto,
  normalizarHashtags,
  piezaDeImagen,
  quitarFoto,
} from "../estado";
import { crearMontadorSimulado, montarPieza, normalizarRespuestaMontar } from "../montar";
import { comprobarPeticion, continuarPublicacion, crearApiSimulada, prepararYPublicar, type PeticionPublicacion, type Progreso } from "../publicar";
import { URL_IA } from "@/components/instagram/ia/api";

const A = "drive:1FotoA000000000000001";
const B = "drive:1FotoB000000000000002";
const C = "carta:3c8a5a7e-1f2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("estado de Crear", () => {
  it("elige hasta 10 fotos en orden, las quita y las reordena", () => {
    let e = estadoInicial();
    e = alternarFoto(alternarFoto(alternarFoto(e, A), B), C);
    expect(e.fotos).toEqual([A, B, C]);
    expect(formatoEfectivo(e)).toBe("carrusel");
    e = moverFoto(e, 2, 0);
    expect(e.fotos).toEqual([C, A, B]);
    e = alternarFoto(e, A);
    expect(e.fotos).toEqual([C, B]);
    e = quitarFoto(quitarFoto(e, C), B);
    expect(e.fotos).toEqual([]);
    let lleno = estadoInicial();
    for (let i = 0; i < 12; i++) lleno = alternarFoto(lleno, `drive:1Foto${String(i).padStart(17, "0")}`);
    expect(lleno.fotos).toHaveLength(10);
  });

  it("una foto: post por defecto; la pieza solo lleva los campos de la plantilla", () => {
    const e = alternarFoto(estadoInicial(), A);
    expect(formatoEfectivo(e)).toBe("post");
    const pieza = piezaDeImagen({ ...e, ajustes: { [A]: { plantilla: "ct-foto-titular", datos: { titular: "Hola", numeral: "01" }, altText: "" } } }, A);
    expect(pieza).toEqual({ marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: A, titular: "Hola" });
  });

  it("aplica el montaje de la IA: orden, plantilla válida, rótulos, hashtags y aviso de fotos sin usar", () => {
    const e = alternarFoto(alternarFoto(alternarFoto(estadoInicial(), A), B), C);
    const r = aplicarMontaje(e, {
      ok: true,
      formato: "carrusel",
      diapositivas: [
        { foto: B, plantilla: "tz-foto-titular", datos: { titular: "Portada", cosa: 1 }, altText: "Una mesa" },
        { foto: A, plantilla: "ct-foto-titular", datos: { titular: "Segunda", antetitulo: "Hoy" }, altText: "Un plato" },
      ],
      caption: "Texto",
      hashtags: ["Marisco", "#marisco", "#Crevillent"],
      horaSugerida: "2026-11-12T13:00:00+01:00",
      resumen: "He entendido: marisco",
      avisos: [],
    });
    expect(r.fotos).toEqual([B, A, C]);
    // Plantilla de Touza en Casa Tomás → la de por defecto («Solo foto», o la portada a sangre con «Con rótulos»).
    expect(ajusteDe(r, B)).toEqual({ plantilla: "ct-solo-foto", datos: { titular: "Portada" }, altText: "Una mesa" });
    expect(ajusteDe(aplicarMontaje({ ...e, estilo: "rotulos" }, { ...r, ok: true, formato: "carrusel", diapositivas: [{ foto: B, plantilla: "tz-foto-titular", datos: {}, altText: "" }] }), B).plantilla).toBe("ct-portada");
    expect(ajusteDe(r, A).datos).toEqual({ antetitulo: "Hoy", titular: "Segunda" });
    expect(r.hashtags).toEqual(["#Marisco", "#Crevillent"]);
    expect(r.avisos.join(" ")).toMatch(/no ha usado una foto/);
    expect(r.montado).toBe(true);
    expect(captionFinal(r, "carrusel")).toBe("Texto\n\n#Marisco #Crevillent");
    expect(captionFinal(r, "story")).toBe("");
  });

  it("explica por qué no se puede publicar", () => {
    const base = { fotos: 0, montado: false, problemasPorImagen: [], problemasTexto: [], preparando: false, ocupado: false };
    expect(motivoNoPublicar(base)).toMatch(/al menos una foto/);
    expect(motivoNoPublicar({ ...base, fotos: 2 })).toMatch(/Montar con IA/);
    expect(motivoNoPublicar({ ...base, fotos: 2, montado: true, problemasPorImagen: [[], ["Falta el titular"]] })).toBe("Revisa la imagen 2: Falta el titular");
    expect(motivoNoPublicar({ ...base, fotos: 1, montado: true, problemasPorImagen: [[]] })).toBeNull();
  });

  it("abre un borrador: separa los hashtags y, sin foto, sus rótulos esperan a la primera", () => {
    const e = estadoDesdePieza({ id: "p1", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", datos: { titular: "Arroz" }, caption: "Ven a probarlo\n\n#arroz #casatomas", alt_text: "Paella" });
    expect(e.fotos).toEqual([]);
    expect(e.caption).toBe("Ven a probarlo");
    expect(e.hashtags).toEqual(["#arroz", "#casatomas"]);
    expect(e.ajustes[AJUSTE_SIN_FOTO]).toBeDefined();
    const con = alternarFoto(e, A);
    expect(ajusteDe(con, A)).toEqual({ plantilla: "ct-foto-titular", datos: { titular: "Arroz" }, altText: "Paella" });
    expect(con.montado).toBe(true);
    expect(con.piezaId).toBe("p1");
  });

  it("normaliza hashtags", () => {
    expect(normalizarHashtags(["#a", "A", "  b c ", "", "##d"])).toEqual(["#a", "#bc", "#d"]);
  });
});

describe("Montar con IA (cliente)", () => {
  it("normaliza: descarta fotos que no se mandaron y repetidas, y no inventa campos", () => {
    const r = normalizarRespuestaMontar(
      {
        ok: true,
        formato: "story",
        diapositivas: [{ foto: A, plantilla: "x", datos: { titular: "T" }, altText: "alt" }, { foto: "drive:otra" }, { foto: A }, { foto: B, datos: [] }],
        caption: 3,
        hashtags: ["#a", 4],
        horaSugerida: "no es fecha",
      },
      [A, B],
    );
    expect(r.diapositivas.map((d) => d.foto)).toEqual([A, B]);
    expect(r.diapositivas[1].datos).toEqual({});
    expect(r.formato).toBe("carrusel");
    expect(r.caption).toBe("");
    expect(r.hashtags).toEqual(["#a"]);
    expect(r.horaSugerida).toBeNull();
  });

  it("montarPieza llama a instagram-ia con la acción montar_pieza y el JWT", async () => {
    let cuerpo: Record<string, unknown> = {};
    let cabeceras: Record<string, string> = {};
    const f = (async (url: string, init: RequestInit) => {
      expect(url).toBe(URL_IA);
      cuerpo = JSON.parse(String(init.body));
      cabeceras = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({ ok: true, formato: "post", diapositivas: [{ foto: A, plantilla: "ct-foto-titular", datos: {}, altText: "" }], caption: "c", hashtags: [], resumen: "r", avisos: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const r = await montarPieza({ marca: "casa-tomas", fotos: [{ id: A, url: "https://x/tmp/a.jpg" }], indicacion: "  para el finde  ", tono: "cercano" }, { fetch: f, token: "jwt" });
    expect(cuerpo).toMatchObject({ accion: "montar_pieza", marca: "casa-tomas", formato: "auto", indicacion: "para el finde", tono: "cercano" });
    expect(cabeceras.Authorization).toBe("Bearer jwt");
    expect(r.diapositivas).toHaveLength(1);
  });

  it("montarPieza: { ok: false } se convierte en un error legible", async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, error: "Sin cupo hoy", tipo: "cupo" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(montarPieza({ marca: "casa-tomas", fotos: [{ id: A, url: "u" }] }, { fetch: f, token: "jwt" })).rejects.toMatchObject({ message: "Sin cupo hoy", tipo: "cupo" });
  });

  it("el montador simulado registra la petición y monta un carrusel", async () => {
    const m = crearMontadorSimulado({ horaSugerida: null });
    const r = await m({ marca: "touza", fotos: [{ id: A, url: "a" }, { id: B, url: "b" }], estilo: "rotulos" });
    expect(m.peticiones).toHaveLength(1);
    expect(r.formato).toBe("carrusel");
    // Como el servidor: con «Con rótulos», portada y cierre.
    expect(r.diapositivas.map((d) => d.plantilla)).toEqual(["tz-portada", "tz-cierre"]);
    // Por defecto («Solo foto»): todas sin texto.
    const sola = await m({ marca: "touza", fotos: [{ id: A, url: "a" }, { id: B, url: "b" }] });
    expect(sola.diapositivas.map((d) => [d.plantilla, d.datos])).toEqual([
      ["tz-solo-foto", {}],
      ["tz-solo-foto", {}],
    ]);
    expect(r.horaSugerida).toBeNull();
  });
});

describe("prepararYPublicar", () => {
  const peticion = (n: number, extra: Partial<PeticionPublicacion> = {}): PeticionPublicacion => ({
    marca: "casa-tomas",
    formato: n > 1 ? "carrusel" : "post",
    diapositivas: Array.from({ length: n }, (_, i) => ({ pieza: { i }, fotoPreparada: null, altText: ` alt ${i} ` })),
    caption: "Texto",
    fotosTmp: Array.from({ length: n }, (_, i) => `tmp/${i}.jpg`),
    programarPara: null,
    ...extra,
  });

  it("genera las imágenes de una en una, avisa del progreso y publica el carrusel", async () => {
    const { api, llamadas } = crearApiSimulada();
    const progreso: Progreso[] = [];
    const r = await prepararYPublicar(peticion(3), { api, onProgreso: (p) => progreso.push(p) });
    expect(progreso).toEqual([
      { fase: "imagenes", hechas: 0, total: 3 },
      { fase: "imagenes", hechas: 1, total: 3 },
      { fase: "imagenes", hechas: 2, total: 3 },
      { fase: "imagenes", hechas: 3, total: 3 },
      { fase: "publicando" },
    ]);
    expect(llamadas.publicarAhora[0]).toMatchObject({ formato: "carrusel", piezaIds: ["pieza-1", "pieza-2", "pieza-3"], altTexts: ["alt 0", "alt 1", "alt 2"], fotosTmp: ["tmp/0.jpg", "tmp/1.jpg", "tmp/2.jpg"] });
    expect(r).toMatchObject({ estado: "publicada", permalink: "https://www.instagram.com/p/simulada/" });
  });

  it("programa con la hora pedida sin publicar", async () => {
    const { api, llamadas } = crearApiSimulada();
    const instante = new Date("2026-11-12T12:00:00Z");
    const r = await prepararYPublicar(peticion(1, { programarPara: instante }), { api });
    expect(llamadas.publicarAhora).toHaveLength(0);
    expect(llamadas.programar[0].instante).toBe(instante);
    expect(r).toMatchObject({ estado: "programada", programadaPara: instante.toISOString() });
  });

  it("«en_proceso» y conflicto se continúan sin volver a generar", async () => {
    const { api, llamadas } = crearApiSimulada({ primeroEnProceso: true, primeroConflicto: true });
    const p = peticion(2);
    const r1 = await prepararYPublicar(p, { api });
    expect(r1.estado).toBe("en_proceso");
    const r2 = await continuarPublicacion(p, r1.piezaIds, { api, contenedorId: r1.contenedorId });
    expect(r2.estado).toBe("publicada");
    expect(llamadas.publicarAhora[1].contenedorId).toBe("C-1");
    expect(llamadas.renderizar).toHaveLength(2);

    const prog = { ...p, programarPara: new Date(Date.now() + 86_400_000) };
    const c1 = await prepararYPublicar(prog, { api });
    expect(c1.estado).toBe("conflicto");
    const c2 = await continuarPublicacion(prog, c1.piezaIds, { api, confirmarConflicto: true });
    expect(c2.estado).toBe("programada");
  });

  it("un fallo del render corta antes de publicar; las stories van sin texto alternativo", async () => {
    const { api, llamadas } = crearApiSimulada({ fallaEn: "render" });
    await expect(prepararYPublicar(peticion(2), { api })).rejects.toThrow(/generar la imagen/);
    expect(llamadas.publicarAhora).toHaveLength(0);

    const ok = crearApiSimulada();
    await prepararYPublicar({ ...peticion(1), formato: "story", caption: "" }, { api: ok.api });
    expect(ok.llamadas.publicarAhora[0].altTexts).toEqual([""]);
  });

  it("rechaza peticiones imposibles antes de gastar nada", () => {
    expect(() => comprobarPeticion(peticion(0))).toThrow(/al menos una foto/);
    expect(() => comprobarPeticion({ ...peticion(2), formato: "post" })).toThrow(/carrusel/);
    expect(() => comprobarPeticion(peticion(11))).toThrow(/como mucho 10/);
  });
});
