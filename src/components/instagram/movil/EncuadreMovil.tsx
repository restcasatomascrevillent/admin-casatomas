/**
 * Móvil: encuadrar las fotos que van con «Solo foto» (12/11/2026). Plegado bajo
 * la vista previa: se elige la imagen (si hay varias) y se arrastra la foto
 * dentro del marco 4:5 (o se usan los deslizadores). Guarda posicionX /
 * posicionY en los datos de la diapositiva, que viajan al render y a la pieza.
 */
import { useState } from "react";
import { obtenerPlantilla } from "@/lib/instagram";
import type { DiapositivaMontada, FotoParaMontar } from "@/lib/instagram/montar";
import { cn } from "@/lib/utils";
import { EncuadreFoto, type Encuadre } from "@/components/instagram/EncuadreFoto";

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 50);

interface Props {
  diapositivas: DiapositivaMontada[];
  fotos: FotoParaMontar[];
  onCambio: (indice: number, encuadre: Encuadre) => void;
}

export function EncuadreMovil({ diapositivas, fotos, onCambio }: Props) {
  const encuadrables = diapositivas.map((d, i) => ({ d, i })).filter(({ d }) => obtenerPlantilla(d.plantilla)?.sinTexto);
  const [elegida, setElegida] = useState(0);
  if (!encuadrables.length) return null;
  const actual = encuadrables[Math.min(elegida, encuadrables.length - 1)];
  const foto = fotos.find((f) => f.id === actual.d.foto);
  return (
    <details className="rounded-lg border p-3" data-testid="encuadre-movil">
      <summary className="min-h-11 cursor-pointer content-center text-base font-medium">Encuadrar {encuadrables.length > 1 ? "las fotos" : "la foto"}</summary>
      <div className="space-y-3 pt-2">
        {encuadrables.length > 1 && (
          <div role="group" aria-label="Qué foto encuadrar" className="flex flex-wrap gap-1">
            {encuadrables.map(({ i }, k) => (
              <button
                key={i}
                type="button"
                aria-pressed={actual.i === i}
                onClick={() => setElegida(k)}
                className={cn("h-11 min-w-11 rounded-md border px-2 text-sm", actual.i === i ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted")}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
        {foto ? (
          <EncuadreFoto key={actual.d.foto} src={foto.url} valor={{ x: pos(actual.d.datos.posicionX), y: pos(actual.d.datos.posicionY) }} onCambio={(e) => onCambio(actual.i, e)} />
        ) : (
          <p className="text-sm text-muted-foreground">La foto aún se está subiendo.</p>
        )}
      </div>
    </details>
  );
}
