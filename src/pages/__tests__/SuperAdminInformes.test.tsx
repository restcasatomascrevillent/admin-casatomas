import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import type { ResultadoInformeTabla } from "@/lib/informes/tabla";
import { mesAnteriorA, mesesPorDefecto, rangoDeMes } from "@/lib/informes/periodo";
import type { PropsGeneradorInforme } from "@/lib/informes/registro";

vi.setConfig({ testTimeout: 15_000 });

const estado = vi.hoisted(() => ({
  superAdmin: true,
  cargando: false,
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  facturas: vi.fn(),
  descargas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/SuperAdminLayout", () => ({ SuperAdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: estado.superAdmin, loading: estado.cargando }) }));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ permissions: estado.permisos, loading: estado.cargando, role: null, isAdmin: false }),
}));
vi.mock("@/components/trafico-web/informe/fuente", () => ({ prepararFuenteInforme: () => Promise.resolve(), cssFuenteEmbebida: () => Promise.resolve(null) }));
vi.mock("@/components/trafico-web/informe/pdf", () => ({
  descargarBlob: (_b: Blob, nombre: string) => estado.descargas.push(nombre),
  descargarPdfInforme: vi.fn(),
}));
vi.mock("@/lib/informes/fuentes/facturas", () => ({ obtenerInformeFacturas: (...a: unknown[]) => estado.facturas(...a) }));
vi.mock("@/lib/informes/fuentes/vinoFavorito", () => ({ obtenerInformeVinoFavorito: async () => ({ vacio: true, motivo: "Todavía no ha votado nadie." }) }));
// Los informes con diapositivas propias se prueban en sus pantallas: aquí, un doble que usa el marco.
vi.mock("@/components/informes/generadores/InformeTraficoGenerador", () => ({
  default: ({ periodo, Marco }: PropsGeneradorInforme) => (
    <Marco acciones={<button type="button">Descargar PDF</button>}>
      <p>Tráfico de {periodo.tipo === "mes" ? periodo.mes : "?"}</p>
    </Marco>
  ),
}));
vi.mock("@/components/informes/generadores/InformeRrssGenerador", () => ({ default: () => <p>RRSS</p> }));

import SuperAdminInformes, { CLAVE_MES_INFORMES } from "../SuperAdminInformes";

const hoy = () => format(new Date(), "yyyy-MM-dd");

let ubicacion = "";
function Ubicacion() {
  const l = useLocation();
  ubicacion = `${l.pathname}${l.search}`;
  return null;
}

function pintar(ruta = "/super-admin/informes") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ruta]}>
        <SuperAdminInformes />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const informeProveedores: ResultadoInformeTabla = {
  vacio: false,
  titulo: "Gasto por proveedor",
  descripcion: "Gasto con IVA de los dos locales.",
  textoPeriodo: "1 – 31 oct 2026",
  tablas: [
    {
      titulo: "Gasto por proveedor",
      columnas: [
        { id: "nombre", etiqueta: "Proveedor", tipo: "texto" },
        { id: "valor", etiqueta: "Gasto con IVA", tipo: "eur" },
      ],
      filas: [{ nombre: "Makro", valor: 200 }],
      total: { nombre: "Total", valor: 200 },
    },
  ],
  nombreArchivo: "informe-gasto-por-proveedor-2026-10",
};

beforeEach(() => {
  estado.superAdmin = true;
  estado.cargando = false;
  estado.permisos = [];
  estado.descargas = [];
  estado.facturas = vi.fn(async () => informeProveedores);
  window.sessionStorage.clear();
});

describe("Super Admin › Informes", () => {
  it("lista todos los informes por sección y pide elegir uno", () => {
    pintar();
    const lista = screen.getByRole("navigation", { name: "Informes disponibles" });
    expect(within(lista).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Web", "Redes sociales", "Facturas", "Servicios", "Cheques regalo", "Carta", "Seguridad"]);
    expect(within(lista).getByRole("button", { name: /Informe mensual de tráfico web/ })).toBeInTheDocument();
    expect(within(lista).getByRole("button", { name: /Gasto por proveedor/ })).toBeInTheDocument();
    expect(screen.getByText("Elige un informe")).toBeInTheDocument();
    // Arriba, el mes de los informes: por defecto, el último mes cerrado.
    expect(screen.getByRole("combobox", { name: "Mes de los informes" })).toBeInTheDocument();
    expect(within(lista).getAllByText("Del mes elegido").length).toBeGreaterThan(0);
  });

  it("mientras se leen los permisos, esqueletos", () => {
    estado.cargando = true;
    pintar();
    expect(screen.getByLabelText("Cargando informes")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Informes disponibles" })).not.toBeInTheDocument();
  });

  it("sin permiso en ninguna sección: estado vacío", () => {
    estado.superAdmin = false;
    pintar();
    expect(screen.getByText("No tienes informes disponibles")).toBeInTheDocument();
    expect(screen.queryByText("Elige un informe")).not.toBeInTheDocument();
  });

  it("cada informe solo sale con permiso en su sección (y la URL no se lo salta)", () => {
    estado.superAdmin = false;
    estado.permisos = [{ section_key: "marketing", can_view: true, can_edit: false }];
    pintar("/super-admin/informes?informe=trafico-web-mensual");
    const lista = screen.getByRole("navigation", { name: "Informes disponibles" });
    expect(within(lista).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Informe mensual de redes sociales")]);
    expect(screen.getByText("Elige un informe")).toBeInTheDocument();
  });

  it("un informe de tabla: periodo en la URL, vista previa en diapositivas y descarga en CSV", async () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Gasto por proveedor/ }));
    expect(ubicacion).toMatch(/informe=facturas-gasto-proveedor/);
    const vista = await screen.findByTestId("vista-informe");
    // Portada y una diapositiva con la tabla.
    await waitFor(() => expect(within(vista).getAllByTestId(/^diapositiva-/)).toHaveLength(2));
    expect(within(vista).getByText("Makro")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Gasto por proveedor", level: 2 }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Facturas › Análisis" })).toHaveAttribute("href", "/facturas?tab=chat");
    // Por defecto, el mes de la página (el último cerrado) entero.
    const [, periodo] = estado.facturas.mock.calls[0];
    expect(periodo).toEqual({ tipo: "rango", ...rangoDeMes(mesAnteriorA(hoy())) });
    expect(ubicacion).toMatch(new RegExp(`mes=${mesAnteriorA(hoy())}`));
    fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(estado.descargas).toEqual(["informe-gasto-por-proveedor-2026-10.csv"]);
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
  });

  it("toma el periodo de la URL y lo vuelve a pedir al cambiarlo", async () => {
    pintar("/super-admin/informes?informe=facturas-gasto-familia&desde=2026-01-01&hasta=2026-03-31");
    await screen.findByTestId("vista-informe");
    await waitFor(() => expect(estado.facturas).toHaveBeenCalled());
    expect(estado.facturas.mock.calls[0][1]).toEqual({ tipo: "rango", desde: "2026-01-01", hasta: "2026-03-31" });
    // Rango que no es un atajo: se ven las fechas.
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-01-01");
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-02-28" } });
    await waitFor(() => expect(ubicacion).toMatch(/hasta=2026-02-28/));
    await waitFor(() => expect(estado.facturas.mock.calls.at(-1)![1]).toEqual({ tipo: "rango", desde: "2026-01-01", hasta: "2026-02-28" }));
    // «Desde» después de «Hasta»: aviso y no se pide nada nuevo.
    const llamadas = estado.facturas.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-05-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("«Desde» tiene que ser una fecha anterior o igual a «Hasta».");
    expect(estado.facturas.mock.calls.length).toBe(llamadas);
  });

  it("si falla la lectura: error con «Reintentar»", async () => {
    estado.facturas = vi.fn(async () => {
      throw new Error("sin conexión");
    });
    pintar("/super-admin/informes?informe=facturas-gasto-familia");
    expect(await screen.findByText(/No se han podido cargar los datos del informe/)).toBeInTheDocument();
    estado.facturas = vi.fn(async () => informeProveedores);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Makro")).toBeInTheDocument();
  });

  it("sin datos: lo dice y por qué", async () => {
    pintar("/super-admin/informes?informe=carta-vino-favorito");
    expect(await screen.findByText("No hay datos para este informe")).toBeInTheDocument();
    expect(screen.getByText("Todavía no ha votado nadie.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Periodo del informe" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Periodo del informe: Todos los datos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
  });

  it("un informe con diapositivas propias se carga en el mismo marco, con el mes elegido", async () => {
    pintar("/super-admin/informes?informe=trafico-web-mensual&mes=2026-09");
    expect(await screen.findByText("Tráfico de 2026-09")).toBeInTheDocument();
    // Sin selector propio: el mes es el de arriba.
    expect(screen.queryByRole("combobox", { name: "Mes del informe" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mes del informe: Septiembre de 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Informes de septiembre de 2026/, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tráfico web" })).toHaveAttribute("href", "/super-admin/trafico-web");
    // Volver a la lista (móvil): el mes se queda.
    fireEvent.click(screen.getByRole("button", { name: "Todos los informes" }));
    expect(ubicacion).toBe("/super-admin/informes?mes=2026-09");
  });

  it("el mes elegido arriba vale para cualquier informe que se abra", async () => {
    pintar("/super-admin/informes?informe=trafico-web-mensual&mes=2026-09");
    expect(await screen.findByText("Tráfico de 2026-09")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gasto por proveedor/ }));
    await waitFor(() => expect(estado.facturas).toHaveBeenCalled());
    expect(estado.facturas.mock.calls[0][1]).toEqual({ tipo: "rango", desde: "2026-09-01", hasta: "2026-09-30" });
    expect(ubicacion).toMatch(/informe=facturas-gasto-proveedor/);
    expect(ubicacion).toMatch(/mes=2026-09/);
    expect(screen.getByRole("combobox", { name: "Periodo del informe" })).toHaveTextContent("Todo septiembre de 2026");
    // Se recuerda en la pestaña para la próxima vez.
    expect(window.sessionStorage.getItem(CLAVE_MES_INFORMES)).toBe("2026-09");
  });

  it("cambiar el mes de arriba cambia el informe abierto (y descarta las fechas a medida)", async () => {
    pintar("/super-admin/informes?informe=trafico-web-mensual&mes=2026-09");
    expect(await screen.findByText("Tráfico de 2026-09")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(await screen.findByText("Tráfico de 2026-08")).toBeInTheDocument();
    expect(ubicacion).toMatch(/mes=2026-08/);
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(await screen.findByText("Tráfico de 2026-09")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Gasto por familia/ }));
    await waitFor(() => expect(estado.facturas).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(estado.facturas.mock.calls.at(-1)![1]).toEqual({ tipo: "rango", desde: "2026-08-01", hasta: "2026-08-31" }));
    expect(ubicacion).not.toMatch(/desde=/);
  });

  it("sin mes en la URL, el último elegido en la pestaña", () => {
    const opciones = mesesPorDefecto(hoy());
    window.sessionStorage.setItem(CLAVE_MES_INFORMES, opciones[3].clave);
    pintar();
    expect(screen.getByRole("combobox", { name: "Mes de los informes" })).toHaveTextContent(opciones[3].etiqueta);
  });

  it("un mes de la URL que no se puede elegir no vale: se queda el guardado", () => {
    const opciones = mesesPorDefecto(hoy());
    window.sessionStorage.setItem(CLAVE_MES_INFORMES, opciones[2].clave);
    pintar("/super-admin/informes?mes=1999-01");
    expect(screen.getByRole("combobox", { name: "Mes de los informes" })).toHaveTextContent(opciones[2].etiqueta);
  });

  it("en el mes más nuevo, «Mes siguiente» está apagado", () => {
    const opciones = mesesPorDefecto(hoy());
    pintar(`/super-admin/informes?mes=${opciones[0].clave}`);
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeEnabled();
    pintar(`/super-admin/informes?mes=${opciones.at(-1)!.clave}`);
    expect(screen.getAllByRole("button", { name: "Mes anterior" }).at(-1)).toBeDisabled();
  });
});
