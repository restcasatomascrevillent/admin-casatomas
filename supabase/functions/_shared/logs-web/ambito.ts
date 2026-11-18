// ============================================================================
//  Logs web · ÁMBITO de un fallo nuestro: ¿de la web o del admin?
// ----------------------------------------------------------------------------
//  Petición del dueño (18/11/2026): todo lo que era culpa nuestra salía como
//  «Fallo de la web», aunque fallara una función del PANEL («Fallo de la web ·
//  clasificar-productos: … statement timeout»). Ahora se separa, solo, según
//  DÓNDE falla:
//    · «Fallo de la web»  → lo que usan los clientes: errores del navegador de
//      la web pública, funciones que sirve la web o que llegan al cliente
//      (FUNCIONES_WEB en funciones.ts) y despliegues del proyecto de la web.
//    · «Fallo del admin»  → funciones del panel, tareas automáticas (pg_cron,
//      Tráfico web…), despliegues del proyecto admin-casatomas y, si algún día
//      se recogen, los errores del navegador del panel (proyecto
//      admin-casatomas*). Hoy el monitor NO los recoge: registrar-actividad-web
//      solo acepta la web pública (clasificacion.ts) y el panel no lleva el
//      rastreador.
//  El origen guardado (web_eventos.origen / web_incidencias.origen = 'web')
//  NO cambia: sigue significando «culpa nuestra» y decide los tickets. El
//  ámbito se deriva de los datos (fuente, proyecto, objetivo/mensaje) sin
//  migración. `filtroAmbito` es la MISMA regla como filtro de PostgREST
//  (columnas de web_incidencias), para la pestaña Incidencias; un test los
//  compara.
//  Sin Deno ni imports remotos (lo usan el panel y las funciones).
// ============================================================================

import { FUNCIONES_WEB, type Ambito } from "./funciones.ts";
import { explicacionOrigen, NOMBRE_ORIGEN, type OrigenVisible } from "./origen.ts";

export type { Ambito };

export const AMBITOS: readonly Ambito[] = ["web", "admin"];

/** Prefijo de los proyectos del panel (Vercel y, si se recogiera, su navegador). */
export const PREFIJO_PROYECTO_ADMIN = "admin-casatomas";

export interface DatosAmbito {
  tipo: string;
  fuente?: string | null;
  proyecto?: string | null;
  objetivo?: string | null;
  mensaje?: string | null;
}

/** Fuente de un evento; si falta, la que corresponde a su tipo (como en las pruebas). */
function fuenteDe(d: DatosAmbito): string {
  if (d.fuente) return d.fuente;
  if (d.tipo === "error_servidor") return "servidor";
  if (d.tipo === "error_integracion") return "integracion";
  if (d.tipo === "error_despliegue") return "hosting";
  return "navegador";
}

const esDelPanel = (proyecto: string | null | undefined) => (proyecto ?? "").startsWith(PREFIJO_PROYECTO_ADMIN);
const esFuncionWeb = (texto: string) => FUNCIONES_WEB.some((f) => texto.startsWith(f));

/**
 * Ámbito de un error (ocurrencia o incidencia). En el servidor manda el
 * principio del mensaje («función/subruta: …», igual que en el filtro); si no
 * hay mensaje, el objetivo.
 */
export function ambitoDeError(d: DatosAmbito): Ambito {
  const fuente = fuenteDe(d);
  if (fuente === "navegador" || fuente === "hosting") return esDelPanel(d.proyecto) ? "admin" : "web";
  if (fuente === "servidor") return esFuncionWeb(d.mensaje ?? d.objetivo ?? "") ? "web" : "admin";
  return "admin"; // integraciones y tareas automáticas
}

/**
 * La misma regla como filtro `or` de PostgREST sobre web_incidencias (fuente,
 * proyecto, mensaje). Patrones `like` con `*`: los nombres de función no
 * llevan «_» ni caracteres reservados.
 */
export function filtroAmbito(ambito: Ambito): string {
  const panel = `proyecto.like.${PREFIJO_PROYECTO_ADMIN}*`;
  const noPanel = `proyecto.not.like.${PREFIJO_PROYECTO_ADMIN}*`;
  if (ambito === "web") {
    return [
      `and(fuente.eq.navegador,${noPanel})`,
      `and(fuente.eq.hosting,${noPanel})`,
      `and(fuente.eq.servidor,or(${FUNCIONES_WEB.map((f) => `mensaje.like.${f}*`).join(",")}))`,
    ].join(",");
  }
  return [
    `and(fuente.eq.navegador,${panel})`,
    `and(fuente.eq.hosting,${panel})`,
    "and(fuente.neq.navegador,fuente.neq.hosting,fuente.neq.servidor)",
    `and(fuente.eq.servidor,${FUNCIONES_WEB.map((f) => `mensaje.not.like.${f}*`).join(",")})`,
  ].join(",");
}

/** «Fallo de la web» / «Fallo del admin»: los mismos en el panel y en el ticket. */
export const NOMBRE_AMBITO: Record<Ambito, string> = {
  web: "Fallo de la web",
  admin: "Fallo del admin",
};

/** Grupo de las cuentas: «Fallos de la web», «Fallos del admin». */
export const NOMBRE_GRUPO_AMBITO: Record<Ambito, string> = {
  web: "Fallos de la web",
  admin: "Fallos del admin",
};

/** Nombre de un origen con su ámbito: los fallos nuestros dicen si son de la web o del admin. */
export function nombreOrigen(o: OrigenVisible, ambito?: Ambito | null): string {
  return o === "web" ? NOMBRE_AMBITO[ambito ?? "web"] : NOMBRE_ORIGEN[o];
}

/** La línea en llano de cada origen, con el ámbito en los fallos nuestros. */
export function explicacionOrigenAmbito(o: OrigenVisible, proveedor?: string | null, ambito?: Ambito | null): string {
  if (o === "web" && ambito === "admin") {
    return "Fallo del admin: algo del panel o de sus tareas automáticas no funcionó. Los clientes no lo ven, pero hay que arreglarlo.";
  }
  return explicacionOrigen(o, proveedor);
}
