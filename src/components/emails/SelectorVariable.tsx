// ============================================================================
// SelectorVariable — inserta un token {{clave}} en el campo al que está
// asociado, en la posición del cursor (o al final si no hay foco). Cada
// campo editable tiene el suyo, así que no hace falta rastrear "cuál es el
// campo activo" en ningún sitio: el propio control ya sabe a qué input
// pertenece a través de `targetRef`.
// ============================================================================
import type { RefObject } from "react";
import { Braces } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TOKENS_DISPONIBLES } from "./catalogoTokens";

interface SelectorVariableProps {
  targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement>;
  valor: string;
  onChange: (nuevoValor: string) => void;
}

export function SelectorVariable({ targetRef, valor, onChange }: SelectorVariableProps) {
  const insertar = (clave: string) => {
    const marcador = `{{${clave}}}`;
    const el = targetRef.current;

    if (!el) {
      onChange(`${valor}${marcador}`);
      return;
    }

    const inicio = el.selectionStart ?? valor.length;
    const fin = el.selectionEnd ?? valor.length;
    const nuevoValor = `${valor.slice(0, inicio)}${marcador}${valor.slice(fin)}`;
    onChange(nuevoValor);

    // Se reasigna el foco y el cursor tras el token insertado en el siguiente
    // frame (después de que React vuelque el nuevo valor al input).
    requestAnimationFrame(() => {
      el.focus();
      const posicion = inicio + marcador.length;
      el.setSelectionRange(posicion, posicion);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-11 gap-1.5 px-3 text-sm">
          <Braces className="h-4 w-4" />
          Variable
        </Button>
      </DropdownMenuTrigger>
      {/* Se evita que Radix devuelva el foco al botón al cerrar: así el foco
          que ponemos nosotros en el campo de destino (arriba) no se pisa. */}
      <DropdownMenuContent align="end" collisionPadding={12} className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Insertar variable aquí</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TOKENS_DISPONIBLES.map((token) => (
          <DropdownMenuItem
            key={token.clave}
            onSelect={() => insertar(token.clave)}
            className="flex min-h-11 flex-col items-start gap-0.5 py-2"
          >
            <span className="font-mono text-xs font-semibold text-primary">{`{{${token.clave}}}`}</span>
            <span className="text-xs text-muted-foreground">{token.descripcion}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
