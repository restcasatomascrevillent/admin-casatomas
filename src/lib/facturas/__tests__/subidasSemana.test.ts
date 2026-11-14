import { describe, expect, it } from "vitest";
import { agruparPorDia, claveDia, inicioSemana, textoEstado } from "../subidasSemana";

const hoy = new Date(2026, 10, 14, 10, 30); // 14/11/2026 (hora local)
const a = (id: string, subido: Date, nombre = `${id}.jpg`) => ({ id, nombre, subido: subido.toISOString(), estado: "completado", facturaId: null });

describe("subidasSemana", () => {
  it("siete días: el más antiguo hace 6 días y hoy el último", () => {
    const dias = agruparPorDia([], hoy);
    expect(dias).toHaveLength(7);
    expect(dias[0].clave).toBe("2026-11-08");
    expect(dias[6].clave).toBe("2026-11-14");
    expect(dias[6].esHoy).toBe(true);
    expect(dias.filter((d) => d.esHoy)).toHaveLength(1);
    expect(claveDia(inicioSemana(hoy))).toBe("2026-11-08");
  });

  it("cuenta los archivos de cada día con su nombre, el más reciente primero, y deja fuera los de antes", () => {
    const dias = agruparPorDia(
      [
        a("1", new Date(2026, 10, 14, 8, 0), "IMG_1153.png"),
        a("2", new Date(2026, 10, 14, 9, 0), "factura makro.pdf"),
        a("3", new Date(2026, 10, 8, 0, 5)),
        a("4", new Date(2026, 10, 7, 23, 59)),
      ],
      hoy,
    );
    expect(dias[6].archivos.map((x) => x.nombre)).toEqual(["factura makro.pdf", "IMG_1153.png"]);
    expect(dias[0].archivos.map((x) => x.id)).toEqual(["3"]);
    expect(dias.reduce((n, d) => n + d.archivos.length, 0)).toBe(3);
  });

  it("estado en palabras sencillas", () => {
    expect(textoEstado("completado").texto).toBe("Leído");
    expect(textoEstado("fallido").tono).toBe("error");
    expect(textoEstado("paginas").texto).toBe("Se está leyendo");
  });
});
