// «Proveedores con más gasto» (barras horizontales finas en HTML).
//
// Cada proveedor es un BOTÓN (foco visible, nombre accesible, 44 px) que abre
// un menú: ver sus documentos, abrirlo en Compras o llevarlo al explorador.
// La cabecera amplía la tarjeta (detalle en grande con filtros).
// «Gasto por mes» ya no es una tarjeta fija: es la gráfica por defecto del
// explorador (Explorador.tsx), que se puede cambiar.
import { useId, useState } from "react";
import { formatCurrency } from "@/components/facturas/shared/formatters";
import { nombreCorto, resumenProveedores, textoPct, type ProveedorGasto } from "@/lib/facturas/tableroCompras";
import type { Tamano } from "@/lib/facturas/widgetsTablero";
import { BotonVerMas, ContenidoFilaBarra, FILA_BARRA, FILAS_TAMANO, FilaConMenu, SinDatos, Tarjeta, type AccionMenu } from "./piezas";

export function ProveedoresTop({
  proveedores,
  acciones,
  className,
  tamano = "s",
  onAmpliar,
}: {
  proveedores: ProveedorGasto[];
  acciones: (p: ProveedorGasto) => AccionMenu[];
  className?: string;
  tamano?: Tamano;
  onAmpliar?: () => void;
}) {
  const [todos, setTodos] = useState(false);
  const idLista = useId();
  const visibles = FILAS_TAMANO[tamano];
  const max = Math.max(1, ...proveedores.map((p) => p.gasto));
  const lista = todos ? proveedores : proveedores.slice(0, visibles);
  return (
    <Tarjeta
      titulo="Proveedores con más gasto"
      subtitulo="Con IVA · % del gasto del periodo"
      resumen={resumenProveedores(proveedores)}
      className={className}
      testId="tarjeta-proveedores"
      onAmpliar={onAmpliar}
    >
      {proveedores.length === 0 ? (
        <SinDatos>Ningún proveedor con gasto en este periodo.</SinDatos>
      ) : (
        <>
          <ol className="space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0" aria-label="Proveedores por gasto" id={idLista}>
            {lista.map((p, i) => (
              <li key={`${p.id ?? p.nombre}-${i}`}>
                <FilaConMenu
                  nombre={`${p.nombre}: ${formatCurrency(p.gasto)}${p.pct !== null ? `, ${textoPct(p.pct, false)} del total` : ""}. Opciones`}
                  acciones={acciones(p)}
                  title={p.nombre}
                  className={FILA_BARRA}
                >
                  <ContenidoFilaBarra
                    nombre={nombreCorto(p.nombre)}
                    valor={formatCurrency(p.gasto)}
                    pct={p.pct !== null ? textoPct(p.pct, false) : null}
                    fraccion={p.gasto / max}
                  />
                </FilaConMenu>
              </li>
            ))}
          </ol>
          <BotonVerMas total={proveedores.length} visibles={visibles} abierto={todos} onCambio={setTodos} controla={idLista} />
        </>
      )}
    </Tarjeta>
  );
}
