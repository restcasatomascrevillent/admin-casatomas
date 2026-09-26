/**
 * Tests para src/components/reservas/GestionMesasEspacios.tsx
 *
 * Estrategia: se mockean los hooks de Supabase (`useMesas`, `useEspaciosReserva`)
 * y el permiso (`useSuperAdmin`) pero NO la lógica de cuadre
 * (`src/lib/reservas/aforoMesas.ts`), que corre de verdad — así estos tests
 * también cubren que la pantalla lee bien las cifras.
 *
 * DECISIÓN DEL DUEÑO (2026-09-26): esta pantalla es de SOLO LECTURA. Las
 * mesas se crean/editan/borran únicamente en el editor de plano (Super Admin
 * › Espacios). Aquí solo se comprueba el cuadre de aforo y el botón/nota que
 * lleva al editor según el permiso del usuario.
 *
 * El escenario por defecto es el ESTADO REAL DE PRODUCCIÓN del 2026-09-26, que
 * es el que motivó el encargo:
 *
 *   Comedor (casa_tomas)      50 declaradas ·  2 mesas ·  4 plazas
 *   Salón (casa_tomas)        50 declaradas · 15 mesas · 64 plazas
 *   Terraza (casa_tomas)      50 declaradas ·  3 mesas · 12 plazas
 *   Reservado (casa_tomas)    20 declaradas ·  0 mesas ·  0 plazas
 *   Interior (touza)          30 declaradas ·  0 mesas ·  0 plazas
 *   Terraza (touza)           30 declaradas ·  0 mesas ·  0 plazas
 *   El Reservado (touza)      20 declaradas ·  0 mesas ·  0 plazas
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/useEspaciosReserva");
vi.mock("@/hooks/useSuperAdmin");

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { useMesas } from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { GestionMesasEspacios } from "@/components/reservas/GestionMesasEspacios";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const espacio = (
  id: string,
  nombre: string,
  capacidad_maxima: number,
  marca: string,
  activa = true,
) => ({
  id,
  nombre,
  descripcion: null,
  capacidad_maxima,
  activa,
  caracteristicas: { marca },
});

const mesa = (
  id: string,
  espacio_id: string,
  nombre: string,
  capacidad: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  espacio_id,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 100,
  alto: 80,
  pos_x: 0,
  pos_y: 0,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...extra,
});

const ESPACIOS_PRODUCCION = [
  espacio("e-comedor", "Comedor", 50, "casa_tomas"),
  espacio("e-salon", "Salón", 50, "casa_tomas"),
  espacio("e-terraza-ct", "Terraza", 50, "casa_tomas"),
  espacio("e-reservado-ct", "Reservado", 20, "casa_tomas"),
  espacio("e-interior-tz", "Interior", 30, "touza"),
  espacio("e-terraza-tz", "Terraza", 30, "touza"),
  espacio("e-reservado-tz", "El Reservado", 20, "touza"),
];

// Comedor: 2 mesas = 4 plazas. Salón: 15 mesas = 64 plazas. Terraza CT: 3 = 12.
const MESAS_PRODUCCION = [
  mesa("m-c1", "e-comedor", "Comedor 1", 2),
  mesa("m-c2", "e-comedor", "Comedor 2", 2),
  ...Array.from({ length: 14 }, (_, i) => mesa(`m-s${i + 1}`, "e-salon", `Salón ${i + 1}`, 4)),
  mesa("m-s15", "e-salon", "Salón 15", 8),
  mesa("m-t1", "e-terraza-ct", "Terraza 1", 4),
  mesa("m-t2", "e-terraza-ct", "Terraza 2", 4),
  mesa("m-t3", "e-terraza-ct", "Terraza 3", 4),
];

function montar({
  espacios = ESPACIOS_PRODUCCION,
  mesas = MESAS_PRODUCCION,
  cargando = false,
  isSuperAdmin = true,
  cargandoPermiso = false,
}: {
  espacios?: unknown[];
  mesas?: unknown[];
  cargando?: boolean;
  isSuperAdmin?: boolean;
  cargandoPermiso?: boolean;
} = {}) {
  vi.mocked(useEspaciosReserva).mockReturnValue({
    data: espacios,
    isLoading: cargando,
  } as never);
  vi.mocked(useMesas).mockReturnValue({
    data: mesas,
    isLoading: cargando,
  } as never);
  vi.mocked(useSuperAdmin).mockReturnValue({
    isSuperAdmin,
    loading: cargandoPermiso,
  } as never);
  return render(
    <MemoryRouter>
      <GestionMesasEspacios />
    </MemoryRouter>,
  );
}

/** Bloque (tarjeta) de un espacio, localizado por su nombre visible. */
function bloqueDe(nombre: string, ocurrencia = 0): HTMLElement {
  const titulos = screen.getAllByText(nombre);
  const bloque = titulos[ocurrencia].closest("div.rounded-lg.border");
  if (!bloque) throw new Error(`No se encontró el bloque del espacio "${nombre}"`);
  return bloque as HTMLElement;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GestionMesasEspacios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Carga y estructura ─────────────────────────────────────────────────────

  it("muestra un indicador de carga mientras llegan espacios y mesas", () => {
    montar({ cargando: true });
    expect(screen.getByLabelText("Cargando")).toBeInTheDocument();
  });

  it("avisa cuando no hay ningún espacio dado de alta", () => {
    montar({ espacios: [], mesas: [] });
    expect(screen.getByText(/No hay espacios de reserva dados de alta/i)).toBeInTheDocument();
  });

  it("agrupa los espacios por negocio, Casa Tomás antes que Touza", () => {
    montar();
    const insignias = screen.getAllByTitle(/^Negocio:/);
    expect(insignias[0]).toHaveTextContent("Casa Tomás");
    expect(insignias[1]).toHaveTextContent("Touza");
  });

  it("pinta los siete espacios de producción", () => {
    montar();
    expect(screen.getByText("Comedor")).toBeInTheDocument();
    expect(screen.getByText("Salón")).toBeInTheDocument();
    expect(screen.getByText("Reservado")).toBeInTheDocument();
    expect(screen.getByText("Interior")).toBeInTheDocument();
    expect(screen.getByText("El Reservado")).toBeInTheDocument();
    // "Terraza" está en los dos negocios
    expect(screen.getAllByText("Terraza")).toHaveLength(2);
  });

  it('dice en la descripción que las mesas se gestionan en el editor de plano', () => {
    montar();
    expect(
      screen.getByText(/se dan de alta, editan y borran en el plano/i),
    ).toBeInTheDocument();
  });

  // ── El descuadre se ve ─────────────────────────────────────────────────────

  it("enseña capacidad declarada y plazas de las mesas de cada espacio", () => {
    montar();
    const salon = bloqueDe("Salón");
    expect(salon).toHaveTextContent(/Declarada\s*50/);
    expect(salon).toHaveTextContent(/15 mesas\s*=\s*64 plazas/);

    const comedor = bloqueDe("Comedor");
    expect(comedor).toHaveTextContent(/Declarada\s*50/);
    expect(comedor).toHaveTextContent(/2 mesas\s*=\s*4 plazas/);
  });

  it("avisa de que sobran plazas cuando las mesas pasan de la capacidad declarada", () => {
    montar();
    // Salón: 64 plazas frente a 50 declaradas
    expect(bloqueDe("Salón")).toHaveTextContent(/Sobran 14 plazas/i);
  });

  it("avisa de que faltan plazas cuando las mesas no llegan a la capacidad declarada", () => {
    montar();
    // Comedor: 4 plazas frente a 50 declaradas
    expect(bloqueDe("Comedor")).toHaveTextContent(/Faltan 46 plazas/i);
  });

  it("marca los espacios sin ninguna mesa dada de alta", () => {
    montar();
    const reservado = bloqueDe("Reservado");
    expect(reservado).toHaveTextContent(/Sin mesas/i);
    expect(reservado).toHaveTextContent(/no tiene mesas dadas de alta/i);
  });

  it("deja claro que el descuadre no impide reservar ni guardar", () => {
    montar();
    expect(bloqueDe("Salón")).toHaveTextContent(/No impide reservar/i);
    expect(
      screen.getByText(/Los avisos de arriba no\s+impiden guardar ni reservar/i),
    ).toBeInTheDocument();
  });

  it("no avisa cuando un espacio cuadra", () => {
    montar({
      espacios: [espacio("e-ok", "Sala Cuadrada", 8, "casa_tomas")],
      mesas: [mesa("m-1", "e-ok", "Mesa 1", 4), mesa("m-2", "e-ok", "Mesa 2", 4)],
    });
    const bloque = bloqueDe("Sala Cuadrada");
    expect(bloque).toHaveTextContent(/Cuadra/);
    expect(bloque).not.toHaveTextContent(/No impide reservar/i);
  });

  it("resume por negocio el aforo declarado frente a la suma de mesas", () => {
    montar();
    // Casa Tomás: 50+50+50+20 = 170 declaradas, 4+64+12+0 = 80 sumando mesas.
    const declarados = screen.getAllByText(/Aforo declarado/i);
    expect(declarados[0]).toHaveTextContent(/170/);
    // Touza: 30+30+20 = 80 declaradas.
    expect(declarados[1]).toHaveTextContent(/80/);
    const resumenes = screen.getAllByText(/sumando mesas/i);
    expect(resumenes[0]).toHaveTextContent("80");
    // Touza: 30+30+20 = 80 declaradas, 0 sumando mesas → se quedaría sin aforo.
    expect(resumenes[1]).toHaveTextContent("0");
    expect(screen.getByText(/Sin mesas en ninguna sala/i)).toBeInTheDocument();
  });

  it("no marca a un negocio como bloqueado si alguna de sus salas tiene mesas", () => {
    montar();
    // Casa Tomás tiene "Reservado" a 0 mesas, pero sus otras salas suman 80:
    // el trigger de aforo suma por MARCA, así que no se quedaría sin aforo.
    const insigniasBloqueo = screen.queryAllByText(/Sin mesas en ninguna sala/i);
    expect(insigniasBloqueo).toHaveLength(1);
  });

  // ── Mesas: listado (solo lectura) ───────────────────────────────────────────

  it("lista las mesas de cada espacio con sus plazas", () => {
    montar();
    const comedor = bloqueDe("Comedor");
    expect(within(comedor).getByText("Comedor 1")).toBeInTheDocument();
    expect(within(comedor).getByText("Comedor 2")).toBeInTheDocument();
    expect(within(comedor).getAllByText("2 plazas")).toHaveLength(2);
  });

  it("muestra las mesas desactivadas sin que sumen plazas", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [
        mesa("m-1", "e-x", "Mesa viva", 4),
        mesa("m-2", "e-x", "Mesa guardada", 6, { activa: false }),
      ],
    });
    const bloque = bloqueDe("Sala X");
    expect(within(bloque).getByText("Mesa guardada")).toBeInTheDocument();
    expect(within(bloque).getByText("Sin usar")).toBeInTheDocument();
    // Solo cuenta la activa: 1 mesa = 4 plazas
    expect(bloque).toHaveTextContent(/1 mesa\s*=\s*4 plazas/);
  });

  it("señala las mesas unidas en el plano", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "Mesa 1+2", 8, { is_merged: true })],
    });
    expect(within(bloqueDe("Sala X")).getByText("Unida")).toBeInTheDocument();
  });

  it("no ofrece ningún botón de añadir, editar ni borrar una mesa concreta", () => {
    montar();
    expect(screen.queryByRole("button", { name: /Añadir mesa/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar (Comedor|Salón|Terraza)/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Borrar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // El único botón "Editar..." que queda es el que lleva al plano, no uno por mesa.
    const botonesEditar = screen.getAllByRole("button", { name: /^Editar/i });
    for (const boton of botonesEditar) {
      expect(boton).toHaveTextContent(/Editar mesas en el plano/i);
    }
  });

  // ── Acceso al editor de plano ───────────────────────────────────────────────

  it('ofrece "Editar mesas en el plano" cuando el usuario puede entrar a Super Admin', () => {
    montar({ isSuperAdmin: true });
    const botones = screen.getAllByRole("button", { name: /Editar mesas en el plano/i });
    expect(botones.length).toBeGreaterThan(0);
  });

  it("navega al editor del espacio correcto al pulsar el botón", () => {
    montar({ isSuperAdmin: true });
    fireEvent.click(
      within(bloqueDe("Comedor")).getByRole("button", { name: /Editar mesas en el plano/i }),
    );
    expect(navigateMock).toHaveBeenCalledWith("/super-admin/espacios?editar=e-comedor");
  });

  it('muestra una nota en vez del botón cuando el usuario NO puede entrar a Super Admin', () => {
    montar({ isSuperAdmin: false });
    expect(
      screen.queryByRole("button", { name: /Editar mesas en el plano/i }),
    ).not.toBeInTheDocument();
    const notas = screen.getAllByText(/Las mesas se gestionan en el plano/i);
    expect(notas.length).toBeGreaterThan(0);
  });

  it("no ofrece el botón mientras se resuelve el permiso de super admin", () => {
    montar({ isSuperAdmin: true, cargandoPermiso: true });
    expect(
      screen.queryByRole("button", { name: /Editar mesas en el plano/i }),
    ).not.toBeInTheDocument();
  });

  // ── Espacios desactivados ──────────────────────────────────────────────────

  it("marca los espacios desactivados y los deja fuera del resumen del negocio", () => {
    montar({
      espacios: [
        espacio("e-on", "Sala Activa", 10, "casa_tomas"),
        espacio("e-off", "Sala Cerrada", 40, "casa_tomas", false),
      ],
      mesas: [mesa("m-1", "e-on", "Mesa 1", 10)],
    });
    expect(within(bloqueDe("Sala Cerrada")).getByText("Desactivado")).toBeInTheDocument();
    // El resumen por negocio replica el filtro del trigger (`activa = true`):
    // solo cuenta la sala activa, así que declara 10 y no 50.
    expect(screen.getByText(/Aforo declarado/i).closest("span")).toHaveTextContent(/10/);
  });
});
