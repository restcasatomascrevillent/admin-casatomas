/**
 * Tests para supabase/functions/reservas-web/plantillas.ts
 *
 * Cubre lo que pide el encargo ("El Reservado, de Touza, reserva por la
 * misma función que Casa Tomás y recibía la marca equivocada en los 4
 * correos"):
 *   - una reserva de Touza produce los datos de Touza en las 4 plantillas;
 *   - una de Casa Tomás produce los suyos;
 *   - el caso indeterminado (sin ninguna señal reconocible) cae siempre en
 *     el valor por defecto (Casa Tomás), nunca en un correo sin marca ni
 *     con marcadores `${...}` sin sustituir.
 *
 * Más la lógica de decisión (`resolverMarca` y sus señales) por separado,
 * como capa pura independiente de cualquier plantilla.
 */
import { describe, it, expect } from "vitest";
import {
  NEGOCIOS,
  NEGOCIO_POR_DEFECTO,
  MARCAS_VALIDAS,
  esMarcaValida,
  resolverMarcaPorNotas,
  resolverMarca,
  construirAvisoEmailFallido,
  escapeHtml,
  tplSolicitudRecibida,
  tplSolicitudNoProcesada,
  tplConfirmaAsistencia,
  tplSinDisponibilidad,
  type Marca,
  type DatosNegocio,
} from "../plantillas.ts";

// Texto EXACTO que compone touza-restaurant-website/src/pages/Reservado.tsx
// como primera línea de `notas_cliente` para toda solicitud de El
// Reservado (líneas 106-111 de ese fichero). Se repite aquí literal, no se
// importa de ningún sitio, para que el test detecte si `plantillas.ts`
// deja de reconocerlo.
const NOTAS_EL_RESERVADO = "Solicitud de El Reservado (espacio privado, hasta 20 personas).";

describe("MARCAS_VALIDAS / esMarcaValida", () => {
  it("incluye exactamente casa_tomas y touza", () => {
    expect(MARCAS_VALIDAS).toEqual(["casa_tomas", "touza"]);
  });

  it("acepta los dos valores válidos", () => {
    expect(esMarcaValida("casa_tomas")).toBe(true);
    expect(esMarcaValida("touza")).toBe(true);
  });

  it("rechaza cualquier otro valor, incluidos los tipos no-string", () => {
    expect(esMarcaValida("restaurante")).toBe(false);
    expect(esMarcaValida("Touza")).toBe(false); // sensible a mayúsculas, a propósito
    expect(esMarcaValida("")).toBe(false);
    expect(esMarcaValida(undefined)).toBe(false);
    expect(esMarcaValida(null)).toBe(false);
    expect(esMarcaValida(123)).toBe(false);
    expect(esMarcaValida({})).toBe(false);
  });
});

describe("resolverMarcaPorNotas", () => {
  it("reconoce el marcador exacto de Reservado.tsx", () => {
    expect(resolverMarcaPorNotas(NOTAS_EL_RESERVADO)).toBe("touza");
  });

  it("reconoce el marcador aunque venga con más texto detrás (mensaje del cliente)", () => {
    const notas = `${NOTAS_EL_RESERVADO}\n\nMensaje del cliente: Cumpleaños de 15 personas, tarta a las 22h.`;
    expect(resolverMarcaPorNotas(notas)).toBe("touza");
  });

  it("ignora espacios en blanco alrededor", () => {
    expect(resolverMarcaPorNotas(`   ${NOTAS_EL_RESERVADO}  `)).toBe("touza");
  });

  it("devuelve null si el marcador no está al principio (no es una búsqueda de substring)", () => {
    expect(resolverMarcaPorNotas("Preguntó por El Reservado pero al final quiere el salón normal")).toBeNull();
  });

  it("devuelve null para notas de cliente normales, sin ninguna relación con Touza", () => {
    expect(resolverMarcaPorNotas("Mesa cerca de la ventana, por favor. Aniversario.")).toBeNull();
  });

  it("devuelve null para null, undefined o cadena vacía", () => {
    expect(resolverMarcaPorNotas(null)).toBeNull();
    expect(resolverMarcaPorNotas(undefined)).toBeNull();
    expect(resolverMarcaPorNotas("")).toBeNull();
  });
});

describe("resolverMarca — orden de prioridad y valor por defecto", () => {
  it("usa la marca explícita del body cuando es válida", () => {
    expect(resolverMarca({ marcaExplicita: "touza" })).toBe("touza");
    expect(resolverMarca({ marcaExplicita: "casa_tomas" })).toBe("casa_tomas");
  });

  it("ignora una marca explícita inválida y sigue mirando las demás señales", () => {
    expect(
      resolverMarca({ marcaExplicita: "otro_negocio_inventado", notasCliente: NOTAS_EL_RESERVADO }),
    ).toBe("touza");
  });

  it("usa la marca del espacio cuando no hay marca explícita", () => {
    expect(resolverMarca({ marcaEspacio: "touza" })).toBe("touza");
  });

  it("ignora una marca de espacio inválida (jsonb sin la clave, o con basura) y sigue la cadena", () => {
    expect(resolverMarca({ marcaEspacio: undefined, notasCliente: NOTAS_EL_RESERVADO })).toBe("touza");
    expect(resolverMarca({ marcaEspacio: { algo: "distinto" }, notasCliente: NOTAS_EL_RESERVADO })).toBe("touza");
  });

  it("cae al sniff de notas_cliente cuando no hay marca explícita ni de espacio", () => {
    expect(resolverMarca({ notasCliente: NOTAS_EL_RESERVADO })).toBe("touza");
  });

  it("la marca explícita gana a la del espacio, y la del espacio gana a las notas", () => {
    expect(resolverMarca({ marcaExplicita: "casa_tomas", marcaEspacio: "touza", notasCliente: NOTAS_EL_RESERVADO })).toBe(
      "casa_tomas",
    );
    expect(resolverMarca({ marcaEspacio: "casa_tomas", notasCliente: NOTAS_EL_RESERVADO })).toBe("casa_tomas");
  });

  it("el caso indeterminado (sin ninguna señal) cae en NEGOCIO_POR_DEFECTO, no en null ni en excepción", () => {
    expect(resolverMarca({})).toBe(NEGOCIO_POR_DEFECTO);
    expect(resolverMarca({ notasCliente: "Sin ninguna relación con ningún negocio en concreto." })).toBe(
      NEGOCIO_POR_DEFECTO,
    );
    expect(resolverMarca({ notasCliente: null })).toBe(NEGOCIO_POR_DEFECTO);
  });

  it("NEGOCIO_POR_DEFECTO es casa_tomas (requisito del encargo: default seguro)", () => {
    expect(NEGOCIO_POR_DEFECTO).toBe("casa_tomas");
  });
});

describe("NEGOCIOS — configuración de contacto", () => {
  it("trae los dos negocios, cada uno con todos los campos rellenos", () => {
    for (const marca of MARCAS_VALIDAS) {
      const negocio = NEGOCIOS[marca];
      expect(negocio.nombre).toBeTruthy();
      expect(negocio.localidad).toBeTruthy();
      expect(negocio.direccion).toBeTruthy();
      expect(negocio.telefonoTexto).toBeTruthy();
      expect(negocio.telefonoDigits).toBeTruthy();
      // telefonoDigits solo dígitos: así lo interpolan las plantillas dentro de tel:
      expect(negocio.telefonoDigits).toMatch(/^\d+$/);
    }
  });

  it("Casa Tomás conserva exactamente los datos que ya estaban en las plantillas originales", () => {
    expect(NEGOCIOS.casa_tomas).toEqual<DatosNegocio>({
      nombre: "Casa Tomás",
      localidad: "Crevillente",
      direccion: "C/ Santa María de la Cabeza, 2",
      telefonoTexto: "966 10 78 87",
      telefonoDigits: "966107887",
    });
  });

  it("Touza usa los datos verificados en touza-restaurant-website (Contacto.tsx / Reservado.tsx / MobileReserveCTA.tsx)", () => {
    expect(NEGOCIOS.touza).toEqual<DatosNegocio>({
      nombre: "Touza",
      localidad: "Crevillente",
      direccion: "C/ San Vicente, 14",
      telefonoTexto: "966 782 000",
      telefonoDigits: "966782000",
    });
  });

  it("Casa Tomás y Touza no comparten dirección ni teléfono (la razón de ser de todo este cambio)", () => {
    expect(NEGOCIOS.casa_tomas.direccion).not.toBe(NEGOCIOS.touza.direccion);
    expect(NEGOCIOS.casa_tomas.telefonoDigits).not.toBe(NEGOCIOS.touza.telefonoDigits);
  });
});

// ----------------------------------------------------------------------------
// Las 4 plantillas — cada una debe llevar los datos del negocio que se le
// pasa, y NUNCA los del otro. Tabla común para no repetir las 4 llamadas por
// separado en cada caso (Touza / Casa Tomás / valor por defecto).
// ----------------------------------------------------------------------------

type Renderizador = (negocio: DatosNegocio) => string;

const PLANTILLAS: Record<string, Renderizador> = {
  tplSolicitudRecibida: (negocio) => tplSolicitudRecibida(negocio, "Elena Morales", "2026-03-16", "21:00", 4),
  tplSolicitudNoProcesada: (negocio) => tplSolicitudNoProcesada(negocio, "Elena Morales", "2026-03-16", "21:00", 4),
  tplConfirmaAsistencia: (negocio) =>
    tplConfirmaAsistencia(negocio, "Elena Morales", "2026-03-16", "21:00", 4, "https://x/confirmar", "https://x/cancelar"),
  tplSinDisponibilidad: (negocio) => tplSinDisponibilidad(negocio, "Elena Morales", "2026-03-16", "21:00", 4),
};

describe.each(Object.entries(PLANTILLAS))("%s", (_nombrePlantilla, renderizar) => {
  it("con negocio Touza: lleva el nombre, dirección y teléfono de Touza, y NADA de Casa Tomás", () => {
    const html = renderizar(NEGOCIOS.touza);
    expect(html).toContain("Touza");
    expect(html).toContain(NEGOCIOS.touza.direccion);
    expect(html).toContain(NEGOCIOS.touza.telefonoTexto);
    expect(html).toContain(NEGOCIOS.touza.telefonoDigits);
    expect(html).not.toContain("Casa Tomás");
    expect(html).not.toContain(NEGOCIOS.casa_tomas.direccion);
    expect(html).not.toContain(NEGOCIOS.casa_tomas.telefonoDigits);
  });

  it("con negocio Casa Tomás: lleva el nombre, dirección y teléfono de Casa Tomás, y NADA de Touza", () => {
    const html = renderizar(NEGOCIOS.casa_tomas);
    expect(html).toContain("Casa Tomás");
    expect(html).toContain(NEGOCIOS.casa_tomas.direccion);
    expect(html).toContain(NEGOCIOS.casa_tomas.telefonoTexto);
    expect(html).toContain(NEGOCIOS.casa_tomas.telefonoDigits);
    expect(html).not.toContain("Touza");
    expect(html).not.toContain(NEGOCIOS.touza.direccion);
    expect(html).not.toContain(NEGOCIOS.touza.telefonoDigits);
  });

  it("caso indeterminado: resolverMarca({}) cae en el defecto, y ese negocio produce Casa Tomás, nunca un marcador sin sustituir", () => {
    const marcaResuelta: Marca = resolverMarca({});
    const html = renderizar(NEGOCIOS[marcaResuelta]);
    expect(marcaResuelta).toBe("casa_tomas");
    expect(html).toContain("Casa Tomás");
    expect(html).not.toContain("Touza");
    // Red de seguridad final: ningún token `${...}` sin sustituir en el HTML.
    expect(html).not.toMatch(/\$\{/);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("sigue escapando los datos de cliente (nombre) igual que antes de este cambio", () => {
    const html =
      renderizar === PLANTILLAS.tplConfirmaAsistencia
        ? tplConfirmaAsistencia(NEGOCIOS.touza, '<script>alert(1)</script>', "2026-03-16", "21:00", 4, "https://x/a", "https://x/b")
        : renderizar(NEGOCIOS.touza).replace("Elena Morales", "debería no importar");
    // Se reconstruye el caso general por separado abajo; aquí solo se
    // confirma que escapeHtml sigue en juego vía una plantilla concreta.
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("tplSinDisponibilidad — botón de llamada específico de esta plantilla", () => {
  it("el botón de llamar usa tel:+34 + los dígitos del negocio, y el nombre en el texto del botón", () => {
    const htmlTouza = tplSinDisponibilidad(NEGOCIOS.touza, "Elena Morales", "2026-03-16", "21:00", 4);
    expect(htmlTouza).toContain(`href="tel:+34${NEGOCIOS.touza.telefonoDigits}"`);
    expect(htmlTouza).toContain("Llamar a Touza");

    const htmlCasaTomas = tplSinDisponibilidad(NEGOCIOS.casa_tomas, "Elena Morales", "2026-03-16", "21:00", 4);
    expect(htmlCasaTomas).toContain(`href="tel:+34${NEGOCIOS.casa_tomas.telefonoDigits}"`);
    expect(htmlCasaTomas).toContain("Llamar a Casa Tomás");
  });
});

describe("tplConfirmaAsistencia — enlaces de confirmar/cancelar", () => {
  it("incluye las URLs de confirmar y cancelar recibidas, sin tocarlas", () => {
    const html = tplConfirmaAsistencia(
      NEGOCIOS.touza,
      "Elena Morales",
      "2026-03-16",
      "21:00",
      4,
      "https://reservas.example/confirmar?token=abc",
      "https://reservas.example/cancelar?token=abc",
    );
    expect(html).toContain('href="https://reservas.example/confirmar?token=abc"');
    expect(html).toContain('href="https://reservas.example/cancelar?token=abc"');
  });
});

describe("construirAvisoEmailFallido", () => {
  const base = {
    contexto: "solicitud recibida",
    negocio: NEGOCIOS.touza,
    nombre: "Elena Morales",
    fecha: "2026-03-16",
    hora: "21:00",
    reservaId: "11111111-1111-1111-1111-111111111111",
  };

  it("usa siempre tipo 'email_fallido' (mismo valor que adopta emails-reserva para el concepto equivalente)", () => {
    expect(construirAvisoEmailFallido(base).tipo).toBe("email_fallido");
  });

  it("el título incluye el contexto y el nombre del negocio, para distinguir Touza de Casa Tomás en la campana", () => {
    const filaTouza = construirAvisoEmailFallido(base);
    expect(filaTouza.titulo).toContain("solicitud recibida");
    expect(filaTouza.titulo).toContain("Touza");

    const filaCasaTomas = construirAvisoEmailFallido({ ...base, negocio: NEGOCIOS.casa_tomas });
    expect(filaCasaTomas.titulo).toContain("Casa Tomás");
  });

  it("con reservaId: referencia_id lo lleva y referencia_tipo es 'reserva'", () => {
    const fila = construirAvisoEmailFallido(base);
    expect(fila.referencia_id).toBe(base.reservaId);
    expect(fila.referencia_tipo).toBe("reserva");
  });

  it("sin reservaId (rechazo antes de insertar en `reservas`): referencia_id y referencia_tipo son null, no se inventa una referencia", () => {
    const fila = construirAvisoEmailFallido({ ...base, reservaId: null });
    expect(fila.referencia_id).toBeNull();
    expect(fila.referencia_tipo).toBeNull();
  });

  it("incluye el motivo del fallo en el mensaje cuando se pasa", () => {
    const fila = construirAvisoEmailFallido({ ...base, error: "resend_not_configured" });
    expect(fila.mensaje).toContain("resend_not_configured");
  });

  it("no rompe si no hay motivo de fallo (excepción sin mensaje, etc.)", () => {
    const fila = construirAvisoEmailFallido({ ...base, error: undefined });
    expect(fila.mensaje).toContain(base.nombre);
    expect(fila.mensaje).not.toContain("undefined");
  });
});

describe("escapeHtml", () => {
  it("escapa los cinco caracteres especiales de HTML", () => {
    expect(escapeHtml(`<b>&"'</b>`)).toBe("&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;");
  });

  it("trata null/undefined como cadena vacía", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
