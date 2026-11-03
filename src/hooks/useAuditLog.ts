import { completeAuditEnabled } from "@/lib/audit-version";
import { useCallback, useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_label?: string;
  actor_origin?:
    | "usuario"
    | "servicio"
    | "base_de_datos"
    | "historico"
    | "intento";
  accion:
    | "login"
    | "logout"
    | "crear"
    | "actualizar"
    | "eliminar"
    | "ejecutar"
    | "intento_login"
    | "login_fallido"
    | "acceso"
    | "acceso_denegado";
  tabla: string | null;
  registro_id: string | null;
  detalles: Record<string, unknown> | null;
  user_agent: string | null;
  device_id?: string | null;
  ip_address?: string | null;
  request_id?: string | null;
  session_id?: string | null;
  tipo_evento?: string;
  resultado?: string;
}

export interface AuditLogFiltros {
  actor?: string;
  dispositivo?: string;
  accion?: string;
  tabla?: string;
  desde?: string;
  hasta?: string;
  texto?: string;
  resultado?: string;
  origen?: "sin_servidor" | "usuario" | "servidor" | "intento" | "historico";
}

const PAGE_SIZE = 25;
const GRUPOS_ACCION: Record<string, { columna: string; valores: string[] }> = {
  grupo_cambios: {
    columna: "accion",
    valores: ["crear", "actualizar", "eliminar"],
  },
  grupo_ia: {
    columna: "tipo_evento",
    valores: [
      "consulta_ia",
      "regeneracion_ia",
      "crear_chat_ia",
      "eliminar_chat_ia",
      "mensaje_ia",
    ],
  },
  grupo_accesos: {
    columna: "accion",
    valores: [
      "login",
      "logout",
      "login_fallido",
      "acceso_denegado",
      "acceso",
      "intento_login",
    ],
  },
};

/**
 * Lista paginada de `audit_log` para /super-admin/auditoria. Solo
 * super_admins pueden leer esta tabla (política RLS), así que un error aquí
 * para cualquier otro usuario es síntoma de que algo le dio acceso a esta
 * pantalla por error, no un fallo de red a tratar en silencio.
 */
export function useAuditLog(filtros: AuditLogFiltros, pagina: number) {
  const secuencia = useRef(0);
  const [accesosActivos, setAccesosActivos] = useState<boolean | null>(null);
  const [entradas, setEntradas] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tablas, setTablas] = useState<readonly string[]>(TABLAS_AUDITADAS);

  useEffect(() => {
    let activo = true;
    void completeAuditEnabled()
      .then((enabled) => {
        if (activo) setAccesosActivos(enabled);
      })
      .catch(() => {
        if (activo) setAccesosActivos(null);
      });
    void supabase
      .rpc("listar_tablas_auditoria_panel")
      .then(({ data, error }) => {
        if (activo && !error && Array.isArray(data) && data.length > 0) {
          setTablas(data.map((fila: { tabla: string }) => fila.tabla));
        }
      });
    return () => {
      activo = false;
    };
  }, []);

  const fetchEntradas = useCallback(
    async (silencioso = false) => {
      const miConsulta = ++secuencia.current;
      if (!silencioso) setLoading(true);
      setError(null);

      const desde = pagina * PAGE_SIZE;
      const consultar = (columnaActor: "actor_label" | "actor_email") => {
        let query = supabase
          .from("audit_log_visible" as "audit_log")
          .select("*", { count: "exact" });
        if (filtros.actor?.trim()) {
          const actor = filtros.actor.trim();
          query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(actor)
            ? query.eq("actor_user_id", actor)
            : query.ilike(columnaActor, `%${actor}%`);
        }
        if (filtros.dispositivo?.trim())
          query = query.ilike("device_id", `%${filtros.dispositivo.trim()}%`);
        if (filtros.accion && GRUPOS_ACCION[filtros.accion]) {
          const grupo = GRUPOS_ACCION[filtros.accion];
          query = query.in(grupo.columna, grupo.valores);
        } else if (filtros.accion) {
          const columna = [
            "login",
            "logout",
            "crear",
            "actualizar",
            "eliminar",
            "ejecutar",
            "intento_login",
            "login_fallido",
            "acceso",
            "acceso_denegado",
          ].includes(filtros.accion)
            ? "accion"
            : "tipo_evento";
          query = query.eq(columna, filtros.accion);
        } else query = query.eq("visible_por_defecto", true);
        if (filtros.texto?.trim())
          query = query.ilike("texto_busqueda", `%${filtros.texto.trim()}%`);
        if (filtros.resultado) query = query.eq("resultado", filtros.resultado);
        if (filtros.origen)
          query = query.in(
            "actor_origin",
            filtros.origen === "servidor"
              ? ["servicio", "base_de_datos"]
              : filtros.origen === "sin_servidor"
                ? ["usuario", "intento", "historico"]
                : [filtros.origen],
          );
        if (filtros.tabla) query = query.eq("tabla", filtros.tabla);
        if (filtros.desde)
          query = query.gte(
            "created_at",
            new Date(`${filtros.desde}T00:00:00`).toISOString(),
          );
        if (filtros.hasta) {
          const fin = new Date(`${filtros.hasta}T00:00:00`);
          fin.setDate(fin.getDate() + 1);
          query = query.lt("created_at", fin.toISOString());
        }
        return query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(desde, desde + PAGE_SIZE - 1);
      };
      try {
        let resultado = await consultar("actor_label");
        // Mantiene el filtro de emails operativo durante el despliegue del SQL.
        if (
          resultado.error?.code === "42703" &&
          resultado.error.message.includes("actor_label")
        ) {
          resultado = await consultar("actor_email");
        }
        if (miConsulta !== secuencia.current) return;
        const { data, error: queryError, count } = resultado;

        if (queryError) {
          setError(queryError.message);
          setEntradas([]);
          setTotal(0);
        } else {
          setEntradas((data ?? []) as AuditLogEntry[]);
          setTotal(count ?? 0);
        }
      } catch (error) {
        if (miConsulta === secuencia.current)
          setError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar la auditoría",
          );
      } finally {
        if (miConsulta === secuencia.current) setLoading(false);
      }
    },
    [
      filtros.actor,
      filtros.dispositivo,
      filtros.accion,
      filtros.tabla,
      filtros.desde,
      filtros.hasta,
      filtros.texto,
      filtros.resultado,
      filtros.origen,
      pagina,
    ],
  );

  useEffect(() => {
    void fetchEntradas();
    const refresh = () => {
      if (document.visibilityState === "visible") void fetchEntradas(true);
    };
    window.addEventListener("auditoria-actualizada", refresh);
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      ++secuencia.current;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("auditoria-actualizada", refresh);
    };
  }, [fetchEntradas]);

  return {
    entradas,
    total,
    tablas,
    accesosActivos,
    pageSize: PAGE_SIZE,
    loading,
    error,
    refetch: fetchEntradas,
  };
}

/** Rango de meses hacia atrás que ofrecen las pestañas "Por mes" y "Por día". */
export const RANGOS_MESES_AGRUPADO = [1, 3, 6, 12] as const;
export type RangoMesesAuditoria = (typeof RANGOS_MESES_AGRUPADO)[number];

/**
 * Tope de filas de las vistas agrupadas: agrupar por mes/día necesita tener
 * cargado el rango completo (no una página de 25), pero sin límite un rango
 * amplio sin filtrar podría traerse la tabla entera. Si se alcanza el tope,
 * `truncado` avisa para que se acote con el selector de meses o con
 * "Desde"/"Hasta".
 */
const LIMITE_AGRUPADO = 1000;

export interface AuditLogAgrupadoResultado {
  entradas: AuditLogEntry[];
  loading: boolean;
  error: string | null;
  truncado: boolean;
  refetch: () => void;
}

/**
 * Carga para las pestañas "Por mes" y "Por día": a diferencia de
 * `useAuditLog` (paginada de 25 en 25) aquí hace falta el rango completo para
 * agrupar bien. Si los filtros ya acotan fechas ("Desde"/"Hasta") se respetan
 * tal cual; si no, se usa `rangoMeses` como ventana desde hace N meses hasta
 * ahora. Siempre con el tope de `LIMITE_AGRUPADO` filas.
 */
export function useAuditLogAgrupado(
  filtros: AuditLogFiltros,
  rangoMeses: RangoMesesAuditoria,
): AuditLogAgrupadoResultado {
  const secuencia = useRef(0);
  const [entradas, setEntradas] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);

  const fetchEntradas = useCallback(async () => {
    const miConsulta = ++secuencia.current;
    setLoading(true);
    setError(null);

    const ahora = new Date();
    const desdeFecha = filtros.desde
      ? new Date(`${filtros.desde}T00:00:00`)
      : new Date(ahora.getFullYear(), ahora.getMonth() - (rangoMeses - 1), 1);
    let hastaFecha = ahora;
    if (filtros.hasta) {
      hastaFecha = new Date(`${filtros.hasta}T00:00:00`);
      hastaFecha.setDate(hastaFecha.getDate() + 1);
    }

    const consultar = (columnaActor: "actor_label" | "actor_email") => {
      let query = supabase.from("audit_log_visible" as "audit_log").select("*");
      if (filtros.actor?.trim()) {
        const actor = filtros.actor.trim();
        query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(actor)
          ? query.eq("actor_user_id", actor)
          : query.ilike(columnaActor, `%${actor}%`);
      }
      if (filtros.dispositivo?.trim())
        query = query.ilike("device_id", `%${filtros.dispositivo.trim()}%`);
      if (filtros.accion && GRUPOS_ACCION[filtros.accion]) {
        const grupo = GRUPOS_ACCION[filtros.accion];
        query = query.in(grupo.columna, grupo.valores);
      } else if (filtros.accion) {
        const columna = [
          "login",
          "logout",
          "crear",
          "actualizar",
          "eliminar",
          "ejecutar",
          "intento_login",
          "login_fallido",
          "acceso",
          "acceso_denegado",
        ].includes(filtros.accion)
          ? "accion"
          : "tipo_evento";
        query = query.eq(columna, filtros.accion);
      } else query = query.eq("visible_por_defecto", true);
      if (filtros.texto?.trim())
        query = query.ilike("texto_busqueda", `%${filtros.texto.trim()}%`);
      if (filtros.resultado) query = query.eq("resultado", filtros.resultado);
      if (filtros.origen)
        query = query.in(
          "actor_origin",
          filtros.origen === "servidor"
            ? ["servicio", "base_de_datos"]
            : filtros.origen === "sin_servidor"
              ? ["usuario", "intento", "historico"]
              : [filtros.origen],
        );
      if (filtros.tabla) query = query.eq("tabla", filtros.tabla);
      query = query
        .gte("created_at", desdeFecha.toISOString())
        .lt("created_at", hastaFecha.toISOString());
      // +1 para saber si hay más filas que el tope sin pedir un `count` aparte (más caro).
      return query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(LIMITE_AGRUPADO + 1);
    };

    try {
      let resultado = await consultar("actor_label");
      if (
        resultado.error?.code === "42703" &&
        resultado.error.message.includes("actor_label")
      ) {
        resultado = await consultar("actor_email");
      }
      if (miConsulta !== secuencia.current) return;
      const { data, error: queryError } = resultado;

      if (queryError) {
        setError(queryError.message);
        setEntradas([]);
        setTruncado(false);
      } else {
        const filas = (data ?? []) as AuditLogEntry[];
        setTruncado(filas.length > LIMITE_AGRUPADO);
        setEntradas(filas.slice(0, LIMITE_AGRUPADO));
      }
    } catch (error) {
      if (miConsulta === secuencia.current)
        setError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la auditoría",
        );
    } finally {
      if (miConsulta === secuencia.current) setLoading(false);
    }
  }, [
    filtros.actor,
    filtros.dispositivo,
    filtros.accion,
    filtros.tabla,
    filtros.desde,
    filtros.hasta,
    filtros.texto,
    filtros.resultado,
    filtros.origen,
    rangoMeses,
  ]);

  useEffect(() => {
    void fetchEntradas();
    const refresh = () => void fetchEntradas();
    window.addEventListener("auditoria-actualizada", refresh);
    return () => {
      ++secuencia.current;
      window.removeEventListener("auditoria-actualizada", refresh);
    };
  }, [fetchEntradas]);

  return {
    entradas,
    loading,
    error,
    truncado,
    refetch: () => void fetchEntradas(),
  };
}

/** Catálogo anterior como respaldo durante el despliegue; el SQL devuelve el catálogo real. */
export const TABLAS_AUDITADAS = [
  "user_roles",
  "user_permissions",
  "super_admins",
  "admin_feature_toggles",
  "sell_users",
  "configuracion_reservas",
  "configuracion_web",
  "configBotWeb",
  "chat_web_config",
  "gdpr_config",
  "dashboard_config",
  "phone_system_config",
  "user_role_presets",
] as const;

/** Nombre legible de cada tabla auditada, para no enseñar el nombre crudo de la tabla SQL. */
export const TABLA_LABEL: Record<string, string> = {
  accesos_panel: "Accesos al panel",
  user_roles: "Roles de usuario",
  user_permissions: "Permisos de usuario",
  super_admins: "Super admins",
  admin_feature_toggles: "Secciones activas del panel",
  sell_users: "Usuarios de venta",
  configuracion_reservas: "Configuración de reservas",
  configuracion_web: "Configuración de la web",
  configBotWeb: "Configuración del bot web",
  chat_web_config: "Configuración del chat web",
  gdpr_config: "Configuración RGPD",
  dashboard_config: "Configuración del panel",
  phone_system_config: "Configuración de telefonía",
  user_role_presets: "Plantillas de rol",
  reservas: "Reservas",
  solicitudes_pendientes: "Solicitudes de reserva",
  configuracion_turnos: "Turnos",
  espacios_reserva: "Espacios",
  mesas: "Mesas",
  planos_espacio: "Planos",
  asignaciones_mesa: "Asignación de mesas",
  blacklist: "Lista de bloqueo",
  sugerencias_blacklist: "Sugerencias de bloqueo",
  notificaciones_dashboard: "Notificaciones",
  Platos: "Platos",
  Vinos: "Vinos",
  Bebidas: "Bebidas",
  Cocteles: "Cócteles",
  menus_diarios: "Menús diarios",
  tapas: "Tapas",
  novedades: "Novedades",
  resenas: "Reseñas",
  config_google_places: "Configuración de Google",
  facturas: "Facturas de proveedores",
  productos_factura: "Líneas de factura",
  productos_catalogo: "Catálogo de productos",
  proveedores: "Proveedores",
  proveedores_alias: "Nombres de proveedores",
  categorias_producto: "Categorías de productos",
  configuracion_facturas: "Configuración de facturas",
  ocr_trabajos: "Procesamiento de facturas",
  ocr_trabajo_paginas: "Páginas procesadas",
  oficiososia_facturas: "Facturas emitidas",
  oficiososia_borradores: "Borradores",
  oficiososia_facturacion_config: "Configuración de facturación",
  cheques_regalo: "Cheques regalo",
  facturas_cheques: "Facturas de cheques",
  plantilla_cheques_regalo: "Plantilla de cheques",
  plantilla_factura_cheques: "Plantilla de factura de cheques",
  newsletter_suscriptores: "Suscriptores",
  newsletter_envios: "Envíos de newsletter",
  newsletter_sincronizaciones_resend: "Sincronización de newsletter",
  plantillas_email_reserva: "Plantillas de correo",
  envios_email_reserva: "Correos de reservas",
  email_eventos: "Eventos de correo",
  BebidasVENTA: "Bebidas de venta",
  ComidaVENTA: "Comida de venta",
  pedidos_ecommerce: "Pedidos",
  lineas_pedido: "Líneas de pedido",
  movimientos_stock: "Movimientos de stock",
  costes_fijos: "Costes fijos",
  servicios_contratados: "Servicios contratados",
  configuracion_tienda: "Configuración de la tienda",
  ia_funciones: "Funciones de IA",
  ia_coste_estimado: "Estimaciones de IA",
  web_rebuild_state: "Publicación de webs",
  profiles: "Perfiles",
  "auth.users": "Usuarios y credenciales",
  "storage.objects": "Archivos",
  acciones_servidor: "Acciones del servidor",
};

export interface AuditLogGrupo {
  /** Clave estable para `key` de React: no cambia al reordenar ni al re-renderizar. */
  key: string;
  actor_email: string | null;
  actor_user_id: string | null;
  actor_label: string;
  actor_origin: AuditLogEntry["actor_origin"];
  accion: AuditLogEntry["accion"];
  tabla: string | null;
  created_at: string;
  entradas: AuditLogEntry[];
}

/**
 * Agrupa filas consecutivas de la misma operación en bloque: un alta de
 * usuario, por ejemplo, inserta varias filas en `user_permissions` (una por
 * sección) EN LA MISMA TRANSACCIÓN, así que comparten el mismo actor, acción,
 * tabla y `created_at` exacto (`now()` es constante dentro de una
 * transacción en Postgres, no hace falta redondear). Sin agrupar, esas
 * operaciones de alta inundan la lista con 5-10 filas idénticas y entierran
 * el resto — el motivo original de que "no se entienda bien".
 */
export interface CambioCampo {
  campo: string;
  antes: unknown;
  despues: unknown;
}

const CAMPOS_IGNORADOS_EN_DIFF = new Set([
  "updated_at",
  "created_at",
  "actualizado_en",
  "modified_at",
]);

/**
 * De `{antes, despues}` (lo que guarda `fn_registrar_auditoria` en un
 * "actualizar") saca solo los campos que de verdad cambiaron — para no
 * obligar a leer el JSON entero cuando solo cambió un campo de ocho.
 * Devuelve [] si no hay antes/después que comparar (p. ej. en "crear").
 */
export function resumirCambios(
  detalles: Record<string, unknown> | null,
): CambioCampo[] {
  if (!detalles) return [];
  // Conceder/retirar un permiso tiene un estado efectivo anterior y posterior
  // aunque la fila SQL sea nueva o se haya borrado. Los snapshots se conservan.
  const antes = (detalles.permiso_antes ?? detalles.antes) as
    | Record<string, unknown>
    | null
    | undefined;
  const despues = (detalles.permiso_despues ?? detalles.despues) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!antes || !despues) return [];

  const campos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const cambios: CambioCampo[] = [];
  for (const campo of campos) {
    if (CAMPOS_IGNORADOS_EN_DIFF.has(campo)) continue;
    const valorAntes = antes[campo];
    const valorDespues = despues[campo];
    if (JSON.stringify(valorAntes) !== JSON.stringify(valorDespues)) {
      cambios.push({ campo, antes: valorAntes, despues: valorDespues });
    }
  }
  return cambios;
}

export function agruparEntradas(entradas: AuditLogEntry[]): AuditLogGrupo[] {
  const grupos: AuditLogGrupo[] = [];

  for (const entrada of entradas) {
    const anterior = grupos[grupos.length - 1];
    const mismoBloque =
      anterior &&
      ["crear", "actualizar", "eliminar"].includes(entrada.accion) &&
      anterior.entradas[0].device_id === entrada.device_id &&
      anterior.entradas[0].request_id === entrada.request_id &&
      anterior.entradas[0].user_agent === entrada.user_agent &&
      anterior.entradas[0].ip_address === entrada.ip_address &&
      anterior.actor_user_id === entrada.actor_user_id &&
      anterior.actor_label === identificarActor(entrada) &&
      anterior.actor_origin === entrada.actor_origin &&
      anterior.accion === entrada.accion &&
      anterior.tabla === entrada.tabla &&
      anterior.entradas[0].registro_id === entrada.registro_id &&
      anterior.created_at === entrada.created_at;

    if (mismoBloque) {
      anterior.entradas.push(entrada);
    } else {
      grupos.push({
        key: entrada.id,
        actor_email: entrada.actor_email,
        actor_user_id: entrada.actor_user_id,
        actor_label: identificarActor(entrada),
        actor_origin: entrada.actor_origin,
        accion: entrada.accion,
        tabla: entrada.tabla,
        created_at: entrada.created_at,
        entradas: [entrada],
      });
    }
  }

  return grupos;
}

/** Compatible con históricos y con datos leídos antes de aplicar la migración. */
export function identificarActor(entrada: AuditLogEntry): string {
  return (
    entrada.actor_label?.trim() ||
    entrada.actor_email?.trim() ||
    (entrada.actor_user_id
      ? `Usuario · ${entrada.actor_user_id}`
      : `Registro histórico · ${entrada.id}`)
  );
}

function capitalizar(texto: string): string {
  return texto.length > 0 ? texto[0].toUpperCase() + texto.slice(1) : texto;
}

export interface DesgloseAccion {
  accion: AuditLogEntry["accion"];
  cantidad: number;
}

/** Nº de registros por tipo de acción, de más a menos frecuente: para el resumen de cada día/mes. */
function calcularDesglosePorAccion(
  entradas: AuditLogEntry[],
): DesgloseAccion[] {
  const cuentas = new Map<AuditLogEntry["accion"], number>();
  for (const entrada of entradas)
    cuentas.set(entrada.accion, (cuentas.get(entrada.accion) ?? 0) + 1);
  return [...cuentas.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([accion, cantidad]) => ({ accion, cantidad }));
}

export interface AuditLogGrupoDia {
  /** Clave estable, "yyyy-MM-dd" en hora local. */
  key: string;
  /** "Jueves, 9 de octubre de 2026". */
  etiqueta: string;
  entradas: AuditLogEntry[];
  totalRegistros: number;
  desglosePorAccion: DesgloseAccion[];
  actoresDistintos: number;
}

/**
 * Agrupa por día (hora local del navegador), manteniendo el orden de
 * `entradas` de entrada: si ya viene ordenada de más a menos reciente (como
 * la devuelve `useAuditLogAgrupado`), el resultado también queda del día más
 * reciente al más antiguo y, dentro de cada día, de la hora más reciente a la
 * más antigua.
 */
export function agruparPorDia(entradas: AuditLogEntry[]): AuditLogGrupoDia[] {
  const dias: AuditLogGrupoDia[] = [];
  for (const entrada of entradas) {
    const fecha = new Date(entrada.created_at);
    const clave = format(fecha, "yyyy-MM-dd");
    const actual = dias[dias.length - 1];
    if (actual && actual.key === clave) {
      actual.entradas.push(entrada);
    } else {
      dias.push({
        key: clave,
        etiqueta: capitalizar(
          format(fecha, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es }),
        ),
        entradas: [entrada],
        totalRegistros: 0,
        desglosePorAccion: [],
        actoresDistintos: 0,
      });
    }
  }
  for (const dia of dias) {
    dia.totalRegistros = dia.entradas.length;
    dia.desglosePorAccion = calcularDesglosePorAccion(dia.entradas);
    dia.actoresDistintos = new Set(dia.entradas.map(identificarActor)).size;
  }
  return dias;
}

export interface AuditLogGrupoMes {
  /** Clave estable, "yyyy-MM" en hora local. */
  key: string;
  /** "Octubre 2026". */
  etiqueta: string;
  totalRegistros: number;
  desglosePorAccion: DesgloseAccion[];
  dias: AuditLogGrupoDia[];
}

/** Igual que `agruparPorDia` pero un nivel por encima: por mes, con los días ya agrupados dentro. */
export function agruparPorMes(entradas: AuditLogEntry[]): AuditLogGrupoMes[] {
  const entradasPorMes = new Map<string, AuditLogEntry[]>();
  const orden: string[] = [];
  for (const entrada of entradas) {
    const clave = format(new Date(entrada.created_at), "yyyy-MM");
    if (!entradasPorMes.has(clave)) {
      entradasPorMes.set(clave, []);
      orden.push(clave);
    }
    entradasPorMes.get(clave)!.push(entrada);
  }

  return orden.map((clave) => {
    const entradasDelMes = entradasPorMes.get(clave)!;
    return {
      key: clave,
      etiqueta: capitalizar(
        format(new Date(entradasDelMes[0].created_at), "LLLL yyyy", {
          locale: es,
        }),
      ),
      totalRegistros: entradasDelMes.length,
      desglosePorAccion: calcularDesglosePorAccion(entradasDelMes),
      dias: agruparPorDia(entradasDelMes),
    };
  });
}
