/**
 * Publicar en Instagram DESDE EL MÓVIL en un minuto (pedido del dueño,
 * 05/11/2026): «subo seis fotos de producto fresco y la IA me monta el
 * carrusel; o una sola y sale un post». Asistente de 3 pasos a pantalla
 * completa, para 375×812 y una mano (botones abajo, 48 px o más):
 *
 *   1. Fotos: cámara o carrete (1–10), o de la carta; reordenar, quitar,
 *      marca y «¿Algo que contar?». Se convierten a JPEG en el móvil y se
 *      suben en cuanto se eligen (tmp/ del bucket, con reintentos).
 *   2. Montar con IA (instagram-ia → montar_pieza): vista previa deslizable,
 *      lo que ha entendido la IA, texto editable, «Otra versión» y
 *      «Cambiar tono».
 *   3. Publicar ahora o Programar (hora sugerida ya puesta), sin paso de
 *      prueba, con progreso y enlace al acabar.
 *
 * Red del móvil: las fotos y el texto se guardan en el propio móvil
 * (IndexedDB) hasta publicar; las subidas esperan a la cobertura y se
 * reintentan; si se sale a mitad, el navegador avisa.
 * Cuota de IA: solo se llama a la IA cuando se pulsa un botón; mismo montaje
 * para las mismas fotos y texto (caché) y tope de MAX_MONTAJES_SESION.
 *
 * Detalle y contratos: docs/instagram-movil.md.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ArrowLeft, Camera, CheckCircle2, ExternalLink, ImagePlus, Loader2, Maximize2, PenLine, Plus, RefreshCw, Sparkles, UtensilsCrossed, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { ESTILO_FEED_POR_DEFECTO, type EstiloFeed, type RespuestaMontar } from "@/lib/instagram/montar";
import { TONOS_IA, type TonoIA } from "@/components/instagram/ia/api";
import { hoyMadrid, sumarDias, utcAMadrid, validarProgramacion, MAXIMO_DIAS } from "@/components/instagram/programar/logica";
import { firmaMontaje, horaInicial, nombreDia, unirCaption } from "./logica";
import type { BorradorMovil, FotoGuardada, PasoMovil } from "./almacen";
import { CarruselPrevia } from "./CarruselPrevia";
import { EncuadreMovil } from "./EncuadreMovil";
import { ElegirCarta } from "./ElegirCarta";
import { fotosParaMontar, huecosLibres, reducirFotos, resumenSubidas, subidaCaducada, todasSubidas, type FotoMovil } from "./estado";
import { MiniaturasOrdenables } from "./MiniaturasOrdenables";
import { MontandoPrevia } from "./MontandoPrevia";
import { MAX_INDICACION, MAX_MONTAJES_SESION, mensajeErrorMontar } from "./montar";
import { MAX_CAPTION, prepararYPublicar, type CacheRender, type CuandoPublicar, type ProgresoPublicar, type ResultadoPublicar } from "./publicar";
import { conReintentos } from "./reintentos";
import { serviciosReales, serviciosSimulados, type PlatoCarta, type ServiciosMovil } from "./servicios";

export interface CrearMovilProps {
  /** Servicios inyectados (pruebas). Si no, los reales o, con `simulado`, los de muestra. */
  servicios?: ServiciosMovil;
  /** Usa la API simulada (sin red ni IA): demo y pruebas en el navegador. */
  simulado?: boolean;
  /** Dentro de la pestaña «Crear» (ocupa su hueco) en vez de pantalla completa. */
  incrustado?: boolean;
  /** Botón de cerrar (solo a pantalla completa). */
  onSalir?: () => void;
  /** Enlace «Usar el editor completo» (en la pestaña). */
  onEditorCompleto?: () => void;
  /** Botón «Pantalla completa» (en la pestaña): abre /instagram/rapido. */
  onPantallaCompleta?: () => void;
  /** Lo que va a la derecha de la cabecera (en la pestaña: el punto de la cuenta conectada). */
  cuenta?: ReactNode;
  marcaInicial?: MarcaId;
}

const MARCAS: Array<{ id: MarcaId; nombre: string }> = [
  { id: "casa-tomas", nombre: "Casa Tomás" },
  { id: "touza", nombre: "Touza" },
];

const PASOS: Record<PasoMovil, { n: number; titulo: string }> = {
  fotos: { n: 1, titulo: "Fotos" },
  montaje: { n: 2, titulo: "Montar con IA" },
  publicar: { n: 3, titulo: "Publicar" },
};

const MENSAJES_IA = ["Mirando las fotos…", "Pensando el orden…", "Escribiendo el texto…", "Poniendo los rótulos…", "Casi está…"];

/** Subidas a la vez (la red del móvil va mejor con pocas). */
const SUBIDAS_SIMULTANEAS = 2;

const GRANDE = "h-14 pointer-coarse:h-14 w-full text-base font-semibold";
const MEDIO = "h-12 pointer-coarse:h-12 text-base";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Respaldo (navegadores muy viejos): v4 con Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function crearVista(blob: Blob): string {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : "";
}
function soltarVista(url: string) {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

type EstadoPublicacion =
  | { fase: "lista" }
  | { fase: "trabajando"; progreso: ProgresoPublicar | null; cuando: CuandoPublicar["tipo"] }
  | { fase: "hecha"; resultado: ResultadoPublicar }
  | { fase: "error"; mensaje: string };

type Confirmar = null | "salir" | "descartar";

export function CrearMovil({
  servicios: inyectados,
  simulado = false,
  incrustado = false,
  onSalir,
  onEditorCompleto,
  onPantallaCompleta,
  cuenta,
  marcaInicial = "casa-tomas",
}: CrearMovilProps) {
  const servicios = useMemo(() => inyectados ?? (simulado ? serviciosSimulados({ espera: 400 }) : serviciosReales()), [inyectados, simulado]);

  const [paso, setPaso] = useState<PasoMovil>("fotos");
  const [marca, setMarca] = useState<MarcaId>(marcaInicial);
  const [indicacion, setIndicacion] = useState("");
  const [tono, setTono] = useState<TonoIA>("cercano");
  // Estilo del feed (RRSS › Instagram › Ajustes): «Solo foto» por defecto.
  const [estilo, setEstilo] = useState<EstiloFeed>(ESTILO_FEED_POR_DEFECTO);
  useEffect(() => {
    let vivo = true;
    servicios
      .estiloFeed?.()
      .then((e) => vivo && setEstilo(e))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [servicios]);
  const [fotos, despachar] = useReducer(reducirFotos, []);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cartaAbierta, setCartaAbierta] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [recuperado, setRecuperado] = useState(false);
  const [sinRed, setSinRed] = useState(() => !servicios.enLinea());
  const [confirmar, setConfirmar] = useState<Confirmar>(null);

  const [montaje, setMontaje] = useState<RespuestaMontar | null>(null);
  const [firmaDelMontaje, setFirmaDelMontaje] = useState<string | null>(null);
  const [montando, setMontando] = useState<null | "subiendo" | "ia">(null);
  const [mensajeIA, setMensajeIA] = useState(0);
  const [errorMontaje, setErrorMontaje] = useState<string | null>(null);
  const [montajesUsados, setMontajesUsados] = useState(0);
  const [elegirTono, setElegirTono] = useState(false);
  const [caption, setCaption] = useState("");

  const [pub, setPub] = useState<EstadoPublicacion>({ fase: "lista" });
  const [dia, setDia] = useState<"hoy" | "manana" | "otro">("manana");
  const [fechaOtro, setFechaOtro] = useState("");
  const [hora, setHora] = useState("13:00");
  const [horaTocada, setHoraTocada] = useState(false);
  const [archivo, setArchivo] = useState<null | "guardando" | "hecho" | "error">(null);

  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  const marcaRef = useRef(marca);
  marcaRef.current = marca;
  const enVuelo = useRef(new Map<string, Promise<void>>());
  const montandoRef = useRef(false);
  const usadosRef = useRef(0);
  const cache = useRef<CacheRender>(new Map());
  const terminado = useRef(false);
  const inputCarrete = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);
  const vistas = useRef(new Set<string>());

  const hayRed = servicios.enLinea;
  const reintento = servicios.reintento;

  // ── Recuperar el borrador guardado en el móvil ──────────────────────────
  useEffect(() => {
    let vivo = true;
    servicios.almacen
      .leer()
      .then((b) => {
        if (!vivo || !b || !b.fotos.length) return;
        const ahora = Date.now();
        const recuperadas: FotoMovil[] = b.fotos.map((f) => {
          const vista = f.blob ? crearVista(f.blob) : (f.vistaCarta ?? "");
          if (vista.startsWith("blob:")) vistas.current.add(vista);
          const valida = f.estado === "subida" && f.subida && !subidaCaducada(f, ahora);
          const resto: FotoMovil = { ...f, vista };
          delete (resto as FotoMovil & { vistaCarta?: unknown }).vistaCarta;
          return { ...resto, estado: valida ? "subida" : f.blob || f.origen === "carta" ? "subiendo" : "error", subida: valida ? f.subida : null, error: null };
        });
        despachar({ tipo: "reemplazar", fotos: recuperadas });
        setMarca(b.marca);
        setIndicacion(b.indicacion);
        setTono(b.tono);
        setMontaje(b.montaje);
        setFirmaDelMontaje(b.firmaMontaje);
        setCaption(b.caption);
        setPaso(b.montaje ? b.paso : "fotos");
        setRecuperado(true);
      })
      .catch(() => {
        /* sin borrador */
      })
      .finally(() => vivo && setCargado(true));
    return () => {
      vivo = false;
    };
  }, [servicios]);

  // ── Guardar el borrador en el móvil (cada cambio, con un respiro) ───────
  useEffect(() => {
    if (!cargado || terminado.current) return;
    const t = setTimeout(() => {
      if (terminado.current) return;
      if (!fotos.length && !montaje) {
        void servicios.almacen.borrar();
        return;
      }
      const b: BorradorMovil = {
        version: 1,
        marca,
        indicacion,
        tono,
        fotos: fotos
          .filter((f) => f.blob || f.origen === "carta")
          .map(({ vista, ...f }): FotoGuardada => ({ ...f, vistaCarta: f.origen === "carta" ? vista : null })),
        montaje,
        firmaMontaje: firmaDelMontaje,
        caption,
        paso,
        guardadoEn: Date.now(),
      };
      void servicios.almacen.guardar(b);
    }, 300);
    return () => clearTimeout(t);
  }, [cargado, fotos, marca, indicacion, tono, montaje, firmaDelMontaje, caption, paso, servicios]);

  // Soltar las miniaturas al salir.
  useEffect(() => {
    const v = vistas.current;
    return () => v.forEach(soltarVista);
  }, []);

  // ── Cobertura ───────────────────────────────────────────────────────────
  useEffect(() => {
    const cambiar = () => setSinRed(!hayRed());
    window.addEventListener("online", cambiar);
    window.addEventListener("offline", cambiar);
    return () => {
      window.removeEventListener("online", cambiar);
      window.removeEventListener("offline", cambiar);
    };
  }, [hayRed]);

  // ── Avisar si se sale a mitad (cerrar pestaña, recargar, atrás del sistema) ─
  const aMedias = fotos.length > 0 && pub.fase !== "hecha";
  useEffect(() => {
    if (!aMedias) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [aMedias]);

  // ── Subidas: cola de 2 en 2, con reintentos y esperando a la cobertura ──
  const subir = useCallback(
    (clave: string): Promise<void> => {
      const enCurso = enVuelo.current.get(clave);
      if (enCurso) return enCurso;
      const f = fotosRef.current.find((x) => x.clave === clave);
      if (!f) return Promise.resolve();
      const p = (async () => {
        try {
          const subida = await conReintentos(
            () => (f.origen === "carta" ? servicios.prepararCarta(marcaRef.current, String(f.platoId)) : servicios.subirFoto(f.blob as Blob, f.clave, { ancho: f.ancho, alto: f.alto })),
            {
              ...reintento,
              enLinea: hayRed,
              alReintentar: ({ sinConexion }) => {
                if (sinConexion) setSinRed(true);
              },
            },
          );
          setSinRed(!hayRed());
          despachar({
            tipo: "actualizar",
            clave,
            cambios: { estado: "subida", subida, subidaEn: Date.now(), error: null, ancho: f.ancho ?? subida.ancho ?? null, alto: f.alto ?? subida.alto ?? null },
          });
        } catch (e) {
          despachar({ tipo: "actualizar", clave, cambios: { estado: "error", error: (e as Error)?.message || "No se ha podido subir" } });
        } finally {
          enVuelo.current.delete(clave);
        }
      })();
      enVuelo.current.set(clave, p);
      return p;
    },
    [servicios, reintento, hayRed],
  );

  useEffect(() => {
    if (!cargado) return;
    let libres = SUBIDAS_SIMULTANEAS - enVuelo.current.size;
    for (const f of fotos) {
      if (libres <= 0) break;
      if (f.estado !== "subiendo" || enVuelo.current.has(f.clave)) continue;
      if (f.origen === "subida" && !f.blob) continue;
      libres--;
      void subir(f.clave);
    }
  }, [fotos, cargado, subir]);

  /** Espera a que acaben las subidas (reintentando las que fallaron). true si están todas. */
  const esperarSubidas = useCallback(async (): Promise<boolean> => {
    for (const f of fotosRef.current) {
      if (f.estado === "error" && (f.blob || f.origen === "carta")) despachar({ tipo: "actualizar", clave: f.clave, cambios: { estado: "subiendo", error: null } });
    }
    await new Promise((r) => setTimeout(r, 0));
    for (;;) {
      const l = fotosRef.current;
      if (!l.length) return false;
      if (l.every((f) => f.estado === "subida" || f.estado === "error") && enVuelo.current.size === 0) return todasSubidas(l);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, []);

  // ── Elegir fotos ────────────────────────────────────────────────────────
  const alElegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const ficheros = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!ficheros.length) return;
    const libres = huecosLibres(fotosRef.current);
    if (!libres) {
      setAviso("Ya tienes 10 fotos, el máximo de Instagram. Quita alguna para añadir otra.");
      return;
    }
    setAviso(ficheros.length > libres ? `Solo caben 10 fotos: se han añadido las ${libres} primeras.` : null);
    const nuevas: Array<{ foto: FotoMovil; fichero: File }> = ficheros.slice(0, libres).map((fichero) => ({
      fichero,
      foto: { clave: uuid(), origen: "subida", nombre: fichero.name || "foto.jpg", blob: null, vista: "", ancho: null, alto: null, estado: "preparando", subida: null },
    }));
    despachar({ tipo: "anadir", fotos: nuevas.map((n) => n.foto) });
    // Una a una: convertir varias fotos de 12 Mpx a la vez agota la memoria del móvil.
    for (const { foto, fichero } of nuevas) {
      try {
        const c = await servicios.convertir(fichero);
        const vista = crearVista(c.blob);
        if (vista) vistas.current.add(vista);
        despachar({ tipo: "actualizar", clave: foto.clave, cambios: { blob: c.blob, vista, ancho: c.ancho, alto: c.alto, estado: "subiendo" } });
      } catch (err) {
        despachar({ tipo: "quitar", clave: foto.clave });
        setAviso(`«${foto.nombre}»: ${(err as Error)?.message || "no se ha podido leer"}`);
      }
    }
  };

  const alElegirCarta = (platos: PlatoCarta[]) => {
    setCartaAbierta(false);
    const libres = huecosLibres(fotosRef.current);
    const nuevas: FotoMovil[] = platos.slice(0, libres).map((p) => ({
      clave: uuid(),
      origen: "carta",
      nombre: p.nombre,
      blob: null,
      vista: p.url,
      ancho: null,
      alto: null,
      estado: "subiendo",
      subida: null,
      platoId: p.id,
    }));
    despachar({ tipo: "anadir", fotos: nuevas });
  };

  const quitar = (clave: string) => {
    const f = fotosRef.current.find((x) => x.clave === clave);
    if (f) {
      soltarVista(f.vista);
      vistas.current.delete(f.vista);
    }
    despachar({ tipo: "quitar", clave });
    if (seleccionada === clave) setSeleccionada(null);
  };

  const indiceSel = seleccionada ? fotos.findIndex((f) => f.clave === seleccionada) : -1;
  const mover = (desde: number, hasta: number) => despachar({ tipo: "mover", desde, hasta });

  // ── Montar con IA (solo con un toque; nunca en bucle) ───────────────────
  const montar = async (motivo: "primera" | "otra" | "tono", tonoPedido: TonoIA = tono) => {
    if (montandoRef.current) return;
    montandoRef.current = true;
    setElegirTono(false);
    setErrorMontaje(null);
    setPaso("montaje");
    setMontando("subiendo");
    try {
      const listas = await esperarSubidas();
      if (!listas) {
        setErrorMontaje(
          hayRed()
            ? "No se han podido subir todas las fotos. Vuelve a las fotos y quita las marcadas en rojo, o pulsa «Probar otra vez»."
            : "Sin cobertura: las fotos están guardadas en el móvil. Pulsa «Probar otra vez» cuando vuelva la red.",
        );
        return;
      }
      const l = fotosRef.current;
      const firma = firmaMontaje(marcaRef.current, l, indicacion);
      if (motivo === "primera" && montaje && firmaDelMontaje === firma) return; // mismas fotos y texto: no se gasta IA
      if (usadosRef.current >= MAX_MONTAJES_SESION) {
        setErrorMontaje("Ya has pedido muchas versiones seguidas. Quédate con esta y retoca el texto a mano.");
        return;
      }
      usadosRef.current++;
      setMontajesUsados(usadosRef.current);
      setMontando("ia");
      setMensajeIA(0);
      const r = await servicios.montar({ accion: "montar_pieza", marca: marcaRef.current, fotos: fotosParaMontar(l), formato: "auto", indicacion: indicacion.trim() || undefined, tono: tonoPedido, estilo });
      setMontaje(r);
      setFirmaDelMontaje(firma);
      setCaption(unirCaption(r));
      setTono(tonoPedido);
      setHoraTocada(false);
      cache.current.clear();
    } catch (e) {
      setErrorMontaje(mensajeErrorMontar(e));
    } finally {
      montandoRef.current = false;
      setMontando(null);
    }
  };

  useEffect(() => {
    if (montando !== "ia") return;
    const t = setInterval(() => setMensajeIA((i) => Math.min(i + 1, MENSAJES_IA.length - 1)), 2500);
    return () => clearInterval(t);
  }, [montando]);

  // ── Programar: fecha y hora iniciales ───────────────────────────────────
  const hoy = hoyMadrid();
  useEffect(() => {
    if (paso !== "publicar" || horaTocada) return;
    const { fecha, hora: h } = horaInicial(montaje?.horaSugerida);
    const hoyAhora = hoyMadrid();
    setHora(h);
    if (fecha === hoyAhora) setDia("hoy");
    else if (fecha === sumarDias(hoyAhora, 1)) setDia("manana");
    else {
      setDia("otro");
      setFechaOtro(fecha);
    }
  }, [paso, montaje, horaTocada]);

  const fechaProgramada = dia === "hoy" ? hoy : dia === "manana" ? sumarDias(hoy, 1) : fechaOtro;
  const validacionHora = validarProgramacion(fechaProgramada, hora);

  // ── Publicar ────────────────────────────────────────────────────────────
  const publicarAhoraO = async (cuando: CuandoPublicar) => {
    if (!montaje || pub.fase === "trabajando") return;
    setPub({ fase: "trabajando", progreso: null, cuando: cuando.tipo });
    try {
      if (!(await esperarSubidas())) throw new Error(hayRed() ? "Alguna foto no se ha podido subir. Vuelve a las fotos." : "Sin cobertura: espera a tener red y vuelve a intentarlo.");
      const resultado = await prepararYPublicar(
        { marca, formato: montaje.formato, fotos: fotosParaMontar(fotosRef.current), diapositivas: montaje.diapositivas, caption },
        { cuando, api: servicios.api, cache: cache.current, reintento, onProgreso: (progreso) => setPub({ fase: "trabajando", progreso, cuando: cuando.tipo }) },
      );
      terminado.current = true;
      setPub({ fase: "hecha", resultado });
      void servicios.almacen.borrar();
      // Archivo en Drive, después y en segundo plano (solo las hechas con el móvil).
      const propias = fotosRef.current.filter((f) => f.origen === "subida" && f.blob).map((f) => ({ blob: f.blob as Blob }));
      if (propias.length) {
        setArchivo("guardando");
        servicios
          .archivar(propias, marca, indicacion.trim() || montaje.resumen)
          .then(() => setArchivo("hecho"))
          .catch(() => setArchivo("error"));
      }
    } catch (e) {
      setPub({ fase: "error", mensaje: (e as Error)?.message || "No se ha podido publicar" });
    }
  };

  const reiniciar = () => {
    vistas.current.forEach(soltarVista);
    vistas.current.clear();
    terminado.current = false;
    despachar({ tipo: "reemplazar", fotos: [] });
    setPaso("fotos");
    setIndicacion("");
    setMontaje(null);
    setFirmaDelMontaje(null);
    setCaption("");
    setErrorMontaje(null);
    setPub({ fase: "lista" });
    setArchivo(null);
    setRecuperado(false);
    setSeleccionada(null);
    setAviso(null);
    setHoraTocada(false);
    cache.current.clear();
    void servicios.almacen.borrar();
  };

  const salir = () => {
    if (aMedias) setConfirmar("salir");
    else onSalir?.();
  };

  const atras = () => {
    if (paso === "publicar") setPaso("montaje");
    else if (paso === "montaje") setPaso("fotos");
  };

  const trabajando = pub.fase === "trabajando";
  const sub = resumenSubidas(fotos);
  const fotosSubidasParaPrevia = useMemo(() => fotosParaMontar(fotos), [fotos]);
  const info = PASOS[paso];
  const nombreMarca = MARCAS.find((m) => m.id === marca)?.nombre ?? marca;
  const resumenProgramada = /^\d{2}:\d{2}$/.test(hora) ? `${nombreDia(fechaProgramada || hoy, hoy)} a las ${hora}` : "elige la hora";

  // ── Pintar ──────────────────────────────────────────────────────────────
  // Cabecera compacta: una sola línea «Paso 2/3 · Montar con IA» con la barra de progreso (05/11/2026).
  const cabecera = (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-1" data-testid="cabecera-asistente">
      {paso !== "fotos" && pub.fase !== "hecha" ? (
        <Button variant="ghost" size="icon" className="h-12 w-12 pointer-coarse:h-12 pointer-coarse:w-12" onClick={atras} disabled={trabajando || !!montando} aria-label="Volver al paso anterior">
          <ArrowLeft className="h-6 w-6" aria-hidden="true" />
        </Button>
      ) : !incrustado && onSalir ? (
        <Button variant="ghost" size="icon" className="h-12 w-12 pointer-coarse:h-12 pointer-coarse:w-12" onClick={salir} disabled={trabajando} aria-label="Salir">
          <X className="h-6 w-6" aria-hidden="true" />
        </Button>
      ) : (
        <span className="w-2" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold leading-tight">
        {pub.fase === "hecha" ? (
          "Listo"
        ) : (
          <>
            <span className="font-normal text-muted-foreground" aria-hidden="true">
              Paso {info.n}/3 ·
            </span>
            <span className="sr-only">Paso {info.n} de 3: </span> {info.titulo}
          </>
        )}
      </h1>
      <ol className={cn("flex shrink-0 gap-1", !cuenta && "mr-3")} aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <li key={n} className={cn("h-1.5 w-4 rounded-full", n <= info.n || pub.fase === "hecha" ? "bg-primary" : "bg-muted")} />
        ))}
      </ol>
      {cuenta}
    </header>
  );

  const bannerRed = sinRed ? (
    <p role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      Sin cobertura. Tus fotos están guardadas en el móvil y se subirán al volver la red.
    </p>
  ) : null;

  const subtituloSubidas =
    sub.total === 0
      ? "Una foto: post. Varias: carrusel (hasta 10)."
      : sub.errores
        ? `${sub.errores === 1 ? "Una foto no se ha podido subir" : `${sub.errores} fotos no se han podido subir`}: se reintentará al montar.`
        : sub.pendientes
          ? `Subiendo fotos: ${sub.subidas} de ${sub.total} listas…`
          : `${sub.total === 1 ? "1 foto lista" : `${sub.total} fotos listas`}: ${sub.total === 1 ? "saldrá un post" : "saldrá un carrusel"}.`;

  const pasoFotos = (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {recuperado && (
          <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
            <span>Hemos recuperado lo que dejaste a medias.</span>
            <Button variant="link" className="h-12 px-2 text-sm" onClick={() => setConfirmar("descartar")}>
              Empezar de cero
            </Button>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">¿Para qué cuenta?</legend>
          <div className="grid grid-cols-2 gap-2">
            {MARCAS.map((m) => (
              <Button key={m.id} type="button" variant={marca === m.id ? "default" : "outline"} className={MEDIO} aria-pressed={marca === m.id} onClick={() => setMarca(m.id)}>
                {m.nombre}
              </Button>
            ))}
          </div>
        </fieldset>

        {/* Sin `capture`: así iOS y Android ofrecen cámara Y carrete. «Hacer foto» abre la cámara directamente. */}
        <input ref={inputCarrete} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={alElegir} data-testid="input-carrete" />
        <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={alElegir} data-testid="input-camara" />

        {fotos.length === 0 ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => inputCarrete.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 p-4 text-center text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/10"
            >
              <ImagePlus className="h-10 w-10 text-primary" aria-hidden="true" />
              Hacer fotos o elegir del carrete
              <span className="text-sm font-normal text-muted-foreground">De 1 a 10 fotos</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className={MEDIO} onClick={() => inputCamara.current?.click()}>
                <Camera className="mr-2 h-5 w-5" aria-hidden="true" /> Hacer foto
              </Button>
              <Button variant="outline" className={MEDIO} onClick={() => setCartaAbierta(true)}>
                <UtensilsCrossed className="mr-2 h-5 w-5" aria-hidden="true" /> De la carta
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <MiniaturasOrdenables
              fotos={fotos}
              seleccionada={seleccionada}
              onSeleccionar={setSeleccionada}
              onMover={mover}
              onQuitar={quitar}
              extra={
                huecosLibres(fotos) > 0 ? (
                  <button
                    type="button"
                    onClick={() => inputCarrete.current?.click()}
                    className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus className="h-7 w-7" aria-hidden="true" />
                    Añadir
                  </button>
                ) : null
              }
            />
            <p className="text-sm text-muted-foreground">Mantén pulsada una foto para arrastrarla. La primera es la portada.</p>
            {huecosLibres(fotos) > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className={MEDIO} onClick={() => inputCamara.current?.click()}>
                  <Camera className="mr-2 h-5 w-5" aria-hidden="true" /> Hacer foto
                </Button>
                <Button variant="outline" className={MEDIO} onClick={() => setCartaAbierta(true)}>
                  <UtensilsCrossed className="mr-2 h-5 w-5" aria-hidden="true" /> De la carta
                </Button>
              </div>
            )}
          </div>
        )}

        {aviso && (
          <p role="alert" className="rounded-md bg-amber-100 p-3 text-sm text-amber-950">
            {aviso}
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor="indicacion-movil" className="text-sm font-medium">
            ¿Algo que contar? <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="indicacion-movil"
            value={indicacion}
            onChange={(e) => setIndicacion(e.target.value.slice(0, MAX_INDICACION))}
            placeholder="Por ejemplo: llegó la centolla"
            enterKeyHint="done"
            autoCapitalize="sentences"
            autoComplete="off"
            className="h-12 text-base"
            aria-describedby="ayuda-indicacion-movil"
          />
          <p id="ayuda-indicacion-movil" className="text-sm text-muted-foreground">
            Puedes dictarlo con el micrófono del teclado.
          </p>
        </div>
      </div>

      {seleccionada && indiceSel >= 0 ? (
        <div className="shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="toolbar" aria-label={`Foto ${indiceSel + 1} seleccionada`}>
          <p className="mb-2 text-sm font-medium">Foto {indiceSel + 1} de {fotos.length}</p>
          <div className="grid grid-cols-4 gap-2">
            <Button variant="outline" className={MEDIO} disabled={indiceSel === 0} onClick={() => mover(indiceSel, indiceSel - 1)} aria-label="Mover antes">
              Antes
            </Button>
            <Button variant="outline" className={MEDIO} disabled={indiceSel === fotos.length - 1} onClick={() => mover(indiceSel, indiceSel + 1)} aria-label="Mover después">
              Después
            </Button>
            <Button variant="outline" className={MEDIO} onClick={() => quitar(seleccionada)}>
              Quitar
            </Button>
            <Button className={MEDIO} onClick={() => setSeleccionada(null)}>
              Hecho
            </Button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 space-y-1 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-center text-sm text-muted-foreground" role="status" aria-live="polite">
            {subtituloSubidas}
          </p>
          <Button className={GRANDE} disabled={!fotos.length || !cargado} onClick={() => void montar("primera")}>
            <Sparkles className="mr-2 h-5 w-5" aria-hidden="true" /> Montar con IA
          </Button>
          {incrustado && (onEditorCompleto || onPantallaCompleta) && (
            <div className="flex">
              {onEditorCompleto && (
                <Button variant="ghost" className="h-12 flex-1 px-2 text-sm text-muted-foreground" onClick={onEditorCompleto}>
                  <PenLine className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editor completo
                </Button>
              )}
              {onPantallaCompleta && (
                <Button variant="ghost" className="h-12 flex-1 px-2 text-sm text-muted-foreground" onClick={onPantallaCompleta}>
                  <Maximize2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Pantalla completa
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  const pasoMontaje = (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {/* Mientras la IA trabaja (o si falla sin montaje): SU publicación montándose, no un spinner en el vacío. */}
        {montando ? (
          <MontandoPrevia
            fotos={fotos}
            estado={montando}
            mensajes={MENSAJES_IA}
            pasoIA={mensajeIA}
            textoSubida={sub.pendientes || sub.errores ? `Subiendo fotos: ${sub.subidas} de ${sub.total}…` : "Preparando las fotos…"}
            indicacion={indicacion}
            nombreMarca={nombreMarca}
          />
        ) : errorMontaje ? (
          <>
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-base text-destructive">
              {errorMontaje}
            </p>
            {!montaje && <MontandoPrevia fotos={fotos} estado="error" mensajes={MENSAJES_IA} pasoIA={0} textoSubida="" indicacion={indicacion} nombreMarca={nombreMarca} />}
          </>
        ) : null}

        {montaje && !montando && (
          <>
            <CarruselPrevia marca={marca} formato={montaje.formato} diapositivas={montaje.diapositivas} fotos={fotosSubidasParaPrevia} />
            {montaje.diapositivas.every((d) => obtenerPlantilla(d.plantilla)?.sinTexto) && (
              <p className="text-sm text-muted-foreground" data-testid="aviso-solo-foto">
                Sin texto encima, como vuestro feed: el nombre del plato y el gancho van en el texto.
              </p>
            )}
            <EncuadreMovil
              diapositivas={montaje.diapositivas}
              fotos={fotosSubidasParaPrevia}
              onCambio={(i, en) =>
                setMontaje((m) =>
                  m ? { ...m, diapositivas: m.diapositivas.map((d, k) => (k === i ? { ...d, datos: { ...d.datos, posicionX: en.x, posicionY: en.y } } : d)) } : m,
                )
              }
            />
            {montaje.resumen && (
              <p className="rounded-lg bg-muted p-3 text-base" data-testid="resumen-ia">
                {montaje.resumen}
              </p>
            )}
            {montaje.avisos.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                {montaje.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            <div className="space-y-1">
              <Label htmlFor="caption-movil" className="text-sm font-medium">
                Texto de la publicación
              </Label>
              <Textarea id="caption-movil" value={caption} onChange={(e) => setCaption(e.target.value)} rows={7} className="text-base" aria-describedby="contador-caption-movil" />
              <p id="contador-caption-movil" className={cn("text-right text-sm", caption.length > MAX_CAPTION ? "text-destructive" : "text-muted-foreground")}>
                {caption.length} / {MAX_CAPTION}
              </p>
            </div>
          </>
        )}
      </div>

      {!montaje && !montando && errorMontaje && (
        <div className="shrink-0 space-y-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className={GRANDE} onClick={() => void montar("primera")} disabled={usadosRef.current >= MAX_MONTAJES_SESION}>
            <RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" /> Probar otra vez
          </Button>
          <Button variant="outline" className={cn(MEDIO, "w-full")} onClick={() => setPaso("fotos")}>
            Volver a las fotos
          </Button>
        </div>
      )}

      {montaje && !montando && (
        <div className="shrink-0 space-y-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {elegirTono && (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Elige el tono">
              {TONOS_IA.map((t) => (
                <Button key={t.id} variant={t.id === tono ? "default" : "outline"} className={cn(MEDIO, "px-2 text-sm")} onClick={() => void montar("tono", t.id)} aria-pressed={t.id === tono}>
                  {t.etiqueta}
                </Button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className={MEDIO} onClick={() => void montar("otra")} disabled={montajesUsados >= MAX_MONTAJES_SESION}>
              <RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" /> Otra versión
            </Button>
            <Button variant="outline" className={MEDIO} onClick={() => setElegirTono((v) => !v)} aria-expanded={elegirTono} disabled={montajesUsados >= MAX_MONTAJES_SESION}>
              Cambiar tono
            </Button>
          </div>
          <Button className={GRANDE} onClick={() => setPaso("publicar")} disabled={!caption.trim() || caption.length > MAX_CAPTION}>
            Siguiente: publicar
          </Button>
        </div>
      )}
    </>
  );

  const portada = montaje ? fotosSubidasParaPrevia.find((f) => f.id === montaje.diapositivas[0]?.foto) : undefined;
  const progresoTexto = (p: ProgresoPublicar | null, cuando: CuandoPublicar["tipo"]) => {
    if (!p) return "Empezando…";
    if (p.fase === "preparando") return `Preparando imágenes ${p.hechas}/${p.total}`;
    if (p.fase === "reintentando") return p.sinConexion ? "Sin cobertura: esperando a la red…" : "La red va lenta, reintentando…";
    if (p.fase === "publicando") return "Publicando…";
    return cuando === "programar" ? "Programando…" : "Publicando…";
  };

  // Paso 3: el resumen arriba y «¿cuándo?» pegado a los botones (al alcance del pulgar), sin hueco muerto en medio.
  const pasoPublicar = (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
        {pub.fase === "hecha" ? (
          <div className="my-auto flex flex-col items-center gap-3 py-2 text-center" role="status">
            {portada ? (
              <div className="relative aspect-[4/5] w-2/5 overflow-hidden rounded-lg bg-muted">
                <img src={portada.url} alt="" className="h-full w-full object-cover" />
                <CheckCircle2 className="absolute bottom-2 right-2 h-10 w-10 rounded-full bg-white text-green-700" aria-hidden="true" />
              </div>
            ) : (
              <CheckCircle2 className="h-16 w-16 text-green-700" aria-hidden="true" />
            )}
            <p className="text-2xl font-semibold">{pub.resultado.estado === "publicada" ? "¡Publicada!" : "Programada"}</p>
            {pub.resultado.estado === "programada" && pub.resultado.programadaPara && (
              <p className="text-base">
                Saldrá {nombreDia(utcAMadrid(pub.resultado.programadaPara).fecha, hoyMadrid())} a las {utcAMadrid(pub.resultado.programadaPara).hora}.
              </p>
            )}
            {pub.resultado.avisos.map((a, i) => (
              <p key={i} className="text-sm text-amber-900">
                {a}
              </p>
            ))}
            {archivo && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {archivo === "guardando" ? "Guardando tus fotos en Drive…" : archivo === "hecho" ? "Fotos guardadas en Drive." : "No se han podido guardar las fotos en Drive (la publicación está bien)."}
              </p>
            )}
          </div>
        ) : trabajando ? (
          <div className="my-auto flex flex-col items-center justify-center gap-4 py-2 text-center" role="status" aria-live="polite">
            {portada ? (
              <div className="relative aspect-[4/5] w-1/2 overflow-hidden rounded-lg bg-muted">
                <img src={portada.url} alt="" className="h-full w-full object-cover" />
                <span aria-hidden="true" className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent motion-safe:animate-brillo motion-reduce:hidden" />
              </div>
            ) : null}
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Loader2 className="h-6 w-6 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
              {progresoTexto(pub.progreso, pub.cuando)}
            </p>
            {pub.progreso?.fase === "preparando" && <Progress value={(pub.progreso.hechas / pub.progreso.total) * 100} className="h-3 w-full max-w-xs" aria-label="Imágenes preparadas" />}
            <p className="text-sm text-muted-foreground">No cierres esta pantalla.</p>
          </div>
        ) : (
          <>
            {montaje && (
              <div className="flex items-start gap-3" data-testid="resumen-publicar">
                {portada && <img src={portada.url} alt="" className="aspect-[4/5] w-28 shrink-0 rounded-lg bg-muted object-cover" />}
                <div className="min-w-0">
                  <p className="font-semibold">
                    {montaje.formato === "carrusel" ? `Carrusel de ${montaje.diapositivas.length} fotos` : montaje.formato === "story" ? "Story" : "Post de 1 foto"} · {nombreMarca}
                  </p>
                  <p className="line-clamp-5 text-sm text-muted-foreground">{caption}</p>
                </div>
              </div>
            )}
            {montaje && montaje.diapositivas.length > 1 && (
              <ol className="grid grid-cols-5 gap-1.5" aria-label="Orden del carrusel" data-testid="tira-publicar">
                {montaje.diapositivas.slice(1).map((d, i) => {
                  const f = fotosSubidasParaPrevia.find((x) => x.id === d.foto);
                  return (
                    <li key={`${d.foto}-${i}`} className="relative aspect-[4/5] overflow-hidden rounded-md bg-muted">
                      {f && <img src={f.url} alt="" className="h-full w-full object-cover" />}
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-sm font-semibold leading-tight text-white">{i + 2}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {pub.fase === "error" && (
              <p role="alert" className="rounded-md bg-destructive/10 p-3 text-base text-destructive">
                {pub.mensaje}
              </p>
            )}
            <fieldset className="mt-auto space-y-2">
              <legend className="mb-2 text-sm font-medium">Si la programas, ¿cuándo?</legend>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["hoy", "Hoy"],
                    ["manana", "Mañana"],
                    ["otro", "Otro día"],
                  ] as const
                ).map(([v, t]) => (
                  <Button
                    key={v}
                    type="button"
                    variant={dia === v ? "default" : "outline"}
                    className={MEDIO}
                    aria-pressed={dia === v}
                    onClick={() => {
                      setHoraTocada(true);
                      setDia(v);
                      if (v === "otro" && !fechaOtro) setFechaOtro(sumarDias(hoy, 2));
                    }}
                  >
                    {t}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {dia === "otro" && (
                  <div className="space-y-1">
                    <Label htmlFor="fecha-movil" className="text-sm">
                      Día
                    </Label>
                    <Input
                      id="fecha-movil"
                      type="date"
                      value={fechaOtro}
                      min={hoy}
                      max={sumarDias(hoy, MAXIMO_DIAS)}
                      onChange={(e) => {
                        setHoraTocada(true);
                        setFechaOtro(e.target.value);
                      }}
                      className="h-12 text-base"
                    />
                  </div>
                )}
                <div className={cn("space-y-1", dia !== "otro" && "col-span-2")}>
                  <Label htmlFor="hora-movil" className="text-sm">
                    Hora
                  </Label>
                  <Input
                    id="hora-movil"
                    type="time"
                    step={300}
                    value={hora}
                    onChange={(e) => {
                      // Algunos móviles mandan «» mientras se edita el reloj: no se pierde la hora.
                      if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
                      setHoraTocada(true);
                      setHora(e.target.value);
                    }}
                    className="h-12 text-base"
                  />
                </div>
              </div>
              {"error" in validacionHora && <p className="text-sm text-destructive">{validacionHora.error}</p>}
            </fieldset>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {pub.fase === "hecha" ? (
          <>
            {pub.resultado.permalink && (
              <Button asChild className={GRANDE}>
                <a href={pub.resultado.permalink} target="_blank" rel="noreferrer">
                  Ver en Instagram <ExternalLink className="ml-2 h-5 w-5" aria-hidden="true" />
                </a>
              </Button>
            )}
            <Button variant={pub.resultado.permalink ? "outline" : "default"} className={GRANDE} onClick={reiniciar}>
              Hacer otra
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              className={GRANDE}
              disabled={trabajando || !validacionHora.ok}
              onClick={() => "instante" in validacionHora && void publicarAhoraO({ tipo: "programar", instante: validacionHora.instante })}
            >
              Programar · {resumenProgramada}
            </Button>
            <Button className={GRANDE} disabled={trabajando} onClick={() => void publicarAhoraO({ tipo: "ahora" })}>
              {pub.fase === "error" ? "Reintentar: publicar ahora" : "Publicar ahora"}
            </Button>
          </>
        )}
      </div>
    </>
  );

  return (
    <div
      className={cn(incrustado ? "flex h-full min-h-0 flex-1 flex-col bg-background" : "fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background")}
      data-testid="crear-movil"
      aria-busy={trabajando || !!montando}
    >
      {cabecera}
      {bannerRed}
      {paso === "fotos" ? pasoFotos : paso === "montaje" ? pasoMontaje : pasoPublicar}

      {cartaAbierta && <ElegirCarta marca={marca} maximo={Math.max(1, huecosLibres(fotos))} listar={servicios.listarCarta} onCerrar={() => setCartaAbierta(false)} onElegir={alElegirCarta} />}

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === "salir" ? "¿Salir sin publicar?" : "¿Empezar de cero?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "salir"
                ? "Tus fotos y el texto se quedan guardados en este móvil: al volver, seguirás donde lo dejaste."
                : "Se quitan las fotos y el texto de esta publicación."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Seguir aquí</AlertDialogCancel>
            <AlertDialogAction
              className="h-12"
              onClick={() => {
                if (confirmar === "salir") onSalir?.();
                else reiniciar();
                setConfirmar(null);
              }}
            >
              {confirmar === "salir" ? "Salir" : "Empezar de cero"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
