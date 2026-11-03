import { Button } from "@/components/ui/button";
import { urlSegura } from "@/lib/url-segura";
import { formatoEuros, fuentesMercado, precioMercado, precioSugerido, type DatosVinoFoto } from "./leerVinoFoto";

/**
 * Bajo el precio: precio «Sugerido» por la IA (con «Usar») y lo que cuesta en
 * tiendas, con enlaces. Sale tras leer la etiqueta (precarga del lote o lectura
 * en el propio formulario). El precio nunca se pone solo.
 */
export function PistaPrecioVino({ datos, onUsar }: { datos: DatosVinoFoto | null | undefined; onUsar: (precio: number) => void }) {
  const sugerido = datos ? precioSugerido(datos) : null;
  const enTienda = datos ? precioMercado(datos) : null;
  const fuentesTienda = datos ? fuentesMercado(datos) : [];
  if (sugerido === null && enTienda === null) return null;
  return (
    <div className="space-y-1 rounded-md bg-muted/60 px-2 py-1 text-sm">
      {sugerido !== null && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-muted-foreground">
            Sugerido: <span className="font-medium text-foreground">{formatoEuros(sugerido)}</span>
            {datos?.precio_razon ? ` — ${datos.precio_razon}` : ""}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => onUsar(sugerido)}>
            Usar
          </Button>
        </div>
      )}
      {enTienda !== null && (
        <p className="break-words text-xs text-muted-foreground">
          En tienda: <span className="font-medium text-foreground">~{formatoEuros(enTienda)}</span>
          {fuentesTienda
            .flatMap((f) => {
              const href = urlSegura(f.url);
              return href ? [{ ...f, href }] : [];
            })
            .map((f) => (
              <a
                key={f.url}
                href={f.href}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 underline underline-offset-2 hover:text-foreground"
              >
                {f.tienda} ({formatoEuros(f.precio)})
              </a>
            ))}
        </p>
      )}
    </div>
  );
}
