/**
 * Tests para src/components/reservas/GestionMesasEspacios.tsx
 *
 * Estrategia: se mockean los hooks de Supabase (`useMesas`, `useActualizarMesa`,
 * `useEspaciosReserva`) y el permiso (`useSuperAdmin`) pero NO la lógica de
 * cuadre (`src/lib/reservas/aforoMesas.ts`) ni el helper de nombres
 * (`src/components/espacios/nombresMesa.ts`), que corren de verdad — así estos
 * tests también cubren que la pantalla lee bien las cifras y que valida el
 * número con el MISMO criterio que el índice único de Postgres.
 *
 * ENCARGO DEL DUEÑO (2026-09-27), que cambia la decisión del 26: el NÚMERO de
 * mesa se corrige AQUÍ ("en sala se dice 'la 7'"), pero las mesas se siguen
 * dando de alta y borrando SOLO en el editor de plano. O sea: esta pantalla
 * tiene edición del número y NO tiene crear/borrar.
 *
 * El escenario por defecto es el ESTADO REAL DE PRODUCCIÓN del 2026-09-26 (aún
 * sin uniones en los fixtures; las uniones se prueban aparte con los datos
 * verificados el 2026-09-27):
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
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/useEspaciosReserva");
vi.mock("@/hooks/useSuperAdmin");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { useMesas, useActualizarMesa } from "@/hooks/useMesas";
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

/** Fila de UNIÓN, tal como la guarda el editor de plano: nombre compuesto + is_merged. */
const union = (id: string, espacio_id: string, nombre: string, capacidad: number) =>
  mesa(id, espacio_id, nombre, capacidad, { is_merged: true });

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

const mutateAsyncMock = vi.fn();

function montar({
  espacios = ESPACIOS_PRODUCCION,
  mesas = MESAS_PRODUCCION,
  cargando = false,
  isSuperAdmin = true,
  cargandoPermiso = false,
  guardando = false,
}: {
  espacios?: unknown[];
  mesas?: unknown[];
  cargando?: boolean;
  isSuperAdmin?: boolean;
  cargandoPermiso?: boolean;
  guardando?: boolean;
} = {}) {
  vi.mocked(useEspaciosReserva).mockReturnValue({
    data: espacios,
    isLoading: cargando,
  } as never);
  vi.mocked(useMesas).mockReturnValue({
    data: mesas,
    isLoading: cargando,
  } as never);
  vi.mocked(useActualizarMesa).mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: guardando,
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

/** Abre el editor del número de una mesa y devuelve el input. */
function editarNumeroDe(nombreMesa: string): HTMLInputElement {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`Cambiar el número de la mesa ${nombreMesa}$`) }),
  );
  return screen.getByRole("textbox", {
    name: new RegExp(`Número de la mesa ${nombreMesa}$`),
  }) as HTMLInputElement;
}

const botonGuardar = () => screen.getByRole("button", { name: "Guardar" });

/**
 * Aviso del campo, localizado A TRAVÉS de `aria-describedby` — así el test
 * comprueba de paso que el aviso está bien asociado al input. Hace falta porque
 * el aviso de descuadre del espacio también es `role="status"`.
 */
function avisoDe(input: HTMLInputElement): HTMLElement {
  const id = input.getAttribute("aria-describedby");
  const aviso = id ? document.getElementById(id) : null;
  if (!aviso) throw new Error("El campo no tiene ningún aviso asociado por aria-describedby");
  expect(aviso).toHaveAttribute("role", "status");
  return aviso;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GestionMesasEspacios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsyncMock.mockResolvedValue({});
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

  it("dice en la descripción que las mesas se dan de alta en el plano y que el número se corrige aquí", () => {
    montar();
    // El texto sale en la cabecera de la tarjeta y también en la nota de cada espacio.
    expect(
      screen.getAllByText(/se dan de alta y se borran en el plano/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/corrige aquí el número/i)).toBeInTheDocument();
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
      screen.getByText(/Los avisos de\s+arriba no impiden guardar ni reservar/i),
    ).toBeInTheDocument();
  });

  it("no avisa cuando un espacio cuadra", () => {
    montar({
      espacios: [espacio("e-ok", "Sala Cuadrada", 8, "casa_tomas")],
      mesas: [mesa("m-1", "e-ok", "1", 4), mesa("m-2", "e-ok", "2", 4)],
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

  // ── Mesas reales vs mesas juntadas (datos reales del 2026-09-27) ────────────

  it("separa mesas reales de mesas juntadas: el Salón pasa de 64 plazas a 36", () => {
    // Producción, 2026-09-27: el Salón tiene 15 filas de las que 7 son uniones
    // (nombres compuestos "2+1", "3+4", "11+10"...). 8 mesas reales suman 36
    // plazas; las 7 uniones suman 28 que YA están contadas en las originales.
    montar({
      espacios: [espacio("e-salon", "Salón", 50, "casa_tomas")],
      mesas: [
        ...Array.from({ length: 6 }, (_, i) => mesa(`m-r${i}`, "e-salon", `${i + 1}`, 4)),
        mesa("m-g1", "e-salon", "20", 6),
        mesa("m-g2", "e-salon", "21", 6),
        ...Array.from({ length: 7 }, (_, i) => union(`m-u${i}`, "e-salon", `${i}+${i + 1}`, 4)),
      ],
    });
    const salon = bloqueDe("Salón");
    expect(salon).toHaveTextContent(/8 mesas\s*=\s*36 plazas/);
    expect(salon).toHaveTextContent(/\+\s*7 juntadas\s*\(\s*28 plazas, no cuentan para el aforo\)/);
    // Y el descuadre se cuenta sobre las reales: 36 frente a 50 declaradas.
    expect(salon).toHaveTextContent(/Faltan 14 plazas/i);
  });

  it("señala las mesas unidas en el plano", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "1+2", 8, { is_merged: true })],
    });
    expect(within(bloqueDe("Sala X")).getByText("Unida")).toBeInTheDocument();
  });

  it("un espacio con SOLO uniones dice qué hacer, no un genérico 'sin mesas'", () => {
    // Terraza en producción (2026-09-27): 3 filas y las 3 son uniones, así que
    // no queda ni una mesa real y su aforo real es 0. Eso es correcto y hay que
    // enseñarlo: su plano está roto.
    montar({
      espacios: [espacio("e-terraza", "Terraza", 50, "casa_tomas")],
      mesas: [
        union("m-u1", "e-terraza", "2+1", 4),
        union("m-u2", "e-terraza", "3+4", 4),
        union("m-u3", "e-terraza", "15+14", 4),
      ],
    });
    const terraza = bloqueDe("Terraza");
    expect(terraza).toHaveTextContent(/0 mesas\s*=\s*0 plazas/);
    expect(terraza).toHaveTextContent(/\+\s*3 juntadas\s*\(\s*12 plazas, no cuentan/);
    expect(terraza).toHaveTextContent(/Solo mesas unidas/i);
    expect(terraza).toHaveTextContent(/Las 3 mesas de este espacio son uniones/i);
    expect(terraza).toHaveTextContent(/se perdieron las originales al fusionarlas/i);
    expect(terraza).toHaveTextContent(/volver a darlas de alta en el editor de plano/i);
  });

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

  // ── Edición del NÚMERO de mesa (encargo del 2026-09-27) ────────────────────

  it("se puede corregir el número de una mesa, pero NO hay crear ni borrar mesas", () => {
    // Sustituye al test de "solo lectura" del 2026-09-26: el dueño cambió de
    // criterio y el número se edita aquí. Lo que sigue estando SOLO en el editor
    // de plano es dar de alta y borrar.
    montar();
    expect(screen.queryByRole("button", { name: /Añadir mesa/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nueva mesa/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Borrar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // El único botón "Editar..." sigue siendo el que lleva al plano.
    for (const boton of screen.getAllByRole("button", { name: /^Editar/i })) {
      expect(boton).toHaveTextContent(/Editar mesas en el plano/i);
    }
    // Y cada mesa real tiene su botón de cambiar el número.
    expect(
      screen.getAllByRole("button", { name: /^Cambiar el número de la mesa/ }).length,
    ).toBe(MESAS_PRODUCCION.length);
  });

  it("al abrir el editor aparece el número actual en un campo con nombre accesible", () => {
    montar();
    const input = editarNumeroDe("Comedor 1");
    expect(input).toHaveValue("Comedor 1");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("guarda el número nuevo recortando los espacios", async () => {
    montar();
    const input = editarNumeroDe("Comedor 1");
    fireEvent.change(input, { target: { value: "  7  " } });
    expect(botonGuardar()).toBeEnabled();
    fireEvent.click(botonGuardar());
    expect(mutateAsyncMock).toHaveBeenCalledWith({ id: "m-c1", nombre: "7" });
    // Al terminar el guardado el editor se cierra solo.
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Número de la mesa/ })).not.toBeInTheDocument(),
    );
  });

  it("guarda con Enter y cancela con Escape", async () => {
    montar();
    let input = editarNumeroDe("Comedor 1");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutateAsyncMock).toHaveBeenCalledWith({ id: "m-c1", nombre: "7" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Número de la mesa/ })).not.toBeInTheDocument(),
    );

    input = editarNumeroDe("Comedor 2");
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /Número de la mesa/ })).not.toBeInTheDocument();
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("avisa en vivo y no deja guardar si el número ya existe en ese espacio", () => {
    // Caso real: el Salón tiene DOS mesas "9" en producción porque nada lo
    // impedía. Aquí se comprueba con el mismo criterio que el índice único:
    // mismo espacio, normalizando espacios y mayúsculas.
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "7", 4), mesa("m-2", "e-x", "9", 6)],
    });
    const input = editarNumeroDe("7");
    fireEvent.change(input, { target: { value: "9" } });
    // El aviso está asociado al campo para que lo lea un lector de pantalla.
    expect(avisoDe(input)).toHaveTextContent(/Ya hay una mesa llamada "9"/i);
    expect(botonGuardar()).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(botonGuardar());
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("detecta el duplicado aunque cambien mayúsculas y espacios (igual que el índice)", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "Barra 1", 4), mesa("m-2", "e-x", "Mesa 9", 6)],
    });
    const input = editarNumeroDe("Barra 1");
    fireEvent.change(input, { target: { value: "  mesa   9 " } });
    expect(botonGuardar()).toBeDisabled();
  });

  it("un número libre sí se puede guardar", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "7", 4), mesa("m-2", "e-x", "9", 6)],
    });
    const input = editarNumeroDe("7");
    fireEvent.change(input, { target: { value: "8" } });
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(botonGuardar()).toBeEnabled();
  });

  it("una mesa no choca consigo misma (se excluye su propio id)", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "7", 4), mesa("m-2", "e-x", "9", 6)],
    });
    const input = editarNumeroDe("7");
    fireEvent.change(input, { target: { value: "7" } });
    expect(botonGuardar()).toBeEnabled();
    // Y guardar lo mismo no lanza ningún UPDATE.
    fireEvent.click(botonGuardar());
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("no deja guardar un número vacío (la columna nombre es NOT NULL)", () => {
    montar();
    const input = editarNumeroDe("Comedor 1");
    fireEvent.change(input, { target: { value: "   " } });
    expect(avisoDe(input)).toHaveTextContent(/no puede quedar vacío/i);
    expect(botonGuardar()).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("avisa sin bloquear cuando el nombre no lleva ningún número", () => {
    // En producción hay una mesa llamada "o" en el Comedor: un tecleo suelto.
    // Pero hay salas con "Barra" o "1A" y el dueño decide, así que solo se avisa.
    montar();
    const input = editarNumeroDe("Comedor 1");
    fireEvent.change(input, { target: { value: "Barra" } });
    expect(avisoDe(input)).toHaveTextContent(/no lleva ningún número/i);
    expect(botonGuardar()).toBeEnabled();
  });

  it("una mesa UNIDA no tiene campo de edición y explica por qué", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "7", 4), union("m-u", "e-x", "11+10", 8)],
    });
    expect(
      screen.queryByRole("button", { name: /Cambiar el número de la mesa 11\+10/ }),
    ).not.toBeInTheDocument();
    // La real sí se puede renombrar.
    expect(
      screen.getByRole("button", { name: /Cambiar el número de la mesa 7$/ }),
    ).toBeInTheDocument();
    expect(screen.getByTitle(/El número de una mesa unida lo genera el editor de plano/i))
      .toHaveTextContent("11+10");
  });

  it("si el guardado falla, el campo sigue abierto con lo escrito", async () => {
    montar();
    mutateAsyncMock.mockRejectedValueOnce({ code: "23505", message: "uq_mesas_espacio_nombre_real" });
    const input = editarNumeroDe("Comedor 1");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.click(botonGuardar());
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    // El aviso humano lo da `useActualizarMesa` por toast; aquí lo que importa
    // es no perder lo que el usuario había escrito.
    expect(
      screen.getByRole("textbox", { name: /Número de la mesa Comedor 1$/ }),
    ).toHaveValue("9");
  });

  it("mientras guarda, el campo y los botones quedan bloqueados", () => {
    montar({ guardando: true });
    const input = editarNumeroDe("Comedor 1");
    expect(input).toBeDisabled();
    expect(botonGuardar()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
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
    const notas = screen.getAllByText(/Las mesas se dan de alta y se borran en el plano \(Super Admin/i);
    expect(notas.length).toBeGreaterThan(0);
  });

  it("corregir el número NO está detrás del permiso de super admin", () => {
    // El encargo del dueño es que se pueda arreglar el número desde la pestaña
    // de Configuración, sin pasar por Super Admin.
    montar({ isSuperAdmin: false });
    expect(
      screen.getAllByRole("button", { name: /^Cambiar el número de la mesa/ }).length,
    ).toBeGreaterThan(0);
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
      mesas: [mesa("m-1", "e-on", "1", 10)],
    });
    expect(within(bloqueDe("Sala Cerrada")).getByText("Desactivado")).toBeInTheDocument();
    // El resumen por negocio replica el filtro del trigger (`activa = true`):
    // solo cuenta la sala activa, así que declara 10 y no 50.
    expect(screen.getByText(/Aforo declarado/i).closest("span")).toHaveTextContent(/10/);
  });
});
