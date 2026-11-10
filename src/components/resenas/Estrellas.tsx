import { Star } from "lucide-react";

/** Fila de 5 estrellas (las de la puntuación rellenas en amarillo). */
export function Estrellas({ valor, className = "h-3.5 w-3.5" }: { valor: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${valor} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden="true" className={`${className} ${n <= valor ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}
