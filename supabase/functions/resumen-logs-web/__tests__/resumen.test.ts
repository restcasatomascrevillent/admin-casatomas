/** resumen-logs-web: cifras agregadas y barandillas del resumen de IA (resumen.ts). */
import { describe, expect, it } from "vitest";
import { cifrasParaIa, interpretarResumen, mensajesResumen, numerosDe } from "../resumen";

const comportamiento = {
  periodo: { desde: "2026-10-01", hasta: "2026-10-31", dias: 31, zona: "Europe/Madrid" },
  resumen: { sesiones: 120, paginas_vistas: 480, conversiones: 9, tiempo_activo_mediana_s: 42, errores: 6 },
  anterior: { sesiones: 100, paginas_vistas: 400, conversiones: 10, tiempo_activo_mediana_s: 40, errores: 2 },
  embudos: [{ operacion: "reserva", entrada: 120, consulta: 40, inicio: 20, fin: 9 }],
  paginas: [{ ruta: "/carta/vinos", vistas: 150 }],
};

describe("resumen IA", () => {
  const cifras = cifrasParaIa({ comportamiento, visitasVercel: 900, visitasVercelAnterior: 800, incidencias: [] });
  it("calcula variaciones, tasas del embudo y cobertura", () => {
    expect(cifras.variacion_pct).toMatchObject({ sesiones: 20, conversiones: -10, visitas_vercel: 12.5 });
    expect((cifras.embudos as Array<Record<string, number>>)[0]).toMatchObject({ tasa_consulta_pct: 33.3, tasa_inicio_pct: 50, tasa_fin_pct: 45, abandono_estimado: 11 });
    expect(cifras.cobertura_pct).toBe(53.3);
  });
  it("las reglas del sistema piden cifras, separar observación e hipótesis y no causalidad", () => {
    const [sistema, usuario] = mensajesResumen(cifras);
    expect(sistema.content).toMatch(/citar al menos una cifra/);
    expect(sistema.content).toMatch(/No afirmes causas/);
    expect(sistema.content).toMatch(/no son personas|navegadores, no personas/);
    expect(usuario.content.startsWith("DATOS")).toBe(true);
  });
  it("descarta conclusiones sin una cifra de los datos y fuerza las mejoras a hipótesis", () => {
    const r = interpretarResumen(JSON.stringify({
      cambios: [
        { texto: "Las sesiones suben un 20 % (de 100 a 120).", cifras: ["20", "120"], tipo: "observacion" },
        { texto: "La web va mucho mejor que nunca.", cifras: [], tipo: "observacion" },
        { texto: "Las visitas crecieron un 37 %", cifras: ["37"], tipo: "observacion" },
      ],
      perdidas: [{ texto: "De 20 inicios de reserva, 9 terminan: 11 abandonos estimados.", cifras: ["20", "9", "11"], tipo: "observacion" }],
      mejoras: [{ texto: "Probar a acortar el formulario: 45 % de los que empiezan terminan.", cifras: ["45"], tipo: "observacion" }],
      problemas: [{ texto: "Errores de 2 a 6 coincidiendo con <b>la versión</b> https://x.y", cifras: ["2", "6"], tipo: "hipotesis" }],
    }), cifras);
    expect(r.cambios).toHaveLength(1);
    expect(r.descartadas).toBe(2);
    expect(r.mejoras[0].tipo).toBe("hipotesis");
    expect(r.problemas[0].texto).not.toMatch(/<b>|https/);
    expect(numerosDe(cifras).has("45")).toBe(true);
  });
  it("JSON roto → error", () => {
    expect(() => interpretarResumen("no", cifras)).toThrow(/JSON/);
  });
});
