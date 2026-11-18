/**
 * Logs web · «Fallo de la web» frente a «Fallo del admin» (petición del dueño,
 * 18/11/2026): ámbito derivado de los datos, el mismo filtro en PostgREST,
 * catálogo de funciones del servidor en llano, la causa conocida «la base de
 * datos tardó demasiado» y el título en llano de la incidencia (con los dos
 * ejemplos reales que confundieron al dueño).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ambitoDeError, explicacionOrigenAmbito, filtroAmbito, nombreOrigen, type DatosAmbito } from "../logs-web/ambito";
import { FUNCIONES, FUNCIONES_WEB, funcionDeError, funcionSencilla } from "../logs-web/funciones";
import { causaConocida, IDS_CAUSAS } from "../logs-web/causas";
import { fichaSencilla, type DatosFicha } from "../logs-web/ficha";
import { tareaSencilla } from "../logs-web/sencillo";

const RAIZ_FUNCIONES = resolve(__dirname, "../..");
const MIGRACIONES = resolve(__dirname, "../../../migrations");

// Los dos ejemplos reales (Super Admin › Logs, noviembre de 2026).
const CLASIFICAR = "clasificar-productos: productos_aplicar_clasificacion_ia: canceling statement due to statement timeout";
const EMBEDDINGS = "embeddings-nombres: guardar productos_nombre_embedding: canceling statement due to statement timeout";
const servidor = (mensaje: string, o: Partial<DatosFicha> = {}): DatosFicha => ({
  tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje, pila: null, objetivo: mensaje.split(":")[0],
  origen: "web", ocurrencias: 6, ocurrencias_24h: 3, ...o,
});

describe("ámbito: fallo de la web o del admin, según dónde falla", () => {
  it("las funciones del panel son del admin aunque su origen guardado sea «web»", () => {
    expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: CLASIFICAR, objetivo: "clasificar-productos" })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: EMBEDDINGS })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", mensaje: "procesar-factura/paginas: HTTP 500" })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", mensaje: "funcion-nueva: x" })).toBe("admin"); // fuera del catálogo: del panel
  });
  it("lo que usan los clientes es de la web: navegador de la web pública y sus funciones", () => {
    expect(ambitoDeError({ tipo: "error_js", fuente: "navegador", proyecto: "casa-tomas-story", mensaje: "TypeError: x" })).toBe("web");
    expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", mensaje: "reservas-web/crear: HTTP 500", objetivo: "reservas-web/crear" })).toBe("web");
    for (const f of ["chat-web", "cheques-regalo-web", "stripe-webhook-cheques-regalo", "emails-reserva", "newsletter-baja", "registrar-actividad-web"]) {
      expect(ambitoDeError({ tipo: "error_servidor", fuente: "servidor", mensaje: `${f}: HTTP 500` }), f).toBe("web");
    }
  });
  it("tareas automáticas e integraciones: del admin", () => {
    expect(ambitoDeError({ tipo: "error_integracion", fuente: "integracion", objetivo: "cron:emails-reserva-recordatorios-t2", mensaje: "x" })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_integracion", fuente: "integracion", objetivo: "sync-trafico-web:casa-tomas-story", mensaje: "x" })).toBe("admin");
  });
  it("despliegues según el proyecto de Vercel; navegador del panel (si algún día se recoge): admin", () => {
    expect(ambitoDeError({ tipo: "error_despliegue", fuente: "hosting", proyecto: "web-casatomas", objetivo: "web-casatomas:produccion" })).toBe("web");
    expect(ambitoDeError({ tipo: "error_despliegue", fuente: "hosting", proyecto: "admin-casatomas", objetivo: "admin-casatomas:demo" })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_js", fuente: "navegador", proyecto: "admin-casatomas" })).toBe("admin");
  });
  it("sin fuente (pruebas, datos viejos): la del tipo", () => {
    expect(ambitoDeError({ tipo: "error_servidor", mensaje: CLASIFICAR })).toBe("admin");
    expect(ambitoDeError({ tipo: "error_js" })).toBe("web");
  });
  it("los nombres son los mismos en el panel y en el ticket", () => {
    expect(nombreOrigen("web", "web")).toBe("Fallo de la web");
    expect(nombreOrigen("web", "admin")).toBe("Fallo del admin");
    expect(nombreOrigen("web")).toBe("Fallo de la web"); // sin ámbito: como antes
    expect(nombreOrigen("conexion", "admin")).toBe("Conexión del visitante");
    expect(explicacionOrigenAmbito("web", null, "admin")).toMatch(/^Fallo del admin: algo del panel o de sus tareas automáticas no funcionó\. Los clientes no lo ven/);
    expect(explicacionOrigenAmbito("web", null, "web")).toMatch(/^Fallo de la web: /);
  });
});

// ─── El filtro de PostgREST dice lo mismo que ambitoDeError ──────────────────
type Fila = { fuente: string; proyecto: string; mensaje: string | null };

/** Evalúa el subconjunto de la sintaxis de PostgREST que usa filtroAmbito (or/and, eq, neq, like, not.like). */
function evaluar(expr: string, fila: Fila, modo: "or" | "and" = "or"): boolean {
  const partes: string[] = [];
  let nivel = 0;
  let actual = "";
  for (const c of expr) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  partes.push(actual);
  const valor = (p: string): boolean | null => {
    const logico = /^(and|or)\((.*)\)$/.exec(p);
    if (logico) return evaluar(logico[2], fila, logico[1] as "and" | "or");
    const m = /^(fuente|proyecto|mensaje)\.(not\.)?(eq|neq|like)\.(.*)$/.exec(p);
    if (!m) throw new Error(`no sé evaluar ${p}`);
    const v = fila[m[1] as keyof Fila];
    if (v === null) return null; // NULL de SQL
    const r = m[3] === "eq" ? v === m[4] : m[3] === "neq" ? v !== m[4] : new RegExp(`^${m[4].replace(/[.+?^${}()|[\]\\-]/g, "\\$&").replace(/\*/g, ".*")}$`).test(v);
    return m[2] ? !r : r;
  };
  const vs = partes.map(valor);
  return modo === "or" ? vs.some((v) => v === true) : vs.every((v) => v === true);
}

describe("filtro de ámbito en la pestaña Incidencias (PostgREST, sin migración)", () => {
  const filas: Array<Fila & { tipo: string }> = [
    { tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: CLASIFICAR },
    { tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: EMBEDDINGS },
    { tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: "reservas-web/crear: HTTP 500" },
    { tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: "emails-reserva/enlace/ejecutar: x" },
    { tipo: "error_servidor", fuente: "servidor", proyecto: "supabase", mensaje: "funcion-nueva: x" },
    { tipo: "error_js", fuente: "navegador", proyecto: "casa-tomas-story", mensaje: "TypeError: x" },
    { tipo: "error_peticion", fuente: "navegador", proyecto: "casa-tomas-story", mensaje: "clasificar-productos 500" },
    { tipo: "error_js", fuente: "navegador", proyecto: "admin-casatomas", mensaje: "TypeError: y" },
    { tipo: "error_despliegue", fuente: "hosting", proyecto: "web-casatomas", mensaje: "Despliegue de web-casatomas en ERROR (rama main)" },
    { tipo: "error_despliegue", fuente: "hosting", proyecto: "admin-casatomas", mensaje: "Despliegue de admin-casatomas en ERROR (rama staging)" },
    { tipo: "error_integracion", fuente: "integracion", proyecto: "supabase", mensaje: "reservas-web keep warm: job startup timeout" },
    { tipo: "error_integracion", fuente: "integracion", proyecto: "supabase", mensaje: null },
  ];
  it("cada fila cae en el mismo ámbito con las dos reglas (y en uno solo)", () => {
    for (const f of filas) {
      const esperado = ambitoDeError(f as DatosAmbito);
      expect(evaluar(filtroAmbito("web"), f), `${f.fuente} ${f.mensaje}`).toBe(esperado === "web");
      expect(evaluar(filtroAmbito("admin"), f), `${f.fuente} ${f.mensaje}`).toBe(esperado === "admin");
    }
  });
  it("forma del filtro (sin caracteres reservados de PostgREST en los valores)", () => {
    expect(filtroAmbito("web")).toBe(
      `and(fuente.eq.navegador,proyecto.not.like.admin-casatomas*),and(fuente.eq.hosting,proyecto.not.like.admin-casatomas*),and(fuente.eq.servidor,or(${FUNCIONES_WEB.map((f) => `mensaje.like.${f}*`).join(",")}))`,
    );
    expect(filtroAmbito("admin")).toContain("and(fuente.neq.navegador,fuente.neq.hosting,fuente.neq.servidor)");
    for (const f of FUNCIONES_WEB) expect(f).toMatch(/^[a-z0-9-]+$/); // ni «_» (comodín de LIKE) ni «.,:()»
  });
});

// ─── Catálogo de funciones ───────────────────────────────────────────────────
const carpetas = readdirSync(RAIZ_FUNCIONES).filter((n) => !n.startsWith("_") && statSync(join(RAIZ_FUNCIONES, n)).isDirectory() && n !== "__tests__");
const conRegistro = carpetas.filter((n) => {
  try {
    return readFileSync(join(RAIZ_FUNCIONES, n, "index.ts"), "utf8").includes("conAuditoriaDePeticion");
  } catch {
    return false;
  }
});

describe("catálogo de funciones del servidor en llano", () => {
  it("están todas las que registran errores (las envuelve conAuditoriaDePeticion) y el resto de carpetas", () => {
    expect(conRegistro.length).toBeGreaterThan(40);
    expect(conRegistro.filter((n) => !FUNCIONES[n])).toEqual([]);
    expect(carpetas.filter((n) => !FUNCIONES[n])).toEqual([]);
  });
  it("las de la web: las que llama la web pública (web-casatomas/src) y las que llegan al cliente", () => {
    expect([...FUNCIONES_WEB].sort()).toEqual([
      "chat-web", "cheques-regalo-web", "emails-reserva", "newsletter-baja", "notify-reservation-change", "registrar-actividad-web", "reservas-web", "stripe-webhook-cheques-regalo",
    ]);
    for (const f of ["clasificar-productos", "embeddings-nombres", "procesar-factura", "ocr-trabajo", "instagram-publicar", "instagram-programador", "avisos-telegram"]) {
      expect(FUNCIONES[f].ambito, f).toBe("admin");
    }
  });
  it("ningún nombre de función empieza por el de una función de la web (el filtro usa «empieza por»)", () => {
    const todos = new Set([...Object.keys(FUNCIONES), ...carpetas]);
    for (const w of FUNCIONES_WEB) {
      for (const otro of todos) if (otro !== w && otro.startsWith(w)) expect(FUNCIONES[otro]?.ambito, `${otro} empieza por ${w}`).toBe("web");
    }
  });
  it("cada ficha tiene zona, nombre, qué hace, a quién afecta y cómo se repite", () => {
    for (const [id, f] of Object.entries(FUNCIONES)) {
      expect(f.zona, id).toMatch(f.ambito === "web" ? /^Web › / : /^Panel › /);
      expect(f.nombre, id).toMatch(/^[a-zá-ú]/); // en minúscula: va detrás de «Falló …» o como sujeto
      expect(f.hace.length, id).toBeGreaterThan(10);
      expect(f.afecta, id).toMatch(f.ambito === "web" && id !== "registrar-actividad-web" ? /^a los clientes: / : /^a nadie de fuera/);
      expect(Boolean(f.reintento) || Boolean(f.repetir) || id === "notify-reservation-change", id).toBe(true);
      expect(`${f.nombre} ${f.hace} ${f.afecta}`, id).not.toMatch(/[`*_[\]<>]/); // texto llano: nada que se lea como Markdown
    }
  });
  it("el nombre técnico sale del objetivo o del principio del mensaje; lo desconocido no se nombra", () => {
    expect(funcionDeError({ tipo: "error_servidor", fuente: "servidor", objetivo: "reservas-web/crear" })).toBe("reservas-web");
    expect(funcionDeError({ tipo: "error_servidor", fuente: "servidor", mensaje: CLASIFICAR })).toBe("clasificar-productos");
    expect(funcionDeError({ tipo: "error_integracion", fuente: "integracion", objetivo: "sync-trafico-web:casa-tomas-story" })).toBe("sync-trafico-web");
    expect(funcionDeError({ tipo: "error_integracion", fuente: "integracion", objetivo: "cron:clasificar-productos" })).toBeNull();
    expect(funcionDeError({ tipo: "error_peticion", fuente: "navegador", objetivo: "rest:novedades" })).toBeNull();
    expect(funcionSencilla("funcion-nueva")).toBeNull();
    expect(funcionSencilla("constructor")).toBeNull(); // propiedades del objeto, no funciones
  });
});

describe("tareas programadas: cada cuánto se vuelven a lanzar (lo dicen las migraciones)", () => {
  /** El último cron.schedule de cada tarea en supabase/migrations (por orden de fichero). */
  const horarios = new Map<string, string>();
  for (const f of readdirSync(MIGRACIONES).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRACIONES, f), "utf8");
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([a-z0-9-]+)'\s*,\s*'([^']+)'/gi)) horarios.set(m[1], m[2].trim());
  }
  const texto = (expr: string): string => {
    const [min, hora] = expr.split(/\s+/);
    if (expr === "* * * * *") return "cada minuto";
    if (/^\*\/\d+$/.test(min) && hora === "*") return `cada ${min.slice(2)} minutos`;
    if (/^\d+$/.test(min) && hora === "*") return "cada hora";
    if (/^\d+$/.test(min) && /^\*\/\d+$/.test(hora)) return `cada ${hora.slice(2)} horas`;
    if (/^\d+$/.test(min) && /^\d+,\d+$/.test(hora)) return "dos veces al día";
    if (/^\d+$/.test(min) && /^\d+$/.test(hora)) return "una vez al día";
    return expr;
  };
  it("clasificar-productos cada 5 minutos y embeddings-nombres cada 10 (los dos ejemplos)", () => {
    expect(horarios.get("clasificar-productos")).toBe("*/5 * * * *");
    expect(horarios.get("embeddings-nombres")).toBe("*/10 * * * *");
    expect(FUNCIONES["clasificar-productos"].reintento).toBe("se reintenta sola cada 5 minutos");
    expect(FUNCIONES["embeddings-nombres"].reintento).toBe("se reintenta sola cada 10 minutos");
  });
  it("cada tarea conocida dice el mismo intervalo que su cron.schedule", () => {
    let comprobadas = 0;
    for (const [nombre, expr] of horarios) {
      const t = tareaSencilla(nombre);
      if (!t.conocida) continue;
      expect(t.cada, nombre).toBe(texto(expr));
      expect(t.zona, nombre).toMatch(/^Panel › /);
      comprobadas++;
    }
    expect(comprobadas).toBeGreaterThan(20);
  });
});

// ─── Causa conocida: la base de datos tardó demasiado ────────────────────────
describe("causa conocida «canceling statement due to statement timeout» / «lock timeout»", () => {
  it("errores del servidor y de tareas; no en el navegador", () => {
    expect(IDS_CAUSAS).toContain("bd_tiempo_agotado");
    expect(causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: CLASIFICAR, objetivo: "clasificar-productos" })?.id).toBe("bd_tiempo_agotado");
    expect(causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: "x: canceling statement due to lock timeout" })?.id).toBe("bd_tiempo_agotado");
    expect(causaConocida({ tipo: "error_integracion", fuente: "integracion", mensaje: "ERROR: canceling statement due to statement timeout", objetivo: "cron:levantar-mesas-fin-turno" })?.id).toBe("bd_tiempo_agotado");
    expect(causaConocida({ tipo: "error_js", fuente: "navegador", mensaje: "canceling statement due to statement timeout" })?.id).not.toBe("bd_tiempo_agotado");
    // «job startup timeout» sigue siendo la de pg_cron (va antes).
    expect(causaConocida({ tipo: "error_integracion", mensaje: "job startup timeout", objetivo: "cron:x" })?.id).toBe("cron_plataforma");
  });
  it("nombra la función con el catálogo y dice si se reintenta (clasificar-productos)", () => {
    const c = causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: CLASIFICAR, objetivo: "clasificar-productos" })!;
    expect(c.sencillo.titulo).toBe("La clasificación automática de productos tardó demasiado y se cortó.");
    expect(c.sencillo.quePasa).toBe(
      "La base de datos iba muy cargada y la clasificación automática de productos tardó más de lo permitido, así que se canceló. Suele pasar cuando se guardan muchas facturas a la vez.",
    );
    expect(c.sencillo.seArregla).toBe("Sí: se reintenta sola cada 5 minutos y no se pierde nada.");
    expect(c.sencillo.queHacer).toBe("Nada si es suelto. Si se repite, avisa al técnico.");
  });
  it("embeddings-nombres: cada 10 minutos; una función sin reintento lo dice; una tarea, con su cron", () => {
    const e = causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: EMBEDDINGS })!;
    expect(e.sencillo.titulo).toBe("La preparación de los productos nuevos para el buscador tardó demasiado y se cortó.");
    expect(e.sencillo.seArregla).toBe("Sí: se reintenta sola cada 10 minutos y no se pierde nada.");
    const p = causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: "procesar-factura: canceling statement due to statement timeout" })!;
    expect(p.sencillo.seArregla).toBe("No se reintenta sola: hay que volver a intentarlo desde Facturas.");
    const t = causaConocida({ tipo: "error_integracion", fuente: "integracion", mensaje: "canceling statement due to statement timeout", objetivo: "cron:levantar-mesas-fin-turno" })!;
    expect(t.sencillo.titulo).toBe("La tarea que libera las mesas al terminar el turno tardó demasiado y se cortó.");
    expect(t.sencillo.seArregla).toBe("Sí: la tarea se vuelve a lanzar sola cada 10 minutos y no se pierde nada.");
    const otra = causaConocida({ tipo: "error_servidor", fuente: "servidor", mensaje: "funcion-nueva: canceling statement due to statement timeout" })!;
    expect(otra.sencillo.titulo).toBe("Una operación del servidor tardó demasiado y se cortó."); // lo desconocido no se nombra
    expect(`${otra.sencillo.quePasa} ${otra.sencillo.titulo}`).not.toContain("funcion-nueva");
  });
});

// ─── Ficha en llano: cabecera, título, a quién afecta, ¿se arregla solo? ─────
describe("ficha en llano de la incidencia (los dos ejemplos reales)", () => {
  it("clasificar-productos: Fallo del admin · Panel › Facturas, con título en llano", () => {
    const f = fichaSencilla(servidor(CLASIFICAR));
    expect(f.cabecera).toBe("Fallo del admin · Panel › Facturas");
    expect(f.titulo).toBe("La clasificación automática de productos tardó demasiado y se cortó.");
    expect(f.aQuienAfecta).toBe("A nadie de fuera; los productos de las facturas nuevas se clasifican unos minutos más tarde. Ha pasado 6 veces (3 en las últimas 24 h).");
    expect(f.seArregla).toBe("Sí: se reintenta sola cada 5 minutos y no se pierde nada.");
    expect(f.causa?.sencillo.queHacer).toBe("Nada si es suelto. Si se repite, avisa al técnico.");
    const llano = [f.cabecera, f.titulo, f.aQuienAfecta, f.seArregla, f.quePasoGenerico, f.causa?.sencillo.quePasa, f.causa?.sencillo.queHacer].join(" ");
    expect(llano).not.toMatch(/productos_aplicar_clasificacion_ia|canceling|clasificar-productos/); // nada del mensaje técnico en lo llano
  });
  it("embeddings-nombres: mismo formato, cada 10 minutos", () => {
    const f = fichaSencilla(servidor(EMBEDDINGS, { objetivo: null }));
    expect(f.cabecera).toBe("Fallo del admin · Panel › Facturas");
    expect(f.titulo).toBe("La preparación de los productos nuevos para el buscador tardó demasiado y se cortó.");
    expect(f.aQuienAfecta).toMatch(/^A nadie de fuera; el chat de Facturas tarda unos minutos más en encontrar los productos nuevos\./);
    expect(f.seArregla).toBe("Sí: se reintenta sola cada 10 minutos y no se pierde nada.");
  });
  it("función de la web sin causa conocida: Fallo de la web, título con el catálogo y sin reintento", () => {
    const f = fichaSencilla(servidor("reservas-web/crear: HTTP 500", { objetivo: "reservas-web/crear", ocurrencias: 1, ocurrencias_24h: 1 }));
    expect(f.cabecera).toBe("Fallo de la web · Web › Reservas");
    expect(f.titulo).toBe("La función de reservas de la web falló.");
    expect(f.quePasoGenerico).toBe("Falló la función de reservas de la web: es la función que enseña las mesas libres y recibe las reservas que hacen los clientes en la web.");
    expect(f.aQuienAfecta).toBe("A los clientes: puede que alguno no pueda ver las mesas libres o enviar su reserva desde la web. Ha pasado 1 vez (1 en las últimas 24 h).");
    expect(f.seArregla).toBe("No se reintenta sola: el cliente tendría que volver a intentarlo.");
  });
  it("función del panel que falla por un servicio de fuera: nombra el servicio y que se arregla cuando responda", () => {
    const f = fichaSencilla(servidor("clasificar-productos: OpenAI 429", { origen: "externo", proveedor: "OpenAI" }));
    expect(f.cabecera).toBe("Servicio externo · OpenAI · Panel › Facturas");
    expect(f.titulo).toBe("La clasificación automática de productos falló por un problema de OpenAI.");
    expect(f.seArregla).toBe("Se reintenta sola cada 5 minutos; en cuanto OpenAI vuelva a responder bien, funcionará.");
  });
  it("función desconocida: sin título en llano (se enseña el técnico) y sin su nombre en el texto", () => {
    const f = fichaSencilla(servidor("funcion-nueva: boom"));
    expect(f.cabecera).toBe("Fallo del admin");
    expect(f.titulo).toBeNull();
    expect(f.aQuienAfecta).toBe("No le sale a un cliente en pantalla: es del servidor. Ha pasado 6 veces (3 en las últimas 24 h).");
    expect([f.cabecera, f.aQuienAfecta, f.seArregla, f.quePasoGenerico].join(" ")).not.toContain("funcion-nueva");
  });
  it("tarea automática, despliegue y navegador", () => {
    const cron = fichaSencilla({ tipo: "error_integracion", fuente: "integracion", proyecto: "supabase", mensaje: "ERROR: permission denied", objetivo: "cron:levantar-mesas-fin-turno", origen: "web", ocurrencias: 2, ocurrencias_24h: 2 });
    expect(cron.cabecera).toBe("Fallo del admin · Panel › Reservas");
    expect(cron.titulo).toBe("Falló la tarea automática que libera las mesas al terminar el turno.");
    expect(cron.aQuienAfecta).toMatch(/^Lo que se nota: alguna mesa puede seguir ocupada en el plano hasta la siguiente vuelta\. Ha pasado 2 veces/);
    expect(cron.seArregla).toBe("La tarea se vuelve a lanzar sola cada 10 minutos; si el fallo es del código, seguirá fallando hasta que se corrija.");
    const desp = fichaSencilla({ tipo: "error_despliegue", fuente: "hosting", proyecto: "admin-casatomas", objetivo: "admin-casatomas:demo", origen: "web", ocurrencias: 1, ocurrencias_24h: 1 });
    expect([desp.cabecera, desp.titulo]).toEqual(["Fallo del admin · Panel › Publicación", "La publicación del panel en Vercel falló."]);
    const web = fichaSencilla({ tipo: "error_js", fuente: "navegador", proyecto: "casa-tomas-story", mensaje: "TypeError: x", rutas: [{ ruta: "/carta/vinos" }], origen: "web", ocurrencias: 3, ocurrencias_24h: 1 });
    expect(web.cabecera).toBe("Fallo de la web · Web › Carta de vinos");
    expect(web.titulo).toBeNull(); // sin causa conocida: el mensaje técnico, como antes
    expect(web.aQuienAfecta).toBeNull(); // en el navegador lo cuentan el panel y el ticket con las sesiones
  });
});
