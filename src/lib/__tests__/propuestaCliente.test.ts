import { describe, it, expect } from "vitest";
import {
  esErrorEsquemaPendiente,
  estadoPropuestaVista,
  mensajeErrorPropuesta,
  motivoNoEnviar,
  tieneColumnasPropuesta,
} from "@/lib/reservas/propuestaCliente";
import {
  formatearTelefonoReserva,
  normalizarTelefono,
  telefonoValido,
  variantesTelefono,
} from "@/lib/reservas/telefono";
import { actualizacionPropuesta, puedePersistirSala } from "@/lib/reservas/solicitudPropuesta";

const HOY = "2026-09-23";

const sol = (o: Record<string, unknown> = {}) => ({
  estado: "pendiente",
  email: "ana@example.com",
  fecha_solicitada: "2026-10-06",
  hora_solicitada: "14:00",
  numero_comensales: 12,
  notas_internas: null as string | null,
  espacio_propuesto_id: null as string | null,
  propuesta_estado: "borrador",
  propuesta_enviada_at: null as string | null,
  ...o,
});

describe("estado de la propuesta", () => {
  it("sin migración (la fila no trae propuesta_estado) -> null", () => {
    const { propuesta_estado: _x, ...sinCol } = sol();
    expect(tieneColumnasPropuesta(sinCol)).toBe(false);
    expect(estadoPropuestaVista(sinCol, HOY)).toBeNull();
  });

  it("borrador, enviada con fecha/hora, aceptada, rechazada", () => {
    expect(estadoPropuestaVista(sol(), HOY)?.etiqueta).toBe("Borrador");
    const enviada = estadoPropuestaVista(sol({ propuesta_estado: "enviada", propuesta_enviada_at: "2026-09-23T19:05:00" }), HOY);
    expect(enviada?.clave).toBe("enviada");
    expect(enviada?.etiqueta).toBe("Propuesta enviada 23/09 19:05");
    expect(estadoPropuestaVista(sol({ propuesta_estado: "aceptada", propuesta_respuesta_via: "telefono" }), HOY)?.detalle).toContain(
      "por teléfono",
    );
    expect(estadoPropuestaVista(sol({ propuesta_estado: "rechazada" }), HOY)?.tono).toBe("peligro");
  });

  it("enviada con el día ya pasado se muestra caducada", () => {
    expect(estadoPropuestaVista(sol({ propuesta_estado: "enviada", fecha_solicitada: "2026-09-20" }), HOY)?.clave).toBe("caducada");
  });
});

describe("motivoNoEnviar", () => {
  it("null si todo está bien", () => {
    expect(motivoNoEnviar(sol(), HOY)).toBeNull();
  });
  it("detecta cada bloqueo", () => {
    const { propuesta_estado: _x, ...sinCol } = sol();
    expect(motivoNoEnviar(sinCol, HOY)).toBe("sin_migracion");
    expect(motivoNoEnviar(sol({ email: "" }), HOY)).toBe("sin_email");
    expect(motivoNoEnviar(sol({ hora_solicitada: null }), HOY)).toBe("incompleta");
    expect(motivoNoEnviar(sol({ fecha_solicitada: "2026-09-01" }), HOY)).toBe("fecha_pasada");
    expect(motivoNoEnviar(sol({ estado: "descartada" }), HOY)).toBe("cerrada");
    expect(motivoNoEnviar(sol({ propuesta_estado: "aceptada" }), HOY)).toBe("aceptada");
  });
});

describe("errores", () => {
  it("mensajes legibles", () => {
    expect(mensajeErrorPropuesta("sin_aforo")).toMatch(/aforo/);
    expect(mensajeErrorPropuesta("datos_invalidos", "check x")).toContain("check x");
  });
  it("reconoce columna/función inexistente", () => {
    expect(esErrorEsquemaPendiente({ code: "PGRST204", message: "Could not find the 'solicitud_id' column" })).toBe(true);
    expect(esErrorEsquemaPendiente({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(esErrorEsquemaPendiente({ code: "42703", message: 'column "x" does not exist' })).toBe(true);
    expect(esErrorEsquemaPendiente({ code: "23514", message: "Aforo superado" })).toBe(false);
    expect(esErrorEsquemaPendiente(null)).toBe(false);
  });
});

describe("teléfonos (misma regla que normalizePhone del bot)", () => {
  it("normaliza +34 / 0034 / espacios", () => {
    expect(normalizarTelefono("+34 612 34 56 78")).toBe("612345678");
    expect(normalizarTelefono("0034612345678")).toBe("612345678");
    expect(normalizarTelefono("34612345678")).toBe("612345678");
    expect(normalizarTelefono("612-345-678")).toBe("612345678");
    expect(normalizarTelefono(null)).toBe("");
  });
  it("formatea como el bot al guardar", () => {
    expect(formatearTelefonoReserva("612 345 678")).toBe("+34612345678");
    expect(formatearTelefonoReserva("0034612345678")).toBe("+34612345678");
    expect(formatearTelefonoReserva("+44 7700 900123")).toBe("+447700900123");
    expect(formatearTelefonoReserva("  ")).toBeNull();
  });
  it("variantes para buscar incluyen las formas habituales", () => {
    const v = variantesTelefono("612345678");
    expect(v).toEqual(expect.arrayContaining(["612345678", "+34612345678", "0034612345678", "34612345678"]));
    expect(variantesTelefono("")).toEqual([]);
  });
  it("valida mínimo 9 cifras", () => {
    expect(telefonoValido("612345678")).toBe(true);
    expect(telefonoValido("12345")).toBe(false);
    expect(telefonoValido("abc")).toBe(false);
  });
});

describe("actualizacionPropuesta con sala", () => {
  it("puedePersistirSala depende de que la fila traiga la columna", () => {
    expect(puedePersistirSala(sol())).toBe(true);
    const { espacio_propuesto_id: _x, ...sinSala } = sol();
    expect(puedePersistirSala(sinSala)).toBe(false);
  });

  it("solo cambia la sala -> guarda la sala sin anotar petición original", () => {
    const upd = actualizacionPropuesta(
      sol(),
      { fecha: "2026-10-06", hora: "14:00", comensales: 12, espacioId: "esp-1" },
      { persistirSala: true },
    );
    expect(upd).not.toBeNull();
    expect(upd!.espacio_propuesto_id).toBe("esp-1");
    expect(upd!.notas_internas).toBe("");
  });

  it("sin persistirSala la sala no cuenta como cambio", () => {
    expect(
      actualizacionPropuesta(sol(), { fecha: "2026-10-06", hora: "14:00", comensales: 12, espacioId: "esp-1" }),
    ).toBeNull();
  });

  it("si ya estaba enviada, cualquier cambio la devuelve a borrador", () => {
    const upd = actualizacionPropuesta(
      sol({ propuesta_estado: "enviada" }),
      { fecha: "2026-10-06", hora: "15:00", comensales: 12, espacioId: null },
      { persistirSala: true },
    );
    expect(upd!.propuesta_estado).toBe("borrador");
    expect(upd!.hora_solicitada).toBe("15:00");
    expect("espacio_propuesto_id" in upd!).toBe(false);
  });
});
