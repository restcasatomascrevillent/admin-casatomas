// Facturas › Análisis › «Subidas y proveedor»: la pantalla pinta lo que dan las
// dos RPC (totales solo con lo fiable, «Revisar» aparte y sin sumar) y los
// filtros vuelven a pedirlas con sus parámetros.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const doble = vi.hoisted(() => {
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (!rpcs[fn]) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
    return { data: rpcs[fn](args), error: null };
  });
  const supabase = {
    rpc: (...a: unknown[]) => rpc(...(a as [string, Record<string, unknown>])),
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    functions: { invoke: vi.fn() },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  return { rpcs, rpc, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));

import { InformeSubidasProveedor } from "../analisis/InformeSubidasProveedor";

const doc = (id: number, numero: string) => ({ id, fecha: "2026-11-03", proveedor: "Casimiro Pérez", proveedor_id: 7, numero, tipo: "factura", local: "casa_tomas", total: 100, drive_url: null, archivo_path: null });

const subidas = (meses: unknown) => ({
  hoy: "2026-11-16",
  meses,
  totales: {
    impacto_fiable: 2522,
    n_fiable: 2,
    por_confianza: { alta: { n: 1, impacto: 1530 }, media: { n: 1, impacto: 992 }, baja: { n: 1, impacto: 52920 } },
    bajadas_fiable: { n: 3, importe: -640 },
    sin_referencia: 12,
    comparados: 40,
  },
  total_filas: 3,
  filas: [
    {
      id: "10:7:ud", producto_id: 10, producto: "Ostra", proveedor_id: 7, proveedor: "Casimiro Pérez, S.L.", unidad: "ud", precio: 2.8, fecha: "2026-11-03",
      precio_ref: 2.05, fecha_ref: "2025-10-20", variacion_pct: 36.6, hace_3: { precio: 2.8, fecha: "2026-08-01", variacion_pct: 0 }, hace_6: null,
      hace_12: { precio: 2.05, fecha: "2025-10-20", variacion_pct: 36.6 }, compras_12m: 49, cantidad_12m: 2040, impacto_anual: 1530, confianza: "alta",
      motivo: "Mismo proveedor y misma unidad; 49 compras en 12 meses", doc: doc(1, "F-NUEVA"), doc_ref: doc(2, "F-VIEJA"),
    },
    { id: "11:8:docena", producto_id: 11, producto: "Huevos M", proveedor_id: 8, proveedor: "Aviques", unidad: "docena", precio: 2.3, precio_ref: 1.9, variacion_pct: 21.1, cantidad_12m: 2480, impacto_anual: 992, confianza: "media", motivo: "Pocas compras: 3 en 12 meses" },
    { id: "12:9:ud", producto_id: 12, producto: "Pan de cristal", proveedor_id: 9, proveedor: "Horno", unidad: "ud", precio: 29.4, precio_ref: 1.4, variacion_pct: 2000, cantidad_12m: 1890, impacto_anual: 52920, confianza: "baja", motivo: "Diferencia de más del 60 %: seguramente es otro formato o un precio mal leído" },
  ],
  proveedores: [{ id: 7, nombre: "Casimiro Pérez, S.L.", n: 1 }, { id: 8, nombre: "Aviques", n: 1 }],
  familias: [{ id: 2, nombre: "Pescado y marisco", n: 1 }],
  excluidos: { n_genericos: 1, gasto_genericos: 33791, genericos: [{ producto_id: 99, producto: "Macruros", motivo: "Cajón de la lonja: la nota de venta no dice la especie", gasto_12m: 33791, proveedores: 30 }] },
});

const barato = () => ({
  totales: { ahorro_fiable: 2502, n_fiable: 1, por_confianza: { alta: { n: 0, ahorro: 0 }, media: { n: 1, ahorro: 2502 }, baja: { n: 0, ahorro: 0 } }, productos_varios_proveedores: 213 },
  total_filas: 1,
  filas: [
    {
      id: "1:2:kg", producto_id: 1, producto: "Quisquilla", unidad: "kg", proveedor_id: 2, proveedor: "Hermanos Narejos S.L.", precio: 72, fecha: "2026-11-10", compras_12m: 30,
      cantidad_12m: 250.2, es_habitual: true, proveedor_barato_id: 3, proveedor_barato: "Once de Enero", precio_barato: 62, fecha_barato: "2026-07-01", compras_barato_12m: 5,
      diferencia_pct: 13.9, ahorro_anual: 2502, confianza: "media", motivo: "Pescado, marisco, fruta o verdura: el tamaño y la calidad pueden no ser iguales", doc: doc(5, "N-1"), doc_barato: doc(6, "O-1"),
    },
  ],
  proveedores: [{ id: 2, nombre: "Hermanos Narejos S.L.", n: 1 }, { id: 3, nombre: "Once de Enero", n: 1 }],
  familias: [{ id: 2, nombre: "Pescado y marisco", n: 1 }],
  excluidos: { n_genericos: 0, gasto_genericos: 0, genericos: [] },
});

function pintar(local: "casa_tomas" | "touza" | null = null) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <InformeSubidasProveedor local={local} />
    </QueryClientProvider>,
  );
}

describe("Informe «Subidas y proveedor»", () => {
  beforeEach(() => {
    doble.rpc.mockReset();
    doble.rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      if (!doble.rpcs[fn]) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
      return { data: doble.rpcs[fn](args), error: null };
    });
    doble.rpcs.informe_subidas_precio = (a) => subidas(a.p_meses);
    doble.rpcs.informe_proveedor_mas_barato = () => barato();
  });

  it("arriba, los totales solo con lo fiable; lo de «Revisar» se ve pero no suma", async () => {
    pintar();
    const total = await screen.findByTestId("total-subidas");
    await waitFor(() => expect(total).toHaveTextContent("+2.522 € al año"));
    expect(total).toHaveTextContent("1 fiables (+1.530 €) y 1 probables (+992 €) · 1 por revisar que no se suman");
    expect(screen.getByTestId("total-ahorro")).toHaveTextContent("2.502 € al año");

    const lista = screen.getByRole("list", { name: /Subidas de precio/ });
    const filas = within(lista).getAllByRole("listitem");
    expect(filas.map((f) => f.getAttribute("data-confianza"))).toEqual(["alta", "media", "baja"]);
    expect(filas[0]).toHaveTextContent("Ostra");
    expect(filas[0]).toHaveTextContent("Fiable");
    expect(filas[0]).toHaveTextContent("2,05 → 2,80 €/ud (+36,6 %)");
    expect(filas[0]).toHaveTextContent("Hace 3 meses: 2,80 €");
    expect(filas[0]).toHaveTextContent("6: sin compra");
    expect(filas[0]).toHaveTextContent("2.040 ud en 12 meses");
    expect(filas[2]).toHaveTextContent("Revisar");
    expect(filas[2]).toHaveTextContent("Por qué hay que revisarlo: Diferencia de más del 60 %");
    // El botón se pinta en dos sitios (bajo la cifra desde 640 px, debajo en el móvil): en jsdom están los dos.
    expect(within(filas[0]).getAllByRole("button", { name: /Comparar facturas/ }).length).toBeGreaterThan(0);
    expect(within(filas[1]).queryByRole("button")).toBeNull();
  });

  it("el bloque de proveedor más barato dice a quién, a cuánto y por qué esa confianza", async () => {
    pintar();
    // Una lista a la vez: el total del ahorro la elige.
    await screen.findByText("Ostra");
    expect(screen.queryByRole("list", { name: /más baratos en otro proveedor/ })).toBeNull();
    fireEvent.click(within(screen.getByTestId("total-ahorro")).getByRole("button", { pressed: false }));
    expect(within(screen.getByTestId("total-ahorro")).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("list", { name: /Subidas de precio/ })).toBeNull();
    // El periodo solo afecta a las subidas: con el ahorro elegido no se enseña.
    expect(screen.queryByRole("button", { name: "Hace 3 meses" })).toBeNull();
    const lista = await screen.findByRole("list", { name: /más baratos en otro proveedor/ });
    const fila = within(lista).getByRole("listitem");
    expect(fila).toHaveTextContent("Quisquilla");
    expect(fila).toHaveTextContent("Hermanos Narejos: 72,00 €/kg · Once de Enero: 62,00 €/kg (−13,9 %)");
    expect(fila).toHaveTextContent("2.502 €");
    expect(fila).toHaveTextContent("Probable");
    expect(fila).toHaveTextContent("Confianza: Pescado, marisco, fruta o verdura");
    expect(within(fila).getAllByRole("button", { name: /Ver las dos facturas/ }).length).toBeGreaterThan(0);
  });

  it("enseña qué productos genéricos se han dejado fuera y por qué", async () => {
    pintar();
    const fuera = await screen.findByTestId("informe-excluidos");
    expect(fuera).toHaveTextContent("No entran 1 productos genéricos (33.791 € en 12 meses)");
    expect(fuera).toHaveTextContent("Macruros");
    expect(fuera).toHaveTextContent("Cajón de la lonja");
  });

  it("los filtros vuelven a pedir las dos RPC; el periodo, solo la de subidas", async () => {
    pintar("touza");
    await screen.findByText("Ostra");
    expect(doble.rpc).toHaveBeenCalledWith("informe_subidas_precio", { p_meses: 12, p_proveedor_id: null, p_familia_id: null, p_local: "touza", p_limite: 100, p_desde: 0 });
    expect(doble.rpc).toHaveBeenCalledWith("informe_proveedor_mas_barato", { p_proveedor_id: null, p_familia_id: null, p_local: "touza", p_limite: 100, p_desde: 0 });

    // Las opciones juntan los proveedores de los dos bloques.
    const proveedor = screen.getByLabelText("Proveedor") as HTMLSelectElement;
    await waitFor(() => expect(within(proveedor).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos", "Aviques", "Casimiro Pérez, S.L.", "Hermanos Narejos S.L.", "Once de Enero"]));
    fireEvent.change(proveedor, { target: { value: "7" } });
    await waitFor(() => expect(doble.rpc).toHaveBeenCalledWith("informe_subidas_precio", expect.objectContaining({ p_proveedor_id: 7 })));
    expect(doble.rpc).toHaveBeenCalledWith("informe_proveedor_mas_barato", expect.objectContaining({ p_proveedor_id: 7 }));
    // Con el filtro puesto, las opciones siguen siendo todas.
    expect(within(proveedor).getAllByRole("option")).toHaveLength(5);

    const antes = doble.rpc.mock.calls.filter((c) => c[0] === "informe_proveedor_mas_barato").length;
    fireEvent.click(screen.getByRole("button", { name: "Hace 3 meses" }));
    await waitFor(() => expect(doble.rpc).toHaveBeenCalledWith("informe_subidas_precio", expect.objectContaining({ p_meses: 3, p_proveedor_id: 7 })));
    expect(doble.rpc.mock.calls.filter((c) => c[0] === "informe_proveedor_mas_barato")).toHaveLength(antes);
  });

  it("sin la migración aplicada lo dice, sin romperse", async () => {
    delete doble.rpcs.informe_subidas_precio;
    delete doble.rpcs.informe_proveedor_mas_barato;
    pintar();
    expect(await screen.findByText(/necesita la migración «informe_subidas_proveedor»/)).toBeInTheDocument();
    expect(screen.getByTestId("total-subidas")).toHaveTextContent("Falta la migración del informe");
    expect(screen.getByTestId("total-ahorro")).toHaveTextContent("Falta la migración del informe");
    expect(screen.queryByText("Calculando…")).toBeNull();
  });

  it("con error, los totales no se quedan en «Calculando…»: lo dicen en castellano y dejan reintentar", async () => {
    let falla = true;
    doble.rpcs.informe_subidas_precio = (a) => {
      if (falla) throw new Error("se usa la respuesta de error");
      return subidas(a.p_meses);
    };
    doble.rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn === "informe_subidas_precio" && falla) return { data: null, error: { code: "XX000", message: "internal error" } };
      if (fn === "informe_proveedor_mas_barato") return { data: null, error: { code: "42501", message: "permission denied for function informe_proveedor_mas_barato" } };
      return { data: doble.rpcs[fn](args), error: null };
    });
    pintar();
    const total = screen.getByTestId("total-subidas");
    // El hook reintenta una vez (retry: 1) antes de dar el error.
    await waitFor(() => expect(total).toHaveTextContent("No se ha podido calcular"), { timeout: 5000 });
    expect(total).toHaveTextContent("el servidor ha dado un error");
    expect(total).not.toHaveTextContent("Calculando");
    expect(total).not.toHaveTextContent("internal error");
    await waitFor(() => expect(screen.getByTestId("total-ahorro")).toHaveTextContent("No tienes permiso para ver los informes de Facturas."), { timeout: 5000 });
    expect(screen.getByTestId("total-ahorro")).not.toHaveTextContent("permission denied");
    // La lista también lo dice, con su botón.
    const caja = screen.getByTestId("caja-informe-subidas");
    expect(within(caja).getByRole("status")).toHaveTextContent("el servidor ha dado un error");

    falla = false;
    fireEvent.click(within(total).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(total).toHaveTextContent("+2.522 € al año"));
    expect(within(total).queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(await screen.findByText("Ostra")).toBeInTheDocument();
    doble.rpc.mockReset();
  }, 15000);

  it("mientras calcula, «Calculando…» en los totales y en la lista", async () => {
    doble.rpc.mockImplementation(() => new Promise(() => {}));
    pintar();
    expect(screen.getByTestId("total-subidas")).toHaveTextContent("Calculando…");
    expect(screen.getByTestId("total-ahorro")).toHaveTextContent("Calculando…");
    expect(within(screen.getByTestId("caja-informe-subidas")).getByRole("status")).toHaveTextContent(/Calculando… Tarda unos segundos/);
    doble.rpc.mockReset();
  });

  it("vacío: distingue «no hay con qué comparar» de «nada ha subido»", async () => {
    doble.rpcs.informe_subidas_precio = (a) => ({ ...subidas(a.p_meses), totales: { ...subidas(a.p_meses).totales, comparados: 0, n_fiable: 0, impacto_fiable: 0 }, filas: [], total_filas: 0 });
    doble.rpcs.informe_proveedor_mas_barato = () => ({ ...barato(), totales: { ...barato().totales, productos_varios_proveedores: 0 }, filas: [], total_filas: 0 });
    pintar();
    const caja = await screen.findByTestId("caja-informe-subidas");
    await waitFor(() => expect(within(caja).getByRole("status")).toHaveTextContent("No hay compras de hace 12 meses al mismo proveedor con las que comparar"));
    expect(caja).not.toHaveTextContent("Ningún producto ha subido");
    fireEvent.click(within(screen.getByTestId("total-ahorro")).getByRole("button"));
    expect(within(screen.getByTestId("caja-informe-barato")).getByRole("status")).toHaveTextContent("Ningún producto se ha comprado a dos o más proveedores en 12 meses");

    doble.rpcs.informe_subidas_precio = (a) => ({ ...subidas(a.p_meses), filas: [], total_filas: 0 });
    doble.rpcs.informe_proveedor_mas_barato = () => ({ ...barato(), filas: [], total_filas: 0 });
    fireEvent.click(within(screen.getByTestId("total-subidas")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Hace 6 meses" }));
    await waitFor(() => expect(within(screen.getByTestId("caja-informe-subidas")).getByRole("status")).toHaveTextContent("De 40 productos comparados, ninguno ha subido frente a hace 6 meses"));
  });
});
