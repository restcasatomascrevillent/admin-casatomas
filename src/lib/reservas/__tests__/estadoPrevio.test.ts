/**
 * Estado que tenía una reserva ANTES de «Ha llegado» / «No vino» (`estadoPrevio.ts`).
 *
 * Existe para que el chip «Deshacer» devuelva la reserva a donde estaba. Hasta el paso
 * 2 lo mandaba SIEMPRE a «Confirmada», aunque la reserva hubiera llegado estando
 * «Pendiente» o «Verificada» (sin pasar por la verificación ni el correo).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __vaciarEstadosPreviosParaTests,
  estadoAlDeshacer,
  estadoPrevioDe,
  olvidarEstadoPrevio,
  recordarEstadoPrevio,
} from "../estadoPrevio";
import { ESTADO_TRAS_DESHACER } from "../estadosReserva";

beforeEach(() => {
  __vaciarEstadosPreviosParaTests();
});

describe("recordar y olvidar", () => {
  it.each(["pendiente", "verificada", "confirmada"])("recuerda «%s» (desde ahí se llega a «Llegó» / «No vino»)", (estado) => {
    recordarEstadoPrevio("r1", estado);
    expect(estadoPrevioDe("r1")).toBe(estado);
  });

  it.each(["completada", "no_show", "cancelada", "rechazada", "", null, undefined])(
    "NO recuerda %j: no es un estado al que tenga sentido volver",
    (estado) => {
      recordarEstadoPrevio("r1", estado as string);
      expect(estadoPrevioDe("r1")).toBeUndefined();
    },
  );

  it("cada reserva tiene el suyo", () => {
    recordarEstadoPrevio("r1", "pendiente");
    recordarEstadoPrevio("r2", "verificada");
    expect(estadoPrevioDe("r1")).toBe("pendiente");
    expect(estadoPrevioDe("r2")).toBe("verificada");
    expect(estadoPrevioDe("r3")).toBeUndefined();
  });

  it("una reserva sin id no se guarda", () => {
    recordarEstadoPrevio("", "pendiente");
    expect(estadoPrevioDe("")).toBeUndefined();
  });

  it("recordar de nuevo sustituye al anterior", () => {
    recordarEstadoPrevio("r1", "pendiente");
    recordarEstadoPrevio("r1", "confirmada");
    expect(estadoPrevioDe("r1")).toBe("confirmada");
  });

  it("olvidar borra solo esa reserva", () => {
    recordarEstadoPrevio("r1", "pendiente");
    recordarEstadoPrevio("r2", "pendiente");
    olvidarEstadoPrevio("r1");
    expect(estadoPrevioDe("r1")).toBeUndefined();
    expect(estadoPrevioDe("r2")).toBe("pendiente");
  });

  it("olvidar lo que no estaba no falla", () => {
    expect(() => olvidarEstadoPrevio("nadie")).not.toThrow();
  });
});

describe("estadoAlDeshacer", () => {
  it("devuelve el estado que tenía antes", () => {
    recordarEstadoPrevio("r1", "verificada");
    expect(estadoAlDeshacer("r1")).toBe("verificada");
  });

  it("si no se sabe (la llegada se marcó en otra sesión, o la marcó el sistema), «Confirmada» como hasta ahora", () => {
    expect(estadoAlDeshacer("r1")).toBe(ESTADO_TRAS_DESHACER);
    expect(ESTADO_TRAS_DESHACER).toBe("confirmada");
  });
});

describe("tamaño acotado", () => {
  it("no crece sin límite: al pasar de 500 reservas se olvidan las más antiguas", () => {
    for (let i = 0; i < 600; i++) recordarEstadoPrevio(`r${i}`, "pendiente");
    expect(estadoPrevioDe("r0")).toBeUndefined();
    expect(estadoPrevioDe("r99")).toBeUndefined();
    expect(estadoPrevioDe("r599")).toBe("pendiente");
    expect(estadoPrevioDe("r100")).toBe("pendiente");
  });
});
