import { describe, it, expect } from "vitest";
import {
  admiteReservas,
  MARCA_POR_DEFECTO,
  marcaDeEspacio,
  normalizarMarca,
  salaAdmiteReservas,
} from "@/lib/reservas/negocios";
import { cifrasDeLaLista } from "@/lib/reservas/cifrasPorEstado";
import { aforoCasaTomas, resumirDia, resumirMes } from "@/lib/reservas/ocupacionCalendario";
import { calcularCuadres, calcularCuadreTotal } from "@/lib/reservas/aforoMesas";
import { resumirOcupacion } from "@/lib/reservas/resumenOcupacion";
import {
  contarSolicitudesPendientes,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
} from "@/lib/reservas/vistaUnificada";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";

// Decisión del dueño 2026-10-01: «toda la lógica de reservas de Touza va fuera, no se reserva».
// Solo Casa Tomás admite reservas. La regla es UNA (`admiteReservas`, negocios.ts) y la usan todas
// las pantallas para ignorar lo que quede de Touza en la base de datos (5 reservas de demostración,
// 2 vivas, y sus 3 salas todavía activas). Antes había dos filtros locales que hacían lo mismo
// (`esDeCasaTomas` en el calendario y la comprobación de `MARCA_POR_DEFECTO` de la asignación).
//
// Touza no admite reservas (decisión del dueño 2026-10-01): se retiran los tests del panel de dos
// negocios (alta con la marca de la sala, marca de una solicitud por la sala o las notas, sala única de
// Touza preseleccionada, etiquetas «Touza · El Reservado», filtro «Negocio», agrupar por negocio,
// aforo y franjas por negocio y el resumen de hoy con desglose por negocio).

/** Las salas de producción (2026-10-01): dos «Terraza» y «Reservado» ≠ «El Reservado». */
const ESPACIOS_BD = [
  { id: "ct-comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: {} },
  { id: "ct-salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: null },
  { id: "ct-terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "ct-reservado", nombre: "Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "tz-reservado", nombre: "El Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { privada: true, marca: "touza" } },
  { id: "tz-terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
  { id: "tz-interior", nombre: "Interior", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
];

describe("negocios: de dónde sale la marca", () => {
  it("normaliza null/vacío a Casa Tomás", () => {
    expect(MARCA_POR_DEFECTO).toBe("casa_tomas");
    expect(normalizarMarca(null)).toBe("casa_tomas");
    expect(normalizarMarca("  ")).toBe("casa_tomas");
    expect(normalizarMarca(" touza ")).toBe("touza");
  });

  it("espacio: caracteristicas.marca (o `marca` ya aplanada); sin etiqueta = Casa Tomás, como el trigger", () => {
    expect(marcaDeEspacio(ESPACIOS_BD[0])).toBe("casa_tomas");
    expect(marcaDeEspacio(ESPACIOS_BD[1])).toBe("casa_tomas");
    expect(marcaDeEspacio(ESPACIOS_BD[4])).toBe("touza");
    expect(marcaDeEspacio({ marca: "touza" })).toBe("touza");
    expect(marcaDeEspacio(null)).toBe("casa_tomas");
  });
});

describe("admiteReservas: el interruptor central (solo Casa Tomás)", () => {
  it("Casa Tomás y lo que no tiene marca (null, vacío, espacios) sí; Touza o cualquier otra marca, no", () => {
    for (const marca of ["casa_tomas", " casa_tomas ", null, undefined, "", "   "]) {
      expect(admiteReservas(marca), String(marca)).toBe(true);
    }
    for (const marca of ["touza", "Touza", "otra", "pulperia"]) {
      expect(admiteReservas(marca), marca).toBe(false);
    }
  });

  it("salaAdmiteReservas: la misma regla con la marca de la sala; las dos «Terraza» se distinguen por su marca", () => {
    const admitidas = ESPACIOS_BD.filter(salaAdmiteReservas).map((e) => e.id);
    expect(admitidas).toEqual(["ct-comedor", "ct-salon", "ct-terraza", "ct-reservado"]);
    // Mismo nombre, distinto negocio: el nombre no decide nada.
    const terrazas = ESPACIOS_BD.filter((e) => e.nombre === "Terraza");
    expect(terrazas.map(salaAdmiteReservas)).toEqual([true, false]);
    // «Reservado» (Casa Tomás) se queda; «El Reservado» (Touza), no.
    expect(salaAdmiteReservas(ESPACIOS_BD.find((e) => e.nombre === "Reservado"))).toBe(true);
    expect(salaAdmiteReservas(ESPACIOS_BD.find((e) => e.nombre === "El Reservado"))).toBe(false);
  });
});

// ─── Las reservas de Touza que quedan en la base de datos se IGNORAN en todas las cifras ────────────

const HOY = "2026-10-01";
const reserva = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  fecha: HOY,
  hora: "21:00:00",
  nombre: `Cliente ${id}`,
  telefono: null,
  email: null,
  estado: "confirmada",
  canal: "web",
  numero_comensales: 4,
  notas_cliente: null,
  espacio_id: null as string | null,
  marca: "casa_tomas" as string | null,
  ...o,
});

/** Casa Tomás: 3 reservas de hoy (2 confirmadas y 1 pendiente, 10 comensales vivos). */
const CASA_TOMAS = [
  reserva("ct1", { numero_comensales: 4, espacio_id: "ct-salon" }),
  reserva("ct2", { numero_comensales: 2, marca: null }),
  reserva("ct3", { numero_comensales: 4, estado: "pendiente", hora: "14:00:00" }),
];
/** Las de Touza de producción que caen hoy y mañana (las 2 vivas) y una pasada. */
const TOUZA = [
  reserva("tz-hoy", { numero_comensales: 6, espacio_id: "tz-reservado", marca: "touza" }),
  reserva("tz-manana", { fecha: "2026-10-02", estado: "verificada", numero_comensales: 10, espacio_id: "tz-reservado", marca: "touza" }),
  reserva("tz-pasada", { fecha: "2026-09-26", estado: "pendiente", numero_comensales: 14, marca: "touza" }),
];
const TODAS = [...CASA_TOMAS, ...TOUZA];

describe("Touza se ignora en los recuentos (misma regla en todas las pantallas)", () => {
  it("Lista: ni sus reservas ni sus solicitudes llegan a ser filas; el «N reservas» es el de Casa Tomás", () => {
    const solicitudes = [
      { id: "s-ct", estado: "pendiente", fecha_solicitada: HOY, hora_solicitada: "21:00", marca: "casa_tomas", motivo_rechazo: "grupo_grande" },
      { id: "s-tz", estado: "pendiente", fecha_solicitada: HOY, hora_solicitada: "21:00", marca: "touza", motivo_rechazo: "grupo_grande" },
    ] as unknown as SolicitudPendiente[];
    const filas = unificarReservasYSolicitudes(TODAS, solicitudes);
    expect(filas.map((f) => f.id).sort()).toEqual(["ct1", "ct2", "ct3", "solicitud-s-ct"]);
    const deHoy = filtrarFilasUnificadas(filas, { fecha: HOY });
    expect(deHoy.filter((f) => f.tipo === "reserva")).toHaveLength(3);
  });

  it("Insignia de la pestaña Lista: solo las solicitudes pendientes de Casa Tomás (las que enseña la lista)", () => {
    const solicitudes = [
      { id: "s-ct", estado: "pendiente", marca: "casa_tomas" },
      { id: "s-sin-marca", estado: "pendiente", marca: null },
      { id: "s-ct-contactado", estado: "contactado", marca: "casa_tomas" },
      { id: "s-tz", estado: "pendiente", marca: "touza" },
    ] as unknown as SolicitudPendiente[];
    expect(contarSolicitudesPendientes(solicitudes)).toBe(2);
    // Todas cerradas: 0 (lo que antes probaba el `countPendientes` del hook, ya retirado).
    const cerradas = [
      { id: "s1", estado: "resuelta", marca: "casa_tomas" },
      { id: "s2", estado: "descartada", marca: null },
    ] as unknown as SolicitudPendiente[];
    expect(contarSolicitudesPendientes(cerradas)).toBe(0);
  });

  it("Timeline de la Lista: las cifras por estado son las de Casa Tomás", () => {
    expect(cifrasDeLaLista(TODAS, {})).toEqual(cifrasDeLaLista(CASA_TOMAS, {}));
    expect(cifrasDeLaLista(TODAS, {})).toMatchObject({ confirmada: 2, pendiente: 1, verificada: 0 });
  });

  it("Calendario: comensales, reservas y % del día solo de Casa Tomás; un día con solo Touza sale vacío", () => {
    const contexto = { hoy: HOY, ahora: Date.parse("2026-10-01T16:00:00Z"), ventanaHoras: 48 };
    const dia = resumirDia(HOY, TODAS, 170, contexto);
    expect(dia).toMatchObject({ reservas: 3, comensales: 10 });
    expect(dia.turnos.cena.comensales).toBe(6);
    const mes = resumirMes(TODAS, 170, contexto);
    expect(mes["2026-10-02"]).toBeUndefined();
  });

  it("Aforo: las salas de Touza no suman (ni en el calendario ni en el cuadre de mesas)", () => {
    expect(aforoCasaTomas(ESPACIOS_BD)).toBe(170);
    const total = calcularCuadreTotal(
      calcularCuadres(ESPACIOS_BD.map((e) => ({ ...e, caracteristicas: e.caracteristicas ?? undefined })), []),
    );
    expect(total?.capacidadDeclarada).toBe(170);
  });

  it("Hoy (franja de cifras): reservas, comensales, capacidad y % de Casa Tomás", () => {
    expect(resumirOcupacion(TODAS.filter((r) => r.fecha === HOY), ESPACIOS_BD)).toMatchObject({
      totalReservas: 3,
      totalComensales: 10,
      capacidadTotal: 170,
      porcentajeTotal: 6,
      reservasConfirmadas: 2,
    });
  });
});
