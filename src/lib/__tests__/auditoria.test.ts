import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "@/hooks/useAuditLog";
import {
  camposLegibles,
  puedeRevertir,
  resumenEntrada,
  tipoEvento,
  valorLegible,
} from "../auditoria";
const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: "event",
  created_at: "2026-10-12T15:00:00Z",
  actor_user_id: "admin",
  actor_email: "admin@test.local",
  accion: "actualizar",
  tabla: "Platos",
  registro_id: "dish",
  detalles: null,
  user_agent: null,
  ...overrides,
});
describe("auditoría legible", () => {
  it("identifica y explica una modificación de precio", () => {
    const e = entry({
      detalles: {
        antes: { nombre: "Croquetas", precio_eur: 9.5 },
        despues: { nombre: "Croquetas", precio_eur: 10.5 },
      },
    });
    expect(resumenEntrada(e)).toBe("Ha modificado el plato «Croquetas»");
    expect(tipoEvento(e)).toBe("cambiar_precio");
    expect(valorLegible("precio_eur", 9.5)).toMatch(/9,50/);
    expect(valorLegible("activado", false)).toBe("No");
  });
  it("oculta identificadores y secretos del resumen", () => {
    expect(
      camposLegibles({
        id: "id",
        nombre: "Plato",
        password: "secret",
        api_key: "secret",
        updated_at: "now",
      }),
    ).toEqual([{ campo: "nombre", etiqueta: "Nombre", valor: "Plato" }]);
  });
  it("lee los mensajes históricos con los nombres reales de la tabla", () => {
    expect(
      resumenEntrada(
        entry({
          tabla: "mensajes_chat",
          accion: "crear",
          detalles: { despues: { role: "user", content: "¿Cuánto gastamos?" } },
        }),
      ),
    ).toContain("Ha preguntado a la IA de facturas: «¿Cuánto gastamos?»");
  });
  it("distingue regeneraciones y no ofrece restaurar cobros ni secretos", () => {
    expect(
      tipoEvento(
        entry({
          accion: "ejecutar",
          detalles: { tipo_evento: "regeneracion_ia", pregunta: "Gasto" },
        }),
      ),
    ).toBe("regeneracion_ia");
    expect(
      puedeRevertir(
        entry({
          detalles: { antes: { nombre: "A" }, despues: { nombre: "B" } },
        }),
      ),
    ).toBe(true);
    expect(
      puedeRevertir(
        entry({
          tabla: "cheques_regalo",
          detalles: { antes: { usado: false }, despues: { usado: true } },
        }),
      ),
    ).toBe(false);
    expect(
      puedeRevertir(
        entry({
          detalles: { antes: { secret: "[oculto]" }, despues: { nombre: "B" } },
        }),
      ),
    ).toBe(false);
  });
});
