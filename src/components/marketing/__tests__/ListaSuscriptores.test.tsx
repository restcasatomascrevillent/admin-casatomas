import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListaSuscriptores } from "../ListaSuscriptores";
import { PreviewNewsletter } from "../PreviewNewsletter";
import type { SuscriptorNewsletter } from "@/lib/newsletter/bajas";

const activo: SuscriptorNewsletter = {
  id: "1",
  email: "activo@ejemplo.es",
  nombre: "Ana",
  activo: true,
  created_at: "2026-09-01T10:00:00Z",
  fecha_baja: null,
  origen_baja: null,
  origen_alta: "reserva_web",
};
const baja: SuscriptorNewsletter = {
  id: "2",
  email: "baja@ejemplo.es",
  nombre: null,
  activo: false,
  created_at: "2026-09-01T10:00:00Z",
  fecha_baja: "2026-10-02T18:30:00Z",
  origen_baja: "queja_spam",
};

describe("ListaSuscriptores", () => {
  it("muestra los contadores de activos y dados de baja", () => {
    render(<ListaSuscriptores activos={[activo]} bajas={[baja]} isLoading={false} />);
    expect(screen.getByRole("tab", { name: "Activos (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dados de baja (1)" })).toBeInTheDocument();
    expect(screen.getByText("activo@ejemplo.es")).toBeInTheDocument();
    expect(screen.getByText(/Ana · Se apuntó por: Reserva web/)).toBeInTheDocument();
    // Lista plana: una fila por suscriptor, sin tarjetas.
    expect(screen.getByRole("list", { name: "Suscriptores activos" })).toHaveClass("divide-y");
  });

  it("los dados de baja muestran fecha y motivo, y no hay botón para reactivarlos", () => {
    render(<ListaSuscriptores activos={[activo]} bajas={[baja]} isLoading={false} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dados de baja (1)" }));
    expect(screen.getByText("baja@ejemplo.es")).toBeInTheDocument();
    expect(screen.getByText("Marcó el correo como spam")).toBeInTheDocument();
    expect(screen.getByText(/^Baja: /)).toBeInTheDocument();
    expect(screen.getByText(/No se pueden volver a activar desde aquí/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reactivar|activar|suscribir/i })).not.toBeInTheDocument();
  });
});

describe("PreviewNewsletter", () => {
  it("la vista previa lleva el pie de baja y escapa lo que escribe el personal", () => {
    const { container } = render(
      <PreviewNewsletter tipo="anuncio" titulo="<b>Hola</b>" mensaje="<style>.footer{display:none}</style>" />,
    );
    const iframe = container.querySelector("iframe");
    const html = iframe?.getAttribute("srcdoc") ?? "";
    expect(html).toContain('data-pie-baja="obligatorio"');
    expect(html).toContain("Darse de baja");
    expect(html).toContain("&lt;b&gt;Hola&lt;/b&gt;");
    expect(html).not.toContain("<style>.footer{display:none}</style>");
    expect(screen.getByText(/se añade siempre, automáticamente/)).toBeInTheDocument();
  });
});
