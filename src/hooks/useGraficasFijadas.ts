// Gráficas de la IA fijadas al final del tablero de Facturas › Análisis.
// Se recuerdan en este navegador (localStorage); ver lib/facturas/graficasCopiloto.ts.
import { useCallback, useState } from "react";
import { CLAVE_FIJADAS, fijar as fijarEn, normalizarFijadas, type GraficaFijada, type GraficaIa } from "@/lib/facturas/graficasCopiloto";

function leer(): GraficaFijada[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE_FIJADAS);
    return normalizarFijadas(crudo ? JSON.parse(crudo) : []);
  } catch {
    return [];
  }
}

function guardar(lista: GraficaFijada[]) {
  try {
    window.localStorage.setItem(CLAVE_FIJADAS, JSON.stringify(lista));
  } catch {
    // Modo privado o cuota llena: se fija igual, solo que no sobrevive a recargar.
  }
}

export function useGraficasFijadas() {
  const [fijadas, setFijadas] = useState<GraficaFijada[]>(leer);

  const fijar = useCallback((g: GraficaIa) => {
    setFijadas((prev) => {
      const sig = fijarEn(prev, g);
      if (sig !== prev) guardar(sig);
      return sig;
    });
  }, []);

  const quitar = useCallback((id: string) => {
    setFijadas((prev) => {
      const sig = prev.filter((g) => g.id !== id);
      guardar(sig);
      return sig;
    });
  }, []);

  return { fijadas, fijar, quitar };
}
