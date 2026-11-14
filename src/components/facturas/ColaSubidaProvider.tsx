import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { leerTrabajosOcrEnCurso } from "@/hooks/useTrabajoOcr";
import { ColaSubidaContext, type ContextoColaSubida, RUTA_CARGAR } from "@/hooks/useColaSubida";
import { invalidarTrasDocumento, type AlertaValidacion } from "@/hooks/useFacturas";
import {
  alertasRelevantes,
  clasificarResultado,
  crearColaSubida,
  cuentaActivos,
  debeAvisarEnCampana,
  type DepsCola,
  depsSupabase,
  type ElementoCola,
  hayEnNavegador,
  idToastTanda,
  POSICION_AVISOS,
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
  descartarPendienteServidor,
  fusionarPendientes,
  guardarDescartados,
  leerDescartados,
  leerPendientesDecidir,
} from "@/lib/facturas/pendientesDecidir";
import { useIsCompactNav } from "@/hooks/use-mobile";

import { AvisoDuplicadoDialog, type AvisoDuplicado } from "@/components/facturas/AvisoDuplicadoDialog";
import { IndicadorSubidasFacturas } from "@/components/facturas/IndicadorSubidasFacturas";
import { SustituirFacturaDialog } from "@/components/facturas/SustituirFacturaDialog";
import { useDecisionDuplicado } from "@/components/facturas/useDecisionDuplicado";

export const CLAVE_PENDIENTES = "ocr_pendientes_decidir";

/** «Ver» de un documento: abre ESE documento en Compras › Documentos (sin id, la pestaña Cargar). */
const rutaVerDocumento = (id: number | undefined) =>
  id ? `/facturas?tab=compras&modo=documentos&doc=${id}` : RUTA_CARGAR;

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
 *  · Un documento suelto: toast con el resultado y botón «Ver».
 *  · Una tanda de VARIOS (07/11/2026, «se llena de avisos al subir los
 *    albaranes»): UN solo toast al final, con el resumen de la tanda; sin un
 *    aviso ni un pop-up por documento, y sin toast de avance (13/11/2026). Los
 *    duplicados quedan en «Cargar» para decidir, como el resto de detalles.
 *  · Al terminar la tanda: una entrada en la campana (si el usuario no estaba
 *    mirando «Cargar») — una por tanda, no una por documento, para no llenarla.
 *  · Al cargar la página: adopta los documentos largos del usuario que siguen
 *    leyéndose en el servidor.
 *  · `beforeunload` solo mientras haya ficheros que dependen del navegador.
 *  · Por debajo de 1024 px (menú en panel deslizante, sin pie visible) pinta
 *    un indicador flotante mientras haya documentos en marcha fuera de «Cargar».
 */
export function ColaSubidaProvider({ children, deps }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Solo quien puede entrar en Facturas (o en su Subida) lee ocr_trabajos al entrar (07/11/2026):
  // antes se pedía dos veces nada más abrir el panel, aunque no tuviera permiso.
  const accesoFacturas = useCanAccessSection("facturas");
  const accesoSubida = useCanAccessSection("facturas_subida");
  const puedeFacturas = accesoFacturas.canAccess || accesoSubida.canAccess;
  const usuarioId = user?.id && puedeFacturas ? user.id : null;

  // Los callbacks de la cola se crean una vez: leen lo último por referencia.
  const navegarRef = useRef(navigate);
  navegarRef.current = navigate;
  const ubicacionRef = useRef(location);
  ubicacionRef.current = location;

  // Avisos de «ya estaba subido»: uno detrás de otro, el primero es el que se ve.
  const [avisos, setAvisos] = useState<AvisoDuplicado[]>([]);
  const encolarAviso = (a: AvisoDuplicado) => setAvisos((prev) => [...prev, a]);

  // La cola se crea dentro de su propio inicializador: los callbacks la leen por referencia.
  const colaRef = useRef<ReturnType<typeof crearColaSubida> | null>(null);

  const [cola] = useState(() => {
    const irACargar = { label: "Ver", onClick: () => navegarRef.current(RUTA_CARGAR) };
    const alTerminar = (e: ElementoCola) => {
      const r = e.resultado;
      const clase = clasificarResultado(r);
      // Tipo real del resultado; sin tipo reconocible, «Documento» (no se inventa «Factura»).
      const tipo = tipoDocumento(r);
      const doc = tipo ? ETIQUETA_TIPO[tipo] : "Documento";
      const guardado = tipo === "factura" ? "guardada" : "guardado";
      // «Ver» lleva al documento guardado (Compras › Documentos), no a la lista de la subida.
      const ver = { label: "Ver", onClick: () => navegarRef.current(rutaVerDocumento(r?.facturaId)) };
      const pos = { position: POSICION_AVISOS };
      if (r?.success && !r.duplicado) {
        // Documento nuevo: lista, productos, compras y proveedores (QA C-11).
        invalidarTrasDocumento(queryClient);
      }
      const temporal = r?.archivoEstado === "temporal" ? " · original pendiente de subir a Drive (se subirá solo)" : "";
      if (clase === "pendiente") queryClient.invalidateQueries({ queryKey: [CLAVE_PENDIENTES] });
      // Tanda de varios documentos: ningún toast por documento ni de avance
      // (13/11/2026, «quitar la notificación de leyendo documentos»: el toast
      // «Leyendo documentos: X de Y» no se cerraba solo y, si la lista se
      // limpiaba a mitad, se quedaba colgado). El avance ya se ve en «Cargar»
      // y en el indicador del menú; el resumen sale en alAcabarTanda.
      const deLaTanda = e.tanda > 0 ? (colaRef.current?.getEstado().elementos ?? []).filter((x) => x.tanda === e.tanda) : [];
      if (deLaTanda.length > 1) return;
      switch (clase) {
        case "guardada":
          toast.success(`${doc} ${guardado}`, { description: `${e.nombre}${temporal}`, action: ver, ...pos });
          break;
        case "avisos": {
          const n = alertasRelevantes(r).length;
          toast.warning(`${doc} ${guardado} con ${n} aviso${n === 1 ? "" : "s"}`, {
            description: `${e.nombre}: conviene revisar los importes.${temporal}`,
            action: ver,
            ...pos,
          });
          break;
        }
        case "sin_original":
          toast.error("No se ha podido archivar el original", {
            description: `${e.nombre}: los datos están guardados, pero el fichero no. Guarda una copia a mano y avisa al administrador.`,
            action: ver,
            ...pos,
          });
          break;
        case "en_servidor":
          toast(`${e.nombre} sigue en el servidor`, {
            description: "Está tardando más de lo normal. Aparecerá en la lista al terminar; no hace falta volver a subirlo.",
            action: irACargar,
            ...pos,
          });
          break;
        case "pendiente":
          if (r?.anadible) {
            // Otra página de una factura que ya existe: no es un duplicado, basta el toast.
            toast(`${e.nombre}: es otra página de ${r.anadible.existente.numero_documento}`, {
              description: "Queda en «Pendientes de decidir» para añadirla a la factura que ya existe.",
              action: { label: "Decidir", onClick: () => navegarRef.current(RUTA_CARGAR) },
              ...pos,
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
          toast.error(`No se ha podido leer ${e.nombre}`, { description: r?.error, action: irACargar, ...pos });
      }
    };
    const alAcabarTanda = (r: ResumenTanda) => {
      queryClient.invalidateQueries({ queryKey: ["ocr_trabajos_en_curso"] });
      if (r.total > 1) {
        // El toast de la tanda pasa a resumen: verde si todo bien, ámbar si hay algo que mirar.
        const c = r.porClase;
        const algoQueMirar = c.avisos + c.sin_original + c.pendiente + c.duplicada + c.en_servidor + c.fallida > 0;
        const opciones = {
          id: idToastTanda(r.tanda),
          description: textoResumenTanda(r),
          action: irACargar,
          duration: algoQueMirar ? 12000 : 6000,
          position: POSICION_AVISOS,
        };
        const titulo = `Subida terminada: ${r.total} documentos`;
        if (algoQueMirar) toast.warning(titulo, opciones);
        else toast.success(titulo, opciones);
      }
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
    const nueva = crearColaSubida({ ...depsSupabase(), ...deps, alTerminar, alAcabarTanda });
    colaRef.current = nueva;
    return nueva;
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

  /**
   * «Dejar la que hay» / «No añadirla»: se oculta YA y se descarta en el
   * servidor (ocr_descartar_trabajo: deja de salir en «Pendientes de decidir»
   * y en el indicador, en cualquier navegador). Sin la RPC, como antes: se
   * recuerda en este navegador. Si el servidor no lo permite, vuelve a salir
   * con el motivo.
   */
  const descartarPendiente = useCallback(
    (trabajoId: string) => {
      setSustituidos((prev) => new Set(prev).add(trabajoId));
      void descartarPendienteServidor(trabajoId).then((r) => {
        if (r.como === "error") {
          setSustituidos((prev) => {
            const nuevo = new Set(prev);
            nuevo.delete(trabajoId);
            return nuevo;
          });
          toast.error("No se ha podido descartar", { description: r.motivo, position: POSICION_AVISOS });
          return;
        }
        cola.marcarDescartado(trabajoId);
        if (r.como === "local") {
          setDescartados((prev) => {
            const nuevo = new Set(prev);
            nuevo.add(trabajoId);
            guardarDescartados(nuevo);
            return nuevo;
          });
        } else {
          queryClient.invalidateQueries({ queryKey: [CLAVE_PENDIENTES] });
        }
      });
    },
    [cola, queryClient],
  );

  const sustituir = useCallback(
    async (s: Sustituible, esperado?: Esperado) => {
      const r = await sustituirExistente(s, esperado);
      toast.success("Factura sustituida", { description: r.message });
      setSustituidos((prev) => new Set(prev).add(s.trabajo_id));
      cola.marcarSustituida(s.trabajo_id, r.alertas as AlertaValidacion[]);
      // Documento nuevo: lista, productos, compras y proveedores (QA C-11).
      invalidarTrasDocumento(queryClient);
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
      // Documento nuevo: lista, productos, compras y proveedores (QA C-11).
      invalidarTrasDocumento(queryClient);
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
  const { decision, setDecision, cancelar, confirmar, dejar } = useDecisionDuplicado({
    sustituir,
    anadirPagina,
    descartar: descartarPendiente,
  });

  // Menú en panel deslizante (< 1024 px): su pie no se ve, así que el
  // indicador flota abajo mientras haya algo en marcha y no se esté en «Cargar».
  const navCompacta = useIsCompactNav();
  const enCargar = location.pathname === "/facturas" && new URLSearchParams(location.search).get("tab") === "cargar";
  const flotante = navCompacta && !enCargar && valor.activos > 0;

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
      <SustituirFacturaDialog decision={decision} onCancelar={cancelar} onDejar={dejar} onConfirmar={confirmar} />
      {flotante && (
        <IndicadorSubidasFacturas
          variante="flotante"
          className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-40 max-w-[calc(100vw-1.5rem)] lg:hidden"
        />
      )}
    </ColaSubidaContext.Provider>
  );
}
