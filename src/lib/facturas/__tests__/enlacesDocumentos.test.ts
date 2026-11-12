import { describe, expect, it } from "vitest";
import { enlazarDocumentos, patronNumero } from "../enlacesDocumentos";
import type { DocumentoCitado } from "../seriePrecio";

const DRIVE = "https://drive.google.com/file/d/abc/view";
const doc = (numero: string | null, drive_url: string | null = DRIVE, id = 1): DocumentoCitado => ({
  id, tipo: "factura", numero, proveedor: "Catral", fecha: "2026-09-30", drive_url, archivo_path: null,
});

describe("enlazarDocumentos (número citado → enlace a Drive)", () => {
  it("enlaza la primera vez que sale el número", () => {
    expect(enlazarDocumentos("La factura 002482 de Catral. Otra vez 002482.", [doc("002482")])).toBe(
      `La factura [002482](<${DRIVE}>) de Catral. Otra vez 002482.`,
    );
  });

  it("casa con otros separadores y respeta lo que escribió el modelo", () => {
    expect(enlazarDocumentos("Albarán AL 2025 0009781.", [doc("AL2025/0009781")])).toBe(
      `Albarán [AL 2025 0009781](<${DRIVE}>).`,
    );
  });

  it("no enlaza si va pegado a otra cifra, ni dentro de código, enlaces o URLs", () => {
    expect(enlazarDocumentos("Total 1002482 €", [doc("002482")])).toBe("Total 1002482 €");
    expect(enlazarDocumentos("`002482` y [ver](https://x.test/002482)", [doc("002482")])).toBe(
      "`002482` y [ver](https://x.test/002482)",
    );
  });

  it("sin Drive (o con una URL que no es http) no enlaza", () => {
    expect(enlazarDocumentos("Factura 002482", [doc("002482", null)])).toBe("Factura 002482");
    expect(enlazarDocumentos("Factura 002482", [doc("002482", "javascript:alert(1)")])).toBe("Factura 002482");
  });

  it("enlaza varios documentos de la misma respuesta, también en tablas", () => {
    const texto = "| Nº | Proveedor |\n|---|---|\n| A-101 | Uno |\n| B-202 | Dos |";
    const salida = enlazarDocumentos(texto, [doc("A-101", DRIVE, 1), doc("B-202", "https://drive.google.com/file/d/zzz/view", 2)]);
    expect(salida).toContain(`[A-101](<${DRIVE}>)`);
    expect(salida).toContain("[B-202](<https://drive.google.com/file/d/zzz/view>)");
  });

  it("los números muy cortos no se enlazan (demasiado ambiguos)", () => {
    expect(patronNumero("12")).toBeNull();
    expect(enlazarDocumentos("la 12", [doc("12")])).toBe("la 12");
  });
});
