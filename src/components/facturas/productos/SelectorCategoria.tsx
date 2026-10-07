import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { opcionesCategoria, type CategoriaProducto } from "@/lib/facturas/productos";

const NINGUNA = "__ninguna";

/**
 * Selector de categoría en árbol («Bebidas», «Bebidas › Vinos»…).
 * `valor` null = la opción «ninguna» (`textoNinguna`); undefined = nada elegido
 * todavía (se ve `placeholder`, p. ej. «Cambiar categoría…»).
 */
export function SelectorCategoria({
  categorias,
  valor,
  onCambiar,
  disabled,
  etiqueta = "Categoría",
  className,
  textoNinguna = "Sin categoría",
  placeholder = "Sin categoría",
}: {
  categorias: CategoriaProducto[];
  valor: number | null | undefined;
  onCambiar: (id: number | null) => void;
  disabled?: boolean;
  etiqueta?: string;
  className?: string;
  textoNinguna?: string;
  placeholder?: string;
}) {
  const opciones = useMemo(() => opcionesCategoria(categorias, valor ?? null), [categorias, valor]);
  const actual = valor === undefined ? "" : valor === null ? NINGUNA : String(valor);
  return (
    <Select value={actual} onValueChange={(v) => onCambiar(v === NINGUNA ? null : Number(v))} disabled={disabled}>
      <SelectTrigger className={className} aria-label={etiqueta}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[60vh]">
        <SelectItem value={NINGUNA}>{textoNinguna}</SelectItem>
        {opciones.map((o) => (
          <SelectItem key={o.id} value={String(o.id)} className={o.nivel === 1 ? "pl-8" : "font-medium"}>
            {o.etiqueta}
            {!o.activa && " (desactivada)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
