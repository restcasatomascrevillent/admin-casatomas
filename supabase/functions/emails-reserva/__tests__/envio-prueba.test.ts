/**
 * Tests para supabase/functions/emails-reserva/envio-prueba.ts
 *
 * Capa pura del endpoint POST /enviar-prueba (ver contrato en
 * src/hooks/usePlantillasEmail.ts:251-294). Lo crítico:
 * - Los datos de ejemplo dan pie al bloque de contraoferta en 'propuesta' y
 *   solo ahí (integración con hayContraoferta de plantillas.ts).
 * - El borrador se valida sin reventar con formas inesperadas.
 * - El 403 de sandbox de Resend se distingue de cualquier otro error suyo.
 */
import { describe, it, expect } from "vitest";
import {
  datosEjemploParaTipo,
  validarPlantillaBorrador,
  esErrorSandboxResend,
  superaLimiteDePrueba,
} from "../envio-prueba.ts";
import { hayContraoferta, TIPOS_PLANTILLA, type TipoPlantilla } from "../plantillas.ts";

describe("datosEjemploParaTipo", () => {
  it("da datos realistas: nombre no vacío, comensales positivos, espacio presente", () => {
    for (const tipo of TIPOS_PLANTILLA) {
      const datos = datosEjemploParaTipo(tipo, "2026-01-01");
      expect(datos.nombre.trim().length).toBeGreaterThan(0);
      expect(datos.comensales).toBeGreaterThan(0);
      expect(datos.espacio).toBeTruthy();
      expect(datos.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(datos.hora).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("calcula la fecha de ejemplo a partir de hoyIso (mismo motor que fechaObjetivoRecordatorio)", () => {
    const datos = datosEjemploParaTipo("confirmada", "2026-01-01");
    expect(datos.fecha).toBe("2026-01-10"); // +9 días, en UTC, sin líos de mes/año
  });

  it("cruza el fin de año correctamente", () => {
    const datos = datosEjemploParaTipo("confirmada", "2026-12-28");
    expect(datos.fecha).toBe("2027-01-06");
  });

  it("'propuesta' trae hora/espacio solicitados distintos de los vigentes, y por tanto hayContraoferta() es true", () => {
    const datos = datosEjemploParaTipo("propuesta", "2026-01-01");
    expect(datos.horaSolicitada).toBeDefined();
    expect(datos.horaSolicitada).not.toBe(datos.hora);
    expect(hayContraoferta(datos)).toBe(true);
  });

  it("el resto de tipos NO traen horaSolicitada, y por tanto hayContraoferta() es false", () => {
    const otros: TipoPlantilla[] = TIPOS_PLANTILLA.filter((t) => t !== "propuesta") as TipoPlantilla[];
    for (const tipo of otros) {
      const datos = datosEjemploParaTipo(tipo, "2026-01-01");
      expect(datos.horaSolicitada).toBeUndefined();
      expect(hayContraoferta(datos)).toBe(false);
    }
  });
});

describe("validarPlantillaBorrador", () => {
  function borradorBase(overrides: Record<string, unknown> = {}) {
    return {
      asunto: "Confirma tu reserva, {{nombre}}",
      saludo: "Hola, {{nombre}}",
      cuerpo: "Te esperamos el {{fecha}}.",
      texto_boton_principal: "Sí, confirmo",
      texto_boton_secundario: null,
      pie: "Casa Tomás",
      color_acento: "#B8936A",
      color_oscuro: "#1C1F22",
      logo_url: null,
      bloques: { mostrar_tabla_detalles: true },
      ...overrides,
    };
  }

  it("acepta un borrador completo y lo devuelve tal cual", () => {
    const resultado = validarPlantillaBorrador(borradorBase());
    expect(resultado).not.toBeNull();
    expect(resultado?.asunto).toBe("Confirma tu reserva, {{nombre}}");
    expect(resultado?.texto_boton_secundario).toBeNull();
  });

  it.each(["asunto", "saludo", "cuerpo"])("rechaza cuando falta %s", (campo) => {
    const borrador = borradorBase({ [campo]: undefined });
    expect(validarPlantillaBorrador(borrador)).toBeNull();
  });

  it.each(["asunto", "saludo", "cuerpo"])("rechaza cuando %s es solo espacios en blanco", (campo) => {
    const borrador = borradorBase({ [campo]: "   " });
    expect(validarPlantillaBorrador(borrador)).toBeNull();
  });

  it("rechaza valores que no son objeto (null, string, array)", () => {
    expect(validarPlantillaBorrador(null)).toBeNull();
    expect(validarPlantillaBorrador(undefined)).toBeNull();
    expect(validarPlantillaBorrador("no soy un objeto")).toBeNull();
    expect(validarPlantillaBorrador(["a", "b"])).toBeNull();
  });

  it("rechaza bloques que no son objeto", () => {
    expect(validarPlantillaBorrador(borradorBase({ bloques: "no-es-objeto" }))).toBeNull();
  });

  it("rellena color_acento/color_oscuro por defecto cuando faltan (mismo default que renderPlantilla)", () => {
    const resultado = validarPlantillaBorrador(borradorBase({ color_acento: undefined, color_oscuro: "" }));
    expect(resultado?.color_acento).toBe("#B8936A");
    expect(resultado?.color_oscuro).toBe("#1C1F22");
  });

  it("acepta texto_boton_principal/secundario/pie/logo_url ausentes como null", () => {
    const resultado = validarPlantillaBorrador(
      borradorBase({ texto_boton_principal: undefined, texto_boton_secundario: undefined, pie: undefined, logo_url: undefined }),
    );
    expect(resultado?.texto_boton_principal).toBeNull();
    expect(resultado?.texto_boton_secundario).toBeNull();
    expect(resultado?.pie).toBeNull();
    expect(resultado?.logo_url).toBeNull();
  });

  it("rechaza cuando un campo de texto opcional llega con un tipo raro (number)", () => {
    expect(validarPlantillaBorrador(borradorBase({ pie: 42 }))).toBeNull();
  });
});

describe("esErrorSandboxResend", () => {
  it("reconoce el 403 documentado de Resend (sandbox, solo al dueño de la cuenta)", () => {
    expect(
      esErrorSandboxResend({
        name: "validation_error",
        statusCode: 403,
        message: "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain.",
      }),
    ).toBe(true);
  });

  it("no depende de statusCode (el SDK no siempre lo trae — resend-node#286)", () => {
    expect(
      esErrorSandboxResend({
        name: "validation_error",
        message: "You can only send testing emails to your own email address (owner@example.com).",
      }),
    ).toBe(true);
  });

  it("es insensible a mayúsculas/minúsculas en el mensaje", () => {
    expect(
      esErrorSandboxResend({
        name: "validation_error",
        message: "YOU CAN ONLY SEND TESTING EMAILS TO YOUR OWN EMAIL ADDRESS (owner@example.com).",
      }),
    ).toBe(true);
  });

  it("no confunde otro validation_error (campo obligatorio ausente) con la restricción de sandbox", () => {
    expect(
      esErrorSandboxResend({
        name: "validation_error",
        statusCode: 422,
        message: "Missing `to` field",
      }),
    ).toBe(false);
  });

  it("no confunde otro error con el mismo texto pero distinto name", () => {
    expect(
      esErrorSandboxResend({
        name: "rate_limit_exceeded",
        statusCode: 429,
        message: "own email address testing email — texto colado a propósito para el test",
      }),
    ).toBe(false);
  });

  it("devuelve false para null/undefined", () => {
    expect(esErrorSandboxResend(null)).toBe(false);
    expect(esErrorSandboxResend(undefined)).toBe(false);
  });
});

describe("superaLimiteDePrueba", () => {
  it("no supera el límite por debajo del máximo", () => {
    expect(superaLimiteDePrueba(3, 5)).toBe(false);
  });

  it("supera el límite en el máximo exacto (el intento que lo alcanza ya no pasa)", () => {
    expect(superaLimiteDePrueba(5, 5)).toBe(true);
  });

  it("supera el límite por encima del máximo", () => {
    expect(superaLimiteDePrueba(9, 5)).toBe(true);
  });
});
