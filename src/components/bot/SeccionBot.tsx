import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface SeccionBotProps {
  titulo: string;
  descripcion?: ReactNode;
  children: ReactNode;
}

// Bloque de ajustes: título modesto + descripción corta + campos. Mismo
// lenguaje visual que el resto del Gestor Web (Card ligera, p-4).
export function SeccionBot({ titulo, descripcion, children }: SeccionBotProps) {
  const id = useId();
  return (
    <Card className="p-4" role="group" aria-labelledby={id}>
      <div className="mb-4 space-y-0.5">
        <h3 id={id} className="text-base font-semibold">
          {titulo}
        </h3>
        {descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  );
}
