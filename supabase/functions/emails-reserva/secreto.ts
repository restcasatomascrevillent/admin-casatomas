import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";

/**
 * Comprueba el secreto compartido de las rutas internas de emails-reserva
 * (cabecera `x-webhook-secret`). FALLA CERRADO: sin secreto configurado
 * rechaza todo. La comparación es en tiempo constante (CT-REM-FN-17).
 */
export function secretoCompartidoValido(configurado: string, recibido: string | null): boolean {
  if (!configurado) return false;
  if (recibido === null) return false;
  return compararTiempoConstante(recibido, configurado);
}
