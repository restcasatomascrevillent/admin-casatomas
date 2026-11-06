/**
 * Reservas › Configuración (04/11/2026, petición del dueño: «mueve la sección de plantillas email del
 * superadmin a reservas … dentro de la subsección de configuración como otra subpestaña más»).
 *
 * Configuración tiene ahora dos subpestañas en chips (como Cheques › Configuración): «General» (lo de
 * siempre: reglas, mesas y turnos) y «Plantillas email». Se llega directo a la segunda con
 * `?tab=configuracion&sub=plantillas`, que es adonde redirige la ruta vieja /super-admin/plantillas-email.
 *
 * Y desde el mismo día («que haya un permiso para esa pestaña configurable tal y como se hace en gestor
 * web»), la pestaña se ve con «Ver» en la sección «Reservas · Configuración» (`reservas_configuracion`),
 * no por ser admin. Lo que se puede editar dentro lo prueban EditorPlantillasEmail.permisos.test.tsx y
 * ConfiguracionTurnos.permisos.test.tsx.
 *
 * También el mismo día («pon subpestañas porque el scroll es eterno»), «General» se repartió en cuatro
 * chips: «Reglas», «Servicio», «Mesas» y «Turnos». `?sub=general` (enlaces viejos) abre «Reglas». Qué
 * enseña cada parte del formulario lo prueba ConfiguracionGeneralReservas.partes.test.tsx.
 *
 * 06/11/2026 (decisión del dueño): con solo «Ver» en «Reservas · Configuración» NO se ve la pestaña (ni
 * por enlace, que cae en «Hoy» y se limpia de la URL): solo entra quien tiene «Puede editar» en ella.
 * Desaparece el aviso de «Solo lectura» que salía en cada chip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/** Permisos del usuario, como «sección:tipo» (p. ej. «reservas_configuracion:view»). */
const h = vi.hoisted(() => ({ permisos: new Set<string>() }));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => <div data-testid="vista-hoy" /> }));
vi.mock("@/components/reservas/FormularioReserva", () => ({ FormularioReserva: () => null }));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => null }));
vi.mock("@/components/reservas/CalendarioOcupacion", () => ({ CalendarioOcupacion: () => null }));
vi.mock("@/components/reservas/PlanoEspacio2D", () => ({ PlanoEspacio2D: () => null }));
vi.mock("@/components/reservas/servicio/ModoServicioPlano", () => ({ ModoServicioPlano: () => null }));
vi.mock("@/components/reservas/GestionBlacklist", () => ({ GestionBlacklist: () => null }));
vi.mock("@/components/reservas/ConfiguracionTurnos", () => ({
  ConfiguracionTurnos: () => <div data-testid="chip-turnos" />,
}));
vi.mock("@/components/reservas/ConfiguracionGeneralReservas", () => ({
  ConfiguracionGeneralReservas: ({ parte }: { parte: string }) => <div data-testid={`chip-${parte}`} />,
}));
vi.mock("@/components/reservas/GestionMesasEspacios", () => ({
  GestionMesasEspacios: () => <div data-testid="chip-mesas" />,
}));
vi.mock("@/components/emails/EditorPlantillasEmail", () => ({
  EditorPlantillasEmail: () => <div data-testid="editor-plantillas" />,
}));
vi.mock("@/components/reservas/PanelAsignacion", () => ({ PanelAsignacion: () => null }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useSolicitudesPendientes", () => ({ useSolicitudesPendientes: () => ({ solicitudes: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({
  // Ser admin ya no cuenta para Configuración: aunque el rol sea admin, solo manda el permiso.
  useUserRole: () => ({ role: "admin", isAdmin: true, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: h.permisos.has(`${seccion}:${tipo}`),
    loading: false,
  }),
}));

import Reservas from "@/pages/Reservas";

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <output data-testid="ubicacion">{pathname + search}</output>;
}

function montar(ruta = "/reservas") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Reservas />
      <Ubicacion />
    </MemoryRouter>,
  );
}

/** Las pestañas son de Radix: se activan con mousedown. */
function pulsar(nombre: string | RegExp) {
  const pestana = screen.getByRole("tab", { name: nombre });
  fireEvent.mouseDown(pestana);
  fireEvent.click(pestana);
}

const chip = (nombre: string) => screen.getByRole("tab", { name: nombre });

const PUEDE_CONFIGURAR = ["reservas_configuracion:view", "reservas_configuracion:edit"];

beforeEach(() => {
  h.permisos = new Set(["reservas:view", "reservas:edit", ...PUEDE_CONFIGURAR]);
});

/** Lo que pinta cada chip (los componentes de verdad van simulados arriba). */
const CONTENIDO_CHIP = {
  Reglas: "chip-reglas",
  Servicio: "chip-servicio",
  Mesas: "chip-mesas",
  Turnos: "chip-turnos",
  "Plantillas email": "editor-plantillas",
} as const;
type NombreChip = keyof typeof CONTENIDO_CHIP;
const NOMBRES_CHIP = Object.keys(CONTENIDO_CHIP) as NombreChip[];

/** Solo está el contenido de `activo`: los demás chips no están montados (Radix los desmonta). */
function soloSeVe(activo: NombreChip) {
  for (const nombre of NOMBRES_CHIP) {
    expect(chip(nombre)).toHaveAttribute("aria-selected", String(nombre === activo));
    if (nombre === activo) expect(screen.getByTestId(CONTENIDO_CHIP[nombre])).toBeInTheDocument();
    else expect(screen.queryByTestId(CONTENIDO_CHIP[nombre])).not.toBeInTheDocument();
  }
}

describe("Reservas › Configuración · subpestañas", () => {
  it("Configuración abre en «Reglas» y ofrece los cinco chips, en este orden", () => {
    montar();
    pulsar("Configuración");

    const chips = screen.getByTestId("chips-subnivel");
    expect(chips).toBeInTheDocument();
    expect(Array.from(chips.querySelectorAll('[role="tab"]'), (t) => t.textContent)).toEqual(NOMBRES_CHIP);
    soloSeVe("Reglas");
  });

  it.each(NOMBRES_CHIP)("el chip «%s» enseña solo lo suyo, sin salir de Configuración", (nombre) => {
    montar();
    pulsar("Configuración");
    pulsar(nombre);

    soloSeVe(nombre);
    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");
  });

  it("de «Plantillas email» se vuelve a «Reglas»", () => {
    montar();
    pulsar("Configuración");
    pulsar("Plantillas email");
    pulsar("Reglas");

    soloSeVe("Reglas");
  });

  it.each([
    ["/reservas?tab=configuracion&sub=plantillas", "Plantillas email"],
    ["/reservas?tab=configuracion&sub=reglas", "Reglas"],
    ["/reservas?tab=configuracion&sub=servicio", "Servicio"],
    ["/reservas?tab=configuracion&sub=mesas", "Mesas"],
    ["/reservas?tab=configuracion&sub=turnos", "Turnos"],
  ] as const)("%s abre directo «%s»", (ruta, nombre) => {
    montar(ruta);

    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");
    soloSeVe(nombre);
  });

  it.each([
    "/reservas?tab=configuracion",
    // El chip único de antes del reparto: los enlaces guardados siguen llevando a Configuración.
    "/reservas?tab=configuracion&sub=general",
    "/reservas?tab=configuracion&sub=inventada",
  ])("%s abre «Reglas»", (ruta) => {
    montar(ruta);

    soloSeVe("Reglas");
  });

  it("cambiar de chip a mano limpia el enlace de la URL, como al cambiar de pestaña", () => {
    montar("/reservas?tab=configuracion&sub=plantillas");
    pulsar("Turnos");

    expect(screen.getByTestId("ubicacion")).toHaveTextContent(/^\/reservas$/);
    // Y no vuelve a saltar a las plantillas al limpiarse la URL.
    soloSeVe("Turnos");
  });
});

describe("Reservas › Configuración · sin aviso de «Solo lectura» (solo entra quien puede editar)", () => {
  it.each(NOMBRES_CHIP)("con «Puede editar», el chip «%s» no enseña ningún «Solo lectura»", (nombre) => {
    montar("/reservas?tab=configuracion");
    pulsar(nombre);

    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
    expect(screen.queryByText(/no tiene «Puede editar» en «Reservas · Configuración»/)).not.toBeInTheDocument();
  });
});

describe("Reservas › Configuración · permiso propio «Reservas · Configuración»", () => {
  it("con «Puede editar» en la sección se ve la pestaña con todos sus chips, aunque no se editen las reservas", () => {
    h.permisos = new Set(["reservas:view", ...PUEDE_CONFIGURAR]);
    montar("/reservas?tab=configuracion");

    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");
    for (const nombre of NOMBRES_CHIP) expect(chip(nombre)).toBeInTheDocument();
  });

  it("con solo «Ver» en la sección (06/11/2026) NO hay pestaña Configuración, ni chips, ni plantillas", () => {
    h.permisos = new Set(["reservas:view", "reservas:edit", "reservas_configuracion:view"]);
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chips-subnivel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });

  it("con solo «Ver», un enlace a Configuración cae en «Hoy» y se limpia de la URL", () => {
    h.permisos = new Set(["reservas:view", "reservas_configuracion:view"]);
    montar("/reservas?tab=configuracion&sub=reglas");

    expect(screen.getByRole("tab", { name: "Hoy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("chip-reglas")).not.toBeInTheDocument();
    expect(screen.getByTestId("ubicacion")).toHaveTextContent(/^\/reservas$/);
  });

  it("sin el permiso no hay pestaña Configuración, ni chips, ni plantillas: ni siendo admin ni editando Reservas", () => {
    h.permisos = new Set(["reservas:view", "reservas:edit"]);
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chips-subnivel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
    // El resto de Reservas sigue igual.
    expect(screen.getByRole("tab", { name: "Blacklist" })).toBeInTheDocument();
  });

  it("«Puede editar» sin «Ver» no basta para ver la pestaña (la regla de siempre: editar implica ver)", () => {
    h.permisos = new Set(["reservas:view", "reservas_configuracion:edit"]);
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
  });

  it("si llega por el enlace de las plantillas sin el permiso, cae en «Hoy» en vez de en una pestaña vacía", () => {
    h.permisos = new Set(["reservas:view"]);
    montar("/reservas?tab=configuracion&sub=plantillas");

    expect(screen.getByRole("tab", { name: "Hoy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });
});
