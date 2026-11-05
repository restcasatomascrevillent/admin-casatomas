// Tablero de Facturas › Análisis: sale hecho al abrir la pestaña.
//   Fila 1  4 indicadores (gasto con IVA, abonos, regalado, por revisar).
//   Fila 2  Gasto por mes (~3/5) · Proveedores con más gasto (~2/5).
//   Fila 3  rejilla de 3 columnas (2 en tablet vertical, 1 en móvil).
//   Al final, las gráficas de la IA fijadas desde el copiloto.
// Solo este bloque hace scroll (la página no): lo pone quien lo usa.
import { forwardRef } from "react";
import { PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { tituloSerie, type GraficaFijada } from "@/lib/facturas/graficasCopiloto";
import { textoRangoMeses, textoVariacion, type ProveedorGasto, type TableroCompras as Datos } from "@/lib/facturas/tableroCompras";
import { GastoPorMes, ProveedoresTop } from "./GraficasPrincipales";
import { AbonosPorProveedor, CasaTomasYTouza, GastoPorFamilia, GastosFijos, LoQueMasHaSubido, PrecioDeUnProducto } from "./TarjetasDetalle";
import { FOCO, Indicador, Tarjeta } from "./piezas";

interface Props {
  datos: Datos;
  /** «Todos»: gasto por mes apilado por local. */
  apilado: boolean;
  producto: string | null;
  onProducto: (p: string | null) => void;
  onMes: (mes: string) => void;
  onProveedor: (id: number) => void;
  onClasificar: () => void;
  fijadas: GraficaFijada[];
  onQuitarFijada: (id: string) => void;
}

export const TableroCompras = forwardRef<HTMLInputElement, Props>(function TableroCompras(
  { datos, apilado, producto, onProducto, onMes, onProveedor, onClasificar, fijadas, onQuitarFijada },
  refBuscador,
) {
  const i = datos.indicadores;
  const variacion = textoVariacion(datos);
  const abrirProveedor = (p: ProveedorGasto) => p.id !== null && onProveedor(p.id);

  return (
    <div className="space-y-3 pb-4">
      {/* Fila 1 · indicadores */}
      <dl className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4" aria-label="Indicadores del periodo" data-tour="facturas-analisis-indicadores">
        <Indicador
          etiqueta="Gasto con IVA"
          valor={formatCurrency(i.gasto)}
          nota={
            <>
              {textoRangoMeses(datos.meses)}
              {variacion && (
                <span className={cn("ml-1 font-medium", variacion.sube ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                  · {variacion.texto}
                </span>
              )}
            </>
          }
        />
        <Indicador etiqueta="Abonos" valor={formatImporte(i.abonos)} nota={plural(i.abonosN, "documento", "documentos")} />
        <Indicador
          etiqueta="Regalado y descuentos"
          valor={formatCurrency(i.regalado)}
          nota={
            <>
              lo que valía {formatCurrency(i.regaladoValia)}
              {i.regaladoEstimadas > 0 && <> · {formatEntero(i.regaladoEstimadas)} estimados</>}
            </>
          }
        />
        <Indicador
          etiqueta="Por revisar"
          valor={formatEntero(i.albaranesSinFactura)}
          nota={i.albaranesSinFactura === 1 ? "albarán sin factura" : "albaranes sin factura"}
          claseNota={i.albaranesSinFactura > 0 ? "font-medium text-amber-700 dark:text-amber-400" : undefined}
        />
      </dl>

      {/* Fila 2 · gasto por mes y proveedores */}
      <div className="grid gap-3 md:grid-cols-5">
        <GastoPorMes meses={datos.meses} apilado={apilado} onMes={onMes} className="md:col-span-3" />
        <ProveedoresTop proveedores={datos.proveedores} onProveedor={abrirProveedor} className="md:col-span-2" />
      </div>

      {/* Fila 3 · detalle */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <LoQueMasHaSubido subidas={datos.subidas} onProducto={onProducto} />
        <PrecioDeUnProducto ref={refBuscador} producto={producto} onProducto={onProducto} />
        <GastoPorFamilia familias={datos.familias} onClasificar={onClasificar} />
        <GastosFijos fijos={datos.fijos} onProveedor={onProveedor} />
        <AbonosPorProveedor abonos={datos.abonos} onProveedor={onProveedor} />
        <CasaTomasYTouza locales={datos.locales} />
      </div>

      {/* Gráficas de la IA fijadas */}
      {fijadas.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2" aria-label="Gráficas fijadas desde la IA" role="group">
          {fijadas.map((g) => (
            <Tarjeta
              key={g.id}
              titulo={tituloSerie(g.serie)}
              subtitulo="Fijada desde la IA"
              accion={
                <button
                  type="button"
                  onClick={() => onQuitarFijada(g.id)}
                  className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground", FOCO)}
                  aria-label={`Quitar del tablero: ${tituloSerie(g.serie)}`}
                >
                  <PinOff className="h-3.5 w-3.5" aria-hidden /> Quitar
                </button>
              }
            >
              <GraficoSeriePrecio datos={g.serie} compacto alto={180} />
            </Tarjeta>
          ))}
        </div>
      )}
    </div>
  );
});
