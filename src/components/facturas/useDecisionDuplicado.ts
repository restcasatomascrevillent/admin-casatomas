import { useState } from "react";
import type { Anadible, Esperado, Sustituible } from "@/lib/facturas/documentoLargo";
import type { DecisionDuplicado } from "./SustituirFacturaDialog";

interface Acciones {
  sustituir: (s: Sustituible, esperado?: Esperado) => Promise<void>;
  anadirPagina: (a: Anadible, esperado?: Esperado) => Promise<void>;
}

/**
 * Flujo único de «sustituir / añadir página» para un duplicado: lo usan la
 * lista «Pendientes de decidir» (SubidaFacturas) y el pop-up de duplicado
 * (ColaSubidaProvider). Se enlaza a <SustituirFacturaDialog decision onCancelar onConfirmar>.
 * Los errores los enseña el propio diálogo (se queda abierto con el motivo).
 */
export function useDecisionDuplicado({ sustituir, anadirPagina }: Acciones) {
  const [decision, setDecision] = useState<DecisionDuplicado | null>(null);
  const cancelar = () => setDecision(null);
  const confirmar = async (esperado: Esperado) => {
    if (!decision) return;
    if (decision.tipo === "sustituir") await sustituir(decision.s, esperado);
    else await anadirPagina(decision.a, esperado);
    setDecision(null);
  };
  return { decision, setDecision, cancelar, confirmar };
}
