import { describe, expect, it } from "vitest";
import {
  atajosPeriodo,
  diasRango,
  escribirAnalisisEnUrl,
  esFechaIso,
  fechasSeleccion,
  leerAnalisisDeUrl,
  seleccionDeRango,
  textoRango,
} from "../periodoAnalisis";
import { argumentosRpc, cuadra, idDrive, normalizarPaginaDocumentos, peticionSimple, vistaPreviaDrive } from "../documentosCifra";

const HOY = new Date(2026, 10, 5, 12); // 5 nov 2026

describe("periodo personalizado", () => {
  it("atajos: últimos 7/30/90 días, este mes, mes anterior, este año, año pasado", () => {
    const a = Object.fromEntries(atajosPeriodo(HOY).map((x) => [x.id, [x.desde, x.hasta]]));
    expect(a["7d"]).toEqual(["2026-10-30", "2026-11-05"]);
    expect(a["30d"]).toEqual(["2026-10-07", "2026-11-05"]);
    expect(a["90d"]).toEqual(["2026-08-08", "2026-11-05"]);
    expect(a["este-mes"]).toEqual(["2026-11-01", "2026-11-30"]);
    expect(a["mes-anterior"]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(a["este-anio"]).toEqual(["2026-01-01", "2026-12-31"]);
    expect(a["anio-pasado"]).toEqual(["2025-01-01", "2025-12-31"]);
    expect(atajosPeriodo(new Date(2026, 0, 10)).find((x) => x.id === "mes-anterior")).toMatchObject({ desde: "2025-12-01", hasta: "2025-12-31" });
  });
  it("un rango igual a Mes/Trimestre/Año se enseña como ese botón", () => {
    expect(seleccionDeRango("2026-01-01", "2026-12-31", HOY)).toEqual({ tipo: "anio" });
    expect(seleccionDeRango("2026-10-01", "2026-12-31", HOY)).toEqual({ tipo: "trimestre" });
    expect(seleccionDeRango("2026-03-01", "2026-04-15", HOY)).toEqual({ tipo: "personalizado", desde: "2026-03-01", hasta: "2026-04-15" });
    expect(fechasSeleccion({ tipo: "todo" }, HOY)).toEqual({ desde: null, hasta: null });
  });
  it("textos y fechas válidas", () => {
    expect(textoRango("2026-03-01", "2026-04-15")).toBe("1 mar – 15 abr 2026");
    expect(textoRango("2025-11-05", "2026-11-04")).toBe("5 nov 2025 – 4 nov 2026");
    expect(diasRango("2026-03-01", "2026-03-31")).toBe(31);
    expect(esFechaIso("2026-02-31")).toBe(false);
    expect(esFechaIso("2026-02-28")).toBe(true);
  });
});

describe("periodo y local en la URL", () => {
  it("se escriben sin tocar el resto (tab) y se leen de vuelta", () => {
    const p = escribirAnalisisEnUrl(new URLSearchParams("tab=chat"), { tipo: "personalizado", desde: "2026-03-01", hasta: "2026-04-15" }, "touza", HOY);
    expect(p.toString()).toBe("tab=chat&desde=2026-03-01&hasta=2026-04-15&local=touza");
    expect(leerAnalisisDeUrl(p, HOY)).toEqual({ periodo: { tipo: "personalizado", desde: "2026-03-01", hasta: "2026-04-15" }, local: "touza" });
    const todo = escribirAnalisisEnUrl(p, { tipo: "todo" }, "todos", HOY);
    expect(todo.toString()).toBe("tab=chat&periodo=todo");
    expect(leerAnalisisDeUrl(todo, HOY)).toEqual({ periodo: { tipo: "todo" }, local: null });
  });
  it("lo inválido se ignora", () => {
    expect(leerAnalisisDeUrl(new URLSearchParams("desde=2026-05-01&hasta=2026-04-01&local=bar"), HOY)).toEqual({ periodo: null, local: null });
    expect(leerAnalisisDeUrl(new URLSearchParams("desde=hoy&hasta=2026-04-01"), HOY).periodo).toBeNull();
  });
});

describe("documentos de una cifra", () => {
  it("argumentos de la RPC (local en los filtros) y paginación", () => {
    const p = peticionSimple({ titulo: "Abonos", desde: "2026-01-01", hasta: "2026-12-31", medida: "abonos", local: "touza", cifra: 10 });
    expect(argumentosRpc(p, 50, 100)).toEqual({
      p_desde: "2026-01-01",
      p_hasta: "2026-12-31",
      p_medida: "abonos",
      p_agrupar: null,
      p_desglose: null,
      p_filtros: { local: "touza" },
      p_clave: null,
      p_clave_desglose: null,
      p_top: 10,
      p_limite: 50,
      p_desplazamiento: 100,
    });
  });
  it("lee la página sin fiarse y comprueba que cuadra", () => {
    const pag = normalizarPaginaDocumentos({
      cifra: "600.00",
      documentos: 3,
      importe_total: 600,
      desplazamiento: 0,
      filas: [
        { id: 5, fecha: "2026-02-20", proveedor: "TOUZA SL", numero_documento: "A-1", tipo: "factura", local: "touza", total: 300, importe_aportado: 300, drive_url: null, archivo_path: "x.pdf" },
        { id: "malo" },
        { id: 6, tipo: "abono", total: -100, importe_aportado: -100 },
      ],
    });
    expect(pag.filas.map((f) => [f.id, f.tipo, f.local, f.aporta])).toEqual([
      [5, "factura", "touza", 300],
      [6, "abono", "casa_tomas", -100],
    ]);
    expect(cuadra(600, pag.cifra)).toBe(true);
    expect(cuadra(601, pag.cifra)).toBe(false);
    expect(cuadra(undefined, pag.cifra)).toBeNull();
    expect(() => normalizarPaginaDocumentos({ error: "x" })).toThrow();
  });
  it("vista previa de Drive solo para URLs de Drive", () => {
    expect(vistaPreviaDrive("https://drive.google.com/file/d/1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr/view?usp=drivesdk")).toBe(
      "https://drive.google.com/file/d/1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr/preview",
    );
    expect(idDrive("https://drive.google.com/open?id=1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr")).toBe("1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr");
    expect(vistaPreviaDrive("https://evil.example.com/file/d/1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr/view")).toBeNull();
    expect(vistaPreviaDrive("javascript:alert(1)")).toBeNull();
  });
});
