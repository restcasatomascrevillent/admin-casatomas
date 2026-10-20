/**
 * Compras › ficha de documento › albaranes de una factura y cotejo
 * (migración 20261010110000_albaranes_factura_cotejo). RPC simuladas con los
 * números del simulacro con datos reales de Luga ML/101511.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Factura } from "@/hooks/useFacturas";

const base = vi.hoisted(() => {
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) =>
    rpcs[fn] ? { data: rpcs[fn](args), error: null } : { data: null, error: { code: "PGRST202", message: `Could not find the function ${fn}` } },
  );
  return { rpc, rpcs, puedeEditar: true };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: base.rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: base.puedeEditar, loading: false }),
}));

import { AlbaranesDeFactura } from "../compras/AlbaranesDeFactura";
import { FacturaDelAlbaran } from "../compras/FacturaDelAlbaran";
import {
  leerCotejo,
  separarProductos,
  textoDiferencia,
  tonoDiferencia,
  type ProductoCotejo,
} from "@/lib/facturas/cotejo";

const doc = (id: number, tipo: "factura" | "albaran", numero: string, extra: Partial<Factura> = {}): Factura => ({
  id,
  tipo,
  numero_documento: numero,
  proveedor: "LUGA SABORES S.L.",
  proveedor_normalizado: "luga sabores",
  cif: null,
  fecha: "2025-12-31",
  subtotal: 3787.53,
  iva: null,
  total: 4162.54,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  drive_url: null,
  archivo_path: null,
  facturado_en_id: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: false,
  ...extra,
});

const lado = (cantidad: number, precio: number) => ({ cantidad, precio, importe: +(cantidad * precio).toFixed(2), lineas: 1 });
const ok = (i: number) => ({
  clave: `p${1000 + i}|ud`,
  producto: `Producto que cuadra ${i}`,
  producto_id: 1000 + i,
  unidad: "ud",
  en_albaranes: lado(2, 10),
  en_factura: lado(2, 10),
  diferencia_cantidad: 0,
  diferencia_importe: 0,
  diferencia_precio_pct: 0,
  estado: "ok",
});

const COTEJO_LUGA = {
  modo: "factura",
  factura: { id: 54, numero: "ML/101511" },
  albaranes: [
    { id: 310, numero: "775.630", fecha: "2025-12-05", total: null, base: 478.17, lineas: 12, citado_en_factura: true, origen: "auto" },
    { id: 311, numero: "778.342", fecha: "2025-12-12", total: null, base: 546.45, lineas: 13, citado_en_factura: true, origen: "auto" },
    { id: 312, numero: "ZZ-9", fecha: "2025-12-22", total: null, base: 248.03, lineas: 7, citado_en_factura: false, origen: "manual" },
  ],
  albaranes_no_subidos: [
    { numero: "781.316", lineas: 10, importe: 468.9 },
    { numero: "V/ 781.528", lineas: 1, importe: 1547.26 },
  ],
  albaranes_sin_vincular: [],
  resumen: {
    albaranes: 3,
    suma_albaranes: "1272.65",
    total_factura_base: 3787.53,
    diferencia: 2514.88,
    base_citada_sin_albaran: 2549.13,
    diferencia_sin_explicar: -34.25,
    productos_ok: 16,
    productos_con_diferencias: 3,
  },
  productos: [
    ...Array.from({ length: 16 }, (_, i) => ok(i + 1)),
    {
      clave: "p105|kg", producto: "Gambón zarado XXL Gegarri", producto_id: 105, unidad: "kg",
      en_albaranes: lado(2, 18.9), en_factura: lado(2, 19.9),
      diferencia_cantidad: 0, diferencia_importe: 2, diferencia_precio_pct: 5.29, estado: "precio_distinto",
    },
    {
      clave: "p14|ud", producto: "Mayonesa Hellmann's cubo 5 L", producto_id: 14, unidad: "ud",
      en_albaranes: lado(10, 17.25), en_factura: lado(9, 17.25),
      diferencia_cantidad: -1, diferencia_importe: -17.25, diferencia_precio_pct: 0, estado: "cantidad_distinta",
    },
    {
      clave: "nACEITE|ud", producto: "ACEITE GIRASOL (garrafa 5L)", producto_id: null, unidad: "ud",
      en_albaranes: lado(2, 9.5), en_factura: null,
      diferencia_cantidad: -2, diferencia_importe: -19, diferencia_precio_pct: null, estado: "solo_albaran",
    },
  ],
};

function montar(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  for (const k of Object.keys(base.rpcs)) delete base.rpcs[k];
  base.rpc.mockClear();
  base.puedeEditar = true;
});

describe("lib/facturas/cotejo", () => {
  it("lee el jsonb sin convertir NULL en 0 y rechaza un {error}", () => {
    const c = leerCotejo(COTEJO_LUGA)!;
    expect(c.resumen.suma_albaranes).toBe(1272.65); // venía como texto
    expect(c.albaranes[2].origen).toBe("manual");
    expect(c.productos.find((p) => p.estado === "solo_albaran")!.en_factura).toBeNull();
    expect(c.productos.find((p) => p.estado === "solo_albaran")!.diferencia_precio_pct).toBeNull();
    expect(leerCotejo({ error: "No existe esa factura" })).toBeNull();
    expect(leerCotejo(null)).toBeNull();
  });

  it("separa discrepancias (cantidad, luego precio…, lo más caro arriba) de lo que cuadra", () => {
    const { discrepancias, ok: cuadran } = separarProductos(leerCotejo(COTEJO_LUGA)!.productos);
    expect(discrepancias.map((p) => p.estado)).toEqual(["cantidad_distinta", "precio_distinto", "solo_albaran"]);
    expect(cuadran).toHaveLength(16);
  });

  it("colorea la diferencia: redondeo verde, hasta 5 % ámbar, más rojo", () => {
    expect(tonoDiferencia(0.3, 10)).toBe("ok");
    expect(tonoDiferencia(-30, 3787.53)).toBe("ok"); // < 1 %
    expect(tonoDiferencia(-150, 3787.53)).toBe("aviso");
    expect(tonoDiferencia(2514.88, 3787.53)).toBe("alerta");
    expect(tonoDiferencia(null, 100)).toBe("aviso");
  });

  it("explica cada diferencia en corto", () => {
    const [cant, precio, solo] = separarProductos(leerCotejo(COTEJO_LUGA)!.productos).discrepancias as ProductoCotejo[];
    expect(textoDiferencia(cant)).toBe("−1 ud en factura");
    expect(textoDiferencia(precio)).toBe("+5,29 % precio");
    expect(textoDiferencia(solo)).toBe("Solo en albarán");
  });
});

describe("Ficha de factura › Albaranes y cotejo", () => {
  it("lista los albaranes (citado / no citado), avisa de los no subidos y coteja con las discrepancias primero", async () => {
    base.rpcs.cotejo_factura_albaranes = () => COTEJO_LUGA;
    const abrir = vi.fn();
    montar(<AlbaranesDeFactura factura={doc(54, "factura", "ML/101511")} albaranesCargados={[]} onAbrirDocumento={abrir} />);

    const seccion = await screen.findByRole("region", { name: "Albaranes de la factura" });
    expect(await within(seccion).findByText("Albaranes (3)")).toBeInTheDocument();
    expect(base.rpc).toHaveBeenCalledWith("cotejo_factura_albaranes", { p_factura_id: 54, p_albaran_id: null });
    expect(within(seccion).getAllByText("Citado")).toHaveLength(2);
    expect(within(seccion).getByText("No citado")).toBeInTheDocument();

    const aviso = within(seccion).getAllByRole("note")[0];
    expect(aviso).toHaveTextContent("La factura cita 2 albaranes que no están subidos");
    expect(aviso).toHaveTextContent("781.316, V/ 781.528");

    const cotejo = within(seccion).getByRole("region", { name: "Cotejo de albaranes y factura" });
    // Diferencia total sin color (la explican los no subidos); lo sin explicar, en verde (< 1 %).
    expect(within(cotejo).getByText(/son de albaranes citados sin subir/)).toBeInTheDocument();
    expect(cotejo.querySelector('[data-tono="ok"]')).toHaveTextContent("-34,25");

    const filas = within(cotejo).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(3); // las 16 que cuadran, plegadas
    expect(filas[0]).toHaveTextContent("Mayonesa");
    expect(filas[0]).toHaveTextContent("−1 ud en factura");
    expect(filas[1]).toHaveTextContent("+5,29 % precio");
    expect(filas[2]).toHaveTextContent("Solo en albarán");

    const plegadas = within(cotejo).getByRole("button", { name: /16 líneas cuadran/ });
    expect(plegadas).toHaveAttribute("aria-expanded", "false");
    expect(plegadas.className).toContain("min-h-11");
    fireEvent.click(plegadas);
    expect(within(cotejo).getAllByRole("row")).toHaveLength(1 + 3 + 16);
  });

  it("tocar un albarán abre su ficha (?doc=) y la X quita el vínculo", async () => {
    base.rpcs.cotejo_factura_albaranes = () => COTEJO_LUGA;
    base.rpcs.desvincular_albaran = (a) => ({ ok: true, albaran_id: a.p_albaran_id });
    const abrir = vi.fn();
    montar(<AlbaranesDeFactura factura={doc(54, "factura", "ML/101511")} albaranesCargados={[]} onAbrirDocumento={abrir} />);

    const enlace = (await screen.findByText("Albarán 778.342")).closest("a")!;
    expect(enlace).toHaveAttribute("href", "?tab=compras&modo=documentos&doc=311");
    fireEvent.click(enlace);
    expect(abrir).toHaveBeenCalledWith(311);

    const quitar = screen.getByRole("button", { name: "Quitar el albarán ZZ-9 de esta factura" });
    expect(quitar.className).toContain("h-11");
    fireEvent.click(quitar);
    await waitFor(() => expect(base.rpc).toHaveBeenCalledWith("desvincular_albaran", { p_albaran_id: 312 }));
  });

  it("«Añadir albarán» propone candidatos y vincula (forzando si es de otro proveedor)", async () => {
    base.rpcs.cotejo_factura_albaranes = () => ({ ...COTEJO_LUGA, albaranes: [], albaranes_no_subidos: [], productos: [] });
    base.rpcs.albaranes_candidatos = (a) =>
      a.p_texto
        ? [{ id: 77, numero_documento: "B-1", fecha: "2025-12-20", proveedor: "OTRO, S.L.", total: null, base: 10, lineas: 1, citado_en_factura: false, mismo_proveedor: false, dias: -11 }]
        : [{ id: 40, numero_documento: "781.316", fecha: "2025-12-18", proveedor: "LUGA SABORES S.L.", total: null, base: "468.90", lineas: 10, citado_en_factura: true, mismo_proveedor: true, dias: -13 }];
    base.rpcs.vincular_albaran_factura = () => ({ ok: true });
    montar(<AlbaranesDeFactura factura={doc(54, "factura", "ML/101511")} albaranesCargados={[]} onAbrirDocumento={vi.fn()} />);

    expect(await screen.findByText("Ningún albarán vinculado a esta factura.")).toBeInTheDocument();
    const anadir = screen.getByRole("button", { name: "Añadir albarán" });
    expect(anadir.className).toContain("h-11");
    fireEvent.click(anadir);
    const lista = await screen.findByRole("list", { name: "Albaranes candidatos" });
    const cand = await within(lista).findByRole("listitem");
    expect(cand).toHaveTextContent("Albarán 781.316");
    expect(cand).toHaveTextContent("Citado en la factura");
    expect(cand.className).toContain("min-h-11");
    fireEvent.click(cand);
    await waitFor(() =>
      expect(base.rpc).toHaveBeenCalledWith("vincular_albaran_factura", { p_albaran_id: 40, p_factura_id: 54, p_forzar: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Añadir albarán" }));
    fireEvent.change(await screen.findByRole("searchbox", { name: /Buscar albarán/ }), { target: { value: "B-1" } });
    const otro = await screen.findByText("Otro proveedor: OTRO, S.L.");
    fireEvent.click(otro.closest("button")!);
    await waitFor(() =>
      expect(base.rpc).toHaveBeenCalledWith("vincular_albaran_factura", { p_albaran_id: 77, p_factura_id: 54, p_forzar: true }),
    );
  });

  it("sin la migración se queda en la lista de siempre, sin editar", async () => {
    montar(
      <AlbaranesDeFactura
        factura={doc(54, "factura", "ML/101511")}
        albaranesCargados={[doc(9, "albaran", "A-9", { facturado_en_id: 54, fecha: "2025-12-01", subtotal: 12 })]}
        onAbrirDocumento={vi.fn()}
      />,
    );
    expect(await screen.findByText("Albarán A-9")).toBeInTheDocument();
    await waitFor(() => expect(base.rpc).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Añadir albarán" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quitar el albarán/ })).not.toBeInTheDocument();
  });

  it("sin permiso de edición no ofrece añadir ni quitar", async () => {
    base.puedeEditar = false;
    base.rpcs.cotejo_factura_albaranes = () => COTEJO_LUGA;
    montar(<AlbaranesDeFactura factura={doc(54, "factura", "ML/101511")} albaranesCargados={[]} onAbrirDocumento={vi.fn()} />);
    expect(await screen.findByText("Albaranes (3)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir albarán" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quitar el albarán/ })).not.toBeInTheDocument();
  });
});

describe("Ficha de albarán › factura que lo recoge", () => {
  it("facturado: «Facturado en … · Ver» y mini-cotejo de sus líneas", async () => {
    base.rpcs.cotejo_factura_albaranes = (a) => ({
      ...COTEJO_LUGA,
      modo: "por_referencia",
      albaranes: [COTEJO_LUGA.albaranes[1]],
      albaranes_no_subidos: [],
      resumen: { ...COTEJO_LUGA.resumen, albaranes: 1, suma_albaranes: 546.45, total_factura_base: 529.2, diferencia: -17.25, base_citada_sin_albaran: 0, diferencia_sin_explicar: -17.25 },
      productos: COTEJO_LUGA.productos.filter((p) => p.producto_id === 14 || p.producto_id === 1001),
      _args: a,
    });
    const abrir = vi.fn();
    montar(
      <FacturaDelAlbaran
        albaran={doc(311, "albaran", "778.342", { facturado_en_id: 54 })}
        factura={doc(54, "factura", "ML/101511")}
        onAbrirDocumento={abrir}
      />,
    );
    expect(await screen.findByText("ML/101511")).toBeInTheDocument();
    const ver = screen.getByRole("link", { name: "Ver la factura ML/101511" });
    fireEvent.click(ver);
    expect(abrir).toHaveBeenCalledWith(54);
    expect(base.rpc).toHaveBeenCalledWith("cotejo_factura_albaranes", { p_factura_id: 54, p_albaran_id: 311 });

    const mini = await screen.findByRole("region", { name: "Cotejo del albarán con la factura" });
    expect(mini).toHaveTextContent("Este albarán");
    expect(mini.querySelector('[data-tono="aviso"]')).toHaveTextContent("-17,25"); // 3,2 % del albarán
    expect(within(mini).getAllByRole("row")).toHaveLength(2); // cabecera + la mayonesa
    expect(within(mini).getByRole("button", { name: /1 línea cuadra/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar el vínculo con la factura ML/101511" }).className).toContain("h-11");
  });

  it("sin factura: «Asociar a factura» con las del mismo proveedor", async () => {
    base.rpcs.facturas_candidatas = () => [
      { id: 54, numero_documento: "ML/101511", fecha: "2025-12-31", total: 4162.54, base: 3787.53, lineas: 54, cita_albaran: true, dias: 9 },
    ];
    base.rpcs.vincular_albaran_factura = () => ({ ok: true });
    montar(<FacturaDelAlbaran albaran={doc(40, "albaran", "781.316")} factura={null} onAbrirDocumento={vi.fn()} />);
    expect(screen.getByText("Sin factura")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Asociar a factura" }));
    const f = await screen.findByText("Factura ML/101511");
    expect(screen.getByText("Cita este albarán")).toBeInTheDocument();
    fireEvent.click(f.closest("button")!);
    await waitFor(() =>
      expect(base.rpc).toHaveBeenCalledWith("vincular_albaran_factura", { p_albaran_id: 40, p_factura_id: 54, p_forzar: false }),
    );
  });
});
