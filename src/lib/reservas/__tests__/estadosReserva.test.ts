/**
 * Mapa único de estados de reserva (`estadosReserva.ts`).
 *
 * QUÉ SE FIJA
 * ----------------------------------------------------------------------------
 * · El mapa cubre EXACTAMENTE los seis estados del CHECK `reservas_estado_check`,
 *   ni uno más ni uno menos, y en el orden del ciclo de vida. Si alguien añade o
 *   quita un estado en la base de datos, este test lo dice: la lista de valores
 *   válidos se lee de la documentación de la migración 20260919130000, que es
 *   donde el repo la tiene apuntada («verificado en la BD»).
 * · Cada estado trae todos los campos que pintan las cuatro copias actuales.
 * · Los conjuntos de estados (vivos, terminales, los que ocupan sitio) coinciden
 *   con los que ya usan el trigger de aforo (`ESTADOS_QUE_OCUPAN`) y
 *   `servicioSala.ts`, que hoy son otra definición de lo mismo.
 * · El módulo es un módulo de datos: no importa React ni Supabase por su cuenta.
 *
 * Que el mapa dice lo mismo que lo que pintan hoy la lista, el kanban, el
 * timeline y el filtro se comprueba en `estadosReserva.copias.test.tsx`.
 */
import { describe, it, expect } from "vitest";
import {
  ESTADOS_RESERVA,
  ESTADOS_TERMINALES,
  ESTADOS_VIVOS,
  ESTADO_CANCELADA,
  ESTADO_CONFIRMADA,
  ESTADO_LLEGADA,
  ESTADO_NO_SHOW,
  ESTADO_PENDIENTE,
  ESTADO_TRAS_DESHACER,
  ESTADO_VERIFICADA,
  ORDEN_ESTADOS,
  esEstadoReserva,
  esEstadoVivo,
  esTerminal,
  etiquetaEstadoReserva,
  infoEstadoReserva,
  ocupaEspacio,
  type EstadoReserva,
} from "../estadosReserva";
import {
  ESTADO_LLEGADA as LLEGADA_SERVICIO_SALA,
  ESTADO_NO_SHOW as NO_SHOW_SERVICIO_SALA,
  ESTADO_TRAS_DESHACER as TRAS_DESHACER_SERVICIO_SALA,
  esperandoLlegada,
  haLlegado,
  ocupaEspacio as ocupaEspacioServicioSala,
  puedeMoverReserva,
} from "../servicioSala";
import { ESTADOS_QUE_OCUPAN } from "../../../../supabase/functions/_shared/disponibilidad";
// Texto de los ficheros, tal cual (`?raw` de Vite): no hace falta `fs` ni rutas.
import migracionDelCheck from "../../../../supabase/migrations/20260919130000_fix_vista_ocupacion_hoy_estados.sql?raw";
import fuenteDelMapa from "../estadosReserva.ts?raw";

/** Los seis valores del CHECK, en el orden del ciclo de vida (el del timeline). */
const SEIS_ESTADOS: EstadoReserva[] = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"];

/** Lo que no es un estado: nada de esto existe en la BD. */
const NO_SON_ESTADOS = ["rechazada", "", "PENDIENTE", " pendiente", "no-show", "completada ", null, undefined, 0, {}];

describe("ESTADOS_RESERVA — cubre exactamente los seis estados", () => {
  it("tiene los seis del CHECK, en orden del ciclo de vida, y ninguno más", () => {
    expect(Object.keys(ESTADOS_RESERVA)).toEqual(SEIS_ESTADOS);
    expect([...ORDEN_ESTADOS]).toEqual(SEIS_ESTADOS);
    expect(new Set(ORDEN_ESTADOS).size).toBe(6);
  });

  it("coincide con la lista de valores válidos que documenta la migración del CHECK", () => {
    // `reservas_estado_check` no se declara en ninguna migración (se creó antes),
    // pero 20260919130000 lo documenta así: «verificado en la BD».
    const documentados = /ESTADOS VALIDOS[^\n]*\n--\s+([a-z_ |]+)/.exec(migracionDelCheck)?.[1]
      ?.split("|")
      .map((e) => e.trim())
      .filter(Boolean);

    expect(documentados, "no se encontró la lista «ESTADOS VALIDOS» en la migración").toBeDefined();
    expect([...documentados!].sort()).toEqual([...SEIS_ESTADOS].sort());
  });

  it("la clave de cada ficha es su propia clave en el mapa", () => {
    for (const estado of SEIS_ESTADOS) expect(ESTADOS_RESERVA[estado].clave).toBe(estado);
  });

  it("cada estado trae todos los campos, ninguno vacío", () => {
    for (const estado of SEIS_ESTADOS) {
      const ficha = ESTADOS_RESERVA[estado];
      for (const campo of ["etiqueta", "etiquetaFiltro", "frase", "insignia", "burbuja", "descripcion"] as const) {
        expect(ficha[campo], `${estado}.${campo}`).toEqual(expect.any(String));
        expect(ficha[campo].trim().length, `${estado}.${campo}`).toBeGreaterThan(0);
      }
      // Un componente de lucide-react: función o `forwardRef` (objeto con `render`).
      expect(["function", "object"], `${estado}.Icono`).toContain(typeof ficha.Icono);
      expect(ficha.Icono, `${estado}.Icono`).toBeTruthy();
    }
  });

  it("solo las dos salidas del timeline traen «cuando»; los pasos del camino, no", () => {
    expect(SEIS_ESTADOS.filter((e) => ESTADOS_RESERVA[e].cuando !== undefined)).toEqual(["cancelada", "no_show"]);
    // «Antes de que llegue»: una reserva «Llegó» o «No vino» ya no se cancela (decisión (a)).
    expect(ESTADOS_RESERVA.cancelada.cuando).toBe("Antes de que llegue:");
    expect(ESTADOS_RESERVA.no_show.cuando).toBe("Si no se presenta:");
  });

  it("los nombres son los de los badges: «Llegó» y «No vino», no los de la BD", () => {
    expect(SEIS_ESTADOS.map((e) => ESTADOS_RESERVA[e].etiqueta)).toEqual([
      "Pendiente",
      "Verificada",
      "Confirmada",
      "Llegó",
      "Cancelada",
      "No vino",
    ]);
  });

  it("los colores de los tres estados vivos son los tokens `status-*` del tema", () => {
    expect(ESTADOS_RESERVA.pendiente.insignia).toBe("bg-status-pending text-status-pending-foreground");
    expect(ESTADOS_RESERVA.verificada.insignia).toBe("bg-status-verified text-status-verified-foreground");
    expect(ESTADOS_RESERVA.confirmada.insignia).toBe("bg-status-confirmed text-status-confirmed-foreground");
  });

  it("no hay token `status-*` para cancelada, «Llegó» y «No vino»: usan las clases de la lista actual", () => {
    // Crear `--status-cancelled`, `--status-arrived` y `--status-no-show` es tocar
    // index.css y tailwind.config.ts; hasta entonces se mantiene lo que la lista
    // ya pinta (destructive / emerald-600 / secondary).
    expect(ESTADOS_RESERVA.cancelada.insignia).toBe("bg-destructive text-destructive-foreground");
    expect(ESTADOS_RESERVA.completada.insignia).toBe("bg-emerald-600 text-white");
    expect(ESTADOS_RESERVA.no_show.insignia).toBe("bg-secondary text-secondary-foreground");
    for (const estado of ["cancelada", "completada", "no_show"] as const) {
      expect(ESTADOS_RESERVA[estado].insignia).not.toContain("status-");
    }
  });

  it("cada estado tiene un fondo distinto (no se confunden a simple vista)", () => {
    const fondos = SEIS_ESTADOS.map((e) => /bg-\S+/.exec(ESTADOS_RESERVA[e].insignia)![0]);
    expect(new Set(fondos).size).toBe(6);
  });
});

describe("conjuntos de estados", () => {
  it("ESTADOS_VIVOS = pendiente, verificada, confirmada, y es lo mismo que ESTADOS_QUE_OCUPAN del trigger", () => {
    expect([...ESTADOS_VIVOS]).toEqual(["pendiente", "verificada", "confirmada"]);
    expect([...ESTADOS_VIVOS]).toEqual([...ESTADOS_QUE_OCUPAN]);
  });

  it("ESTADOS_TERMINALES = Llegó, cancelada y No vino", () => {
    expect([...ESTADOS_TERMINALES]).toEqual(["completada", "cancelada", "no_show"]);
  });

  it("vivos y terminales son una partición de los seis: sin solaparse y sin dejarse ninguno", () => {
    expect(ESTADOS_VIVOS.filter((e) => (ESTADOS_TERMINALES as readonly string[]).includes(e))).toEqual([]);
    expect([...ESTADOS_VIVOS, ...ESTADOS_TERMINALES].sort()).toEqual([...SEIS_ESTADOS].sort());
  });

  it.each(SEIS_ESTADOS)("%s: esEstadoVivo y esTerminal dicen lo contrario el uno del otro", (estado) => {
    expect(esEstadoVivo(estado)).toBe(!esTerminal(estado));
    expect(esEstadoVivo(estado)).toBe((ESTADOS_VIVOS as readonly string[]).includes(estado));
  });

  it.each([
    ["pendiente", true, false, true],
    ["verificada", true, false, true],
    ["confirmada", true, false, true],
    ["completada", false, true, true],
    ["cancelada", false, true, false],
    ["no_show", false, true, false],
  ] as const)("%s: vivo=%s, terminal=%s, ocupa sitio=%s", (estado, vivo, terminal, ocupa) => {
    expect(esEstadoVivo(estado)).toBe(vivo);
    expect(esTerminal(estado)).toBe(terminal);
    expect(ocupaEspacio(estado)).toBe(ocupa);
  });

  it.each(NO_SON_ESTADOS)("%j no es un estado: ni vivo, ni terminal, ni ocupa sitio, ni está en el mapa", (raro) => {
    expect(esEstadoReserva(raro)).toBe(false);
    expect(esEstadoVivo(raro as never)).toBe(false);
    expect(esTerminal(raro as never)).toBe(false);
    expect(ocupaEspacio(raro as never)).toBe(false);
    expect(infoEstadoReserva(raro as never)).toBeUndefined();
  });

  it("esEstadoReserva acepta los seis y nada más", () => {
    for (const estado of SEIS_ESTADOS) expect(esEstadoReserva(estado)).toBe(true);
  });
});

describe("servicioSala.ts reexporta el mapa: una sola definición de los estados", () => {
  it("los predicados son LOS MISMOS (no una copia que coincide): esperandoLlegada, ocupaEspacio y puedeMoverReserva", () => {
    expect(esperandoLlegada).toBe(esEstadoVivo);
    expect(ocupaEspacioServicioSala).toBe(ocupaEspacio);
    expect(puedeMoverReserva).toBe(ocupaEspacio);
  });

  it("las constantes de estado son las mismas", () => {
    expect(ESTADO_LLEGADA).toBe(LLEGADA_SERVICIO_SALA);
    expect(ESTADO_NO_SHOW).toBe(NO_SHOW_SERVICIO_SALA);
    expect(ESTADO_TRAS_DESHACER).toBe(TRAS_DESHACER_SERVICIO_SALA);
    expect([ESTADO_PENDIENTE, ESTADO_VERIFICADA, ESTADO_CONFIRMADA, ESTADO_CANCELADA]).toEqual([
      "pendiente",
      "verificada",
      "confirmada",
      "cancelada",
    ]);
  });

  it.each([...SEIS_ESTADOS, "rechazada"])("%s: los mismos predicados que esperandoLlegada, haLlegado, ocupaEspacio y puedeMoverReserva", (estado) => {
    expect(esEstadoVivo(estado)).toBe(esperandoLlegada(estado));
    expect(estado === ESTADO_LLEGADA).toBe(haLlegado(estado));
    expect(ocupaEspacio(estado)).toBe(ocupaEspacioServicioSala(estado));
  });

  it.each(SEIS_ESTADOS)("%s: se puede mover exactamente si ocupa sitio", (estado) => {
    // Canceladas y no presentadas no ocupan sitio, así que no tiene sentido moverlas.
    expect(ocupaEspacio(estado)).toBe(puedeMoverReserva(estado));
  });

  it("deshacer «Llegó» / «No vino» devuelve a un estado vivo", () => {
    expect(esEstadoVivo(ESTADO_TRAS_DESHACER)).toBe(true);
  });
});

describe("infoEstadoReserva / etiquetaEstadoReserva", () => {
  it("devuelve la ficha del estado", () => {
    expect(infoEstadoReserva("completada")).toBe(ESTADOS_RESERVA.completada);
    expect(infoEstadoReserva("no_show")?.etiqueta).toBe("No vino");
  });

  it("con un estado que no existe no inventa nada: quien pinta decide cómo degradar", () => {
    expect(infoEstadoReserva("rechazada")).toBeUndefined();
    expect(infoEstadoReserva(null)).toBeUndefined();
    expect(infoEstadoReserva(undefined)).toBeUndefined();
  });

  it("etiquetaEstadoReserva: el nombre del estado o, si no es uno, el texto tal cual (o vacío)", () => {
    expect(etiquetaEstadoReserva("completada")).toBe("Llegó");
    expect(etiquetaEstadoReserva("no_show")).toBe("No vino");
    expect(etiquetaEstadoReserva("rechazada")).toBe("rechazada");
    expect(etiquetaEstadoReserva(null)).toBe("");
    expect(etiquetaEstadoReserva(undefined)).toBe("");
  });
});

describe("es un módulo de datos", () => {
  it("no importa React ni Supabase por su cuenta (solo los iconos de lucide-react)", () => {
    const importaciones = [...fuenteDelMapa.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

    expect(importaciones).toEqual(["lucide-react"]);
  });
});
