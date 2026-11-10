import { beforeEach, describe, expect, it } from "vitest";
import { detectarNuevas, textoAlerta, tituloConCifra, type CancelacionFila } from "../detectar";
import { avisosEnVivo, CLAVE_SONIDO, guardarSonidoActivo, leerSonidoActivo } from "../preferencias";
import type { ItemPorGestionar } from "@/lib/reservas/porGestionar";
import { __resetCambiosPropiosParaTests, esCambioPropio, marcarCambioPropio } from "@/lib/reservas/cambiosPropios";

const reserva = (id: string, canal: string | null = "web"): ItemPorGestionar => ({
  clave: `reserva-${id}`,
  tipo: "reserva",
  id,
  fecha: "2026-11-12",
  hora: "21:00",
  nombre: "Ana",
  personas: 4,
  detalle: "Pendiente de confirmar",
  ruta: "/reservas?tab=reservas&status=pendiente",
  canal,
});

const solicitud = (id: string): ItemPorGestionar => ({
  clave: `solicitud-${id}`,
  tipo: "solicitud",
  id,
  fecha: "2026-11-13",
  hora: "14:00",
  nombre: "Luis",
  personas: 12,
  detalle: "Grupo grande",
  ruta: "/reservas?tab=reservas&status=solicitudes",
});

const cancelada = (id: string, canal: string | null = "telefono"): CancelacionFila => ({
  id,
  nombre: "Eva",
  fecha: "2026-11-12",
  hora: "13:30:00",
  numero_comensales: 2,
  canal,
});

const nadaPropio = () => false;

describe("detectarNuevas", () => {
  it("la primera lectura no avisa, pero deja todo como ya avisado", () => {
    const r = detectarNuevas({ porGestionar: [reserva("a")], canceladas: [cancelada("c")], avisados: new Set(), primeraVez: true, esPropio: nadaPropio });
    expect(r.nuevas).toEqual([]);
    expect([...r.avisados].sort()).toEqual(["cancelacion-c", "reserva-a"]);
  });

  it("avisa de lo nuevo (reserva, solicitud y cancelación) con el texto completo", () => {
    const r = detectarNuevas({
      porGestionar: [reserva("a"), reserva("b"), solicitud("s")],
      canceladas: [cancelada("c")],
      avisados: new Set(["reserva-a"]),
      primeraVez: false,
      esPropio: nadaPropio,
    });
    expect(r.nuevas.map((n) => n.clave)).toEqual(["reserva-b", "solicitud-s", "cancelacion-c"]);
    expect(r.nuevas[0]).toMatchObject({ titulo: "Nueva reserva", texto: "Ana · 12/11 21:00 · 4 pers." });
    expect(r.nuevas[1].titulo).toBe("Nueva solicitud: Grupo grande");
    expect(r.nuevas[2]).toMatchObject({ titulo: "Reserva cancelada por el cliente", texto: "Eva · 12/11 13:30 · 2 pers." });
  });

  it("no duplica: lo ya avisado no vuelve a avisar en lecturas siguientes", () => {
    const primera = detectarNuevas({ porGestionar: [], canceladas: [], avisados: new Set(), primeraVez: true, esPropio: nadaPropio });
    const segunda = detectarNuevas({ porGestionar: [reserva("b")], canceladas: [], avisados: primera.avisados, primeraVez: false, esPropio: nadaPropio });
    expect(segunda.nuevas).toHaveLength(1);
    const tercera = detectarNuevas({ porGestionar: [reserva("b")], canceladas: [], avisados: segunda.avisados, primeraVez: false, esPropio: nadaPropio });
    expect(tercera.nuevas).toEqual([]);
    // Si sale y vuelve a entrar (p. ej. relectura sin ella), tampoco: se recuerda toda la sesión.
    const cuarta = detectarNuevas({ porGestionar: [], canceladas: [], avisados: tercera.avisados, primeraVez: false, esPropio: nadaPropio });
    const quinta = detectarNuevas({ porGestionar: [reserva("b")], canceladas: [], avisados: cuarta.avisados, primeraVez: false, esPropio: nadaPropio });
    expect(quinta.nuevas).toEqual([]);
  });

  it("no avisa de lo dado de alta en el panel (manual, presencial) ni de lo que este panel acaba de cambiar", () => {
    __resetCambiosPropiosParaTests();
    marcarCambioPropio("propia");
    const r = detectarNuevas({
      porGestionar: [reserva("m", "manual"), reserva("p", "presencial"), reserva("propia", "web")],
      canceladas: [cancelada("propia"), cancelada("cm", "manual")],
      avisados: new Set(),
      primeraVez: false,
      esPropio: (id) => esCambioPropio(id),
    });
    expect(r.nuevas).toEqual([]);
    // Pero quedan como avisadas: no saltan más tarde.
    expect(r.avisados.has("reserva-m")).toBe(true);
  });

  it("no modifica el conjunto que recibe", () => {
    const avisados = new Set<string>();
    detectarNuevas({ porGestionar: [reserva("a")], canceladas: [], avisados, primeraVez: false, esPropio: nadaPropio });
    expect(avisados.size).toBe(0);
  });
});

describe("cambiosPropios", () => {
  beforeEach(() => __resetCambiosPropiosParaTests());
  it("caduca a los 10 minutos", () => {
    marcarCambioPropio("x", 0);
    expect(esCambioPropio("x", 9 * 60_000)).toBe(true);
    expect(esCambioPropio("x", 11 * 60_000)).toBe(false);
  });
});

describe("textoAlerta y título", () => {
  it("omite lo que falta", () => {
    expect(textoAlerta(null, null, null, null)).toBe("Sin nombre");
    expect(textoAlerta("Ana", "2026-11-12", null, 2)).toBe("Ana · 12/11 · 2 pers.");
  });
  it("pone y quita la cifra del título sin acumularla", () => {
    expect(tituloConCifra("Casa Tomás · Reservas", 3)).toBe("(3) Casa Tomás · Reservas");
    expect(tituloConCifra("(3) Casa Tomás · Reservas", 5)).toBe("(5) Casa Tomás · Reservas");
    expect(tituloConCifra("(5) Casa Tomás", 0)).toBe("Casa Tomás");
    expect(tituloConCifra("Casa Tomás", 150)).toBe("(99+) Casa Tomás");
    expect(tituloConCifra("(99+) Casa Tomás", 2)).toBe("(2) Casa Tomás");
  });
});

describe("silenciar", () => {
  const memoria = () => {
    const datos = new Map<string, string>();
    return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
  };

  it("el sonido viene activado por defecto y se recuerda al silenciarlo", () => {
    const almacen = memoria();
    expect(leerSonidoActivo(almacen)).toBe(true);
    guardarSonidoActivo(false, almacen);
    expect(almacen.getItem(CLAVE_SONIDO)).toBe("0");
    expect(leerSonidoActivo(almacen)).toBe(false);
    guardarSonidoActivo(true, almacen);
    expect(leerSonidoActivo(almacen)).toBe(true);
  });

  it("sin almacenamiento (bloqueado) no rompe: sonido activado", () => {
    const roto = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(leerSonidoActivo(roto)).toBe(true);
    expect(() => guardarSonidoActivo(false, roto)).not.toThrow();
  });

  it("el estado compartido avisa a los oyentes al silenciar y al marcar vistos", () => {
    avisosEnVivo.__reset();
    let llamadas = 0;
    const quitar = avisosEnVivo.suscribir(() => llamadas++);
    avisosEnVivo.ponerSonido(false);
    expect(avisosEnVivo.leer().sonido).toBe(false);
    avisosEnVivo.sumarSinVer(2);
    expect(avisosEnVivo.leer().sinVer).toBe(2);
    avisosEnVivo.marcarVistos();
    expect(avisosEnVivo.leer().sinVer).toBe(0);
    expect(llamadas).toBe(3);
    quitar();
    avisosEnVivo.ponerSonido(true);
  });
});
