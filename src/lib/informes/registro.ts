// ============================================================================
//  Super Admin › Informes — REGISTRO de todos los informes del panel
// ----------------------------------------------------------------------------
//  Petición del dueño (10/11/2026): «un módulo en el superadmin que sea
//  Informes donde se puedan generar todos los informes que hay a lo largo del
//  superadmin de forma centralizada». La página (/super-admin/informes) lista
//  lo que hay aquí, filtrado por permisos, y deja elegir el periodo y
//  generar/descargar con el mismo formato que el informe de Tráfico web.
//
//  CÓMO SE AÑADE UN INFORME
//    1. Si es una tabla (o varias): escribe `obtener(periodo, ctx)` que
//       devuelva un `InformeTabla` (./tabla.ts) o `{ vacio: true, motivo }`.
//       Si tiene diapositivas propias (como Tráfico web): un componente que
//       reciba `PropsGeneradorInforme` y pinte dentro de `<Marco>`
//       (ver src/components/informes/generadores/).
//    2. Añade su `DefinicionInforme` a `INFORMES` (abajo): id único, título,
//       sección, permiso, tipo de periodo y el generador.
//    3. Si su sección no está en `SECCIONES_INFORME`, añádela.
//    4. Test: src/lib/informes/__tests__/registro.test.ts comprueba que los
//       ids son únicos y que cada sección y permiso existen.
// ============================================================================
import type { ComponentType, ReactNode } from "react";
import type { SectionKey } from "@/hooks/useUserRole";
import type { OpcionMes, Periodo, TipoPeriodo } from "./periodo";
import type { ResultadoInformeTabla } from "./tabla";
import { mesesSeleccionables as mesesTrafico, mesPorDefecto as mesPorDefectoTrafico } from "@/components/trafico-web/informe/modelo";
import { obtenerInformeFacturas } from "./fuentes/facturas";
import { obtenerInformeVinoFavorito } from "./fuentes/vinoFavorito";
import { obtenerInformeServicios } from "./fuentes/servicios";
import { obtenerInformeAuditoria } from "./fuentes/auditoria";
import { obtenerInformeCartaFacturas, type TipoCartaFacturas } from "./fuentes/cartaFacturas";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type IdSeccionInforme = "web" | "rrss" | "facturas" | "carta" | "servicios" | "cheques" | "auditoria";

export interface SeccionInforme {
  id: IdSeccionInforme;
  titulo: string;
}

/** Orden en que salen los grupos en la página. */
export const SECCIONES_INFORME: SeccionInforme[] = [
  { id: "web", titulo: "Web" },
  { id: "rrss", titulo: "Redes sociales" },
  { id: "facturas", titulo: "Facturas" },
  { id: "servicios", titulo: "Servicios" },
  { id: "cheques", titulo: "Cheques regalo" },
  { id: "carta", titulo: "Carta" },
  { id: "auditoria", titulo: "Seguridad" },
];

/**
 * Quién puede generar el informe:
 *   · «superadmin»: solo super admins (módulos que solo existen en el Super Admin: Tráfico web, Servicios…).
 *   · «seccion»: quien tenga ese permiso en Usuarios (como `useCanAccessSection`): «view» o «edit».
 * Un super admin lo puede todo (igual que `has_section_permission()` en la base de datos).
 */
export type PermisoInforme = { tipo: "superadmin" } | { tipo: "seccion"; seccion: SectionKey; nivel: "view" | "edit" };

export type FormatoInforme = "pdf" | "csv";

export interface ContextoInforme {
  /** Hoy, `YYYY-MM-DD` (día local). */
  hoy: string;
}

/** Lo que recibe el componente de un informe con diapositivas propias. */
export interface PropsGeneradorInforme {
  periodo: Periodo;
  hoy: string;
  /** Cabecera (título, selector de periodo) y zona de vista previa comunes: el informe pone sus botones y su contenido. */
  Marco: ComponentType<{ acciones: ReactNode; children: ReactNode }>;
}

export type GeneradorInforme =
  /** Una o varias tablas: la página hace la vista previa, el PDF (diapositivas) y el CSV. */
  | { tipo: "tabla"; obtener: (periodo: Periodo, ctx: ContextoInforme) => Promise<ResultadoInformeTabla> }
  /** Diapositivas propias (Tráfico web, RRSS): componente que se carga al elegir el informe. */
  | { tipo: "componente"; cargar: () => Promise<{ default: ComponentType<PropsGeneradorInforme> }> };

export interface DefinicionInforme {
  /** Único y estable: va en la URL (?informe=trafico-web-mensual). */
  id: string;
  titulo: string;
  /** Una o dos frases: qué sale en el informe. */
  descripcion: string;
  seccion: IdSeccionInforme;
  permiso: PermisoInforme;
  periodo: TipoPeriodo;
  formatos: FormatoInforme[];
  /** Pantalla donde también se puede generar (enlace «También en …»). */
  origen?: { etiqueta: string; ruta: string };
  /** Solo con periodo «mes»: meses que se pueden elegir y el de por defecto (si no, los 12 últimos y el anterior). */
  meses?: (hoy: string) => OpcionMes[];
  mesPorDefecto?: (hoy: string) => string;
  generador: GeneradorInforme;
}

// ─── Los informes ───────────────────────────────────────────────────────────

const facturas = (
  id: string,
  modulo: Parameters<typeof obtenerInformeFacturas>[0],
  titulo: string,
  descripcion: string,
): DefinicionInforme => ({
  id,
  titulo,
  descripcion,
  seccion: "facturas",
  permiso: { tipo: "seccion", seccion: "facturas", nivel: "view" },
  periodo: "rango",
  formatos: ["pdf", "csv"],
  origen: { etiqueta: "Facturas › Análisis", ruta: "/facturas?tab=chat" },
  generador: { tipo: "tabla", obtener: (periodo) => obtenerInformeFacturas(modulo, periodo, titulo) },
});

// 11/11/2026, petición del dueño: «una lista de todos los vinos de la carta, precio en facturas, precio
// en carta, si está activo o no y si tienen foto o no […]. Para platos lo mismo». Las compras exigen
// ver Facturas (como Facturas › Márgenes, de donde sale la vinculación producto ↔ vino/plato).
const cartaFacturas = (tipo: TipoCartaFacturas, titulo: string, descripcion: string): DefinicionInforme => ({
  id: `facturas-carta-${tipo}`,
  titulo,
  descripcion,
  seccion: "facturas",
  permiso: { tipo: "seccion", seccion: "facturas", nivel: "view" },
  periodo: "ninguno",
  formatos: ["pdf", "csv"],
  origen: { etiqueta: "Facturas › Márgenes", ruta: "/facturas?tab=margenes" },
  generador: { tipo: "tabla", obtener: (_periodo, ctx) => obtenerInformeCartaFacturas(tipo, ctx) },
});

export const INFORMES: DefinicionInforme[] = [
  {
    id: "trafico-web-mensual",
    titulo: "Informe mensual de tráfico web",
    descripcion:
      "La web de Casa Tomás: cifras clave, gráficas y conclusiones del mes, comparado con el anterior, y al final un apartado para Touza.",
    seccion: "web",
    permiso: { tipo: "superadmin" },
    periodo: "mes",
    formatos: ["pdf"],
    origen: { etiqueta: "Tráfico web", ruta: "/super-admin/trafico-web" },
    meses: (hoy) => mesesTrafico(hoy),
    mesPorDefecto: mesPorDefectoTrafico,
    generador: { tipo: "componente", cargar: () => import("@/components/informes/generadores/InformeTraficoGenerador") },
  },
  {
    id: "rrss-mensual",
    titulo: "Informe mensual de redes sociales",
    descripcion: "Instagram (alcance, publicaciones y seguidores del mes, comparado con el anterior) y las visitas que las redes llevan a la web.",
    seccion: "rrss",
    permiso: { tipo: "seccion", seccion: "marketing", nivel: "view" },
    periodo: "mes",
    formatos: ["pdf"],
    origen: { etiqueta: "RRSS › Métricas", ruta: "/rrss?red=metricas" },
    meses: (hoy) => mesesTrafico(hoy),
    mesPorDefecto: mesPorDefectoTrafico,
    generador: { tipo: "componente", cargar: () => import("@/components/informes/generadores/InformeRrssGenerador") },
  },
  facturas("facturas-gasto-proveedor", "proveedores", "Gasto por proveedor", "Lo gastado con cada proveedor en el periodo (con IVA), su parte del total y cuántos documentos."),
  facturas("facturas-gasto-familia", "familias", "Gasto por familia", "La base sin IVA de las líneas de compra de cada familia de productos en el periodo."),
  facturas("facturas-gasto-mes", "gasto_mes", "Gasto por mes", "El gasto con IVA de cada mes del periodo, de Casa Tomás y de Touza."),
  facturas("facturas-productos", "productos", "Productos más comprados", "Los productos en los que más se ha gastado en el periodo (base sin IVA de sus líneas)."),
  cartaFacturas("vinos", "Vinos: facturas y carta", "Todos los vinos: precio en carta, última compra en facturas (precio y fecha), margen de beneficio, si están activos y si tienen foto."),
  cartaFacturas("platos", "Platos: facturas y carta", "Todos los platos: precio en carta, última compra de su ingrediente principal (o «Falta el escandallo»), si están activos y si tienen foto."),
  {
    id: "carta-vino-favorito",
    titulo: "Votación del vino favorito",
    descripcion: "Votos por vino y la lista de participantes (con nombre y contacto) de «Vota tu vino favorito».",
    seccion: "carta",
    // Los votos llevan nombre y contacto: solo con «Editar» en la carta, como el botón «Resultados».
    permiso: { tipo: "seccion", seccion: "gestor_carta", nivel: "edit" },
    periodo: "ninguno",
    formatos: ["pdf", "csv"],
    origen: { etiqueta: "Gestor Web › Carta › Vinos", ruta: "/gestion-web?tab=carta" },
    generador: { tipo: "tabla", obtener: (_periodo, ctx) => obtenerInformeVinoFavorito(ctx) },
  },
  {
    id: "servicios-mensual",
    // 13/11/2026: también la IA función por función, lo que cuesta cada cosa y los precios por confirmar.
    titulo: "Informe mensual de costes",
    descripcion:
      "Gasto de cada servicio en el mes, el total y la comparación con el anterior; la IA función por función y lo que cuesta cada cosa; lo que falta por meter y los precios por confirmar.",
    seccion: "servicios",
    permiso: { tipo: "superadmin" },
    periodo: "mes",
    formatos: ["pdf", "csv"],
    origen: { etiqueta: "Servicios › Costes", ruta: "/super-admin/servicios" },
    generador: { tipo: "tabla", obtener: (periodo) => obtenerInformeServicios(periodo) },
  },
  {
    id: "auditoria-mensual",
    // 14/11/2026, petición del dueño: quién usa el panel, qué toca y qué hace el sistema solo.
    titulo: "Informe mensual de auditoría",
    descripcion:
      "Quién ha usado el panel en el mes: acciones, días que entró y dónde trabaja más; gráfico por días y horas; lo delicado (borrados, precios, permisos) y, aparte, lo que hace el sistema solo.",
    seccion: "auditoria",
    permiso: { tipo: "superadmin" },
    periodo: "mes",
    formatos: ["pdf", "csv"],
    origen: { etiqueta: "Super Admin › Auditoría", ruta: "/super-admin/auditoria" },
    generador: { tipo: "tabla", obtener: (periodo) => obtenerInformeAuditoria(periodo) },
  },
  {
    id: "cheques-mensual",
    titulo: "Informe de cheques regalo",
    descripcion: "Ventas, canjes, pendiente de canjear, caducidades y comisiones de Stripe del mes, comparado con el anterior.",
    seccion: "cheques",
    // «Editar» en Cheques (10/11/2026, petición del dueño): como la pestaña Stripe de la que sale.
    // La RPC informe_cheques_regalo también lo exige (migración 20261122164100).
    permiso: { tipo: "seccion", seccion: "cheques", nivel: "edit" },
    periodo: "mes",
    formatos: ["pdf"],
    origen: { etiqueta: "Cheques › Stripe", ruta: "/cheques" },
    generador: { tipo: "componente", cargar: () => import("@/components/informes/generadores/InformeChequesGenerador") },
  },
];

// ─── Permisos ───────────────────────────────────────────────────────────────

export interface PermisosUsuario {
  esSuperAdmin: boolean;
  permisos: ReadonlyArray<{ section_key: string; can_view: boolean; can_edit: boolean }>;
}

/** ¿Puede este usuario generar el informe? Misma regla que `useCanAccessSection`. */
export function puedeVerInforme(def: Pick<DefinicionInforme, "permiso">, u: PermisosUsuario): boolean {
  if (u.esSuperAdmin) return true;
  if (def.permiso.tipo === "superadmin") return false;
  const { seccion, nivel } = def.permiso;
  const p = u.permisos.find((x) => x.section_key === seccion);
  if (!p) return false;
  return nivel === "view" ? p.can_view || p.can_edit : p.can_edit;
}

/** Los informes que puede ver, agrupados por sección en el orden de `SECCIONES_INFORME` (sin grupos vacíos). */
export function informesPorSeccion(
  u: PermisosUsuario,
  informes: DefinicionInforme[] = INFORMES,
): { seccion: SeccionInforme; informes: DefinicionInforme[] }[] {
  const visibles = informes.filter((i) => puedeVerInforme(i, u));
  return SECCIONES_INFORME.map((seccion) => ({ seccion, informes: visibles.filter((i) => i.seccion === seccion.id) })).filter((g) => g.informes.length > 0);
}

export const buscarInforme = (id: string | null, informes: DefinicionInforme[] = INFORMES): DefinicionInforme | null =>
  (id && informes.find((i) => i.id === id)) || null;
