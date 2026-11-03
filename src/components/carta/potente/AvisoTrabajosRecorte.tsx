import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { hayQueAvisar, MS_SONDEO } from "./colaPendientes";
import { nombreTrabajoRecorte, recortesReclamables, textoAvisoRecortes, trabajosRecorteVivos, type TrabajoRecorte } from "./trabajosRecorte";
import { CLAVE_CONSULTA_TABLA } from "../recorte/recorteMovil";

const ID_AVISO = "trabajos-recorte-pendientes";
const ID_PROCESO = "trabajos-recorte-proceso";
/** Espera inicial antes del primer sondeo: primero, lo que pide la pantalla. */
const MS_ESPERA_INICIAL = 20_000;

/**
 * En un ORDENADOR (recorte en el navegador seguro) con el panel abierto:
 * sondea cada 60 s las fotos que un móvil guardó sin recortar y ofrece
 * «¿Recortarlas aquí?» (mismo aviso que los vídeos). Al aceptar las recorta
 * de una en una con el fondo elegido, las guarda en su ficha y avisa por push
 * al que las subió. Sin la migración aplicada no hace nada. Lo monta
 * GestorRecortes solo en ordenadores con permiso de carta.
 */
export function AvisoTrabajosRecorte() {
  const queryClient = useQueryClient();
  const descartados = useRef(new Set<string>());
  const procesando = useRef(false);
  const sinMigracion = useRef(false);

  const procesarTodos = useCallback(
    async (lista: TrabajoRecorte[]) => {
      if (procesando.current) return;
      procesando.current = true;
      toast.dismiss(ID_AVISO);
      const tablas = new Set<string>();
      try {
        const { procesarTrabajoRecorte } = await import("./procesarTrabajoRecorte");
        for (const [i, t] of lista.entries()) {
          const nombre = nombreTrabajoRecorte(t);
          const prefijo = lista.length > 1 ? `(${i + 1}/${lista.length}) ` : "";
          toast.loading(`${prefijo}Recortando la foto de ${nombre}…`, { id: ID_PROCESO, duration: Infinity });
          const r = await procesarTrabajoRecorte(t);
          tablas.add(t.tabla);
          if (r.estado === "listo") toast.success(`Foto con fondo guardada: ${nombre}`, { id: ID_PROCESO, description: "Se ha avisado a quien la subió.", duration: 6000 });
          else if (r.estado === "cogido") toast.info(r.mensaje, { id: ID_PROCESO, duration: 5000 });
          else if (r.estado === "cancelado") toast.info(`Foto de ${nombre} devuelta a pendientes`, { id: ID_PROCESO, duration: 5000 });
          else toast.error(`No se pudo recortar la foto de ${nombre}`, { id: ID_PROCESO, description: r.mensaje, duration: 10000 });
        }
      } finally {
        for (const tabla of tablas) {
          const clave = CLAVE_CONSULTA_TABLA[tabla as keyof typeof CLAVE_CONSULTA_TABLA];
          if (clave) void queryClient.invalidateQueries({ queryKey: [clave] });
        }
        try {
          (await import("../recorte/quitarFondoNavegador")).liberarWorkerRecorte();
        } catch {
          /* nada */
        }
        procesando.current = false;
      }
    },
    [queryClient],
  );

  const sondear = useCallback(async () => {
    if (procesando.current || sinMigracion.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    let lista: TrabajoRecorte[];
    try {
      const r = await trabajosRecorteVivos();
      if (!r.disponible) {
        sinMigracion.current = true;
        return;
      }
      lista = recortesReclamables(r.trabajos);
    } catch {
      return; // red caída: siguiente sondeo
    }
    if (lista.length === 0) {
      toast.dismiss(ID_AVISO);
      return;
    }
    if (!hayQueAvisar(lista, descartados.current)) return;
    toast(textoAvisoRecortes(lista), {
      id: ID_AVISO,
      duration: Infinity,
      description: "Se recortan aquí, en este ordenador, con el fondo elegido y se avisa al móvil que las subió.",
      action: { label: lista.length === 1 ? "Recortarla aquí" : "Recortarlas aquí", onClick: () => void procesarTodos(lista) },
      cancel: {
        label: "Ahora no",
        onClick: () => {
          for (const t of lista) descartados.current.add(t.id);
        },
      },
    });
  }, [procesarTodos]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const arranque = setTimeout(() => {
      void sondear();
      id = setInterval(() => void sondear(), MS_SONDEO);
    }, MS_ESPERA_INICIAL);
    return () => {
      clearTimeout(arranque);
      if (id) clearInterval(id);
    };
  }, [sondear]);

  return null;
}
