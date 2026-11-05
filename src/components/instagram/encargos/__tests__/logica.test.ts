/** Lógica pura de los encargos: botones por rol y estado, pendientes, rutas de entrega, huecos y formulario. */
import { describe, expect, it } from "vitest";
import {
  accionesDisponibles,
  avisoMedidas,
  datosParaGuardar,
  esperaA,
  formularioVacio,
  huecosPorDia,
  pasoDeEstado,
  pendientes,
  problemaFicheroEntrega,
  problemasFormulario,
  referencia,
  rutasEntrega,
  sumarDiasLaborables,
  textoEvento,
  textoRonda,
  type EstadoEncargo,
} from "../logica";
import { basesDeMarca, piezaImagenDesdeEncargo, reelDesdeEncargo, titularDesdeTitulo } from "../automatico";

const R = { restaurante: true, agencia: false };
const A = { restaurante: false, agencia: true };
const AMBOS = { restaurante: true, agencia: true };
const e = (estado: EstadoEncargo, modo: "oficiosos" | "automatico" = "oficiosos", pieza_id: string | null = null) => ({ estado, modo, pieza_id });

describe("accionesDisponibles", () => {
  it("el restaurante envía, aprueba, pide cambios y cancela; nunca acepta ni entrega", () => {
    expect(accionesDisponibles(e("borrador"), R)).toEqual(["editar", "enviar", "cancelar"]);
    expect(accionesDisponibles(e("para_revisar"), R)).toEqual(["aprobar", "pedir_cambios", "cancelar", "comentar"]);
    expect(accionesDisponibles(e("rechazado"), R)).toContain("enviar");
    expect(accionesDisponibles(e("aprobado", "oficiosos", "p1"), R)).toEqual(["programar", "comentar"]);
    for (const s of ["enviado", "aceptado", "en_curso", "cambios_pedidos"] as const) {
      expect(accionesDisponibles(e(s), R)).not.toContain("aceptar");
      expect(accionesDisponibles(e(s), R)).not.toContain("entregar");
    }
    expect(accionesDisponibles(e("publicado"), R)).not.toContain("cancelar");
  });

  it("la agencia acepta, rechaza, empieza y entrega; nunca aprueba ni cancela", () => {
    expect(accionesDisponibles(e("enviado"), A)).toEqual(["aceptar", "rechazar", "comentar"]);
    expect(accionesDisponibles(e("aceptado"), A)).toEqual(["empezar", "entregar", "rechazar", "comentar"]);
    expect(accionesDisponibles(e("cambios_pedidos"), A)).toEqual(["empezar", "entregar", "comentar"]);
    expect(accionesDisponibles(e("en_curso"), A)).toEqual(["entregar", "comentar"]);
    expect(accionesDisponibles(e("para_revisar"), A)).toEqual(["comentar"]);
    expect(accionesDisponibles(e("borrador"), A)).toEqual([]);
  });

  it("en los automáticos la agencia no hace nada y no hay «pedir cambios»", () => {
    expect(accionesDisponibles(e("en_curso", "automatico"), A)).toEqual([]);
    expect(accionesDisponibles(e("en_curso", "automatico"), R)).toContain("generar");
    expect(accionesDisponibles(e("en_curso", "automatico", "p1"), R)).not.toContain("generar");
    expect(accionesDisponibles(e("para_revisar", "automatico", "p1"), R)).toEqual(["aprobar", "cancelar", "comentar"]);
  });

  it("el super admin (los dos lados) ve los botones de ambos", () => {
    expect(accionesDisponibles(e("enviado"), AMBOS)).toEqual(expect.arrayContaining(["aceptar", "cancelar"]));
  });
});

describe("pendientes de la pestaña", () => {
  const lista = [e("para_revisar"), e("rechazado"), e("enviado"), e("cambios_pedidos"), e("aceptado"), e("enviado", "automatico")];
  it("cuenta lo que espera a quien mira", () => {
    expect(esperaA(e("para_revisar"))).toBe("restaurante");
    expect(esperaA(e("enviado"))).toBe("agencia");
    expect(pendientes(lista, R)).toBe(2);
    expect(pendientes(lista, A)).toBe(2);
    expect(pendientes(lista, AMBOS)).toBe(4);
    expect(pendientes(lista, { restaurante: false, agencia: false })).toBe(0);
  });
});

describe("rutas de entrega", () => {
  const ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
  it("JPEG en encargos/<encargo>/vN y MP4 en reels/AAAA-MM/<encargo> (lo que exige la RPC)", () => {
    expect(rutasEntrega({ id: ID, formato: "post" }, 2, new Date("2026-11-10T10:00:00Z"), "abcdef01")).toEqual({
      cubo: "instagram",
      ruta: `encargos/${ID}/v2-abcdef01.jpg`,
      portada: null,
    });
    expect(rutasEntrega({ id: ID, formato: "reel" }, 1, new Date("2026-11-10T10:00:00Z"), "abcdef01")).toEqual({
      cubo: "instagram-video",
      ruta: `reels/2026-11/${ID}-abcdef01.mp4`,
      portada: `reels/2026-11/${ID}-abcdef01.jpg`,
    });
    expect(rutasEntrega({ id: ID, formato: "story" }, 1).ruta).toMatch(new RegExp(`^encargos/${ID}/v1-[0-9a-f]{8}\\.jpg$`));
  });

  it("solo JPEG (≤ 8 MB) o MP4 (≤ 50 MB)", () => {
    expect(problemaFicheroEntrega({ type: "image/jpeg", size: 1000, name: "a.jpg" }, "post")).toBeNull();
    expect(problemaFicheroEntrega({ type: "image/png", size: 1000, name: "a.png" }, "post")).toMatch(/JPEG/);
    expect(problemaFicheroEntrega({ type: "image/jpeg", size: 9 * 1048576, name: "a.jpg" }, "story")).toMatch(/8 MB/);
    expect(problemaFicheroEntrega({ type: "video/mp4", size: 1000, name: "a.mp4" }, "reel")).toBeNull();
    expect(problemaFicheroEntrega({ type: "video/quicktime", size: 1000, name: "a.mov" }, "reel")).toMatch(/MP4/);
    expect(avisoMedidas("post", 1080, 1350)).toBeNull();
    expect(avisoMedidas("post", 1080, 1920)).toMatch(/4:5/);
    expect(avisoMedidas("reel", 1080, 1920)).toBeNull();
  });
});

describe("huecos del calendario", () => {
  const base = { numero: 1, marca: "casa-tomas" as const, titulo: "Setas", formato: "reel" as const };
  it("desde que se envía hasta que se aprueba; en rojo si la fecha pasó sin aprobar", () => {
    const m = huecosPorDia(
      [
        { ...base, id: "a", estado: "borrador", fecha_deseada: "2026-11-12" },
        { ...base, id: "b", estado: "enviado", fecha_deseada: "2026-11-12" },
        { ...base, id: "c", estado: "en_curso", fecha_deseada: "2026-11-01" },
        { ...base, id: "d", estado: "aprobado", fecha_deseada: "2026-11-01" },
        { ...base, id: "e", estado: "publicado", fecha_deseada: "2026-11-12" },
        { ...base, id: "f", estado: "cancelado", fecha_deseada: "2026-11-12" },
      ],
      "2026-11-05",
    );
    expect(m.get("2026-11-12")?.map((h) => h.id)).toEqual(["b"]);
    expect(m.get("2026-11-01")?.map((h) => [h.id, h.retrasado])).toEqual([["c", true], ["d", false]]);
  });
});

describe("formulario y textos", () => {
  it("días laborables iguales que en la BD", () => {
    expect(sumarDiasLaborables("2026-11-06", 1)).toBe("2026-11-09");
    expect(sumarDiasLaborables("2026-11-06", 5)).toBe("2026-11-13");
    expect(sumarDiasLaborables("2026-11-09", 5)).toBe("2026-11-16");
  });

  it("lo que falta para enviar", () => {
    const d = { ...formularioVacio(), titulo: "Reel", fecha_deseada: "2026-11-20", idea: "Idea" };
    expect(problemasFormulario(d, "2026-11-05")).toEqual([]);
    expect(problemasFormulario({ ...d, idea: "" }, "2026-11-05")).toEqual(["Cuenta la idea a Oficiosos."]);
    expect(problemasFormulario({ ...d, fecha_deseada: "2026-11-01" }, "2026-11-05")).toEqual(["La fecha deseada ya ha pasado."]);
    expect(problemasFormulario({ ...d, modo: "automatico", formato: "post", plantilla: "" }, "2026-11-05")).toEqual(["Elige la plantilla."]);
  });

  it("solo manda la plantilla en automático de imagen y la base en vídeo; miniaturas solo https", () => {
    const d = { ...formularioVacio(), modo: "oficiosos" as const, formato: "post" as const, plantilla: "ct-foto-titular", fotos: [{ id: "drive:a", miniatura: "http://x/a.jpg" }, { id: "carta:b", miniatura: "https://x/b.jpg" }] };
    const g = datosParaGuardar(d);
    expect(g).toMatchObject({ plantilla: "", base_reel: "" });
    expect(g.fotos).toEqual([{ id: "drive:a", nombre: "" }, { id: "carta:b", nombre: "", miniatura: "https://x/b.jpg" }]);
  });

  it("textos de rondas, pasos y referencia", () => {
    expect(textoRonda(1, 2)).toBe("Ronda 1 de 2 incluidas");
    expect(textoRonda(3, 2)).toMatch(/fuera de las 2 incluidas/);
    expect(pasoDeEstado("cambios_pedidos")).toBe(1);
    expect(pasoDeEstado("cancelado")).toBe(-1);
    expect(referencia(7)).toBe("ENC-0007");
    expect(textoEvento({ accion: "rechazar", comentario: "Falta material" })).toBe("Rechazado: Falta material");
  });
});

describe("encargos automáticos", () => {
  it("titular de 6 palabras como mucho y solo los campos de la plantilla", () => {
    expect(titularDesdeTitulo("  Llegan las setas de temporada a Casa Tomás ")).toBe("Llegan las setas de temporada a");
    const p = piezaImagenDesdeEncargo({ marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular", titulo: "Setas de temporada" }, [{ id: "drive:abc" }]);
    expect(p).toMatchObject({ marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", titular: "Setas de temporada", foto: "drive:abc" });
  });

  it("el reel base lleva las fotos del encargo repartidas por las escenas", () => {
    const r = reelDesdeEncargo("del-mar", "casa-tomas", [{ id: "drive:1" }, { id: "carta:2" }]);
    expect(r.base).toBe("del-mar");
    expect(r.escenas.map((x) => x.foto)).toEqual(r.escenas.map((_, i) => (i % 2 === 0 ? "drive:1" : "carta:2")));
    expect(basesDeMarca("touza").every((b) => b.marca === null || b.marca === "touza")).toBe(true);
    expect(basesDeMarca("touza").some((b) => b.id === "del-mar")).toBe(false);
  });
});
