import { describe, expect, it } from "vitest";
import { cambiosGuardables, COLUMNAS_CONFIG_SOLO_LECTURA, type CambiosConfigLogs } from "../useLogsWeb";

describe("guardar la configuración de Logs", () => {
  it("no manda las columnas que pone la base de datos (si no, «permission denied for table web_logs_config»)", () => {
    // Así llega el borrador: la fila entera de select("*").
    const borrador = { id: true, entorno_bd: "produccion", actualizado_en: "2026-11-14", actualizado_por: "u-1", linear_modo: "real", linear_equipo_id: "eq-1", ia_max_analisis_dia: 20 } as unknown as CambiosConfigLogs;
    const limpio = cambiosGuardables(borrador) as Record<string, unknown>;
    for (const c of COLUMNAS_CONFIG_SOLO_LECTURA) expect(limpio).not.toHaveProperty(c);
    expect(limpio).toEqual({ linear_modo: "real", linear_equipo_id: "eq-1", ia_max_analisis_dia: 20 });
  });
});
