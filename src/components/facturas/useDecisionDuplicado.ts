import { useState } from "react";
import type { Anadible, Esperado, Sustituible } from "@/lib/facturas/documentoLargo";
import type { DecisionDuplicado } from "./SustituirFacturaDialog";

interface Acciones {
  sustituir: (s: Sustituible, esperado?: Esperado) => Promise<void>;
  anadirPagina: (a: Anadible, esperado?: Esperado) => Promise<void>;
  /** «No, dejar la que hay» / «No añadirla»: descarta el pendiente (ocr_descartar_trabajo). */
  descartar?: (trabajoId: string) => void;
}

/**
 * Flujo único de «sustituir / añadir página» para un duplicado: lo usan la
 * lista «Pendientes de decidir» (SubidaFacturas) y el pop-up de duplicado
 * (ColaSubidaProvider). Se enlaza a
 * <SustituirFacturaDialog decision onCancelar onDejar onConfirmar>.
 *  · `cancelar`: cierra sin decidir (sigue en «Pendientes de decidir»).
 *  · `dejar`: decide NO usar el documento nuevo → lo descarta (deja de estar pendiente).
 * Los errores los enseña el propio diálogo (se queda abierto con el motivo).
 */
export function useDecisionDuplicado({ sustituir, anadirPagina, descartar }: Acciones) {
  const [decision, setDecision] = useState<DecisionDuplicado | null>(null);
  const cancelar = () => setDecision(null);
  const dejar = () => {
    if (decision) descartar?.(decision.tipo === "sustituir" ? decision.s.trabajo_id : decision.a.trabajo_id);
    setDecision(null);
  };
  const confirmar = async (esperado: Esperado) => {
    if (!decision) return;
    if (decision.tipo === "sustituir") await sustituir(decision.s, esperado);
    else await anadirPagina(decision.a, esperado);
    setDecision(null);
  };
  return { decision, setDecision, cancelar, dejar, confirmar };
}
