// «Mis peticiones» (estado y motivo de descarte) y Super Admin › Tickets (filtros, orden y abrir).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Peticion } from "@/lib/peticiones";
import { MisPeticiones } from "../MisPeticiones";
import { ListaTickets } from "../ListaTickets";
import { FILTROS_INICIALES, autores, filtrarTickets, type FiltrosTickets } from "../utilidades";

const base: Peticion = {
  id: "p-0", creado_por: "u-1", creado_por_nombre: "Ana Sala", creado_por_email: "ana@t",
  titulo: "Título", prioridad: "normal", modulo: "reservas", descripcion: "Una descripción larga.",
  captura_path: null, ruta: "/reservas", dispositivo: null, estado: "nueva", motivo_descarte: null, estado_cambiado_en: null,
  analisis: null, analisis_estado: "hecho", analisis_error: null, analisis_modelo: null, analizado_en: null,
  linear_id: null, linear_url: null, created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z",
};
const p = (o: Partial<Peticion>): Peticion => ({ ...base, ...o });

const TICKETS = [
  p({ id: "a", titulo: "Vieja normal", created_at: "2026-11-10T10:00:00Z" }),
  p({ id: "b", titulo: "Urgente de Luis", prioridad: "urgente", creado_por_nombre: "Luis", modulo: "facturas", created_at: "2026-11-11T10:00:00Z", analisis_estado: "analizando" }),
  p({ id: "c", titulo: "Nueva normal", created_at: "2026-11-12T10:00:00Z", analisis_estado: "error" }),
  p({ id: "d", titulo: "Ya hecha", estado: "hecha", prioridad: "urgente" }),
  p({ id: "e", titulo: "Descartada", estado: "descartada", motivo_descarte: "Ya existe en Configuración.", creado_por_nombre: null, creado_por_email: null }),
];

describe("MisPeticiones", () => {
  it("cada petición con su estado; el motivo solo en las descartadas", () => {
    render(<MisPeticiones peticiones={TICKETS} cargando={false} error={null} onReintentar={vi.fn()} />);
    const filas = screen.getAllByTestId("mi-peticion");
    expect(filas).toHaveLength(5);
    expect(within(filas[0]).getByTestId("estado-peticion")).toHaveTextContent("Recibida");
    expect(within(filas[3]).getByTestId("estado-peticion")).toHaveTextContent("Hecha");
    expect(within(filas[4]).getByTestId("estado-peticion")).toHaveTextContent("Descartada");
    expect(screen.getAllByTestId("motivo-descarte")).toHaveLength(1);
    expect(within(filas[4]).getByTestId("motivo-descarte")).toHaveTextContent("Motivo: Ya existe en Configuración.");
    expect(within(filas[1]).getByText("Facturas y albaranes")).toBeInTheDocument();
  });

  it("vacía: invita a enviar la primera", () => {
    const onNueva = vi.fn();
    render(<MisPeticiones peticiones={[]} cargando={false} error={null} onReintentar={vi.fn()} onNueva={onNueva} />);
    expect(screen.getByTestId("sin-peticiones")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nueva petición" }));
    expect(onNueva).toHaveBeenCalled();
  });

  it("si falla la carga lo dice (y se puede reintentar)", () => {
    const onReintentar = vi.fn();
    render(<MisPeticiones peticiones={undefined} cargando={false} error={new Error("x")} onReintentar={onReintentar} />);
    expect(screen.getByText(/No se han podido cargar tus peticiones/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onReintentar).toHaveBeenCalled();
  });
});

describe("filtrarTickets", () => {
  it("por defecto, las abiertas: urgente arriba y luego lo más nuevo", () => {
    expect(filtrarTickets(TICKETS, FILTROS_INICIALES).map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
  it("todas: las cerradas al final", () => {
    expect(filtrarTickets(TICKETS, { ...FILTROS_INICIALES, estado: "todas" }).map((t) => t.id)).toEqual(["b", "c", "a", "d", "e"]);
  });
  it("por estado, prioridad, módulo y usuario", () => {
    expect(filtrarTickets(TICKETS, { ...FILTROS_INICIALES, estado: "descartada" }).map((t) => t.id)).toEqual(["e"]);
    expect(filtrarTickets(TICKETS, { ...FILTROS_INICIALES, estado: "todas", prioridad: "urgente" }).map((t) => t.id)).toEqual(["b", "d"]);
    expect(filtrarTickets(TICKETS, { ...FILTROS_INICIALES, modulo: "facturas" }).map((t) => t.id)).toEqual(["b"]);
    expect(filtrarTickets(TICKETS, { ...FILTROS_INICIALES, estado: "todas", usuario: "Usuario dado de baja" }).map((t) => t.id)).toEqual(["e"]);
  });
  it("autores para el filtro, sin repetir y en orden", () => {
    expect(autores(TICKETS)).toEqual(["Ana Sala", "Luis", "Usuario dado de baja"]);
  });
});

describe("ListaTickets", () => {
  function pintar(filtros: FiltrosTickets = FILTROS_INICIALES) {
    const onFiltros = vi.fn();
    const onAbrir = vi.fn();
    render(<ListaTickets tickets={TICKETS} filtros={filtros} onFiltros={onFiltros} onAbrir={onAbrir} />);
    return { onFiltros, onAbrir };
  }

  it("lista las abiertas con prioridad, estado, módulo, autor y estado del análisis", () => {
    pintar();
    const filas = screen.getAllByTestId("ticket");
    expect(filas.map((f) => within(f).getByTestId("titulo-ticket").textContent)).toEqual(["Urgente de Luis", "Nueva normal", "Vieja normal"]);
    expect(within(filas[0]).getByText("Analizando")).toBeInTheDocument();
    expect(within(filas[1]).getByText("Análisis fallido")).toBeInTheDocument();
    expect(within(filas[2]).getByText("Analizada")).toBeInTheDocument();
    expect(screen.getByText("3 tickets")).toBeInTheDocument();
  });

  it("los cuatro filtros cambian lo que se pide", () => {
    const { onFiltros } = pintar();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "todas" } });
    expect(onFiltros).toHaveBeenLastCalledWith({ ...FILTROS_INICIALES, estado: "todas" });
    fireEvent.change(screen.getByLabelText("Prioridad"), { target: { value: "urgente" } });
    expect(onFiltros).toHaveBeenLastCalledWith({ ...FILTROS_INICIALES, prioridad: "urgente" });
    fireEvent.change(screen.getByLabelText("Módulo"), { target: { value: "carta" } });
    expect(onFiltros).toHaveBeenLastCalledWith({ ...FILTROS_INICIALES, modulo: "carta" });
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "Luis" } });
    expect(onFiltros).toHaveBeenLastCalledWith({ ...FILTROS_INICIALES, usuario: "Luis" });
  });

  it("al tocar uno se abre; con filtros sin resultados lo dice y se pueden quitar", () => {
    const { onAbrir } = pintar();
    fireEvent.click(screen.getAllByTestId("ticket")[0]);
    expect(onAbrir).toHaveBeenCalledWith("b");
  });

  it("sin resultados", () => {
    const { onFiltros } = pintar({ ...FILTROS_INICIALES, modulo: "tienda" });
    expect(screen.getByTestId("sin-tickets")).toHaveTextContent("Ningún ticket con estos filtros.");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(onFiltros).toHaveBeenCalledWith(FILTROS_INICIALES);
  });
});
