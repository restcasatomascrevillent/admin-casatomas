/**
 * Peticiones duplicadas (ia_uso 212-219, 08/10/2026): cada pregunta dejaba DOS
 * ejecuciones completas del bucle de OpenAI y dos filas en ia_uso. sinDuplicar
 * las colapsa en UNA ejecucion y UN registro. Y las reglas de grafica y de
 * comparacion de proveedores del prompt (mismo dia).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { _vaciarDuplicados, sinDuplicar, systemPrompt, TOOLS } from "../herramientas.ts";

/**
 * Tope del prompt de sistema: 6.400 (antes 5.990). Sube ~370 caracteres el
 * 07/11/2026 (migracion 20261107100000) por las reglas que el dueño pidio tras
 * fallos reales en la demo: precio del litro en la 15, no preguntar «¿quieres
 * que consulte…?» (16), seguimiento con el mismo tema (17) y «ultimo mes» (18).
 * El prompt va en cache (≈5.600 de 8.200 tokens de entrada, 0,10 $/M en
 * gpt-4.1-mini): ~+90 tokens ≈ +0,00001 $ por ronda.
 */
const LIMITE_PROMPT = 6_450; // + regla 19 «como_leer» (16/11/2026)

/** Simula el handler: una "ejecucion" = bucle de OpenAI (2 llamadas) + 1 registro de uso. */
function handlerSimulado() {
  const estado = { ejecuciones: 0, llamadasOpenAI: 0, filasUso: 0 };
  const ejecutar = async () => {
    estado.ejecuciones++;
    await new Promise((r) => setTimeout(r, 20));
    estado.llamadasOpenAI += 2;
    estado.filasUso++;
    return { status: 200, cuerpo: JSON.stringify({ success: true, respuesta: "ok" }) };
  };
  return { estado, ejecutar };
}

describe("sinDuplicar", () => {
  beforeEach(() => _vaciarDuplicados());

  it("dos peticiones simultaneas iguales: 1 ejecucion, 2 llamadas a OpenAI y 1 fila de uso", async () => {
    const { estado, ejecutar } = handlerSimulado();
    const [a, b] = await Promise.all([sinDuplicar("u|s|pregunta", ejecutar), sinDuplicar("u|s|pregunta", ejecutar)]);
    expect(estado).toEqual({ ejecuciones: 1, llamadasOpenAI: 2, filasUso: 1 });
    expect(b).toEqual(a);
  });

  it("la repeticion justo despues de terminar tambien se colapsa", async () => {
    const { estado, ejecutar } = handlerSimulado();
    await sinDuplicar("u|s|p", ejecutar, 8_000);
    await sinDuplicar("u|s|p", ejecutar, 8_000);
    expect(estado.ejecuciones).toBe(1);
    expect(estado.filasUso).toBe(1);
  });

  it("pasada la ventana (regenerar) vuelve a ejecutar", async () => {
    const { estado, ejecutar } = handlerSimulado();
    let t = 1_000;
    await sinDuplicar("u|s|p", ejecutar, 8_000, () => t);
    t += 9_000;
    await sinDuplicar("u|s|p", ejecutar, 8_000, () => t);
    expect(estado.ejecuciones).toBe(2);
  });

  it("preguntas o sesiones distintas no se mezclan", async () => {
    const { estado, ejecutar } = handlerSimulado();
    await Promise.all([sinDuplicar("u|s|a", ejecutar), sinDuplicar("u|s|b", ejecutar), sinDuplicar("u|s2|a", ejecutar)]);
    expect(estado.ejecuciones).toBe(3);
  });

  it("un fallo no se reutiliza", async () => {
    let n = 0;
    const falla = async () => {
      n++;
      throw new Error("x");
    };
    await expect(sinDuplicar("k", falla)).rejects.toThrow();
    await expect(sinDuplicar("k", falla)).rejects.toThrow();
    expect(n).toBe(2);
  });
});

describe("prompt ronda 9", () => {
  const p = systemPrompt("2026-10-08");
  const desc = (n: string) => TOOLS.find((t) => t.function.name === n)!.function.description;

  it("pide grafico_precio para grafica, evolucion y «como ha ido el precio»", () => {
    expect(p).toMatch(/grafico_precio: grafica, evolucion, "como ha ido\/ensename el precio" de un producto \(no historial_precios\)/);
    expect(desc("grafico_precio")).toMatch(/evolucion|como ha ido el precio/);
    expect(desc("historial_precios")).toMatch(/grafico_precio/);
  });

  it("al comparar proveedores lista todos, cada uno en su unidad, y no declara ganador si no son comparables", () => {
    expect(p).toMatch(/lista TODOS los proveedores, cada uno con su precio en SU unidad/);
    expect(p).toMatch(/sin ganador si avisos\.unidades_mezcladas o productos_coincidentes > 1/);
  });

  it("tamanos no crecen (prompt <= 5.990, TOOLS <= 10.560 con volumen_comprado y bebidas)", () => {
    expect(p.length).toBeLessThanOrEqual(LIMITE_PROMPT); // 5.732 + bebidas (13/11) + asociacion (07/11/2026)
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(11_950); // 9.626 + volumen_comprado (06/11/2026) + bebidas (13/11/2026) + IRPF (07/11/2026) + margenes_carta y alertas_precio (16/11/2026)
  });
});
