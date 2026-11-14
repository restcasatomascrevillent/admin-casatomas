/**
 * Super Admin › Logs: explicación «para tontos» arriba de cada incidencia y de
 * cada sesión (qué hizo el cliente, qué falló, ¿afecta?, qué hacer); lo
 * técnico debajo, plegado.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventoWeb, IncidenciaWeb } from "@/hooks/useLogsWeb";

let incidencia: IncidenciaWeb | null = null;
let ocurrencias: EventoWeb[] = [];
let contexto: EventoWeb[] = [];
vi.mock("@/hooks/useLogsWeb", async (original) => {
  const real = await original<typeof import("@/hooks/useLogsWeb")>();
  const q = <T,>(data: T) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() });
  const m = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...real,
    useIncidencia: () => q(incidencia),
    useOcurrencias: () => q({ filas: ocurrencias, total: ocurrencias.length }),
    useMuestrasIncidencia: () => q(ocurrencias),
    useContextoEvento: (id: number | null) => q(id === null ? undefined : contexto),
    useEnviosPrueba: () => q([]),
    useCambiarIncidencia: m,
    usePedirTicket: m,
  };
});

const { describirEvento, explicacionIncidencia, explicacionSesion } = await import("../calculos");
const { ExplicacionSencilla } = await import("../ExplicacionSencilla");
const { DetalleIncidencia } = await import("../DetalleIncidencia");

const AHORA = new Date("2026-11-13T12:00:00");
const inc = (o: Partial<IncidenciaWeb> = {}): IncidenciaWeb => ({
  id: 9, entorno: "produccion", huella: "a".repeat(32), titulo: "TypeError: carta.vinos is undefined", tipo: "error_js", fuente: "navegador",
  proyecto: "casa-tomas-story", gravedad: "error", estado: "nueva", primera_vez: "2026-11-12T10:00:00Z", ultima_vez: "2026-11-13T10:00:00Z",
  ocurrencias: 6, sesiones_afectadas: 4, ocurrencias_ventana: 6, sesiones_ventana: 4, ocurrencias_24h: 3, rutas: [{ ruta: "/carta/vinos", n: 6 }],
  version_primera: "1.2.0", version_ultima: "1.2.0", despliegue_ultimo: null, mensaje: "TypeError: carta.vinos is undefined", pila: null,
  requiere_ticket: false, motivo_ticket: null, linear_estado: "sin_ticket", linear_issue_id: null, linear_identificador: null, linear_url: null,
  linear_estado_remoto: null, linear_destino: null, linear_intentos: 0, linear_ultimo_error: null, linear_proximo_intento: null, linear_creado_en: null,
  linear_pendiente_reapertura: false, analisis_ia: null, analisis_ia_en: null, analisis_ia_error: null, resuelta_en: null, reabierta_veces: 0, nota: null,
  ocurrencias_tras_publicar: 0, repetidas_tras_recargar: 0, explicacion_ia: null, ...o,
});
let n = 0;
const ev = (tipo: string, o: Partial<EventoWeb> = {}): EventoWeb => ({
  id: ++n, evento_id: `e${n}`, recibido_en: "2026-11-13T10:00:00Z", ocurrido_en: `2026-11-13T10:00:${String(n % 60).padStart(2, "0")}Z`, entorno: "produccion",
  proyecto: "casa-tomas-story", fuente: "navegador", categoria: "actividad", tipo, accion: null, sesion_id: "s1", visitante_id: null, secuencia: n,
  ruta: "/carta", objetivo: null, valor: null, propiedades: {}, dispositivo: "movil", navegador: "Safari", so: "iOS", es_bot: false, es_interno: false,
  es_prueba: false, consentimiento: true, version: "1.2.0", despliegue: null, gravedad: null, huella: null, mensaje: null, pila: null, incidencia_id: null, ...o,
});

describe("explicación de una incidencia", () => {
  it("qué hizo el cliente, a partir del recorrido antes del error", () => {
    const error = ev("error_js", { categoria: "error", mensaje: "TypeError: carta.vinos is undefined", incidencia_id: 9 });
    const recorrido = [ev("pagina_vista", { propiedades: { navegacion: "inicial" } }), ev("vino_abierto", { objetivo: "A" }), ev("vino_abierto", { objetivo: "B" }),
      ev("clic", { objetivo: "Reservar" }), error, ev("pagina_vista", { ruta: "/reservas" })];
    const e = explicacionIncidencia(inc(), [], recorrido, error.id, AHORA);
    expect(e.queHizo).toBe("Entró en la carta, abrió 2 vinos y pulsó «Reservar». Y entonces falló.");
    expect(e.queFallo).toBe("Un fallo en el código de la página en la carta de vinos.");
    expect(e.fuente).toBe("generica");
    expect(e.queHacer).toMatch(/^Nada por ahora: si se repite en más visitantes, se abrirá un ticket solo/);
  });
  it("sin consentimiento no inventa lo que hizo", () => {
    expect(explicacionIncidencia(inc(), [], null, null, AHORA).queHizo).toBe("Estaba en la carta de vinos. No se sabe qué hizo antes: no aceptó las estadísticas, así que solo llega el error.");
  });
  it("¿afecta?: visitantes en total y hoy; grave si es crítica", () => {
    const muestras = [ev("error_js", { categoria: "error", sesion_id: "x", ocurrido_en: "2026-11-13T09:00:00" }), ev("error_js", { categoria: "error", sesion_id: "y", ocurrido_en: "2026-11-13T08:00:00" }),
      ev("error_js", { categoria: "error", sesion_id: "z", ocurrido_en: "2026-11-12T20:00:00" })];
    const e = explicacionIncidencia(inc({ gravedad: "critico" }), muestras, null, null, AHORA);
    expect(e.afecta).toBe("Sí: a 4 visitantes distintos en total; hoy, 2 visitantes. 3 veces en las últimas 24 h. Es grave: puede impedir reservar o pagar.");
    expect(explicacionIncidencia(inc({ sesiones_afectadas: 0 }), [], null, null, AHORA).afecta).toMatch(/^No: solo lo han provocado robots/);
  });
  it("versión antigua tras publicar: texto fijo y «no afecta» con sus cifras", () => {
    const e = explicacionIncidencia(inc({ mensaje: "TypeError: Failed to fetch dynamically imported module: https://w/assets/a-AbCd1234.js", titulo: "TypeError: Failed to fetch dynamically imported module",
      ocurrencias: 3, ocurrencias_tras_publicar: 3, repetidas_tras_recargar: 0 }), [], null, null, AHORA);
    expect(e.fuente).toBe("conocida");
    expect(e.queFallo).toBe("La página tenía una versión antigua abierta justo cuando publicamos; se recarga sola.");
    expect(e.afecta).toBe("No: las 3 veces fueron páginas antiguas abiertas durante una publicación y se recargó sola.");
    expect(e.queHacer).toMatch(/^Nada: es normal justo después de publicar/);
  });
  it("tarea programada: nadie la provoca y se dice qué se nota", () => {
    const e = explicacionIncidencia(inc({ tipo: "error_integracion", fuente: "integracion", titulo: "job startup timeout · cron:reanudar-trabajos-ocr", mensaje: "job startup timeout",
      sesiones_afectadas: 0, rutas: [], linear_estado: "creado", linear_identificador: "PRUEBA-4", linear_destino: "prueba" }), [], null, null, AHORA);
    expect(e.queHizo).toMatch(/^Ningún cliente: lo hace una tarea automática/);
    expect(e.queFallo).toMatch(/^La tarea que retoma la lectura de facturas atascadas no arrancó a tiempo; las facturas pueden tardar más en leerse\./);
    expect(e.afecta).toMatch(/^No se ve en la web: es del servidor\. 3 veces en las últimas 24 h \(6 en total\)\. Lo que se nota: las facturas pueden tardar más en leerse\./);
    expect(e.queHacer).toMatch(/Ya hay un ticket para el técnico \(PRUEBA-4, en el destino de pruebas\)\.$/);
  });
  it("error nuevo: explicación de la IA, marcada «sin comprobar»", () => {
    const e = explicacionIncidencia(inc({ explicacion_ia: { que_paso: "La lista de vinos no se mostró.", a_quien_afecta: "A quien abre los vinos en el móvil.", que_hacer: "Avisa al técnico.", gravedad: "alta" } }), [], null, null, AHORA);
    expect([e.fuente, e.queFallo, e.queHacer]).toEqual(["ia", "La lista de vinos no se mostró.", "Avisa al técnico."]);
    expect(e.afecta).toMatch(/Según la IA: A quien abre los vinos en el móvil\.$/);
    render(<ExplicacionSencilla explicacion={e} />);
    expect(screen.getByTestId("marca-ia")).toHaveTextContent("Explicación de la IA · sin comprobar");
  });
});

describe("explicación de una sesión", () => {
  it("sin errores", () => {
    const e = explicacionSesion({ conversiones: 1 }, [ev("pagina_vista", { ruta: "/reservas" }), ev("reserva_solicitada", { categoria: "operacion" })]);
    expect(e.queHizo).toBe("Entró en la página de reservas y envió la reserva (le llegó al restaurante).");
    expect([e.queFallo, e.afecta, e.queHacer]).toEqual(["Nada: no hubo ningún error en esta visita.", "No.", "Nada."]);
  });
  it("página antigua que se recargó sola: no afecta", () => {
    const e = explicacionSesion(null, [ev("pagina_vista"), ev("error_promesa", { categoria: "error", mensaje: "TypeError: Importing a module script failed.", tras_publicar: "sin_impacto", incidencia_id: 3 }), ev("plato_abierto", { objetivo: "Arroz" })]);
    expect(e.afecta).toBe("No: era una página antigua abierta durante una publicación; se recargó sola.");
    expect(e.queHacer).toBe("Nada: se arregló solo.");
  });
  it("sin conexión del visitante: no es un fallo de la web", () => {
    const e = explicacionSesion(null, [ev("error_promesa", { categoria: "error", mensaje: "TypeError: Failed to fetch dynamically imported module · sin conexión: no se recargó", accion: "sin_conexion", tras_publicar: "sin_conexion" })]);
    expect(e.queFallo).toBe("El visitante se quedó sin conexión mientras cargaba la página. No es un fallo de la web.");
    expect([e.afecta, e.queHacer]).toEqual(["No: el visitante se quedó sin conexión; no es un fallo de la web.", "Nada."]);
  });
  it("en la lista de errores se ve lo que decidió la web", () => {
    expect(describirEvento(ev("error_promesa", { categoria: "error", mensaje: "TypeError: Load failed", accion: "aviso_version_nueva" })))
      .toBe("Promesa rechazada: TypeError: Load failed [se le pidió tocar «Actualizar»]");
  });
  it("se fue justo después del error: probablemente le afectó; manda a la incidencia", () => {
    const e = explicacionSesion({ conversiones: 0 }, [ev("pagina_vista", { ruta: "/reservas" }), ev("error_peticion", { categoria: "error", mensaje: "reservas-web 500", incidencia_id: 12, ruta: "/reservas" })]);
    expect(e.queFallo).toBe("La web pidió datos al servidor y no obtuvo respuesta (o recibió un error) en la página de reservas.");
    expect(e.afecta).toBe("Sí, probablemente: se fue justo después del error.");
    expect(e.queHacer).toMatch(/^Mira la incidencia #12/);
    expect(e.incidencias).toEqual([12]);
  });
});

describe("detalle de la incidencia", () => {
  it("arriba el bloque en llano; lo técnico debajo y plegado; cada ocurrencia con su clase «tras publicar»", () => {
    incidencia = inc({ mensaje: "TypeError: Failed to fetch dynamically imported module", titulo: "TypeError: Failed to fetch dynamically imported module", ocurrencias_tras_publicar: 1, repetidas_tras_recargar: 1 });
    const a = ev("error_promesa", { categoria: "error", mensaje: incidencia.mensaje, tras_publicar: "sin_impacto", accion: "recuperado_tras_recarga", consentimiento: false, sesion_id: null });
    const b = ev("error_promesa", { categoria: "error", mensaje: incidencia.mensaje, tras_publicar: "repetido", accion: "recarga_sin_efecto", consentimiento: false, sesion_id: null });
    ocurrencias = [b, a];
    contexto = [];
    render(<DetalleIncidencia id={9} onCerrar={vi.fn()} onAbrirSesion={vi.fn()} />);
    const detalle = screen.getByTestId("detalle-incidencia");
    const bloque = within(detalle).getByTestId("explicacion-sencilla");
    const tecnico = within(detalle).getByTestId("detalles-tecnicos");
    expect(bloque.compareDocumentPosition(tecnico) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tecnico).not.toHaveAttribute("open");
    for (const t of ["Qué hizo el cliente", "Qué falló", "¿Afecta?", "Qué hacer"]) expect(within(bloque).getByText(t)).toBeInTheDocument();
    expect(within(bloque).getByTestId("sencillo-afecta")).toHaveTextContent("¿Afecta?Sí, a veces: 1 vez no se arregló al recargar (volvió a fallar o siguió con la versión antigua), así que a esa persona no le funcionó. La otra vez se arregló sola al recargar.");
    expect(within(tecnico).getAllByTestId("tras-publicar").map((x) => x.textContent)).toEqual(["no se arregló al recargar · revisar", "esperado tras publicar · sin impacto"]);
    expect(within(tecnico).getAllByTestId("accion-recarga").map((x) => x.textContent)).toEqual([" · se recargó pero siguió con la misma versión", " · se recargó sola con la versión nueva"]);
  });
});

describe("origen en el detalle y en las sesiones", () => {
  it("la cabecera del detalle dice el origen con su color y una línea en llano (la de la captura: gris)", () => {
    incidencia = inc({ titulo: "Sin respuesta de rest:novedades (sin conexión) · rest:novedades", tipo: "error_peticion", mensaje: "Sin respuesta de rest:novedades (sin conexión)", origen: "conexion" });
    ocurrencias = [];
    contexto = [];
    render(<DetalleIncidencia id={34} onCerrar={vi.fn()} onAbrirSesion={vi.fn()} />);
    const aviso = screen.getByTestId("aviso-origen");
    expect(aviso).toHaveAttribute("data-origen", "conexion");
    expect(within(aviso).getByTestId("badge-origen")).toHaveTextContent("Conexión del visitante");
    expect(aviso).toHaveTextContent("No depende de la web: el móvil del visitante se quedó sin cobertura (o cambió de página) mientras cargaba. No hay que hacer nada salvo que se repita mucho.");
    expect(screen.getByTestId("sin-ticket-origen")).toHaveTextContent("No abre ticket: no depende de la web.");
    expect(screen.getByRole("button", { name: /Pedir ticket igualmente/ })).toBeInTheDocument();
    // La gravedad ya no sale en rojo si no es un fallo de la web.
    expect(screen.getByText("Error").className).not.toMatch(/destructive/);
  });
  it("servicio externo: ámbar, nombra al proveedor y explica cómo activar sus tickets", () => {
    incidencia = inc({ titulo: "Google Maps JavaScript API error", mensaje: "Google Maps JavaScript API error", origen: "externo", origen_proveedor: "Google Maps" });
    render(<DetalleIncidencia id={2} onCerrar={vi.fn()} onAbrirSesion={vi.fn()} />);
    const aviso = screen.getByTestId("aviso-origen");
    expect(aviso.className).toMatch(/amber/);
    expect(aviso).toHaveTextContent("No es un fallo de nuestro código: depende de Google Maps.");
    expect(screen.getByTestId("sin-ticket-origen")).toHaveTextContent(/Configuración › Incidencias y avisos/);
  });
  it("fallo de la web: rojo y sin aviso de «no abre ticket»", () => {
    incidencia = inc({ origen: "web" });
    render(<DetalleIncidencia id={3} onCerrar={vi.fn()} onAbrirSesion={vi.fn()} />);
    expect(screen.getByTestId("aviso-origen").className).toMatch(/destructive/);
    expect(screen.queryByTestId("sin-ticket-origen")).not.toBeInTheDocument();
  });
  it("sin la migración, el origen se calcula con las mismas reglas", () => {
    const sinColumna = inc({ titulo: "Sin respuesta de rest:tapas (sin conexión) · rest:tapas", tipo: "error_peticion", mensaje: "Sin respuesta de rest:tapas (sin conexión)" });
    expect(explicacionIncidencia(sinColumna, [], null, null, AHORA).queHacer).toMatch(/^Nada si son pocos casos/); // la causa conocida manda
    const ext = explicacionIncidencia(inc({ mensaje: "Google Maps JavaScript API error", titulo: "Google Maps JavaScript API error" }), [], null, null, AHORA);
    expect(ext.queHacer).toMatch(/^No es un fallo de nuestro código: depende de Google Maps/);
  });
  it("sesión con errores que no dependen de la web: «No» y nada que hacer", () => {
    const e = explicacionSesion(null, [ev("pagina_vista"),
      ev("error_peticion", { categoria: "error", mensaje: "Sin respuesta de rest:tapas (sin conexión)", objetivo: "rest:tapas", propiedades: { status: 0 }, origen: "conexion" })]);
    expect([e.afecta, e.queHacer]).toEqual(["No: el móvil del visitante se quedó sin cobertura (o cambió de página) mientras cargaba.", "Nada: no depende de la web."]);
    const ext = explicacionSesion(null, [ev("error_js", { categoria: "error", mensaje: "Google Maps JavaScript API error: X", origen: "externo" })]);
    expect(ext.afecta).toBe("Algo: falló un servicio de fuera (Google Maps); no es un fallo de nuestro código.");
    const mezcla = explicacionSesion(null, [ev("error_js", { categoria: "error", mensaje: "ResizeObserver loop limit exceeded", origen: "navegador" }),
      ev("error_peticion", { categoria: "error", mensaje: "Sin respuesta de rest:tapas", propiedades: { status: 0 }, origen: "conexion" })]);
    expect(mezcla.afecta).toBe("No: ninguno depende de la web (navegador o extensión, conexión del visitante).");
  });
});
