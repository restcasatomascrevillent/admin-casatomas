import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Sparkles, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import { cn } from "@/lib/utils";
import { MARCAS, baseFotosPublica, baseRecursosPanel, construirDocumento, obtenerPlantilla, validarPieza, type DatosPieza, type MarcaId } from "@/lib/instagram";
import { MAX_FOTOS_CARRUSEL, type EstiloFeed, type FotoParaMontar } from "@/lib/instagram/montar";
import { useEstiloFeed } from "@/components/instagram/ajustes/estiloFeed";
import { ErrorInstagram, textoError } from "@/components/marketing/instagram/api";
import { MAX_CAPTION, MAX_HASHTAGS, resumenCaption } from "@/components/marketing/instagram/contadores";
import { humanizarProblema } from "@/components/marketing/instagram/pieza";
import { CLAVE_PIEZAS } from "@/components/marketing/instagram/usePiezasInstagram";
import { clavePreparada, useFotosInstagram } from "@/components/marketing/instagram/useFotosInstagram";
import { VistaPreviaPieza, type ResultadoMaquetacion } from "@/components/marketing/instagram/VistaPreviaPieza";
import { TONOS_IA, type TonoIA } from "@/components/instagram/ia/api";
import { CLAVE_PROGRAMACION } from "@/components/instagram/programar/useProgramacionInstagram";
import { AjustarAMano } from "./AjustarAMano";
import { BibliotecaFotos, MiniaturaFoto } from "./BibliotecaFotos";
import { MarcoInstagram } from "./MarcoInstagram";
import { montarPieza, type Montador } from "./montar";
import { OrdenFotos } from "./OrdenFotos";
import { PieAcciones, type Envio } from "./PieAcciones";
import { API_SERVIDOR, continuarPublicacion, prepararYPublicar, type ApiPublicacion, type PeticionPublicacion, type ResultadoPublicacion } from "./publicar";
import { usePreparadas } from "./usePreparadas";
import {
  ajusteDe,
  alternarFoto,
  aplicarMontaje,
  cambiarAjuste,
  cambiarMarca,
  captionFinal,
  estadoDesdePieza,
  estadoInicial,
  formatoEfectivo,
  formatoImagen,
  motivoNoMontar,
  motivoNoPublicar,
  moverFoto,
  normalizarHashtags,
  piezaDeImagen,
  quitarFoto,
  type EstadoCrear,
  type PiezaParaAbrir,
} from "./estado";

/** Fuentes y logos: public/instagram del propio panel. */
const BASE_RECURSOS = baseRecursosPanel();
/** Copias de las fotos (tmp/): bucket público «instagram» de Supabase. */
const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");
/** Espera entre teclear un rótulo y repintar la vista previa (ms). */
export const ESPERA_VISTA_PREVIA = 250;

function useDiferido<T>(valor: T, ms: number): T {
  const [diferido, setDiferido] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDiferido(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return diferido;
}

function aEnvioError(e: unknown): Envio {
  if (e instanceof ErrorInstagram) {
    return {
      tipo: "error",
      mensaje: e.message,
      pasos: e.comoArreglarlo ? [e.comoArreglarlo].flat().filter(Boolean) : [],
      problemas: (e.problemas ?? []).map(humanizarProblema),
    };
  }
  return { tipo: "error", mensaje: textoError(e), pasos: [], problemas: [] };
}

/** Ancho del móvil de la vista previa para que quepa en el alto disponible. */
function anchoMovil(hueco: { ancho: number; alto: number } | null, story: boolean): number {
  if (!hueco) return story ? 200 : 260;
  // Post: cabecera + acciones + texto ≈ 122 px más la imagen 4:5. Story: solo la imagen 9:16.
  const porAlto = story ? (hueco.alto * 0.92 - 12) / (16 / 9) : (hueco.alto * 0.92 - 122) / 1.25;
  return Math.round(Math.max(story ? 150 : 210, Math.min(story ? 260 : 340, porAlto, hueco.ancho - 8)));
}

export interface CrearInstagramProps {
  /** Pieza guardada que hay que abrir (borrador de campaña, calendario). Cada `clave` nueva la vuelve a abrir. */
  abrir?: { pieza: PiezaParaAbrir; clave: number } | null;
  marcaInicial?: MarcaId;
  /** «Montar con IA»: por defecto la Edge Function; en pruebas, uno simulado. */
  montar?: Montador;
  /** Render, publicar y programar: por defecto el servidor; en pruebas, una API simulada. */
  api?: ApiPublicacion;
  /** «Ver en el calendario» tras programar. */
  onVerCalendario?: () => void;
  /** Estilo del feed; por defecto, el de RRSS › Instagram › Ajustes (en pruebas, fijo). */
  estiloFeed?: EstiloFeed;
  className?: string;
}

/**
 * Instagram › Crear (rediseño del 05/11/2026), dos columnas:
 *  · «Qué publicar»: fotos (1–10, en orden y arrastrables), qué contar, tono y
 *    «Montar con IA»; debajo, plegado, «Ajustar a mano».
 *  · «Así quedará»: el móvil de Instagram con el carrusel, el resumen de la IA,
 *    el texto con hashtags y, fijos abajo, «Publicar ahora» y «Programar».
 * Sin paso de prueba: al publicar o programar se generan las imágenes y el
 * servidor publica o programa (prepararYPublicar). Historial y Conexión ya no
 * están aquí: van al Calendario y al indicador «● @cuenta» de la barra de pestañas.
 */
export function CrearInstagram({ abrir = null, marcaInicial = "casa-tomas", montar = montarPieza, api = API_SERVIDOR, onVerCalendario, estiloFeed, className }: CrearInstagramProps) {
  const qc = useQueryClient();
  const [e, setE] = useState<EstadoCrear>(() => estadoInicial(marcaInicial));
  // Estilo del feed («Solo foto» por defecto): decide la plantilla de partida y lo que pide «Montar con IA».
  const { estilo: estiloGuardado } = useEstiloFeed(estiloFeed === undefined);
  const estilo = estiloFeed ?? estiloGuardado;
  useEffect(() => {
    if (e.estilo !== estilo) setE((prev) => ({ ...prev, estilo }));
  }, [estilo, e.estilo]);
  const [actual, setActual] = useState(0);
  const [ajustarAbierto, setAjustarAbierto] = useState(false);
  const [montando, setMontando] = useState(false);
  const [errorMontar, setErrorMontar] = useState<string | null>(null);
  const [envio, setEnvio] = useState<Envio>({ tipo: "inactivo" });
  const ultima = useRef<{ peticion: PeticionPublicacion; resultado: ResultadoPublicacion } | null>(null);
  const [nuevoHashtag, setNuevoHashtag] = useState("");
  // Columna «Así quedará»: su alto visible decide el tamaño del móvil.
  const [huecoPrevia, setHuecoPrevia] = useState<HTMLDivElement | null>(null);
  const tamanoHueco = useTamanoElemento(huecoPrevia);

  const formato = formatoEfectivo(e);
  const story = formato === "story";
  const n = e.fotos.length;
  const indice = Math.min(actual, Math.max(0, n - 1));

  // Abrir una pieza que llega de fuera (borradores de campaña, calendario).
  const claveAbierta = useRef<number | null>(null);
  useEffect(() => {
    if (!abrir || claveAbierta.current === abrir.clave) return;
    claveAbierta.current = abrir.clave;
    setE(estadoDesdePieza(abrir.pieza));
    setActual(0);
    setEnvio({ tipo: "inactivo" });
    setErrorMontar(null);
  }, [abrir]);

  // Biblioteca y copias de las fotos elegidas en el bucket.
  const { catalogo: catalogoBase } = useFotosInstagram(e.marca);
  const preparadas = usePreparadas(e.marca, e.fotos, catalogoBase);
  const catalogo = useMemo(() => catalogoBase.map((f) => preparadas.listas[f.id]?.foto ?? f), [catalogoBase, preparadas.listas]);

  // Pieza (JSON del motor) de cada imagen y sus problemas.
  const piezas = useMemo(() => e.fotos.map((f) => piezaDeImagen(e, f)), [e]);
  const [medidas, setMedidas] = useState<Record<string, ResultadoMaquetacion>>({});
  const problemasPorImagen = useMemo(
    () =>
      piezas.map((p, i) => {
        const v = validarPieza(p, { fotos: catalogo });
        const lista = "problemas" in v ? v.problemas : [];
        const medida = medidas[`${e.fotos[i]}|${JSON.stringify(p)}`];
        return [...new Set([...lista, ...(medida?.errores ?? [])])].map(humanizarProblema);
      }),
    [piezas, catalogo, medidas, e.fotos],
  );

  // Documento de la imagen que se ve (con un respiro al teclear).
  const fotoActual = e.fotos[indice];
  // ¿La imagen que se ve va con «Solo foto» (sin texto encima)?
  const sinTextoActual = !!fotoActual && obtenerPlantilla(ajusteDe(e, fotoActual).plantilla)?.sinTexto === true;
  const firmaActual = fotoActual ? JSON.stringify(piezas[indice]) : "";
  const firmaDiferida = useDiferido(firmaActual, ESPERA_VISTA_PREVIA);
  const { documento, motivoSinVista } = useMemo(() => {
    if (!fotoActual || !e.montado || !firmaDiferida) return { documento: null, motivoSinVista: null };
    const lista = preparadas.listas[fotoActual];
    if (!lista) {
      if (preparadas.errores[fotoActual]) return { documento: null, motivoSinVista: `No se ha podido preparar la foto: ${preparadas.errores[fotoActual].message}` };
      return { documento: null, motivoSinVista: "Preparando la foto…" };
    }
    const p = JSON.parse(firmaDiferida) as Partial<DatosPieza>;
    const v = validarPieza(p, { fotos: catalogo });
    const datos = "datos" in v ? v.datos : ({ ...p, titular: p.titular ?? "" } as DatosPieza);
    try {
      return { documento: construirDocumento(datos, { baseRecursos: BASE_RECURSOS, baseFotos: BASE_FOTOS, fotos: catalogo }), motivoSinVista: null };
    } catch (err) {
      return { documento: null, motivoSinVista: (err as Error).message };
    }
  }, [fotoActual, e.montado, firmaDiferida, preparadas.listas, preparadas.errores, catalogo]);

  const alMaquetar = useCallback(
    (r: ResultadoMaquetacion) => {
      if (!fotoActual || firmaDiferida !== firmaActual) return;
      setMedidas((m) => ({ ...m, [`${fotoActual}|${firmaActual}`]: r }));
    },
    [fotoActual, firmaActual, firmaDiferida],
  );
  const avisosImagen = medidas[`${fotoActual}|${firmaActual}`]?.avisos ?? [];

  const textoFinal = captionFinal(e, formato);
  const resumenTexto = resumenCaption(textoFinal);
  const trabajando = envio.tipo === "trabajando";
  const motivo = motivoNoPublicar({
    fotos: n,
    montado: e.montado,
    problemasPorImagen,
    problemasTexto: resumenTexto.problemas,
    preparando: false,
    ocupado: trabajando,
  });
  const motivoMontar = motivoNoMontar(n);

  const cambiar = (f: (prev: EstadoCrear) => EstadoCrear) => {
    setE(f);
    // Un error viejo deja de valer en cuanto se cambia algo.
    setEnvio((v) => (v.tipo === "error" ? { tipo: "inactivo" } : v));
  };

  const montarConIA = async () => {
    setMontando(true);
    setErrorMontar(null);
    try {
      const listas = await preparadas.prepararTodas();
      const fotos: FotoParaMontar[] = e.fotos.map((id) => ({
        id,
        url: listas[id].preparada.url,
        ancho: listas[id].preparada.ancho || null,
        alto: listas[id].preparada.alto || null,
      }));
      const r = await montar({
        marca: e.marca,
        fotos,
        formato: n === 1 && e.formatoUnaFoto === "story" ? "story" : "auto",
        indicacion: e.indicacion.trim() || undefined,
        tono: e.tono,
        estilo,
      });
      setE((prev) => aplicarMontaje(prev, r));
      setActual(0);
      setEnvio({ tipo: "inactivo" });
    } catch (err) {
      setErrorMontar(textoError(err));
    } finally {
      setMontando(false);
    }
  };

  const tras = (r: ResultadoPublicacion, peticion: PeticionPublicacion) => {
    ultima.current = { peticion, resultado: r };
    setEnvio({ tipo: "hecho", resultado: r });
    if (r.estado === "publicada") {
      // El servidor borra las copias tmp/ al publicar: se marcan caducadas (sin pedirlas ya,
      // que la vista previa de lo publicado sigue en pantalla) y la próxima vez se vuelven a preparar.
      for (const id of e.fotos) void qc.invalidateQueries({ queryKey: clavePreparada(id), refetchType: "none" });
    }
    void qc.invalidateQueries({ queryKey: CLAVE_PIEZAS });
    void qc.invalidateQueries({ queryKey: CLAVE_PROGRAMACION });
  };

  const enviar = async (programarPara: Date | null) => {
    setEnvio({ tipo: "trabajando", progreso: { fase: "imagenes", hechas: 0, total: n } });
    try {
      const listas = await preparadas.prepararTodas();
      const peticion: PeticionPublicacion = {
        marca: e.marca,
        formato,
        diapositivas: e.fotos.map((f, i) => ({
          pieza: piezas[i],
          fotoPreparada: listas[f].preparada,
          altText: ajusteDe(e, f).altText,
          piezaId: i === 0 ? e.piezaId : null,
        })),
        caption: textoFinal,
        fotosTmp: e.fotos.map((f) => listas[f].ruta),
        programarPara,
      };
      const r = await prepararYPublicar(peticion, { api, onProgreso: (p) => setEnvio({ tipo: "trabajando", progreso: p }) });
      tras(r, peticion);
    } catch (err) {
      setEnvio(aEnvioError(err));
    }
  };

  const continuar = async (confirmarConflicto: boolean) => {
    const u = ultima.current;
    if (!u) return;
    try {
      const r = await continuarPublicacion(u.peticion, u.resultado.piezaIds, {
        api,
        contenedorId: u.resultado.contenedorId,
        confirmarConflicto,
        onProgreso: (p) => setEnvio({ tipo: "trabajando", progreso: p }),
      });
      tras(r, u.peticion);
    } catch (err) {
      setEnvio(aEnvioError(err));
    }
  };

  const crearOtra = () => {
    setE((prev) => ({ ...estadoInicial(prev.marca), tono: prev.tono }));
    setActual(0);
    setEnvio({ tipo: "inactivo" });
    setErrorMontar(null);
    ultima.current = null;
  };

  const anadirHashtag = () => {
    const nuevos = normalizarHashtags([...e.hashtags, ...nuevoHashtag.split(/[\s,]+/)]);
    cambiar((prev) => ({ ...prev, hashtags: nuevos }));
    setNuevoHashtag("");
  };

  const ancho = anchoMovil(tamanoHueco, story);
  const queSePublica = formato === "carrusel" ? `carrusel de ${n} imágenes` : story ? "story" : "post de una imagen";

  return (
    <div className={cn("grid gap-3 md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]", className)} data-testid="crear-instagram">
      {/* ── Qué publicar ─────────────────────────────────────────────── */}
      <section aria-labelledby="titulo-que-publicar" className="flex min-h-0 flex-col rounded-lg border bg-card">
        <h2 id="titulo-que-publicar" className="shrink-0 border-b px-3 py-2 text-base font-semibold">
          Qué publicar
        </h2>
        {/* `relative`: lo posicionado dentro (el <select> oculto de Radix) se queda en la columna y no alarga la página. */}
        <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pt-3">
          <fieldset className="relative space-y-2">
            <legend className="text-sm font-medium">1. Elige las fotos</legend>
            <span className="absolute right-0 top-0 text-xs tabular-nums text-muted-foreground" data-testid="contador-fotos" aria-live="polite">
              {n} de {MAX_FOTOS_CARRUSEL}
            </span>
            <p className="text-xs text-muted-foreground">Una para un post; de 2 a 10 para un carrusel. Toca para elegir o quitar.</p>
            <BibliotecaFotos
              marca={e.marca}
              formato={formatoImagen(formato)}
              elegidas={e.fotos}
              onAlternar={(id) => cambiar((prev) => alternarFoto(prev, id))}
              onSubida={(id) => cambiar((prev) => (prev.fotos.includes(id) ? prev : alternarFoto(prev, id)))}
              baseFotos={BASE_FOTOS}
            />
            {n > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">{n > 1 ? "Así se publican. Arrástralas para cambiar el orden; la primera es la portada." : "Foto elegida."}</p>
                <OrdenFotos
                  ids={e.fotos}
                  catalogo={catalogo}
                  baseFotos={BASE_FOTOS}
                  actual={indice}
                  onVer={setActual}
                  onMover={(desde, hasta) => {
                    cambiar((prev) => moverFoto(prev, desde, hasta));
                    setActual(hasta);
                  }}
                  onQuitar={(id) => cambiar((prev) => quitarFoto(prev, id))}
                />
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="crear-indicacion" className="text-sm font-medium">
              2. ¿Qué quieres contar? <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="crear-indicacion"
              rows={2}
              maxLength={500}
              value={e.indicacion}
              onChange={(ev) => setE((prev) => ({ ...prev, indicacion: ev.target.value }))}
              placeholder="Por ejemplo: «ha llegado marisco fresco para el fin de semana»"
              className="text-sm"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span id="crear-tono" className="text-sm">
                Tono
              </span>
              <SelectorSubrayado
                aria-labelledby="crear-tono"
                valor={e.tono}
                onCambio={(v) => setE((prev) => ({ ...prev, tono: v as TonoIA }))}
                opciones={TONOS_IA.map((t) => ({ valor: t.id, etiqueta: t.etiqueta }))}
              />
            </div>
          </div>

          {/* Pegado abajo mientras se desplaza la columna: siempre a mano. */}
          <div className="sticky bottom-0 z-10 -mx-3 space-y-1 border-t bg-card px-3 pb-3 pt-2">
            <Button type="button" className="min-h-11 w-full" disabled={!!motivoMontar || montando || trabajando} onClick={() => void montarConIA()}>
              {montando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
              {montando ? "Montando la publicación…" : e.montado && e.resumen ? "Volver a montar con IA" : "Montar con IA"}
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="ayuda-montar">
              {motivoMontar ?? (montando ? "La IA está eligiendo el orden, los rótulos y el texto." : "La IA elige el orden, la plantilla, los rótulos y el texto. Luego puedes retocarlo.")}
            </p>
            {errorMontar && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {errorMontar}
              </p>
            )}
          </div>

          <div className="pb-3">
            <AjustarAMano
              estado={e}
              abierto={ajustarAbierto}
              onAbierto={setAjustarAbierto}
              actual={indice}
              onActual={setActual}
              onMarca={(m) => {
                cambiar((prev) => cambiarMarca(prev, m));
                setActual(0);
              }}
              onFormatoUnaFoto={(f) => cambiar((prev) => ({ ...prev, formatoUnaFoto: f, montado: prev.fotos.length > 0 || prev.montado }))}
              onAjuste={(foto, c) => cambiar((prev) => cambiarAjuste(prev, foto, c))}
            />
          </div>
        </div>
      </section>

      {/* ── Así quedará ──────────────────────────────────────────────── */}
      <section aria-labelledby="titulo-asi-quedara" className="flex min-h-0 flex-col rounded-lg border bg-card">
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
          <h2 id="titulo-asi-quedara" className="text-base font-semibold">
            Así quedará
          </h2>
          {n > 0 && (
            <span className="text-xs text-muted-foreground">
              {formato === "carrusel" ? `Carrusel · ${n} imágenes` : story ? "Story 9:16" : "Post 4:5"}
              {sinTextoActual ? " · solo foto" : ""}
            </span>
          )}
        </div>
        <div ref={setHuecoPrevia} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
          <div data-testid="hueco-movil">
            <MarcoInstagram marca={e.marca} formato={formato} total={Math.max(1, n)} actual={indice} onActual={setActual} caption={textoFinal} ancho={ancho}>
              {!fotoActual ? (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-600">Elige las fotos a la izquierda y aquí verás la publicación.</div>
              ) : e.montado ? (
                <VistaPreviaPieza
                  documento={documento}
                  formato={formatoImagen(formato)}
                  onMaquetacion={alMaquetar}
                  vacio={motivoSinVista ?? undefined}
                  className="absolute inset-0"
                />
              ) : (
                <>
                  {catalogo.find((f) => f.id === fotoActual) && <MiniaturaFoto foto={catalogo.find((f) => f.id === fotoActual)!} baseFotos={BASE_FOTOS} />}
                  <p className="absolute inset-x-2 bottom-2 rounded-md bg-white/90 p-2 text-center text-xs text-neutral-800 shadow">
                    {sinTextoActual ? "Irá sin texto encima. Pulsa «Montar con IA» para el texto de la publicación." : "Pulsa «Montar con IA» para ver la publicación terminada."}
                  </p>
                </>
              )}
            </MarcoInstagram>
          </div>
          {sinTextoActual && e.montado && (
            <p className="text-xs text-muted-foreground" data-testid="aviso-solo-foto">
              Sin texto encima, como vuestro feed: el nombre del plato y el gancho van en el texto de la publicación.
            </p>
          )}

          {e.montado && (problemasPorImagen[indice]?.length ?? 0) > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" aria-live="polite" data-testid="problemas-imagen">
              {problemasPorImagen[indice].map((p) => (
                <li key={p} className="flex items-start gap-1.5">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {n > 1 ? `Imagen ${indice + 1}: ` : ""}
                    {p}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {[...avisosImagen.map(humanizarProblema), ...e.avisos].length > 0 && (
            <ul className="space-y-1 text-xs text-amber-800">
              {[...new Set([...avisosImagen.map(humanizarProblema), ...e.avisos])].map((a) => (
                <li key={a} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          {e.resumen && (
            <div className="flex gap-2 rounded-md bg-muted/60 p-2 text-sm" data-testid="resumen-ia">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p>{e.resumen}</p>
                <p className="text-xs text-muted-foreground">¿No es eso? Cuéntalo en «¿Qué quieres contar?» y vuelve a montar.</p>
              </div>
            </div>
          )}

          {story ? (
            <p className="text-xs text-muted-foreground">Las stories no llevan texto: Instagram no lo admite al publicar desde aquí.</p>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="crear-caption">Texto de la publicación</Label>
                  <span className={cn("text-xs tabular-nums text-muted-foreground", resumenTexto.caracteres > MAX_CAPTION && "font-medium text-destructive")}>
                    {resumenTexto.caracteres}/{MAX_CAPTION}
                  </span>
                </div>
                <Textarea
                  id="crear-caption"
                  rows={4}
                  value={e.caption}
                  onChange={(ev) => cambiar((prev) => ({ ...prev, caption: ev.target.value }))}
                  placeholder="Lo escribe la IA al montar. También puedes escribirlo tú."
                  aria-invalid={resumenTexto.problemas.length > 0 || undefined}
                  className="resize-y text-sm"
                />
                {resumenTexto.problemas.map((p) => (
                  <p key={p} className="text-xs text-destructive">
                    {p}
                  </p>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span id="crear-hashtags" className="text-sm font-medium">
                    Hashtags
                  </span>
                  <span className={cn("text-xs tabular-nums text-muted-foreground", e.hashtags.length > MAX_HASHTAGS && "font-medium text-destructive")}>
                    {e.hashtags.length}/{MAX_HASHTAGS}
                  </span>
                </div>
                <ul aria-labelledby="crear-hashtags" className="flex flex-wrap gap-1.5" data-testid="hashtags">
                  {e.hashtags.map((h) => (
                    <li key={h} className="inline-flex items-center rounded-full border bg-muted/50 pl-2.5 text-sm">
                      {h}
                      <button
                        type="button"
                        aria-label={`Quitar ${h}`}
                        onClick={() => cambiar((prev) => ({ ...prev, hashtags: prev.hashtags.filter((x) => x !== h) }))}
                        className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="flex gap-1.5"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    anadirHashtag();
                  }}
                >
                  <Input
                    aria-label="Añadir hashtag"
                    placeholder="Añadir hashtag"
                    value={nuevoHashtag}
                    onChange={(ev) => setNuevoHashtag(ev.target.value)}
                    className="h-9 pointer-coarse:min-h-11"
                  />
                  <Button type="submit" variant="outline" className="h-9 pointer-coarse:min-h-11" disabled={!nuevoHashtag.trim()}>
                    Añadir
                  </Button>
                </form>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-card p-3" data-testid="pie-acciones">
          <PieAcciones
            motivo={motivo}
            horaSugerida={e.horaSugerida}
            queSePublica={queSePublica}
            nombreMarca={MARCAS[e.marca]?.nombre ?? e.marca}
            envio={envio}
            onPublicar={() => void enviar(null)}
            onProgramar={(instante) => void enviar(instante)}
            onReintentar={() => void continuar(false)}
            onConfirmarConflicto={() => void continuar(true)}
            onOtra={crearOtra}
            onVerCalendario={onVerCalendario}
          />
        </div>
      </section>
    </div>
  );
}
