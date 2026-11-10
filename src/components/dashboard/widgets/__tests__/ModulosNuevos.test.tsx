/**
 * Dashboard › «Márgenes de precio» y «Avisos» (10/11/2026, petición del dueño). Las cuentas están probadas en
 * lib/dashboard; aquí, lo que se pinta: enlaces a cada origen, permisos por sección y estados de carga y error.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { normalizarMargenes } from "@/lib/analisis/margenesCarta";
import { normalizarAlertas } from "@/lib/facturas/alertas";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";

const h = vi.hoisted(() => ({
  margenes: { isLoading: false, isError: false, data: undefined as unknown, error: null as unknown, refetch: () => {} },
  alertas: [] as unknown[],
  notificaciones: [] as NotificacionDashboard[],
  marcarLeida: (() => {}) as (id: string) => void,
  permisos: {} as Record<string, boolean>,
  facturas: true,
  superAdmin: false,
}));

vi.mock("@/hooks/useMargenesCarta", () => ({ useMargenesCarta: () => h.margenes }));
vi.mock("@/hooks/useAlertasFacturas", () => ({ useAlertasFacturas: () => ({ data: h.alertas }) }));
vi.mock("@/hooks/useNotificacionesDashboard", () => ({
  useNotificacionesDashboard: () => ({ notificaciones: h.notificaciones, loading: false, marcarLeida: h.marcarLeida }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (s: string) => ({ canAccess: !!h.permisos[s], loading: false }),
}));
vi.mock("@/hooks/usePermisosFacturas", () => ({
  usePermisosFacturas: () => ({ consultar: h.facturas, editar: false, subir: false, cargando: false }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));

import { MargenesPrecio } from "../MargenesPrecio";
import { AvisosDashboard } from "../AvisosDashboard";

const DATOS = normalizarMargenes({
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, multiplicador_min_peso: 2 },
  platos: [
    { id: "p1", nombre: "Percebes", precio: 19, gramos_venta: 100, pct: 63, banderas: ["coste_alto"],
      ingredientes: [{ producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g" }] },
  ],
  vinos: [{ id: "v1", nombre: "Champán", precio: 110, producto_id: 1785, multiplicador: 1.37, pct: 80, banderas: ["multiplicador_bajo", "sube_coste"], variacion_pct: 12 }],
  peso: [{ id: "p1", nombre: "Percebes", precio: 19, gramos_venta: 100, producto_id: 301, multiplicador: 1.57, pct: 64, banderas: ["multiplicador_bajo"] }],
});

const ubicacion = { actual: "" };
function Ubicacion() {
  const l = useLocation();
  ubicacion.actual = `${l.pathname}${l.search}`;
  return null;
}
const pintar = (nodo: JSX.Element) =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Ubicacion />
      <Routes>
        <Route path="*" element={nodo} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  h.margenes = { isLoading: false, isError: false, data: DATOS, error: null, refetch: vi.fn() };
  h.alertas = [];
  h.notificaciones = [];
  h.marcarLeida = vi.fn();
  h.permisos = {};
  h.facturas = true;
  h.superAdmin = false;
});

describe("Márgenes de precio", () => {
  it("los peores márgenes con su cifra, cada uno enlazado a su ficha de Facturas › Márgenes", () => {
    pintar(<MargenesPrecio />);
    const lista = screen.getByRole("list", { name: "Peores márgenes" });
    const filas = within(lista).getAllByRole("link");
    expect(filas.map((a) => a.getAttribute("href"))).toEqual([
      "/facturas?tab=margenes&articulo=vino:v1",
      "/facturas?tab=margenes&articulo=plato:p1",
    ]);
    expect(filas[0]).toHaveTextContent("Champán");
    expect(filas[0]).toHaveTextContent("×1,37");
    expect(filas[0]).toHaveTextContent("coste +12 %");
    expect(screen.getByTestId("margenes-cuentas")).toHaveTextContent("2 artículos con el margen en rojo · 1 con el coste subiendo");
    expect(screen.getByRole("link", { name: /Ver todos/ })).toHaveAttribute("href", "/facturas?tab=margenes");
  });

  it("las subidas de proveedor que tocan algún artículo de la carta", () => {
    h.alertas = normalizarAlertas([
      { id: "s1", tipo: "facturas_precio_sube", titulo: "Percebe sube", datos: { producto_id: 301, producto: "Percebe gallego", proveedor: "CETAREA", variacion_pct: 14, impacto_mes: 60 } },
    ]);
    pintar(<MargenesPrecio />);
    const seccion = screen.getByRole("region", { name: "Subidas de proveedor que afectan a la carta" });
    expect(seccion).toHaveTextContent("Percebe gallego");
    expect(seccion).toHaveTextContent("CETAREA · afecta a Percebes");
    expect(seccion).toHaveTextContent("+14 %");
  });

  it("si la consulta falla, lo dice con «Reintentar»", () => {
    h.margenes = { isLoading: false, isError: true, data: undefined, error: new Error("sin conexión"), refetch: vi.fn() };
    pintar(<MargenesPrecio />);
    expect(screen.getByText(/No se han podido cargar/)).toBeInTheDocument();
  });
});

const aviso = (id: string, tipo: string, extra: Partial<NotificacionDashboard> = {}): NotificacionDashboard => ({
  id, tipo, titulo: `Aviso ${id}`, mensaje: null, referencia_id: null, referencia_tipo: null, leida: false,
  created_at: new Date().toISOString(), ...extra,
});

describe("Avisos", () => {
  beforeEach(() => {
    h.notificaciones = [
      aviso("r1", "reserva_sin_asignar"),
      aviso("f1", "facturas_precio_mejor", { referencia_tipo: "facturas_alerta", datos: { enlace: "?tab=compras&modo=documentos&doc=383" } }),
      aviso("i1", "ia_modelo_nuevo", { referencia_tipo: "ia_modelos" }),
    ];
  });

  it("con permiso de Reservas pero no de Facturas: solo ve los de reservas", () => {
    h.permisos = { reservas: true };
    h.facturas = false;
    pintar(<AvisosDashboard />);
    const lista = screen.getByRole("list", { name: "Últimos avisos" });
    expect(within(lista).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Aviso r1")]);
    expect(screen.getByRole("list", { name: "Sin leer por sección" })).toHaveTextContent("Reservas · 1");
  });

  it("con Facturas y super admin ve también los suyos; tocar uno lo marca leído y abre su origen", () => {
    h.permisos = { reservas: true };
    h.superAdmin = true;
    pintar(<AvisosDashboard />);
    expect(screen.getAllByRole("button", { name: /^Abrir:/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Abrir: Aviso f1" }));
    expect(h.marcarLeida).toHaveBeenCalledWith("f1");
    expect(ubicacion.actual).toBe("/facturas?tab=compras&modo=documentos&doc=383");
  });

  it("sin nada que pueda ver: «No hay avisos», y siempre el enlace a la página Avisos", () => {
    h.facturas = false;
    pintar(<AvisosDashboard />);
    expect(screen.getByText("No hay avisos.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver todos/ })).toHaveAttribute("href", "/avisos");
  });
});
