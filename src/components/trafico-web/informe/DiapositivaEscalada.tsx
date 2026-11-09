/**
 * Vista previa de una diapositiva de los informes mensuales: escala el lienzo
 * de 1280 × 720 al ancho disponible (ordenador, tablet o móvil) manteniendo el
 * 16:9. La usan el informe de tráfico web y el de redes sociales.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ALTO_DIAPOSITIVA, ANCHO_DIAPOSITIVA } from "./tema";

/** Escala una diapositiva de 1280 × 720 al ancho disponible, manteniendo el 16:9. */
export function DiapositivaEscalada({ children, indice }: { children: ReactNode; indice: number }) {
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    if (!caja) return;
    const medir = () => setAncho(caja.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, [caja]);
  const escala = ancho > 0 ? ancho / ANCHO_DIAPOSITIVA : 1;
  return (
    <div
      ref={setCaja}
      data-testid={`diapositiva-${indice + 1}`}
      className="relative w-full overflow-hidden rounded-md shadow-md ring-1 ring-black/5"
      style={{ aspectRatio: `${ANCHO_DIAPOSITIVA} / ${ALTO_DIAPOSITIVA}` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: ANCHO_DIAPOSITIVA, height: ALTO_DIAPOSITIVA, transform: `scale(${escala})` }}
      >
        {children}
      </div>
    </div>
  );
}
