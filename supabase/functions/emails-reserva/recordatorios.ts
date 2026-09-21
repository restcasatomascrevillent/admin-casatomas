// ============================================================================
// RECORDATORIO A T-2 DÍAS — quién lo recibe (función pura, sin I/O)
// ============================================================================
// La consulta a Supabase (traer las reservas confirmadas de fecha = hoy+2,
// y el conjunto de reserva_id que YA tienen un envío 'enviado' de tipo
// 'recordatorio') vive en index.ts. Aquí solo la decisión, para poder
// testearla sin levantar ningún cliente de Supabase ni Resend.
// ============================================================================

export interface ReservaParaRecordatorio {
  id: string;
  estado: string;
  fecha: string; // "YYYY-MM-DD"
  email: string | null;
}

/**
 * `hoyIso` es la fecha de HOY (no la fecha objetivo) en "YYYY-MM-DD",
 * normalmente calculada en hora de Madrid por quien llama (ver index.ts) —
 * aquí se recibe ya resuelta para que la función siga siendo pura y
 * determinista en el test (sin `new Date()` interno).
 */
export function fechaObjetivoRecordatorio(hoyIso: string, diasAntelacion = 2): string {
  const [anio, mes, dia] = hoyIso.split("-").map((n) => parseInt(n, 10));
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() + diasAntelacion);
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Filtra qué reservas de una lista candidata deben recibir el recordatorio:
 * confirmadas, con email, en la fecha objetivo (T-2) y que NO tengan ya un
 * envío correcto registrado. `yaEnviadas` son los reserva_id con una fila
 * 'enviado' en envios_email_reserva para tipo_email='recordatorio' — la
 * llamada la hace index.ts, aquí solo se aplica el filtro para que el test
 * no dependa de la forma de la tabla.
 */
export function seleccionarReservasParaRecordatorio(
  candidatas: ReservaParaRecordatorio[],
  fechaObjetivo: string,
  yaEnviadas: ReadonlySet<string>,
): ReservaParaRecordatorio[] {
  return candidatas.filter((r) => {
    if (r.estado !== "confirmada") return false;
    if (r.fecha !== fechaObjetivo) return false;
    if (!r.email) return false;
    if (yaEnviadas.has(r.id)) return false;
    return true;
  });
}

/** Divide un array en lotes de tamaño `tamano` (último lote puede ser más pequeño). */
export function enLotes<T>(items: readonly T[], tamano: number): T[][] {
  if (tamano <= 0) throw new Error("tamano de lote debe ser > 0");
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}
