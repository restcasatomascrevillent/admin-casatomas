/**
 * Un solo juego de estados (evaluación de diseño C5): cada estado de pieza,
 * calendario, encargo y campaña tiene etiqueta, tono e icono; el mismo tono
 * significa lo mismo en todas las pestañas; y un estado desconocido no rompe.
 */
import { describe, expect, it } from "vitest";
import {
  COLOR_TONO,
  ESTADOS_CALENDARIO,
  ESTADOS_CAMPANA,
  ESTADOS_ENCARGO,
  ESTADOS_PIEZA,
  ESTILO_TONO,
  LEYENDA_CALENDARIO,
  infoEstado,
  type InfoEstado,
} from "../estados";
import { explicarErrorPublicacion } from "../errores";

const todos: Array<[string, Record<string, InfoEstado>]> = [
  ["pieza", ESTADOS_PIEZA],
  ["calendario", ESTADOS_CALENDARIO],
  ["encargo", ESTADOS_ENCARGO],
  ["campana", ESTADOS_CAMPANA],
];

describe("estados de Instagram", () => {
  it("cada estado tiene etiqueta, icono y un tono con estilo", () => {
    for (const [, tabla] of todos) {
      for (const [clave, i] of Object.entries(tabla)) {
        expect(i.etiqueta.trim(), clave).not.toBe("");
        expect(i.icono, clave).toBeTruthy();
        expect(ESTILO_TONO[i.tono], `${clave} → ${i.tono}`).toBeDefined();
        expect(COLOR_TONO[i.tono]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("el mismo tono significa lo mismo en todas las pestañas", () => {
    // Verde: ya está en Instagram.
    expect(ESTADOS_PIEZA.publicada.tono).toBe("publicada");
    expect(ESTADOS_CALENDARIO.publicada.tono).toBe("publicada");
    expect(ESTADOS_ENCARGO.publicado.tono).toBe("publicada");
    // Oro: tiene fecha o está aprobado.
    expect(ESTADOS_CALENDARIO.programada.tono).toBe("programada");
    expect(ESTADOS_ENCARGO.aprobado.tono).toBe("programada");
    // Piedra discontinua: borrador, en todas.
    expect(ESTADOS_PIEZA.borrador.tono).toBe("borrador");
    expect(ESTADOS_CALENDARIO.borrador.tono).toBe("borrador");
    expect(ESTADOS_ENCARGO.borrador.tono).toBe("borrador");
    expect(ESTILO_TONO.borrador.insignia).toMatch(/border-dashed/);
    // Ámbar: te toca a ti.
    expect(ESTADOS_ENCARGO.para_revisar.tono).toBe("revisar");
    expect(ESTADOS_CAMPANA.propuesta.tono).toBe("revisar");
    // Azul: en manos de Oficiosos.
    expect(ESTADOS_ENCARGO.en_curso.tono).toBe("encargo");
    // Rojo: error.
    expect(ESTADOS_PIEZA.error.tono).toBe("error");
    expect(ESTADOS_CALENDARIO.error.tono).toBe("error");
  });

  it("la paleta es la de la maqueta (--e-*)", () => {
    expect(COLOR_TONO).toMatchObject({ publicada: "#117e39", programada: "#926a26", borrador: "#9b8a7d", encargo: "#1b6fc2", revisar: "#e7b008" });
    expect(LEYENDA_CALENDARIO.map((l) => l.id)).toEqual(["publicada", "programada", "borrador", "encargo", "error"]);
  });

  it("un estado desconocido sale en gris con el texto limpio", () => {
    expect(infoEstado("encargo", "en_revision_legal")).toMatchObject({ etiqueta: "En revision legal", tono: "neutro" });
    expect(infoEstado("pieza", null)).toMatchObject({ etiqueta: "Sin estado", tono: "neutro" });
    expect(infoEstado("campana", "propuesta")).toBe(ESTADOS_CAMPANA.propuesta);
  });
});

describe("explicarErrorPublicacion", () => {
  it("traduce los errores de Meta más comunes y guarda el crudo", () => {
    const token = explicarErrorPublicacion('{"error":{"message":"Error validating access token: Session has expired","type":"OAuthException","code":190}}');
    expect(token.titulo).toBe("La conexión con Instagram ha caducado.");
    expect(token.detalle).toContain("OAuthException");
    expect(explicarErrorPublicacion("(#4) Application request limit reached").titulo).toBe("Instagram ha frenado las publicaciones por hoy.");
    expect(explicarErrorPublicacion("(#9004) Media download has failed").titulo).toBe("Instagram no ha podido coger la imagen.");
    expect(explicarErrorPublicacion("Tiempo de espera agotado (timeout)").titulo).toBe("Instagram tardó demasiado en responder.");
  });

  it("sin patrón conocido, un mensaje genérico; sin texto, sin detalle", () => {
    const r = explicarErrorPublicacion("algo raro");
    expect(r.titulo).toBe("Instagram no aceptó la publicación.");
    expect(r.detalle).toBe("algo raro");
    expect(explicarErrorPublicacion(null).detalle).toBeNull();
  });
});
