/**
 * Tipos de usuario fijos de la pantalla Usuarios (10/11/2026, petición del dueño: «Crear usuarios de
 * Reservas (solo crear y ver reservas) usuario albaranes solo subida fotos»).
 *
 * Se eligen en el mismo desplegable que los roles preconfigurados, al crear un usuario y en su diálogo
 * «Permisos», y rellenan los permisos. A diferencia de los preconfigurados (tabla user_role_presets,
 * editables y borrables), van en el código: siempre están y siempre significan lo mismo.
 *
 *   · Reservas  → «Ver» en Reservas + «Reservas · Crear». Ve Reservas y crea reservas; no modifica,
 *                 ni cambia el estado (tampoco «Ha llegado»), ni da mesa, ni cancela, ni configura.
 *   · Albaranes → solo «Facturas · Solo fotos (albaranes)». Al entrar va a «Subir albaranes» (/albaranes):
 *                 hace o elige fotos y ve si llegaron. Ni importes, ni lo leído, ni otras secciones.
 *
 * Lo hace cumplir la base de datos (migración 20261122143500_usuarios_reservas_albaranes) y, para las
 * fotos, la función procesar-factura. Rol base: Staff (ninguno edita nada; ver `rolSegunPermisos`).
 */
import { mismosPermisos, permisosParaEditar, type PermisoSeccion } from "@/components/usuarios/permisosSecciones";

export interface TipoUsuario {
  id: "reservas" | "albaranes";
  nombre: string;
  /** Una línea para el desplegable y la ayuda. */
  descripcion: string;
  /** Permisos que deja (el resto de secciones, sin nada). */
  permisos: PermisoSeccion[];
  /** Pantalla con la que empieza al entrar. */
  inicio: string;
}

export const TIPOS_USUARIO: readonly TipoUsuario[] = [
  {
    id: "reservas",
    nombre: "Reservas",
    descripcion: "Solo Reservas: ver y crear reservas (sin modificarlas, cambiar su estado ni configurar).",
    permisos: permisosParaEditar([
      { section_key: "reservas", can_view: true, can_edit: false },
      { section_key: "reservas_crear", can_view: true, can_edit: false },
    ]),
    inicio: "/reservas",
  },
  {
    id: "albaranes",
    nombre: "Albaranes",
    descripcion: "Solo subir fotos de albaranes y facturas desde el móvil (sin ver importes ni nada más).",
    permisos: permisosParaEditar([{ section_key: "facturas_albaranes", can_view: true, can_edit: false }]),
    inicio: "/albaranes",
  },
];

/** Prefijo del valor en el desplegable («tipo:reservas»), para no chocar con los ids de los preconfigurados. */
export const PREFIJO_TIPO = "tipo:";

export const valorTipo = (tipo: Pick<TipoUsuario, "id">) => `${PREFIJO_TIPO}${tipo.id}`;

/** El tipo de un valor del desplegable, o null si no es un tipo. */
export function tipoDeValor(valor: string | null | undefined): TipoUsuario | null {
  if (!valor?.startsWith(PREFIJO_TIPO)) return null;
  return TIPOS_USUARIO.find((t) => t.id === valor.slice(PREFIJO_TIPO.length)) ?? null;
}

/** El tipo cuyos permisos son EXACTAMENTE estos (para preseleccionarlo y para la etiqueta de la lista). */
export function tipoQueCoincide(
  permisos: ReadonlyArray<{ section_key: string; can_view?: boolean | null; can_edit?: boolean | null }>,
): TipoUsuario | null {
  return TIPOS_USUARIO.find((t) => mismosPermisos(permisos, t.permisos)) ?? null;
}
