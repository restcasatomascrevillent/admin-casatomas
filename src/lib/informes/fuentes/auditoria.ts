// ============================================================================
//  Super Admin › Informes — «Informe mensual de auditoría» (14/11/2026).
//  Petición del dueño: por persona, cuántas cosas ha hecho, cuántos días entró,
//  cuándo fue la última vez y dónde trabaja más; quién usa más el panel (con su
//  gráfico por días y por horas); la lista de lo delicado (borrados, cambios de
//  precio y de permisos) y, aparte, lo que hace el sistema solo.
//  Los datos salen de la RPC `informe_auditoria_mensual` (migración
//  20261201100000, solo super admin), que resume `audit_log_visible` en hora de
//  Madrid. Aquí solo se convierte en tablas, con textos sin jerga.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { TABLA_LABEL } from "@/hooks/useAuditLog";
import { textoMes, type Periodo } from "../periodo";
import { nombreArchivoInforme, type ColumnaInforme, type FilaInforme, type ResultadoInformeTabla, type TablaInforme } from "../tabla";

const TITULO = "Informe mensual de auditoría";
/** Filas de «lo delicado» que salen en las diapositivas (el resto se cuenta en la nota). */
export const MAX_DELICADAS = 100;

// ─── Lo que devuelve la RPC ─────────────────────────────────────────────────

export interface UsuarioAuditoria {
  quien: string;
  acciones: number;
  dias: number;
  ultima: string;
  borrados: number;
  precios: number;
  secciones: { tabla: string; n: number }[];
}
type Lado = Partial<Record<"nombre" | "precio_eur" | "section_key" | "can_view" | "can_edit" | "role" | "email", string>>;
export interface DelicadaAuditoria {
  created_at: string;
  actor_label: string | null;
  accion: string;
  tabla: string | null;
  tipo_evento: string;
  det: { antes?: Lado; despues?: Lado };
}
export interface DatosAuditoria {
  usuarios: UsuarioAuditoria[];
  por_dia: { dia: string; n: number }[];
  por_hora: { hora: number; n: number }[];
  delicadas_total: number;
  delicadas: DelicadaAuditoria[];
  sistema: { actor_label: string | null; tabla: string | null; accion: string; n: number }[];
  sistema_total: number;
  accesos_fallidos: number;
}

// ─── Textos ─────────────────────────────────────────────────────────────────

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const formatoFecha = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** «14/11 18:30» en hora de Madrid. */
export function cuando(iso: string): string {
  const p = Object.fromEntries(formatoFecha.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const d2 = (v: string) => v.padStart(2, "0");
  return `${d2(p.day)}/${d2(p.month)} ${d2(p.hour)}:${d2(p.minute)}`;
}

export const dondeTabla = (tabla: string | null): string => (tabla ? (TABLA_LABEL[tabla] ?? tabla) : "—");

/** Gráfico de barras con bloques: 24 bloques como mucho. */
export function barra(n: number, max: number, ancho = 24): string {
  if (max <= 0 || n <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((n / max) * ancho)));
}

/** El nombre del actor automático, sin «API · service_role ·». */
function quienSistema(label: string | null): string {
  if (!label) return "Sistema";
  if (/^Base de datos/i.test(label)) return "La base de datos (automático)";
  const m = label.match(/^API\s*·\s*service_role\s*·\s*(.+)$/);
  return m ? `Proceso «${m[1]}»` : label;
}

const VERBO: Record<string, string> = { crear: "Crea", actualizar: "Cambia", eliminar: "Borra", ejecutar: "Lanza" };

const nivel = (v?: string): string => (v === "true" ? "sí" : v === "false" ? "no" : "—");

/** Frase de una acción delicada, para leerla sin saber de informática. */
export function fraseDelicada(d: DelicadaAuditoria): string {
  const a = d.det?.antes ?? {};
  const z = d.det?.despues ?? {};
  const nombre = z.nombre ?? a.nombre;
  switch (d.tipo_evento) {
    case "cambiar_precio": {
      const de = a.precio_eur != null ? eur.format(Number(a.precio_eur)) : "—";
      const aa = z.precio_eur != null ? eur.format(Number(z.precio_eur)) : "—";
      return `Cambió el precio${nombre ? ` de «${nombre}»` : ""}: de ${de} a ${aa}`;
    }
    case "cambiar_permisos": {
      const lado = d.accion === "eliminar" ? a : z;
      const sec = lado.section_key ? `«${lado.section_key}»` : "una sección";
      return d.accion === "eliminar" ? `Quitó el permiso de ${sec} a alguien` : `Cambió permisos en ${sec}: ver ${nivel(lado.can_view)}, editar ${nivel(lado.can_edit)}`;
    }
    case "cambiar_roles":
      return d.accion === "eliminar" ? `Quitó el rol «${a.role ?? "—"}» a alguien` : `Dio el rol «${z.role ?? "—"}»${a.role ? ` (antes «${a.role}»)` : ""} a alguien`;
    case "bloquear_acceso":
      return "Bloqueó el acceso al panel de una persona";
    case "desbloquear_acceso":
      return "Volvió a dar acceso al panel a una persona";
    case "cambiar_credenciales":
      return "Cambió el correo o la contraseña de una persona";
    default:
      return `Borró ${dondeTabla(d.tabla).toLowerCase()}${nombre ? `: «${nombre}»` : ""}`;
  }
}

const TIPO_RESUMEN: { id: string; texto: string }[] = [
  { id: "cambiar_precio", texto: "Cambios de precio" },
  { id: "cambiar_permisos", texto: "Cambios de permisos" },
  { id: "cambiar_roles", texto: "Cambios de rol (quién es jefe, quién no)" },
  { id: "bloquear_acceso", texto: "Accesos bloqueados" },
  { id: "desbloquear_acceso", texto: "Accesos devueltos" },
  { id: "cambiar_credenciales", texto: "Cambios de correo o contraseña" },
  { id: "eliminar", texto: "Cosas borradas" },
];

// ─── Tablas ─────────────────────────────────────────────────────────────────

const col = (id: string, etiqueta: string, tipo: ColumnaInforme["tipo"], ancho?: number): ColumnaInforme => ({ id, etiqueta, tipo, ancho });

function diasDelMes(mes: string): string[] {
  const [y, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

/** El informe como tablas del módulo Informes. Función pura (se prueba sin Supabase). */
export function tablasInformeAuditoria(d: DatosAuditoria, mes: string): ResultadoInformeTabla {
  if (d.usuarios.length === 0 && d.sistema_total === 0 && d.delicadas_total === 0) {
    return { vacio: true, motivo: `No hay nada en el registro de ${textoMes(mes)}.` };
  }
  const personas = d.usuarios.filter((u) => u.acciones > 0 || u.dias > 0);
  const totalAcciones = personas.reduce((s, u) => s + u.acciones, 0);
  const tablas: TablaInforme[] = [];

  tablas.push({
    titulo: "Quién usa más el panel",
    columnas: [
      col("puesto", "Puesto", "texto", 70),
      col("quien", "Persona", "texto"),
      col("acciones", "Acciones", "entero", 100),
      col("dias", "Días que entró", "entero", 120),
      col("ultima", "Última vez", "texto", 130),
      col("donde", "Donde más trabaja", "texto", 330),
    ],
    filas: personas.slice(0, 20).map((u, i): FilaInforme => ({
      puesto: `${i + 1}º`,
      quien: u.quien,
      acciones: u.acciones,
      dias: u.dias,
      ultima: cuando(u.ultima),
      donde: u.secciones.length ? u.secciones.map((s) => `${dondeTabla(s.tabla)} (${s.n})`).join(", ") : "—",
    })),
    total: { puesto: "", quien: "Total", acciones: totalAcciones, dias: null, ultima: "", donde: "" },
    nota:
      "Una acción es cada vez que alguien crea, cambia, borra o lanza algo en el panel. Solo entrar no cuenta. " +
      "«Días que entró» son los días distintos del mes en los que esa persona hizo algo o abrió el panel. Hora de Madrid.",
  });

  const dias = diasDelMes(mes);
  const mapaDia = new Map(d.por_dia.map((x) => [x.dia, x.n]));
  const maxDia = Math.max(0, ...dias.map((x) => mapaDia.get(x) ?? 0));
  tablas.push({
    titulo: "Gráfico por días",
    columnas: [col("dia", "Día", "texto", 110), col("n", "Acciones", "entero", 110), col("grafico", "Gráfico", "texto")],
    filas: dias.map((x) => ({ dia: `${x.slice(8)}/${x.slice(5, 7)}`, n: mapaDia.get(x) ?? 0, grafico: barra(mapaDia.get(x) ?? 0, maxDia) })),
    nota: "Cuántas acciones hizo la gente cada día. Los días sin barra, nadie tocó nada.",
  });

  const mapaHora = new Map(d.por_hora.map((x) => [x.hora, x.n]));
  const horas = Array.from({ length: 24 }, (_, h) => h).filter((h) => (mapaHora.get(h) ?? 0) > 0);
  const maxHora = Math.max(0, ...horas.map((h) => mapaHora.get(h) ?? 0));
  tablas.push({
    titulo: "Gráfico por horas",
    columnas: [col("hora", "Hora", "texto", 110), col("n", "Acciones", "entero", 110), col("grafico", "Gráfico", "texto")],
    filas: horas.map((h) => ({ hora: `${String(h).padStart(2, "0")}:00`, n: mapaHora.get(h) ?? 0, grafico: barra(mapaHora.get(h) ?? 0, maxHora) })),
    nota: "A qué hora del día se trabaja más en el panel (suma de todo el mes). Solo salen las horas con actividad.",
  });

  const resumen = TIPO_RESUMEN.map((t) => ({
    texto: t.texto,
    n: t.id === "eliminar" ? d.usuarios.reduce((s, u) => s + u.borrados, 0) : d.delicadas.filter((x) => x.tipo_evento === t.id).length,
  }));
  tablas.push({
    titulo: "Acciones delicadas: resumen",
    columnas: [col("tipo", "Qué pasó", "texto"), col("n", "Veces", "entero", 120)],
    filas: resumen.filter((r) => r.n > 0).map((r) => ({ tipo: r.texto, n: r.n })),
    nota:
      d.delicadas_total === 0
        ? "Este mes nadie borró nada, ni cambió precios ni permisos."
        : "Son las cosas que conviene mirar con lupa: si algo no te suena, pregunta a la persona.",
  });

  const mostradas = d.delicadas.slice(0, MAX_DELICADAS);
  if (mostradas.length > 0) {
    tablas.push({
      titulo: "Acciones delicadas: una por una",
      columnas: [col("cuando", "Cuándo", "texto", 130), col("quien", "Quién", "texto", 250), col("que", "Qué hizo", "texto")],
      filas: mostradas.map((x) => ({ cuando: cuando(x.created_at), quien: x.actor_label ?? "—", que: fraseDelicada(x) })),
      nota:
        d.delicadas_total > mostradas.length
          ? `Salen las ${mostradas.length} más recientes de ${d.delicadas_total}. Para ver todas: Super Admin › Auditoría.`
          : null,
    });
  }

  // Lo automático, aparte: no es de nadie.
  tablas.push({
    titulo: "Lo que hace el sistema solo",
    columnas: [col("quien", "Quién", "texto", 280), col("que", "Qué hace", "texto"), col("n", "Veces", "entero", 110)],
    filas: d.sistema.slice(0, 25).map((s) => ({ quien: quienSistema(s.actor_label), que: `${VERBO[s.accion] ?? s.accion}: ${dondeTabla(s.tabla)}`, n: s.n })),
    total: { quien: "Total", que: "", n: d.sistema_total },
    nota: "Son cosas que pasan sin que nadie pulse nada: el servidor lee facturas, la base de datos actualiza datos enlazados, etc. No cuentan para el ranking de personas.",
  });

  const descripcion =
    `Quién ha usado el panel en ${textoMes(mes)}: ${personas.length} ${personas.length === 1 ? "persona" : "personas"} y ${totalAcciones} acciones. ` +
    (d.delicadas_total ? `Cosas delicadas (borrados, precios, permisos): ${d.delicadas_total}. ` : "Nada delicado este mes. ") +
    (d.accesos_fallidos ? `Intentos de entrar que fallaron: ${d.accesos_fallidos}. ` : "") +
    `Aparte, el sistema hizo ${d.sistema_total} cosas solo.`;

  return { vacio: false, titulo: TITULO, descripcion, textoPeriodo: textoMes(mes), tablas, nombreArchivo: nombreArchivoInforme(TITULO, mes) };
}

export async function obtenerInformeAuditoria(periodo: Periodo): Promise<ResultadoInformeTabla> {
  if (periodo.tipo !== "mes") return { vacio: true, motivo: "Elige un mes." };
  const { data, error } = await supabase.rpc("informe_auditoria_mensual" as never, { p_mes: periodo.mes } as never);
  if (error) return { vacio: true, motivo: `No se pudo leer la auditoría: ${error.message}` };
  return tablasInformeAuditoria(data as unknown as DatosAuditoria, periodo.mes);
}
