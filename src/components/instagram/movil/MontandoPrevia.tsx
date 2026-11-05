/**
 * Paso 2 del asistente móvil MIENTRAS la IA trabaja (o si ha fallado): en vez
 * de un spinner en una pantalla vacía, enseña SU publicación montándose (pedido
 * del dueño, 05/11/2026): las fotos elegidas en su orden, en gris con un brillo
 * que las cruza (quieto con «reducir movimiento»), los pasos con el que va en
 * curso y lo que el usuario escribió en «¿Algo que contar?».
 */
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FotoMovil } from "./estado";

export interface MontandoPreviaProps {
  fotos: FotoMovil[];
  /** «subiendo»: esperando a las fotos; «ia»: la IA trabaja; «error»: sin brillo ni pasos. */
  estado: "subiendo" | "ia" | "error";
  /** Frases de la IA (en orden) y cuál va ahora. */
  mensajes: readonly string[];
  pasoIA: number;
  /** Texto de la subida («Subiendo fotos: 3 de 6…»). */
  textoSubida: string;
  indicacion: string;
  nombreMarca: string;
}

export function MontandoPrevia({ fotos, estado, mensajes, pasoIA, textoSubida, indicacion, nombreMarca }: MontandoPreviaProps) {
  const trabajando = estado !== "error";
  const pasos = [estado === "subiendo" ? textoSubida : "Fotos subidas", ...mensajes];
  const actual = estado === "subiendo" ? 0 : 1 + Math.min(pasoIA, mensajes.length - 1);
  const una = fotos.length === 1;
  const texto = indicacion.trim();

  return (
    <div className="space-y-4" data-testid="montando-previa">
      <p className="text-base font-semibold">
        {trabajando ? (una ? "Montando tu post" : `Montando tu carrusel de ${fotos.length} fotos`) : una ? "Tu post" : `Tu carrusel de ${fotos.length} fotos`}
        <span className="font-normal text-muted-foreground"> · {nombreMarca}</span>
      </p>

      <ul
        className={cn("-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", una && "justify-center")}
        aria-label="Tus fotos, en el orden en que saldrán"
      >
        {fotos.map((f, i) => (
          <li key={f.clave} className={cn("relative aspect-[4/5] shrink-0 snap-start overflow-hidden rounded-lg bg-muted", una ? "w-1/2" : "w-[42%]")}>
            {f.vista ? (
              <img
                src={f.vista}
                alt={`Foto ${i + 1}`}
                draggable={false}
                className={cn("h-full w-full object-cover transition-[filter,opacity] duration-500", trabajando && "opacity-80 grayscale")}
              />
            ) : null}
            {trabajando && (
              <span
                aria-hidden="true"
                data-testid="brillo"
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent motion-safe:animate-brillo motion-reduce:hidden"
                style={{ animationDelay: `${(i % 4) * 0.2}s` }}
              />
            )}
            {i === 0 && !una && <span className="absolute left-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-sm font-semibold text-white">Portada</span>}
          </li>
        ))}
      </ul>

      {trabajando && (
        <>
          <p className="sr-only" role="status" aria-live="polite">
            {pasos[actual]}
          </p>
          <ol className="space-y-1.5" aria-hidden="true" data-testid="pasos-ia">
            {pasos.map((p, i) => (
              <li key={i} className={cn("flex items-center gap-2 text-sm", i === actual ? "text-base font-semibold text-foreground" : i < actual ? "text-muted-foreground" : "text-muted-foreground/60")}>
                {i < actual ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700" />
                ) : i === actual ? (
                  <Loader2 className="h-5 w-5 shrink-0 text-primary motion-safe:animate-spin" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0" />
                )}
                {p}
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="rounded-lg bg-muted p-3" data-testid="lo-que-me-has-contado">
        {texto ? (
          <>
            <p className="text-sm text-muted-foreground">Lo que me has contado:</p>
            <p className="text-base">«{texto}»</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No me has contado nada: la IA se guía por las fotos, la carta y la marca.</p>
        )}
      </div>
    </div>
  );
}
