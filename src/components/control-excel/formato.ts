import { diaIso, formatearEur, leerNumero } from "@/lib/servicios";

/** «1.700,00 €» o «—» si no hay importe. */
export const eur = (n: number | null | undefined): string => (n == null ? "—" : formatearEur(n));

/** «2026-11-13» → «13/11/2026»; «—» si no hay fecha. */
export const fechaCorta = (iso: string | null | undefined): string => (iso ? iso.split("-").reverse().join("/") : "—");

/** Hoy, en el día local («AAAA-MM-DD»). */
export const hoyIso = (): string => diaIso(new Date());

/** Fecha y hora de la última modificación del Excel, en corto. */
export function fechaHora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Lo que se pone en un campo de importe: «1700,5» o «». */
export const textoDeImporte = (n: number | null | undefined): string => (n == null ? "" : String(n).replace(".", ","));

/** «12,50» → 12.5; «» → null; algo que no es un importe (o negativo) → "invalido". */
export function importeDeTexto(texto: string): number | null | "invalido" {
  const n = leerNumero(texto);
  if (n == null) return null;
  if (Number.isNaN(n) || n < 0) return "invalido";
  return Math.round(n * 100) / 100;
}
