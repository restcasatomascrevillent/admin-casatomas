import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CampoExplicadoProps {
  icono?: ReactNode;
  pregunta: string;
  explicacion: string;
  ejemplo?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}

// Envoltorio común para cada pregunta de la pantalla: no solo dice el nombre
// del campo ("Tono", "Instrucciones extra"...) sino qué efecto tiene de
// verdad en lo que responde el bot, con un ejemplo concreto — antes esos
// nombres se explicaban solos y no decían nada sobre su efecto real.
export function CampoExplicado({ icono, pregunta, explicacion, ejemplo, extra, children }: CampoExplicadoProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icono}
          {pregunta}
        </CardTitle>
        <CardDescription>{explicacion}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {ejemplo && (
          <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2 leading-relaxed">
            <span className="font-medium text-foreground/80">Efecto en el bot: </span>
            {ejemplo}
          </div>
        )}
        {extra}
      </CardContent>
    </Card>
  );
}
