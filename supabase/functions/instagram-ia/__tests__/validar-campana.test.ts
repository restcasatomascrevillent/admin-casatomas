// @vitest-environment node
/**
 * Validadores de campañas e ideas (_shared/instagram/validar-campana.ts),
 * lógica pura: plato solo por id, fechas fuera de rango, plantilla y formato,
 * foto de la biblioteca o «falta foto», emoji, TOUZA sin «reservar», alérgenos
 * y precios con los mismos validadores que los textos, fases recortadas.
 */
import { describe, expect, it } from "vitest";
import { esFecha, lunesDe, revisarCampana, revisarIdea, revisarPiezaCampana, type ContextoCampana } from "../../_shared/instagram/validar-campana.ts";
import { PLANTILLAS_IA, plantillasCampana } from "../plantillas.ts";

const CTX: ContextoCampana = {
  marca: "casa-tomas",
  desde: "2026-11-09",
  hasta: "2026-11-29",
  carta: [
    { id: "pulpo", nombre: "Pulpo a la gallega", tiene_foto: true },
    { id: "croquetas", nombre: "Croquetas de jamón", tiene_foto: false },
  ],
  ctas: ["Reservar mesa"],
  fotos: ["drive:FotoDelPulpo0001"],
  plantillas: plantillasCampana("casa-tomas"),
  maxPiezas: 4,
  minPiezas: 2,
};

const pieza = (extra: Record<string, unknown> = {}) => ({
  fecha: "2026-11-10",
  hora: "13:00",
  formato: "post",
  plantilla: "ct-portada",
  plato_id: "pulpo",
  foto_sugerida: "carta:pulpo",
  antetitulo: "",
  titular: "El pulpo de casa",
  gancho: "Hoy, pulpo.",
  caption: "Hoy, pulpo. Pulpo a la gallega como en casa.",
  hashtags: ["#CasaTomás", "#Pulpo"],
  alt_text: "Pulpo en un plato de madera.",
  por_que: "Es el plato destacado.",
  fase: 0,
  encargo_sugerido: "",
  ...extra,
});

describe("validar-campana", () => {
  it("fechas", () => {
    expect(esFecha("2026-11-31")).toBe(false);
    expect(esFecha("2026-11-30")).toBe(true);
    expect(lunesDe("2026-11-15")).toBe("2026-11-09");
  });

  it("una pieza buena pasa; foto de la carta solo si el plato tiene foto", () => {
    const r = revisarPiezaCampana(pieza(), CTX);
    expect(r.errores).toEqual([]);
    expect(r.valor).toMatchObject({ platoId: "pulpo", foto: "carta:pulpo", faltaFoto: false });
    const sinFoto = revisarPiezaCampana(pieza({ plato_id: "croquetas", foto_sugerida: "carta:croquetas", caption: "Croquetas de jamón.", titular: "Croquetas" }), CTX);
    expect(sinFoto.valor).toMatchObject({ foto: null, faltaFoto: true });
    expect(sinFoto.ok).toBe(true);
  });

  it("foto de la carta con plantilla a sangre → se corrige a la enmarcada del mismo papel (ct-portada-marco) y se avisa; la de Drive no", () => {
    const r = revisarPiezaCampana(pieza(), CTX);
    expect(r.valor.plantilla).toBe("ct-portada-marco");
    expect(r.correcciones.join(" ")).toMatch(/foto de la carta no cubre la plantilla «ct-portada».*«ct-portada-marco» \(Foto enmarcada\)/);
    const story = revisarPiezaCampana(pieza({ formato: "story" }), CTX);
    expect(story.valor.plantilla).toBe("ct-portada-marco");
    const drive = revisarPiezaCampana(pieza({ foto_sugerida: "drive:FotoDelPulpo0001" }), CTX);
    expect(drive.valor.plantilla).toBe("ct-portada");
    const yaMarco = revisarPiezaCampana(pieza({ plantilla: "ct-portada-marco" }), CTX);
    expect(yaMarco.valor.plantilla).toBe("ct-portada-marco");
    expect(yaMarco.correcciones.join(" ")).not.toMatch(/no cubre/);
  });

  it("descarta plato inexistente, fecha fuera, plantilla de otra marca y formato que la plantilla no admite", () => {
    expect(revisarPiezaCampana(pieza({ plato_id: "langosta" }), CTX).errores.join(" ")).toMatch(/no está en la carta activa/);
    expect(revisarPiezaCampana(pieza({ fecha: "2026-11-30" }), CTX).errores.join(" ")).toMatch(/fuera de la campaña/);
    expect(revisarPiezaCampana(pieza({ plantilla: "tz-portada" }), CTX).errores.join(" ")).toMatch(/no es de la marca/);
    // ct-tipografica (clásica, solo post) ya no se ofrece a las campañas; con ella en la lista, el formato manda.
    const conClasicas = { ...CTX, plantillas: PLANTILLAS_IA.filter((p) => p.marca === "casa-tomas") };
    expect(revisarPiezaCampana(pieza({ plantilla: "ct-tipografica", formato: "story" }), conClasicas).errores.join(" ")).toMatch(/no admite el formato story/);
    expect(revisarPiezaCampana(pieza({ titular: "Un titular de muchas más de seis palabras" }), CTX).ok).toBe(false);
  });

  it("mismos validadores que los textos: precio, «sin gluten» y datos personales bloquean; emoji se quita", () => {
    expect(revisarPiezaCampana(pieza({ caption: "Hoy, pulpo a la gallega por 12 €." }), CTX).errores.join(" ")).toMatch(/Precio/);
    expect(revisarPiezaCampana(pieza({ por_que: "Es sin gluten." }), CTX).errores.join(" ")).toMatch(/gluten/);
    expect(revisarPiezaCampana(pieza({ encargo_sugerido: "Llamar al 612345678" }), CTX).errores.join(" ")).toMatch(/teléfono/);
    const e = revisarPiezaCampana(pieza({ caption: "Hoy, pulpo 🐙 a la gallega." }), CTX);
    expect(e.ok).toBe(true);
    expect(e.valor.caption).not.toMatch(/🐙/);
  });

  it("TOUZA: «reservar» en cualquier texto tumba la campaña", () => {
    const ctx = { ...CTX, marca: "touza" as const, plantillas: plantillasCampana("touza"), carta: [{ id: "vermu", nombre: "Vermú de la casa" }] };
    const p = pieza({ plantilla: "tz-portada", plato_id: "vermu", foto_sugerida: "", titular: "La barra", gancho: "Esta noche.", caption: "Esta noche. Vermú de la casa en la barra.", hashtags: ["#TOUZA"], por_que: "Jueves.", alt_text: "Copa." });
    const r = revisarCampana({ titulo: "Jueves", mensaje: "Reserva tu sitio", fases: [], piezas: [p, p] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.descartadas[0]).toMatchObject({ donde: "Campaña" });
    expect(r.errores.join(" ")).toMatch(/TOUZA no admite reservas/);
    expect(revisarCampana({ titulo: "Jueves", mensaje: "La noche empieza aquí", fases: [], piezas: [p, p] }, ctx).ok).toBe(true);
  });

  it("campaña: fases recortadas, piezas ordenadas, tope de piezas y mínimo", () => {
    const r = revisarCampana(
      {
        titulo: "Otoño ✨",
        fases: [{ nombre: "Uno", desde: "2026-11-01", hasta: "2026-12-31" }],
        piezas: [pieza({ fecha: "2026-11-20" }), pieza({ fecha: "2026-11-12" }), pieza({ fecha: "2026-11-14" }), pieza({ fecha: "2026-11-16" }), pieza({ fecha: "2026-11-18" })],
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.valor.titulo).toBe("Otoño");
    expect(r.valor.fases).toEqual([{ nombre: "Uno", desde: "2026-11-09", hasta: "2026-11-29" }]);
    expect(r.valor.piezas.map((p) => p.fecha)).toEqual(["2026-11-12", "2026-11-14", "2026-11-16", "2026-11-18"]);
    expect(r.correcciones.join(" ")).toMatch(/emoji/);
    const pocas = revisarCampana({ titulo: "x", piezas: [pieza(), pieza({ plato_id: "nada" })] }, CTX);
    expect(pocas.ok).toBe(false);
    expect(pocas.errores.join(" ")).toMatch(/hacen falta 2/);
  });

  it("ideas: dentro de la semana y con plato de la carta", () => {
    const ctx = { ...CTX, desde: "2026-11-09", hasta: "2026-11-15" };
    const idea = { fecha: "2026-11-11", titulo: "San Martín", idea: "Pulpo a la gallega para el día.", motivo: "fecha_senalada", formato: "post", plantilla: "ct-portada", plato_id: "pulpo", gancho: "" };
    expect(revisarIdea(idea, ctx).ok).toBe(true);
    expect(revisarIdea({ ...idea, fecha: "2026-11-20" }, ctx).ok).toBe(false);
    expect(revisarIdea({ ...idea, plato_id: "langosta" }, ctx).ok).toBe(false);
    expect(revisarIdea({ ...idea, motivo: "otro" }, ctx).valor.motivo).toBe("plato");
  });
});
