import { describe, expect, it } from "vitest";
import { type Fallo, mensajeFallo } from "../fallos";

const base = { id: 1, usuario: "ana@casa.es", created_at: "2026-11-12T10:30:00Z" };

describe("mensajeFallo (cortos: primera línea con emoji y lo justo para investigar)", () => {
  it("albarán: proveedor, fecha e id en una línea; los avisos debajo", () => {
    const f: Fallo = { ...base, tipo: "albaran_aviso", datos: { factura_id: 77, avisos: [{ codigo: "descuadre_cabecera", mensaje: "Los totales no cuadran" }] } };
    expect(mensajeFallo(f, { albaran: { id: 77, proveedor: "Frutas Pepe", fecha: "2026-11-10" } }))
      .toBe("🧾 Albarán con avisos · Frutas Pepe · 10/11 · id 77\n- Los totales no cuadran [descuadre_cabecera]");
  });
  it("albarán sin contexto usa el id del fallo; como mucho 5 avisos", () => {
    const avisos = Array.from({ length: 7 }, (_, i) => ({ mensaje: `Aviso ${i}` }));
    const t = mensajeFallo({ ...base, tipo: "albaran_aviso", datos: { factura_id: 5, avisos } });
    expect(t.split("\n")[0]).toBe("🧾 Albarán con avisos · proveedor desconocido · id 5");
    expect(t).toContain("- y 2 más");
    expect(t).not.toContain("Aviso 5");
  });
  it("pulgar abajo: usuario y hora arriba; P y R recortadas", () => {
    const t = mensajeFallo({ ...base, tipo: "chat_pulgar_abajo", datos: { pregunta: "¿Cuánto gasté?", respuesta: "x".repeat(2000), hora: base.created_at } });
    const [l1, l2, l3] = t.split("\n");
    expect(l1).toBe("👎 Chat de Facturas · ana@casa.es · 12/11 11:30");
    expect(l2).toBe("P: ¿Cuánto gasté?");
    expect(l3.length).toBeLessThanOrEqual(603);
  });
  it("chat_error: motivo, origen y duración en la primera línea; los acumulados al final", () => {
    const t = mensajeFallo({
      ...base, usuario: null, tipo: "chat_error",
      datos: { origen: "panel", motivo: "tiempo_agotado", pregunta: "Precio del pulpo", duracion_ms: 20500, acumulados_antes: 7, acumulados_desde: "2026-11-12T10:00:00Z" },
    });
    expect(t).toBe("💥 Chat de Facturas sin respuesta · tiempo_agotado (panel) · 20.5 s\nP: Precio del pulpo\n(+7 más desde 12/11 11:00)");
    expect(mensajeFallo({ ...base, tipo: "chat_error", datos: { motivo: "error" } })).not.toContain("más desde");
  });
  it("el agrupado trae los ids de los descartados", () => {
    const t = mensajeFallo({ ...base, tipo: "albaran_aviso", datos: { factura_id: 3, avisos: [], acumulados_antes: 2, acumulados_desde: "2026-11-13T09:00:00Z", acumulados_ids: [41, 42] } });
    expect(t).toContain("(+2 más desde 13/11 10:00; ids 41, 42)");
  });
  it("OpenAI sin créditos, lecturas fallidas y tareas caídas", () => {
    expect(mensajeFallo({ ...base, tipo: "openai_sin_creditos", datos: { trabajos: 6, desde: "2026-11-13T09:00:00Z", ejemplo: "OpenAI 429: You have no credits" } }))
      .toBe("💳 OpenAI sin créditos: 6 lecturas de facturas fallidas desde 13/11 10:00. Hasta recargar, no se leen facturas.\nOpenAI 429: You have no credits");
    expect(mensajeFallo({ ...base, tipo: "ocr_fallido", datos: { trabajos: 3, motivos: [{ error: "La extracción no cumple el contrato", n: 2 }] } }))
      .toBe("📄 3 lecturas de facturas fallidas\n- La extracción no cumple el contrato (2)");
    expect(mensajeFallo({ ...base, tipo: "cron_caido", datos: { crons: [{ job: "reanudar-trabajos-ocr", minutos: 49, maximo: 30, error: "job startup timeout" }] } }))
      .toBe("⏰ Tareas programadas sin éxito\n- reanudar-trabajos-ocr: 49 min (máx. 30) · job startup timeout");
  });
  it("tipo desconocido: formato genérico y nunca pasa de 4096", () => {
    const t = mensajeFallo({ ...base, tipo: "otro_fallo", datos: { x: "y".repeat(9000) } });
    expect(t.split("\n")[0]).toBe("🛠 otro fallo · 12/11 11:30 · ana@casa.es");
    expect(t.length).toBeLessThanOrEqual(1600);
  });
});
