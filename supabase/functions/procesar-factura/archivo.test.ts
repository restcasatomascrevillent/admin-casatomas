import { describe, expect, it } from "vitest";
import { carpetaMes, carpetaProveedor } from "./archivo.ts";

describe("carpetas de Drive: proveedor → mes", () => {
  it("el mes lleva el año delante y el nombre en español", () => {
    expect(carpetaMes("2026-03-14")).toBe("2026-03 Marzo");
    expect(carpetaMes("2025-12-01")).toBe("2025-12 Diciembre");
    expect(carpetaMes("2026-01-31")).toBe("2026-01 Enero");
  });

  it("sin fecha o con fecha rara va a «Sin fecha»", () => {
    expect(carpetaMes(null)).toBe("Sin fecha");
    expect(carpetaMes("")).toBe("Sin fecha");
    expect(carpetaMes("2026-13-01")).toBe("Sin fecha");
    expect(carpetaMes("14/03/2026")).toBe("Sin fecha");
  });

  it("el proveedor se limpia de barras y espacios", () => {
    expect(carpetaProveedor("  PESCADOS   MOLTO, S.L. ")).toBe("PESCADOS MOLTO, S.L.");
    expect(carpetaProveedor("Distribuciones A/B\\C")).toBe("Distribuciones A-B-C");
  });

  it("sin proveedor va a «Sin proveedor» y los nombres largos se recortan", () => {
    expect(carpetaProveedor(null)).toBe("Sin proveedor");
    expect(carpetaProveedor("   ")).toBe("Sin proveedor");
    expect(carpetaProveedor("x".repeat(200))).toHaveLength(80);
  });
});

describe("limpiarConfigDrive", () => {
  it("quita saltos de línea y espacios pegados con los secretos", async () => {
    const { limpiarConfigDrive } = await import("./archivo.ts");
    expect(limpiarConfigDrive({ clientId: "id.apps\n", clientSecret: " s ", refreshToken: "1//t\r\n", parentFolder: "carpeta\n" }))
      .toEqual({ clientId: "id.apps", clientSecret: "s", refreshToken: "1//t", parentFolder: "carpeta" });
  });
});
