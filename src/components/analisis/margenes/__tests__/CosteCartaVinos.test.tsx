import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { normalizarCandidatos, normalizarCosteVinos } from "@/lib/analisis/costeVinos";

const guardarVino = { mutate: vi.fn(), isPending: false };
let estado: { isLoading: boolean; isError: boolean; isFetching: boolean; data: unknown; error: unknown; refetch: () => void };
let mesesPedidos: (number | null)[] = [];
let candidatos: unknown[] = [];

vi.mock("@/hooks/useMargenesCarta", () => ({
  useCosteCartaVinos: (meses: number | null) => {
    mesesPedidos.push(meses);
    return estado;
  },
  useCandidatosVino: (id: string | null) => ({ data: id ? normalizarCandidatos(candidatos) : undefined, isLoading: false, isError: false }),
  useBuscarProductos: () => ({ data: [], isLoading: false }),
  useEdicionMargenes: () => ({ vino: guardarVino }),
}));

import { CosteCartaVinos } from "../CosteCartaVinos";

const factura = (id: number, proveedor: string, extra: Record<string, unknown> = {}) => ({
  id, linea_id: id * 10, fecha: "2026-06-30", proveedor, numero_documento: `F-${id}`, tipo: "factura", total: 900, drive_url: null, archivo_path: null,
  cantidad: 30, unidad_compra: "botella", precio_unidad: 19.3, importe: 579, medida: "l", eur_base: 25.73, ...extra,
});

const DATOS = normalizarCosteVinos({
  hoy: "2026-11-16",
  meses: null,
  copas_por_botella: 6,
  config: { multiplicador_min_vino: 2.3, iva_pct: 10 },
  resumen: {
    total: 4, con_coste: 2, sin_coste: 1, sin_enlazar: 1, sin_compra: 0, sin_precio: 0, dudosos: 1, revisar: 0,
    anada_distinta: 0, por_debajo: 1, con_sin_cargo: 1, con_candidato: 1, multiplicador_mediana: 2.31,
  },
  vinos: [
    { id: "ardanza", nombre: "Viña Ardanza", categoria: "TINTOS — RIOJA", precio: 42.5, venta: 38.6364, producto_id: 2, producto: "Viña Ardanza Reserva 75 cl",
      origen: "manual", litros: 0.75, litros_producto: 0.75, coste_factura: 15.2, coste_efectivo: 15.2, botellas_pagadas: 60, botellas_sin_cargo: 0,
      importe_pagado: 912, facturas: 1, factura: factura(12, "Distribuciones Guillén"), multiplicador: 2.54, margen: 23.44, margen_pct: 60.7, estado: "bien", avisos: [] },
    { id: "seque", nombre: "El Sequé 2022", categoria: "TINTOS — ALICANTE", precio: 37, venta: 33.6364, producto_id: 1, producto: "El Sequé 75 cl",
      origen: "estimado", litros: 0.75, litros_producto: 0.75, coste_factura: 19.3, coste_efectivo: 16.0833, botellas_pagadas: 30, botellas_sin_cargo: 6,
      importe_pagado: 579, facturas: 1, factura: factura(11, "VINOS DEL MUNDO"), multiplicador: 2.09, margen: 17.55, margen_pct: 52.2, estado: "bajo",
      avisos: [], precio_sugerido: 41, copeo: true, precio_copa: 7,
      copa: { venta: 6.3636, coste: 2.6806, multiplicador: 2.37, margen: 3.68, margen_pct: 57.9 } },
    { id: "nacar", nombre: "Juan Gil Nácar", categoria: "TINTOS — JUMILLA", precio: 25, venta: 22.7273, producto_id: 3, producto: "Juan Gil Nácar 75 cl",
      litros: 0.75, coste_factura: 64.8, coste_efectivo: 64.8, botellas_sin_cargo: 0, factura: factura(13, "JULIÁN FERNÁNDEZ", { unidad_compra: "caja", medida: null }),
      multiplicador: 0.35, margen: -42.07, margen_pct: -185.1, estado: "dudoso", avisos: ["coste_mayor_que_carta"] },
    { id: "nido", nombre: "El Nido 2022", categoria: "TINTOS — JUMILLA", precio: 240, venta: 218.18, estado: "sin_enlazar", avisos: [],
      mejor_candidato: { id: 77, nombre: "El Nido 75 cl", similitud: 1 } },
  ],
});

const onFactura = vi.fn();
const pintar = (puedeEditar = true) => render(<CosteCartaVinos puedeEditar={puedeEditar} onFactura={onFactura} />);
const filas = () => screen.getAllByTestId("fila-vino");
const nombres = () => filas().map((f) => f.querySelector("p")?.textContent);

beforeEach(() => {
  estado = { isLoading: false, isError: false, isFetching: false, data: DATOS, error: null, refetch: vi.fn() };
  mesesPedidos = [];
  candidatos = [];
  guardarVino.mutate.mockReset();
  onFactura.mockReset();
});

describe("CosteCartaVinos", () => {
  it("resume con coste, mediana, por debajo y dudosos", () => {
    pintar();
    const r = within(screen.getByTestId("coste-vinos-resumen"));
    expect(r.getByText("2 de 4")).toBeInTheDocument();
    expect(r.getByText(/Sin coste 1: 1 sin enlazar \(1 con propuesta\), 0 sin compra/)).toBeInTheDocument();
    expect(r.getByText("2,31×")).toBeInTheDocument();
    expect(r.getByText("Por debajo de ×2,3")).toBeInTheDocument();
    expect(r.getByText(/subir de media 4,00 € la botella/)).toBeInTheDocument();
    expect(r.getByText(/1 dudosos · 0 de otro formato/)).toBeInTheDocument();
  });

  it("una fila por vino, de peor a mejor multiplicador, con los que no tienen al final", () => {
    pintar();
    expect(nombres()).toEqual(["Juan Gil Nácar", "El Sequé 2022", "Viña Ardanza", "El Nido 2022"]);
  });

  it("enseña el coste efectivo y el de la factura, con las botellas sin cargo", () => {
    pintar();
    const seque = within(filas()[1]);
    expect(seque.getByTestId("coste-efectivo")).toHaveTextContent("16,08 €");
    expect(seque.getByTestId("coste-factura")).toHaveTextContent("Factura 19,30 € · 30 pagadas + 6 sin cargo → 579,00 € ÷ 36");
    expect(seque.getByText("2,09×")).toBeInTheDocument();
    expect(seque.getByText("Para llegar a ×2,3: 41,00 € en carta.")).toBeInTheDocument();
    expect(seque.getByText(/33,64 € sin IVA/)).toBeInTheDocument();
    expect(seque.getByText("VINOS DEL MUNDO")).toBeInTheDocument();
    const ardanza = within(filas()[2]);
    expect(ardanza.getByTestId("coste-factura")).toHaveTextContent("Igual que en la factura");
  });

  it("margen por copa con el supuesto de 6 copas a la vista", () => {
    pintar();
    expect(within(filas()[1]).getByTestId("margen-copa")).toHaveTextContent("Copa: 3,68 € (2,37×)");
    expect(screen.getByTestId("coste-vinos-supuestos")).toHaveTextContent("se suponen 6 copas por botella");
  });

  it("marca el dato dudoso y explica por qué", () => {
    pintar();
    const nacar = within(filas()[0]);
    expect(nacar.getByTestId("estado-vino")).toHaveTextContent("Dato dudoso");
    expect(nacar.getByText(/el coste es mayor que el precio de carta/)).toBeInTheDocument();
  });

  it("filtra por estado, categoría y texto, y ordena", () => {
    pintar();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "bajo" } });
    expect(nombres()).toEqual(["El Sequé 2022"]);
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "todos" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "TINTOS — JUMILLA" } });
    expect(nombres()).toEqual(["Juan Gil Nácar", "El Nido 2022"]);
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("Buscar vino o proveedor"), { target: { value: "guillen" } });
    expect(nombres()).toEqual(["Viña Ardanza"]);
    fireEvent.change(screen.getByPlaceholderText("Buscar vino o proveedor"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Orden"), { target: { value: "mejor" } });
    expect(nombres()[0]).toBe("Viña Ardanza");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "sin_compra" } });
    expect(screen.getByText("Ningún vino con esos filtros.")).toBeInTheDocument();
  });

  it("las cifras del resumen filtran al tocarlas", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Por debajo de ×2,3/ }));
    expect(nombres()).toEqual(["El Sequé 2022"]);
    fireEvent.click(screen.getByRole("button", { name: /Por debajo de ×2,3/ }));
    expect(filas()).toHaveLength(4);
  });

  it("pide el coste de los últimos meses", () => {
    pintar();
    expect(mesesPedidos.at(-1)).toBeNull();
    fireEvent.change(screen.getByLabelText("De qué facturas sale el coste efectivo"), { target: { value: "12" } });
    expect(mesesPedidos.at(-1)).toBe(12);
  });

  it("abre la última factura", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir la última factura de El Sequé 2022" }));
    expect(onFactura).toHaveBeenCalledWith(expect.objectContaining({ id: 11, proveedor: "VINOS DEL MUNDO" }));
  });

  it("propone candidatos para un vino sin enlazar y guarda el elegido", () => {
    candidatos = [
      { id: 77, nombre: "El Nido 75 cl", categoria: "Vinos", similitud: 1, lineas: 2, ultima: "2026-08-26", litros: 0.75, formato_distinto: false,
        coste_botella: 98.5, factura: factura(20, "JULIÁN FERNÁNDEZ"), dudoso: false, enlazado_a: null },
      { id: 78, nombre: "El Nido Magnum", categoria: "Vinos", similitud: 0.8, lineas: 1, litros: 1.5, formato_distinto: true, coste_botella: 400,
        factura: factura(21, "JULIÁN FERNÁNDEZ"), dudoso: true, enlazado_a: ["El Nido (Magnum)"] },
    ];
    pintar();
    expect(within(filas()[3]).getByText("Sin enlazar. ¿Es «El Nido 75 cl»?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enlazar El Nido 2022" }));
    const dialogo = within(screen.getByRole("dialog"));
    expect(dialogo.getByText("Ahora no está enlazado con ningún producto.")).toBeInTheDocument();
    const opciones = dialogo.getAllByTestId("candidato-vino");
    expect(opciones).toHaveLength(2);
    expect(opciones[0]).toHaveTextContent("Parecido 100 %");
    expect(opciones[0]).toHaveTextContent("JULIÁN FERNÁNDEZ · 98,50 € la botella");
    expect(opciones[1]).toHaveTextContent("Otro formato: Magnum (1,5 l)");
    expect(opciones[1]).toHaveTextContent("Dato dudoso");
    expect(opciones[1]).toHaveTextContent("Ya enlazado a El Nido (Magnum)");
    fireEvent.click(within(opciones[0]).getByRole("button", { name: "Enlazar" }));
    expect(guardarVino.mutate).toHaveBeenCalledWith({ vinoId: "nido", productoId: 77 }, expect.anything());
  });

  it("deja quitar el enlace existente", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar el enlace de Viña Ardanza" }));
    const dialogo = within(screen.getByRole("dialog"));
    expect(dialogo.getByText("Viña Ardanza Reserva 75 cl")).toBeInTheDocument();
    fireEvent.click(dialogo.getByRole("button", { name: "Quitar enlace" }));
    expect(guardarVino.mutate).toHaveBeenCalledWith({ vinoId: "ardanza", productoId: null }, expect.anything());
  });

  it("sin permiso de edición no deja enlazar ni quitar", () => {
    candidatos = [{ id: 77, nombre: "El Nido 75 cl", similitud: 1, lineas: 2, factura: factura(20, "JULIÁN FERNÁNDEZ") }];
    pintar(false);
    fireEvent.click(screen.getByRole("button", { name: "Enlazar El Nido 2022" }));
    const dialogo = within(screen.getByRole("dialog"));
    expect(dialogo.getByText(/hace falta el permiso «Editar» en Facturas/)).toBeInTheDocument();
    expect(dialogo.queryByRole("button", { name: "Enlazar" })).not.toBeInTheDocument();
    expect(dialogo.queryByPlaceholderText("Buscar otro producto del catálogo")).not.toBeInTheDocument();
  });

  it("enseña el error con «Reintentar»", () => {
    estado = { ...estado, isError: true, data: undefined, error: new Error("Falta aplicar en Supabase la migración 20261207150000_coste_carta_vinos.") };
    pintar();
    expect(screen.getByRole("alert")).toHaveTextContent("Falta aplicar en Supabase la migración");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(estado.refetch).toHaveBeenCalled();
  });
});
