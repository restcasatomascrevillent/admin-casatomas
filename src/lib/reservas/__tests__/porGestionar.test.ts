import { describe, it, expect } from "vitest";
import {
  construirItemsPorGestionar,
  contarAvisosSinLeer,
  motivoSolicitud,
  RUTA_SOLICITUDES,
} from "../porGestionar";

const reserva = (o = {}) => ({ id: "r1", nombre: "Ana", fecha: "2026-11-12", hora: "21:00:00", numero_comensales: 4, estado: "pendiente", marca: "casa_tomas", ...o });
const solicitud = (o = {}) => ({ id: "s1", nombre: "Luis", fecha_solicitada: "2026-11-11", hora_solicitada: "14:00:00", numero_comensales: 12, motivo_rechazo: "grupo_grande", estado: "pendiente", marca: "casa_tomas", ...o });

describe("construirItemsPorGestionar", () => {
  it("junta reservas pendientes/verificadas y solicitudes abiertas, ordenadas por fecha y hora", () => {
    const items = construirItemsPorGestionar([reserva(), reserva({ id: "r2", estado: "verificada", fecha: "2026-11-10", hora: "13:30" })], [solicitud()], "2026-11-10");
    expect(items.map((i) => i.clave)).toEqual(["reserva-r2", "solicitud-s1", "reserva-r1"]);
    expect(items[0].hora).toBe("13:30");
    expect(items[0].detalle).toContain("Verificada");
    expect(items[1].detalle).toBe("Grupo grande");
    expect(items[1].ruta).toBe(RUTA_SOLICITUDES);
    expect(items[2].ruta).toBe("/reservas?tab=reservas&status=pendiente");
  });

  it("descarta confirmadas, pasadas, solicitudes cerradas y otros negocios", () => {
    const items = construirItemsPorGestionar(
      [reserva({ estado: "confirmada" }), reserva({ id: "r3", fecha: "2026-11-09" }), reserva({ id: "r4", marca: "touza" })],
      [solicitud({ estado: "resuelta" }), solicitud({ id: "s2", marca: "touza" }), solicitud({ id: "s3", estado: "contactado", fecha_solicitada: null })],
      "2026-11-10",
    );
    expect(items.map((i) => i.clave)).toEqual(["solicitud-s3"]);
  });

  it("nombre vacío y motivo desconocido tienen texto por defecto", () => {
    const [i] = construirItemsPorGestionar([], [solicitud({ nombre: " ", motivo_rechazo: "otro" })], "2026-11-10");
    expect(i.nombre).toBe("Sin nombre");
    expect(motivoSolicitud(null)).toBe("Solicitud del asistente");
  });
});

describe("contarAvisosSinLeer", () => {
  const avisos = [
    { leida: false, tipo: "solicitud_pendiente", referencia_tipo: "solicitud" },
    { leida: false, tipo: "facturas_subida", referencia_tipo: "facturas_cargar" },
    { leida: true, tipo: "otro", referencia_tipo: null },
  ];
  it("cuenta todos los sin leer si no se ve «Por gestionar»", () => expect(contarAvisosSinLeer(avisos, false)).toBe(2));
  it("no repite los avisos de solicitud si se ve", () => expect(contarAvisosSinLeer(avisos, true)).toBe(1));
});
