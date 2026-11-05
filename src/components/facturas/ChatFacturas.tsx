// Pestaña «Análisis» de Facturas (rediseño del 05/11/2026): TABLERO DE
// GRÁFICAS FIJAS que sale hecho al abrirla, con el copiloto de IA PLEGADO.
//
//   · Barra: periodo [Mes · Trimestre · Año · Todo] (por defecto, el año),
//     local [Todos · Casa Tomás · Touza] y un único «Pregúntale a la IA».
//   · Tablero (lo único que hace scroll): indicadores, gasto por mes,
//     proveedores, lo que más ha subido, precio de un producto, familias,
//     gastos fijos, abonos y Casa Tomás frente a Touza. Datos: UNA llamada a
//     la RPC `tablero_compras` (useTableroCompras).
//   · Tocar un mes o un proveedor abre Compras filtrado (`onIrA`); tocar un
//     producto que sube lo abre en «Precio de un producto».
//   · Copiloto: panel lateral (CopilotoLateral) con el historial dentro; sus
//     gráficas se pueden fijar al final del tablero.
//
// Se sigue llamando ChatFacturas y expone `enviarConsulta`: el «Preguntar a la
// IA» de una factura en Compras abre el panel y pregunta.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatFacturas, type Conversacion } from "@/hooks/useChatFacturas";
import { useTableroCompras } from "@/hooks/useTableroCompras";
import { useGraficasFijadas } from "@/hooks/useGraficasFijadas";
import { FILTROS_LOCAL, textoPeriodo, type FiltroLocal } from "@/lib/facturas/resumenCompras";
import {
  ENLACE_PRODUCTOS_COMPRAS,
  enlaceMesCompras,
  enlaceProveedorCompras,
  fechasPeriodo,
  localRpc,
  PERIODO_ANALISIS_POR_DEFECTO,
  periodosAnalisis,
  sugerenciasDeTablero,
  type PeriodoAnalisis,
} from "@/lib/facturas/tableroCompras";
import { TableroCompras } from "./analisis/TableroCompras";
import { ErrorTablero, EsqueletoTablero, Segmentado } from "./analisis/piezas";
import { CopilotoLateral } from "./copiloto/CopilotoLateral";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

interface ChatFacturasProps {
  /** Abre otra vista del panel con estos parámetros de URL (`?tab=compras&…`). */
  onIrA?: (enlace: string) => void;
}

const PRESET_TEXTO: Record<PeriodoAnalisis, "este_mes" | "trimestre" | "anio" | "todo"> = {
  mes: "este_mes",
  trimestre: "trimestre",
  anio: "anio",
  todo: "todo",
};

export const ChatFacturas = forwardRef<ChatFacturasRef, ChatFacturasProps>(({ onIrA }, ref) => {
  const [hoy] = useState(() => new Date());
  const [periodo, setPeriodo] = useState<PeriodoAnalisis>(PERIODO_ANALISIS_POR_DEFECTO);
  const [local, setLocal] = useState<FiltroLocal>("todos");
  const [producto, setProducto] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const buscadorRef = useRef<HTMLInputElement>(null);

  const fechas = useMemo(() => fechasPeriodo(periodo, hoy), [periodo, hoy]);
  const tablero = useTableroCompras(fechas.desde, fechas.hasta, localRpc(local));
  const { fijadas, fijar, quitar } = useGraficasFijadas();
  const idsFijadas = useMemo(() => new Set(fijadas.map((g) => g.id)), [fijadas]);

  const {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    nuevaConversacion,
    enviarMensaje,
    regenerarRespuesta,
    eliminarConversacion,
  } = useChatFacturas();

  const sugerencias = useMemo(() => sugerenciasDeTablero(tablero.data, periodo), [tablero.data, periodo]);

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      setVerHistorial(false);
      setAbierto(true);
      void enviarMensaje(texto);
    },
  }));

  const elegirProducto = (p: string | null) => {
    setProducto(p);
    // Desde «Lo que más ha subido»: llevar la vista a «Precio de un producto».
    requestAnimationFrame(() => {
      const tarjeta = document.querySelector<HTMLElement>("[data-testid='tarjeta-precio-producto']");
      tarjeta?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      if (!p) buscadorRef.current?.focus();
    });
  };
  const abrirConversacion = (c: Conversacion) => {
    setVerHistorial(false);
    return seleccionarConversacion(c);
  };
  const nueva = () => {
    setVerHistorial(false);
    return nuevaConversacion();
  };

  const datos = tablero.data;
  let cuerpo;
  if (tablero.isLoading) cuerpo = <EsqueletoTablero />;
  else if (tablero.isError && !datos)
    cuerpo = <ErrorTablero mensaje={(tablero.error as Error)?.message ?? ""} onReintentar={() => void tablero.refetch()} />;
  else if (!datos || datos.sinDatos)
    cuerpo = (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6" role="status">
        <p className="text-sm text-muted-foreground">
          No hay documentos en {periodo === "todo" ? "el histórico" : textoPeriodo({ tipo: PRESET_TEXTO[periodo] }, hoy).toLowerCase()}
          {local !== "todos" ? ` de ${local === "touza" ? "Touza" : "Casa Tomás"}` : ""}.
        </p>
        {periodo !== "todo" && (
          <Button type="button" variant="outline" className="h-11" onClick={() => setPeriodo("todo")}>
            Ver todo el histórico
          </Button>
        )}
      </div>
    );
  else
    cuerpo = (
      <TableroCompras
        ref={buscadorRef}
        datos={datos}
        apilado={local === "todos"}
        producto={producto}
        onProducto={elegirProducto}
        onMes={(mes) => onIrA?.(enlaceMesCompras(mes))}
        onProveedor={(id) => onIrA?.(enlaceProveedorCompras(id))}
        onClasificar={() => onIrA?.(ENLACE_PRODUCTOS_COMPRAS)}
        fijadas={fijadas}
        onQuitarFijada={quitar}
      />
    );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2" data-tour="facturas-analisis-barra">
        <Segmentado<PeriodoAnalisis> etiqueta="Periodo" opciones={periodosAnalisis(hoy)} valor={periodo} onCambio={setPeriodo} />
        <Segmentado<FiltroLocal> etiqueta="Local" opciones={FILTROS_LOCAL} valor={local} onCambio={setLocal} />
        {tablero.isFetching && !tablero.isLoading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Actualizando…
          </span>
        )}
        <Button
          type="button"
          className="ml-auto h-11 gap-1.5"
          // Abre y cierra el panel (no es modal: el botón sigue a mano con él abierto).
          onClick={() => {
            setVerHistorial(false);
            setAbierto((v) => !v);
          }}
          aria-expanded={abierto}
          aria-controls={abierto ? "copiloto-lateral" : undefined}
          data-tour="facturas-ia-abrir"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Pregúntale a la IA
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="region"
        aria-label="Tablero de compras"
        data-testid="tablero-analisis"
        data-tour="facturas-analisis-tablero"
      >
        {cuerpo}
      </div>

      <CopilotoLateral
        abierto={abierto}
        onAbiertoCambia={setAbierto}
        verHistorial={verHistorial}
        onVerHistorial={setVerHistorial}
        conversaciones={conversaciones}
        conversacionActiva={conversacionActiva}
        onSeleccionarConversacion={abrirConversacion}
        onNuevaConversacion={nueva}
        onEliminarConversacion={eliminarConversacion}
        mensajes={mensajes}
        isLoading={isLoading}
        isSending={isSending}
        sugerencias={sugerencias}
        onEnviar={(texto) => void enviarMensaje(texto)}
        onRegenerar={regenerarRespuesta}
        fijadas={idsFijadas}
        onFijar={fijar}
        onQuitarFijada={quitar}
      />
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
