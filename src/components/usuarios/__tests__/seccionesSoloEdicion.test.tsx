/**
 * «Reservas · Configuración» con solo «Ver» no da acceso (06/11/2026, decisión del dueño): en Usuarios esa
 * fila solo ofrece «Puede editar» (que concede los dos permisos) y los visores enseñan su «Ver» igual que su
 * «Editar». El resto de secciones, como siempre: «Ver» y «Puede editar» por separado.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import { ListaPermisosUsuario } from "@/components/usuarios/VisorPermisosUsuario";
import { SECCIONES_SOLO_EDICION, esSeccionSoloEdicion } from "@/components/usuarios/seccionesSoloEdicion";
import { AYUDA_EDICION, permisosParaEditar } from "@/components/usuarios/permisosSecciones";

describe("SECCIONES_SOLO_EDICION", () => {
  it("solo «Reservas · Configuración»", () => {
    expect([...SECCIONES_SOLO_EDICION]).toEqual(["reservas_configuracion"]);
    expect(esSeccionSoloEdicion("reservas_configuracion")).toBe(true);
    expect(esSeccionSoloEdicion("reservas")).toBe(false);
  });
});

// Los textos de ayuda de las cuatro secciones decididas el 06/11/2026 (lo que dicen «Ver» y «Editar»).
describe("AYUDA_EDICION de Reservas, Configuración, Cheques y Tienda", () => {
  it("Reservas: con solo «Ver» se consulta, sin botones para cambiar", () => {
    expect(AYUDA_EDICION.reservas).toMatch(/Con solo «Ver» se consulta/);
    expect(AYUDA_EDICION.reservas).toMatch(/dar mesa/);
  });
  it("Reservas · Configuración: «Ver» no sirve por sí solo", () => {
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/«Ver» aquí no sirve por sí solo/);
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/sin «Editar» no se ve la pestaña/);
  });
  it("Cheques: canjear ya no pide «Editar»; la plantilla, la compra manual y la configuración, sí", () => {
    expect(AYUDA_EDICION.cheques).not.toMatch(/^canjear/);
    expect(AYUDA_EDICION.cheques).toMatch(/Con solo «Ver» se consultan y se canjean/);
    expect(AYUDA_EDICION.cheques).toMatch(/plantilla de factura/);
    expect(AYUDA_EDICION.cheques).toMatch(/compra manual/);
  });
  it("Tienda: Ajustes y poner/quitar vinos piden «Editar»; con «Ver», la lista", () => {
    expect(AYUDA_EDICION.tienda).toMatch(/pestaña Ajustes/);
    expect(AYUDA_EDICION.tienda).toMatch(/Con solo «Ver» se consulta la lista de vinos/);
  });
});

describe("TablaPermisosSecciones · fila de «Reservas · Configuración»", () => {
  const pintar = (props: Partial<Parameters<typeof TablaPermisosSecciones>[0]> = {}) => {
    const onCambiarVer = vi.fn();
    const onCambiarEditar = vi.fn();
    render(
      <TablaPermisosSecciones
        permisos={permisosParaEditar([])}
        onCambiarVer={onCambiarVer}
        onCambiarEditar={onCambiarEditar}
        puedeConcederEdicion
        {...props}
      />,
    );
    return { onCambiarVer, onCambiarEditar };
  };

  it("no tiene interruptor de «Ver»; el de «Puede editar» se puede activar sin «Ver» y activa los dos, en orden", () => {
    const { onCambiarVer, onCambiarEditar } = pintar();

    expect(screen.queryByRole("switch", { name: "Ver Reservas · Configuración" })).toBeNull();
    // El resto, como siempre.
    expect(screen.getByRole("switch", { name: "Ver Reservas" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Puede editar Reservas" })).toBeDisabled();

    const editar = screen.getByRole("switch", { name: "Puede editar Reservas · Configuración" });
    expect(editar).toBeEnabled();
    fireEvent.click(editar);
    expect(onCambiarVer).toHaveBeenCalledWith("reservas_configuracion", true);
    expect(onCambiarEditar).toHaveBeenCalledWith("reservas_configuracion", true);
    expect(onCambiarVer.mock.invocationCallOrder[0]).toBeLessThan(onCambiarEditar.mock.invocationCallOrder[0]);
  });

  it("al quitar «Puede editar» quita «Ver» (que quita los dos)", () => {
    const { onCambiarVer, onCambiarEditar } = pintar({
      permisos: permisosParaEditar([{ section_key: "reservas_configuracion", can_view: true, can_edit: true }]),
    });

    fireEvent.click(screen.getByRole("switch", { name: "Puede editar Reservas · Configuración" }));
    expect(onCambiarVer).toHaveBeenCalledWith("reservas_configuracion", false);
    expect(onCambiarEditar).not.toHaveBeenCalled();
  });

  it("quien no puede conceder la edición tampoco puede concederla aquí", () => {
    pintar({ puedeConcederEdicion: false });
    expect(screen.getByRole("switch", { name: "Puede editar Reservas · Configuración" })).toBeDisabled();
  });
});

describe("ListaPermisosUsuario · «Reservas · Configuración»", () => {
  const fila = (nombre: string) => screen.getByText(nombre, { selector: "p" }).closest("li") as HTMLElement;

  it("un «Ver» suelto (sin «Editar») se enseña como «No»: no da acceso", () => {
    render(
      <ListaPermisosUsuario
        user={{
          is_super_admin: false,
          role: "staff",
          permissions: [
            { section_key: "reservas", can_view: true, can_edit: false },
            { section_key: "reservas_configuracion", can_view: true, can_edit: false },
          ],
        }}
      />,
    );
    expect(within(fila("Reservas · Configuración")).getByLabelText("Ver Reservas · Configuración: No")).toBeInTheDocument();
    // En Reservas, «Ver» sí vale por sí solo.
    expect(within(fila("Reservas")).getByLabelText("Ver Reservas: Sí")).toBeInTheDocument();
  });

  it("con «Editar», «Ver» y «Editar» en «Sí»; el super admin, todo «Sí»", () => {
    const { unmount } = render(
      <ListaPermisosUsuario
        user={{ is_super_admin: false, role: "staff", permissions: [{ section_key: "reservas_configuracion", can_view: true, can_edit: true }] }}
      />,
    );
    expect(screen.getByLabelText("Ver Reservas · Configuración: Sí")).toBeInTheDocument();
    expect(screen.getByLabelText("Editar Reservas · Configuración: Sí")).toBeInTheDocument();
    unmount();

    render(<ListaPermisosUsuario user={{ is_super_admin: true, role: "admin", permissions: [] }} />);
    expect(screen.getByLabelText("Ver Reservas · Configuración: Sí")).toBeInTheDocument();
    expect(screen.getByLabelText("Editar Reservas · Configuración: Sí")).toBeInTheDocument();
  });
});
