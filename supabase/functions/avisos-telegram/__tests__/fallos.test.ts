import { describe, expect, it } from "vitest";
import { type Fallo, mensajeFallo } from "../fallos";

const base = { id: 1, usuario: "ana@casa.es", created_at: "2026-11-12T10:30:00Z" };

describe("mensajeFallo", () => {
  it("albarán: proveedor, fecha, avisos e id", () => {
    const f: Fallo = { ...base, tipo: "albaran_aviso", datos: { factura_id: 77, avisos: [{ codigo: "descuadre_cabecera", mensaje: "Los totales no cuadran" }] } };
    const t = mensajeFallo(f, { albaran: { id: 77, proveedor: "Frutas Pepe", fecha: "2026-11-10" } });
    expect(t).toContain("Proveedor: Frutas Pepe");
    expect(t).toContain("Fecha: 2026-11-10");
    expect(t).toContain("Albarán id: 77");
    expect(t).toContain("Los totales no cuadran");
  });
  it("albarán sin contexto usa el id del fallo", () => {
    const t = mensajeFallo({ ...base, tipo: "albaran_aviso", datos: { factura_id: 5, avisos: [] } });
    expect(t).toContain("Albarán id: 5");
    expect(t).toContain("(desconocido)");
  });
  it("pulgar abajo: pregunta, respuesta, usuario y hora", () => {
    const t = mensajeFallo({ ...base, tipo: "chat_pulgar_abajo", datos: { pregunta: "¿Cuánto gasté?", respuesta: "No lo sé", hora: base.created_at } });
    expect(t).toContain("Pregunta: ¿Cuánto gasté?");
    expect(t).toContain("Respuesta del bot: No lo sé");
    expect(t).toContain("ana@casa.es");
    expect(t).toMatch(/Hora: 12\/11\/2026/);
  });
  it("tipo desconocido: formato genérico y nunca pasa de 4096", () => {
    const t = mensajeFallo({ ...base, tipo: "otro_fallo", datos: { x: "y".repeat(9000) } });
    expect(t).toContain("Fallo interno: otro fallo");
    expect(t.length).toBeLessThanOrEqual(4096);
  });
});
