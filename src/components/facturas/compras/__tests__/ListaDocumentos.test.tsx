/**
 * Compras › Documentos agrupados por mes y proveedor: cabeceras con totales,
 * albaranes facturados atenuados y sin sumar, meses antiguos plegados,
 * recuerdo del plegado y enlace profundo (documento dentro de un grupo plegado).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Factura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { ListaDocumentos } from "../ListaDocumentos";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  tipo: "factura",
  numero_documento: `F-${id}`,
  proveedor: "Makro",
  cif: null,
  fecha: "2026-10-03",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  drive_url: null,
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: true,
  facturado_en_id: null,
  ...extra,
});

const prov = (id: number, nombre: string, variantes: string[]): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 1,
  facturas: 1,
  albaranes: 0,
  total_facturas: 0,
  total_albaranes: 0,
  ultima_fecha: null,
  variantes,
  alias: [],
  cifs_extra: [],
});

const resolver = crearResolverProveedor([prov(1, "Pescados Rías Baixas", ["Pescados Rías Baixas S.L."]), prov(2, "Makro", ["Makro"])]);
const HOY = new Date(2026, 9, 10);

const DOCS: Factura[] = [
  doc(1, { numero_documento: "F-0001", proveedor: "Pescados Rías Baixas S.L.", total: 1000 }),
  doc(2, { numero_documento: "ALB-0002", tipo: "albaran", proveedor: "Pescados Rías Baixas S.L.", total: 300, facturado_en_id: 1 }),
  doc(3, { numero_documento: "ALB-0003", tipo: "albaran", proveedor: "Pescados Rías Baixas S.L.", total: 120.5 }),
  doc(4, { numero_documento: "F-0004", proveedor: "Makro", total: 50 }),
  doc(5, { numero_documento: "F-0005", proveedor: "Makro", fecha: "2026-09-12", total: 70 }),
  doc(6, { numero_documento: "F-0006", proveedor: "Makro", fecha: "2026-05-02", total: 33 }),
  doc(7, { numero_documento: "F-0007", proveedor: "Makro", fecha: "", total: 9 }),
];

function pintar(extra: Partial<React.ComponentProps<typeof ListaDocumentos>> = {}) {
  const onAbrir = vi.fn();
  const props: React.ComponentProps<typeof ListaDocumentos> = {
    documentos: DOCS,
    facturas: DOCS.filter((d) => d.tipo === "factura"),
    resolver,
    avisosPorId: new Map(),
    seleccionadoId: null,
    cargando: false,
    hayFiltros: false,
    onAbrir,
    hoy: HOY,
    ...extra,
  };
  const r = render(<ListaDocumentos {...props} />);
  return { ...r, onAbrir, props };
}

const cabeceraMes = (nombre: RegExp) => screen.getByRole("button", { name: nombre });
/** Cabecera del subgrupo de un proveedor dentro de un mes (Makro sale en octubre y septiembre). */
const cabeceraProveedor = (mes: string, nombre: RegExp) => within(screen.getByRole("region", { name: mes })).getByRole("button", { name: nombre });

describe("ListaDocumentos agrupada", () => {
  beforeEach(() => window.localStorage.clear());

  it("cabeceras de mes en orden, con nº de documentos y total sin doble conteo", () => {
    pintar();
    const meses = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(meses).toHaveLength(4);
    expect(meses[0]).toMatch(/^Octubre 2026 · 4 documentos · 1\.?170,50\s€ con IVA$/); // 1000 + 120,50 + 50 (el albarán facturado no suma)
    expect(meses[1]).toMatch(/^Septiembre 2026 · 1 documento · 70,00\s€ con IVA$/);
    expect(meses[2]).toMatch(/^Mayo 2026 · 1 documento · 33,00\s€ con IVA$/);
    expect(meses[3]).toMatch(/^Sin fecha · 1 documento · 9,00\s€ con IVA$/);
  });

  it("dentro del mes, subgrupo por proveedor con sus documentos y total", () => {
    pintar();
    const octubre = screen.getByRole("region", { name: "Octubre 2026" });
    const provs = within(octubre).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(provs[0]).toMatch(/^Makro · 1 doc · 50,00\s€ con IVA$/);
    expect(provs[1]).toMatch(/^Pescados Rías Baixas · 3 docs · 1\.?120,50\s€ con IVA$/);
  });

  it("el albarán ya facturado sale atenuado con «en F-xxx»", () => {
    pintar();
    const fila = screen.getByText("ALB-0002").closest("button")!;
    expect(fila.getAttribute("data-facturado")).toBe("true");
    expect(fila.className).toMatch(/opacity-60/);
    expect(fila.textContent).toContain("en F-0001");
    const libre = screen.getByText("ALB-0003").closest("button")!;
    expect(libre.getAttribute("data-facturado")).toBeNull();
    expect(libre.textContent).toContain("Sin factura");
  });

  it("si la factura del albarán no está en la lista filtrada, sigue diciendo cuál es", () => {
    const albaran = DOCS[1];
    pintar({ documentos: [albaran] , seleccionadoId: null });
    expect(screen.getByText("ALB-0002").closest("button")!.textContent).toContain("en F-0001");
  });

  it("mes actual y anterior desplegados; más antiguos y «Sin fecha» plegados", () => {
    pintar();
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Septiembre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("F-0006")).toBeNull();
    expect(screen.getByText("F-0005")).toBeTruthy();
  });

  it("plegar y desplegar, y se recuerda en localStorage", () => {
    const { unmount } = pintar();
    fireEvent.click(cabeceraMes(/^Mayo 2026/));
    expect(screen.getByText("F-0006")).toBeTruthy();
    fireEvent.click(cabeceraMes(/^Octubre 2026/));
    expect(screen.queryByText("F-0004")).toBeNull();
    unmount();
    pintar();
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("false");
  });

  it("se puede plegar un proveedor sin tocar el resto", () => {
    pintar();
    fireEvent.click(cabeceraProveedor("Octubre 2026", /^Makro\s*·?\s*1 doc/));
    expect(screen.queryByText("F-0004")).toBeNull();
    expect(screen.getByText("ALB-0003")).toBeTruthy();
  });

  it("con localStorage roto sigue funcionando", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      pintar();
      fireEvent.click(cabeceraMes(/^Mayo 2026/));
      expect(screen.getByText("F-0006")).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("un chip (sin texto) no despliega meses: se respeta lo plegado", () => {
    pintar({ hayFiltros: true });
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("F-0006")).toBeNull();
    expect(screen.queryByTestId("barra-meses")).toBeNull();
  });

  it("con texto buscado: solo los 3 meses más recientes con resultados, y «Abrir todos» / «Plegar todos»", () => {
    // Octubre plegado a mano antes de buscar: durante la búsqueda no cuenta.
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ "m:2026-10": false }));
    pintar({ hayFiltros: true, busqueda: "f-" });
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Septiembre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("barra-meses").textContent).toContain("4 meses con resultados");

    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("F-0007")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Plegar todos" }));
    for (const m of [/^Octubre 2026/, /^Septiembre 2026/, /^Mayo 2026/, /^Sin fecha/]) {
      expect(cabeceraMes(m).getAttribute("aria-expanded")).toBe("false");
    }
    // Lo de la búsqueda no se recuerda en localStorage.
    expect(JSON.parse(window.localStorage.getItem("compras.documentos.plegado") ?? "{}")).toEqual({ "m:2026-10": false });
  });

  it("al cambiar el texto buscado se vuelve a la regla de los 3 primeros", () => {
    const { rerender, props } = pintar({ hayFiltros: true, busqueda: "f-" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    rerender(<ListaDocumentos {...props} busqueda="f-0" />);
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    // Al borrar la búsqueda vuelve lo recordado (mes actual y anterior).
    rerender(<ListaDocumentos {...props} busqueda="" hayFiltros={false} />);
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("barra-meses")).toBeNull();
  });

  it("con búsqueda y 3 meses o menos con resultados, todos abiertos y sin botón", () => {
    pintar({ hayFiltros: true, busqueda: "makro", documentos: DOCS.filter((d) => d.proveedor === "Makro" && d.fecha) });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    for (const m of [/^Octubre 2026/, /^Septiembre 2026/, /^Mayo 2026/]) {
      expect(cabeceraMes(m).getAttribute("aria-expanded")).toBe("true");
    }
    expect(screen.queryByTestId("barra-meses")).toBeNull();
  });

  it("cada mes lleva content-visibility: auto con un tamaño de reserva", () => {
    const { container } = pintar();
    const mayo = container.querySelector('section[data-mes="2026-05"]') as HTMLElement;
    const octubre = container.querySelector('section[data-mes="2026-10"]') as HTMLElement;
    expect(mayo.className).toContain("[content-visibility:auto]");
    expect(mayo.getAttribute("style") ?? "").toMatch(/contain-intrinsic-size:\s*auto 45px/);
    // Octubre abierto: cabecera + 2 proveedores + 4 documentos.
    expect(octubre.getAttribute("style") ?? "").toMatch(new RegExp(`contain-intrinsic-size:\\s*auto ${45 + 2 * 44 + 4 * 49}px`));
  });

  it("enlace profundo: un documento en un mes plegado lo despliega", () => {
    pintar({ seleccionadoId: 6 });
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    const fila = screen.getByText("F-0006").closest("button")!;
    expect(fila.getAttribute("aria-current")).toBe("true");
  });

  it("enlace profundo: también despliega el proveedor plegado y si no se pide otro documento no se vuelve a abrir", () => {
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ "p:2026-10|#2": false }));
    const { rerender, props } = pintar({ seleccionadoId: null });
    expect(screen.queryByText("F-0004")).toBeNull();
    rerender(<ListaDocumentos {...props} seleccionadoId={4} />);
    expect(screen.getByText("F-0004").closest("button")!.getAttribute("aria-current")).toBe("true");
    // El usuario lo pliega a mano estando seleccionado: se respeta.
    fireEvent.click(cabeceraProveedor("Octubre 2026", /^Makro\s*·?\s*1 doc/));
    expect(screen.queryByText("F-0004")).toBeNull();
  });

  it("enlace profundo con búsqueda: un documento en un mes plegado lo despliega (sin recordarlo)", () => {
    pintar({ hayFiltros: true, busqueda: "f-", seleccionadoId: 7 });
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem("compras.documentos.plegado")).toBeNull();
  });

  it("filas: «1 línea» / «2 líneas»", () => {
    const linea = { id: 1, producto_nombre: "X", precio: 1, proveedor: null };
    pintar({ documentos: [doc(20, { productos: [linea] }), doc(21, { productos: [linea, { ...linea, id: 2 }] })] });
    expect(screen.getByText("F-20").closest("button")!.textContent).toMatch(/· 1 línea(?!s)/);
    expect(screen.getByText("F-21").closest("button")!.textContent).toContain("· 2 líneas");
  });

  it("enlace profundo: documento «Sin fecha»", () => {
    pintar({ seleccionadoId: 7 });
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("F-0007")).toBeTruthy();
  });

  it("un clic en una fila abre el documento", () => {
    const { onAbrir } = pintar();
    fireEvent.click(screen.getByText("F-0004"));
    expect(onAbrir).toHaveBeenCalledWith(4);
  });

  it("estados vacío y cargando", () => {
    const { unmount } = pintar({ documentos: [], hayFiltros: true });
    expect(screen.getByText("Ningún documento coincide")).toBeTruthy();
    unmount();
    pintar({ documentos: [], hayFiltros: false });
    expect(screen.getByText("No hay documentos registrados")).toBeTruthy();
  });

  it("cabeceras y filas con zona táctil de 44 px como mínimo", () => {
    pintar();
    expect(cabeceraMes(/^Octubre 2026/).className).toMatch(/min-h-11/);
    expect(cabeceraProveedor("Octubre 2026", /^Makro\s*·?\s*1 doc/).className).toMatch(/min-h-11/);
  });
  it("tabula los tres niveles: mes a ras, proveedor con sangría y documentos con guía vertical", () => {
    const { container } = pintar();
    const mes = container.querySelector('section[data-mes="2026-10"]') as HTMLElement;
    const h3 = mes.querySelector("h3") as HTMLElement;
    expect(h3.className).not.toMatch(/ml-/);
    const h4 = mes.querySelector('[data-nivel="proveedor"]') as HTMLElement;
    expect(h4.className).toMatch(/(^| )ml-2( |$)/);
    expect(h4.className).toMatch(/sm:ml-4/);
    const lista = mes.querySelector('[data-nivel="documentos"]') as HTMLElement;
    expect(lista.className).toMatch(/(^| )ml-4( |$)/);
    expect(lista.className).toMatch(/sm:ml-8/);
    expect(lista.className).toMatch(/border-l/);
    expect(lista.className).toMatch(/border-border(\s|$)/);
  });
});
