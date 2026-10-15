// ============================================================================
// TELÉFONOS DE RESERVA — misma regla que el bot (restaurante-phone/api/
// vapi-webhook.js: normalizePhone() + formato "+34XXXXXXXXX" al guardar).
// Puro, sin I/O.
// ============================================================================

/** Quita espacios, guiones, paréntesis, puntos y "+", y el prefijo 0034/34
 * de un número español de 9 cifras. Igual que normalizePhone() del bot y que
 * fn_normalizar_telefono() en la BD. */
export function normalizarTelefono(telefono: string | null | undefined): string {
  if (!telefono) return "";
  let n = telefono.replace(/[\s\-().+]/g, "");
  if (n.startsWith("0034")) n = n.slice(4);
  if (n.startsWith("34") && n.length === 11) n = n.slice(2);
  return n;
}

/** Formato con el que se guarda (igual que el bot): 9 cifras -> "+34XXXXXXXXX";
 * más largo -> "+<cifras>" (extranjero); si no son cifras, se deja tal cual. */
export function formatearTelefonoReserva(telefono: string | null | undefined): string | null {
  const bruto = (telefono ?? "").trim();
  if (!bruto) return null;
  const n = normalizarTelefono(bruto);
  if (!/^\d+$/.test(n)) return bruto;
  if (n.length === 9) return `+34${n}`;
  if (n.length > 9) return `+${n}`;
  return n;
}

/** Formas en que puede estar guardado el mismo número (las reservas antiguas
 * y la lista negra no están normalizadas): para `.in("telefono", ...)`. */
export function variantesTelefono(telefono: string | null | undefined): string[] {
  const bruto = (telefono ?? "").trim();
  if (!bruto) return [];
  const n = normalizarTelefono(bruto);
  const set = new Set<string>([bruto]);
  if (n) {
    set.add(n);
    if (n.length === 9) {
      set.add(`+34${n}`);
      set.add(`34${n}`);
      set.add(`0034${n}`);
      set.add(`+34 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
      set.add(`${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
    } else if (n.length > 9) {
      set.add(`+${n}`);
    }
  }
  return [...set];
}

/** Un teléfono con al menos 9 cifras tras normalizar. */
export function telefonoValido(telefono: string | null | undefined): boolean {
  return /^\d{9,15}$/.test(normalizarTelefono(telefono));
}

/** Para leerlo de un vistazo (vista móvil de Hoy): un español de 9 cifras ->
 * "618 19 04 32" (sin el +34); otro -> "+<cifras>"; si no son cifras, tal cual.
 * Vacío -> null. */
export function telefonoLegible(telefono: string | null | undefined): string | null {
  const bruto = (telefono ?? "").trim();
  if (!bruto) return null;
  const n = normalizarTelefono(bruto);
  if (!/^\d+$/.test(n)) return bruto;
  if (n.length === 9) return `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  return n.length > 9 ? `+${n}` : n;
}

/** Enlace `tel:` (marca con un toque): "+34XXXXXXXXX" o lo que haya. Vacío -> null. */
export function enlaceTelefono(telefono: string | null | undefined): string | null {
  const f = formatearTelefonoReserva(telefono);
  return f ? `tel:${f.replace(/\s/g, "")}` : null;
}
