import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { leerTrabajosOcrEnCurso } from "@/hooks/useTrabajoOcr";
import { ColaSubidaContext, type ContextoColaSubida, RUTA_CARGAR } from "@/hooks/useColaSubida";
import type { AlertaValidacion } from "@/hooks/useFacturas";
import {
  clasificarResultado,
  crearColaSubida,
  cuentaActivos,
  debeAvisarEnCampana,
  type DepsCola,
  depsSupabase,
  type ElementoCola,
  hayEnNavegador,
  type ResumenTanda,
  textoResumenTanda,
} from "@/lib/facturas/colaSubida";
import {
  type Anadible,
  anadirComoPagina,
  type Esperado,
  sustituirExistente,
  type Sustituible,
} from "@/lib/facturas/documentoLargo";
import { ETIQUETA_TIPO, tipoDocumento } from "@/lib/facturas/resultadosCarga";
import {
  fusionarPendientes,
  guardarDescartados,
  leerDescartados,
  leerPendientesDecidir,
} from "@/lib/facturas/pendientesDecidir";

import { AvisoDuplicadoDialog, type AvisoDuplicado } from "@/components/facturas/AvisoDuplicadoDialog";
import { SustituirFacturaDialog } from "@/components/facturas/SustituirFacturaDialog";
import { useDecisionDuplicado } from "@/components/facturas/useDecisionDuplicado";

export const CLAVE_PENDIENTES = "ocr_pendientes_decidir";

interface Props {
  children: ReactNode;
  /** Solo para tests: sustituye las llamadas reales (troceado, Storage, funciones). */
  deps?: Partial<DepsCola>;
}

/**
 * Gestor GLOBAL de la subida de facturas (05-oct-2026): montado una vez en
 * App.tsx, dentro del router y por encima de las rutas, así que cambiar de
 * pestaña o de sección no cancela nada. La pestaña «Cargar» y el indicador
 * del menú solo leen de aquí.
 *
 *  · Al terminar cada documento: toast con el resultado y botón «Ver».
 *  · Al terminar la tanda: una entrada en la campana (si el usuario no estaba
 *    mirando «Cargar») — una por tanda, no una por documento, para no llenarla.
 *  · Al cargar la página: adopta los documentos largos del usuario que siguen
 *    leyéndose en el servidor.
 *  · `beforeunload` solo mientras haya ficheros que dependen del navegador.
 */
export function ColaSubidaProvider({ children, deps }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const usuarioId = user?.id ?? null;

  // Los callbacks de la cola se crean una vez: leen lo último por referencia.
  const navegarRef = useRef(navigate);
  navegarRef.current = navigate;
  const ubicacionRef = useRef(location);
  ubicacionRef.current = location;

  // Avisos de «ya estaba subido»: uno detrás de otro, el primero es el que se ve.
  const [avisos, setAvisos] = useState<AvisoDuplicado[]>([]);
  const encolarAviso = (a: AvisoDuplicado) => setAvisos((prev) => [...prev, a]);

  const [cola] = useState(() => {
    const ver = { label: "Ver", onClick: () => navegarRef.current(RUTA_CARGAR) };
    const alTerminar = (e: ElementoCola) => {
      const r = e.resultado;
      const clase = clasificarResultado(r);
      // Tipo real del resultado; sin tipo reconocible, «Documento» (no se inventa «Factura»).
      const tipo = tipoDocumento(r);
      const doc = tipo ? ETIQUETA_TIPO[tipo] : "Documento";
      const guardado = tipo === "factura" ? "guardada" : "guardado";
      if (r?.success && !r.duplicado) {
        queryClient.invalidateQueries({ queryKey: ["facturas"] });
        queryClient.invalidateQueries({ queryKey: ["albaranes"] });
      }
      switch (clase) {
        case "guardada":
          toast.success(`${doc} ${guardado}`, { description: e.nombre, action: ver });
          break;
        case "avisos": {
          const n = r?.alertas?.length ?? 0;
          toast.warning(`${doc} ${guardado} con ${n} aviso${n === 1 ? "" : "s"}`, {
            description: `${e.nombre}: conviene revisar los importes.`,
            action: ver,
          });
          break;
        }
        case "sin_original":
          toast.error("No se ha podido archivar el original", {
            description: `${e.nombre}: los datos están guardados, pero el fichero no. Guarda una copia a mano y avisa al administrador.`,
            action: ver,
          });
          break;
        case "pendiente":
          queryClient.invalidateQueries({ queryKey: [CLAVE_PENDIENTES] });
          if (r?.anadible) {
            // Otra página de una factura que ya existe: no es un duplicado, basta el toast.
            toast(`${e.nombre}: es otra página de ${r.anadible.existente.numero_documento}`, {
              description: "Queda en «Pendientes de decidir» para añadirla a la factura que ya existe.",
              action: { label: "Decidir", onClick: () => navegarRef.current(RUTA_CARGAR) },
            });
          } else {
            // El mismo documento: pop-up con enlace a la foto del existente (sin toast, para no avisar dos veces).
            encolarAviso({
              nombre: e.nombre,
              facturaId: r?.facturaId,
              tipo,
              pendiente: true,
              sustituible: r?.sustituible ?? null,
              preview: e.preview,
            });
          }
          break;
        case "duplicada":
          encolarAviso({ nombre: e.nombre, facturaId: r?.facturaId, tipo, pendiente: false });
          break;
        default:
          toast.error(`No se ha podido leer ${e.nombre}`, { description: r?.error, action: ver });
      }
    };
    const alAcabarTanda = (r: ResumenTanda) => {
      queryClient.invalidateQueries({ queryKey: ["ocr_trabajos_en_curso"] });
      const u = ubicacionRef.current;
      const oculta = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (!debeAvisarEnCampana(u.pathname, u.search, oculta)) return;
      // Solo pueden escribir en la campana quienes editan el Dashboard (RLS):
      // si no, se queda en los toasts y la lista de «Cargar».
      void supabase
        .from("notificaciones_dashboard")
        .insert({
          tipo: "facturas_subida",
          titulo: `Subida de facturas terminada (${r.total} documento${r.total === 1 ? "" : "s"})`,
          mensaje: textoResumenTanda(r),
          referencia_tipo: "facturas_cargar",
        })
        .then(({ error }) => {
          if (error) console.info("[cola-subida] sin aviso en la campana:", error.message);
        });
    };
    return crearColaSubida({ ...depsSupabase(), ...deps, alTerminar, alAcabarTanda });
  });

  const estado = useSyncExternalStore(cola.suscribir, cola.getEstado, cola.getEstado);

  // Documentos largos que siguen en el servidor tras recargar: se adoptan.
  useEffect(() => {
    if (!usuarioId) return;
    let vigente = true;
    void leerTrabajosOcrEnCurso(usuarioId).then((ts) => {
      if (vigente && ts.length > 0) cola.adoptar(ts);
    });
    return () => {
      vigente = false;
    };
  }, [usuarioId, cola]);

  // Cerrar la pestaña con ficheros aún en el navegador los perdería.
  const enNavegador = hayEnNavegador(estado);
  useEffect(() => {
    if (!enNavegador) return;
    const avisar = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [enNavegador]);

  const { data: pendientesBd = [] } = useQuery({
    queryKey: [CLAVE_PENDIENTES, usuarioId],
    queryFn: () => leerPendientesDecidir(usuarioId!),
    enabled: !!usuarioId,
    staleTime: 30_000,
  });

  const [descartados, setDescartados] = useState<Set<string>>(() => leerDescartados());
  const [sustituidos, setSustituidos] = useState<Set<string>>(() => new Set());

  const descartarPendiente = useCallback((trabajoId: string) => {
    setDescartados((prev) => {
      const nuevo = new Set(prev);
      nuevo.add(trabajoId);
      guardarDescartados(nuevo);
      return nuevo;
    });
  }, []);

  const sustituir = useCallback(
    async (s: Sustituible, esperado?: Esperado) => {
      const r = await sustituirExistente(s, esperado);
      toast.success("Factura sustituida", { description: r.message });
      setSustituidos((prev) => new Set(prev).add(s.trabajo_id));
      cola.marcarSustituida(s.trabajo_id, r.alertas as AlertaValidacion[]);
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
      queryClient.invalidateQueries({ queryKey: ["albaranes"] });
      queryClient.invalidateQueries({ queryKey: [CLAVE_PENDIENTES] });
    },
    [cola, queryClient],
  );

  const anadirPagina = useCallback(
    async (a: Anadible, esperado?: Esperado) => {
      const r = await anadirComoPagina(a, esperado);
      toast.success(`Página ${a.pagina.actual} añadida`, { description: r.message });
      setSustituidos((prev) => new Set(prev).add(a.trabajo_id));
      cola.marcarPaginaAnadida(a.trabajo_id, r.alertas as AlertaValidacion[]);
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
      queryClient.invalidateQueries({ queryKey: ["albaranes"] });
      queryClient.invalidateQueries({ queryKey: [CLAVE_PENDIENTES] });
    },
    [cola, queryClient],
  );

  const pendientes = useMemo(() => {
    const ocultos = new Set([...descartados, ...sustituidos]);
    return fusionarPendientes(pendientesBd, estado.elementos, ocultos);
  }, [pendientesBd, estado.elementos, descartados, sustituidos]);

  const valor = useMemo<ContextoColaSubida>(
    () => ({ cola, estado, activos: cuentaActivos(estado), pendientes, descartarPendiente, sustituir, anadirPagina }),
    [cola, estado, pendientes, descartarPendiente, sustituir, anadirPagina],
  );

  // Mismo flujo (relectura + confirmación + servidor) que «Pendientes de decidir».
  const { decision, setDecision, cancelar, confirmar } = useDecisionDuplicado({ sustituir, anadirPagina });

  const aviso = avisos[0];
  return (
    <ColaSubidaContext.Provider value={valor}>
      {children}
      {aviso && (
        <AvisoDuplicadoDialog
          key={`${avisos.length}-${aviso.nombre}-${aviso.facturaId ?? ""}`}
          aviso={aviso}
          restantes={avisos.length - 1}
          onCerrar={() => setAvisos((prev) => prev.slice(1))}
          onVerFicha={(id) => {
            setAvisos((prev) => prev.slice(1));
            navigate(`/facturas?tab=compras&modo=documentos&doc=${id}`);
          }}
          onDecidir={() => {
            setAvisos((prev) => prev.slice(1));
            navigate(RUTA_CARGAR);
          }}
          onSustituir={(s) => {
            setAvisos((prev) => prev.slice(1));
            setDecision({ tipo: "sustituir", s });
          }}
          onDejar={(s) => {
            descartarPendiente(s.trabajo_id);
            setAvisos((prev) => prev.slice(1));
          }}
        />
      )}
      <SustituirFacturaDialog decision={decision} onCancelar={cancelar} onConfirmar={confirmar} />
    </ColaSubidaContext.Provider>
  );
}
