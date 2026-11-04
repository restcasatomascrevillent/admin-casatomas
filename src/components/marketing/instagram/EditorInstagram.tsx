import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, XCircle } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { cn } from "@/lib/utils";
import {
  EJEMPLOS,
  FORMATOS,
  baseFotosPublica,
  baseRecursosPanel,
  construirDocumento,
  obtenerPlantilla,
  plantillasDe,
  validarPieza,
  type CampoPieza,
  type DatosPieza,
  type FormatoId,
  type MarcaId,
} from "@/lib/instagram";
import { AccionesPieza, SERVIDOR_VACIO, type ServidorPieza } from "./AccionesPieza";
import { ConexionInstagram } from "./ConexionInstagram";
import { FormularioPieza, NOMBRE_FORMATO } from "./FormularioPieza";
import { HistorialPiezas, urlImagenPieza } from "./HistorialPiezas";
import { borradorDesdeDatos, borradorVacio, camposConProblemas, humanizarProblema, piezaDesdeBorrador, type Borrador } from "./pieza";
import { CLAVE_PIEZAS, type PiezaInstagram } from "./usePiezasInstagram";
import { useFotosInstagram } from "./useFotosInstagram";
import { VistaPreviaPieza, type ResultadoMaquetacion } from "./VistaPreviaPieza";

/** Espera entre teclear y repintar la vista previa (ms). */
export const ESPERA_VISTA_PREVIA = 250;

/** Fuentes y logos: public/instagram del propio panel (relativa: vale en el iframe srcdoc). */
const BASE_RECURSOS = baseRecursosPanel();
/** Fotos de la biblioteca y JPEG generados: bucket público «instagram» de Supabase. */
const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");

function useDiferido<T>(valor: T, ms: number): T {
  const [diferido, setDiferido] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDiferido(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return diferido;
}

/** Ejemplos de una plantilla, primero los del formato pedido. */
function ejemplosPara(plantilla: string, formato: FormatoId) {
  const todos = EJEMPLOS.filter((e) => e.json.plantilla === plantilla);
  return [...todos.filter((e) => e.json.formato === formato), ...todos.filter((e) => e.json.formato !== formato)];
}

function borradorInicial(): Borrador {
  const marca: MarcaId = "casa-tomas";
  const plantilla = plantillasDe(marca)[0];
  const base = borradorVacio(marca, plantilla?.id ?? "", plantilla?.formatos[0] ?? "post");
  const ejemplo = plantilla ? ejemplosPara(plantilla.id, base.formato)[0] : undefined;
  return ejemplo ? borradorDesdeDatos(ejemplo.json as never, base) : base;
}

/**
 * Marketing › Instagram: formulario (izquierda), vista previa en vivo (centro)
 * y publicar / historial / conexión (derecha). Desde `lg` las tres columnas
 * llenan el alto de la pestaña y cada una hace su propio scroll (regla del
 * dueño: la página no hace scroll). Por debajo van apiladas y desplaza la pestaña.
 */
export function EditorInstagram() {
  const qc = useQueryClient();
  const [borrador, setBorrador] = useState<Borrador>(borradorInicial);
  const [servidor, setServidor] = useState<ServidorPieza>(SERVIDOR_VACIO);
  const [caption, setCaption] = useState("");
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [lado, setLado] = useState("publicar");
  const [indiceEjemplo, setIndiceEjemplo] = useState(1);
  const [maquetacion, setMaquetacion] = useState<(ResultadoMaquetacion & { documento: string }) | null>(null);

  const plantilla = obtenerPlantilla(borrador.plantilla);
  const pieza = useMemo(() => piezaDesdeBorrador(borrador, plantilla), [borrador, plantilla]);
  const firma = useMemo(() => JSON.stringify(pieza), [pieza]);
  const firmaDiferida = useDiferido(firma, ESPERA_VISTA_PREVIA);

  // Catálogo de fotos = estáticas + subidas desde el panel (instagram_fotos).
  const { catalogo } = useFotosInstagram(borrador.marca);
  const validacion = useMemo(() => validarPieza(JSON.parse(firmaDiferida), { fotos: catalogo }), [firmaDiferida, catalogo]);

  // El documento se pinta aunque la pieza tenga problemas (titular largo, foto que no
  // vale…): así se ve el desborde. Solo si no se puede construir (falta la foto) no hay vista.
  const { documento, motivoSinVista } = useMemo(() => {
    const p = JSON.parse(firmaDiferida) as Partial<DatosPieza>;
    const datos = "datos" in validacion ? validacion.datos : ({ ...p, titular: p.titular ?? "" } as DatosPieza);
    try {
      return { documento: construirDocumento(datos, { baseRecursos: BASE_RECURSOS, baseFotos: BASE_FOTOS, fotos: catalogo }), motivoSinVista: null };
    } catch (e) {
      const falta = (obtenerPlantilla(String(p.plantilla))?.obligatorios ?? []).includes("foto") && !p.foto;
      return { documento: null, motivoSinVista: falta ? "Elige una foto para ver la pieza." : (e as Error).message };
    }
  }, [firmaDiferida, validacion, catalogo]);

  const alMaquetar = useCallback((r: ResultadoMaquetacion) => setMaquetacion(documento ? { ...r, documento } : null), [documento]);
  const maquetacionAlDia = maquetacion && maquetacion.documento === documento ? maquetacion : null;
  // Mientras se teclea (firma ≠ diferida) o se mide, no se puede generar.
  const midiendo = firma !== firmaDiferida || (!!documento && !maquetacionAlDia);

  const problemas = useMemo(() => {
    const lista = [...("problemas" in validacion ? validacion.problemas : []), ...(maquetacionAlDia?.errores ?? [])];
    return [...new Set(lista)];
  }, [validacion, maquetacionAlDia]);
  const avisos = maquetacionAlDia?.avisos ?? [];
  const conProblema = useMemo<Set<CampoPieza>>(() => camposConProblemas(problemas), [problemas]);

  const cambiar = (cambio: Partial<Borrador>) => setBorrador((b) => ({ ...b, ...cambio }));

  const cambiarMarca = (marca: MarcaId) => {
    if (marca === borrador.marca) return;
    const p = plantillasDe(marca)[0];
    setBorrador((b) => ({
      ...b,
      marca,
      plantilla: p?.id ?? "",
      formato: p && !p.formatos.includes(b.formato) ? p.formatos[0] : b.formato,
      foto: "", // las fotos son de una marca
    }));
    setIndiceEjemplo(0);
  };

  const cambiarPlantilla = (id: string) => {
    const p = obtenerPlantilla(id);
    setBorrador((b) => ({ ...b, plantilla: id, formato: p && !p.formatos.includes(b.formato) ? p.formatos[0] : b.formato }));
    setIndiceEjemplo(0);
  };

  const ejemplos = ejemplosPara(borrador.plantilla, borrador.formato);
  const cargarEjemplo = () => {
    if (!ejemplos.length) return;
    const e = ejemplos[indiceEjemplo % ejemplos.length];
    setBorrador((b) => borradorDesdeDatos(e.json as never, b));
    setIndiceEjemplo((i) => i + 1);
  };

  const abrirPieza = (p: PiezaInstagram) => {
    const base = borradorVacio(p.marca as MarcaId, p.plantilla, p.formato as FormatoId);
    const b = borradorDesdeDatos({ ...(p.datos ?? {}), marca: p.marca, plantilla: p.plantilla, formato: p.formato } as never, base);
    setBorrador(b);
    setCaption(p.caption ?? "");
    const firmaPieza = JSON.stringify(piezaDesdeBorrador(b, obtenerPlantilla(b.plantilla)));
    setServidor({
      ...SERVIDOR_VACIO,
      id: p.id,
      estado: p.estado,
      urlJpeg: urlImagenPieza(BASE_FOTOS, p),
      firma: p.imagen_ruta ? firmaPieza : null,
      contenedorId: p.contenedor_id,
      permalink: p.permalink,
      captionProbado: p.estado === "prueba_ok" ? (p.formato === "story" ? "" : p.caption ?? "") : null,
    });
    setLado("publicar");
  };

  const nuevaPieza = () => {
    setServidor(SERVIDOR_VACIO);
    setCaption("");
  };

  const { ancho, alto } = FORMATOS[borrador.formato];

  return (
    <div
      className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(15rem,17.5rem)] lg:grid-rows-[minmax(0,1fr)]"
      data-testid="editor-instagram"
    >
      {/* Formulario */}
      <section aria-label="Contenido de la pieza" className="rounded-lg border bg-card p-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
        <FormularioPieza
          borrador={borrador}
          plantilla={plantilla}
          onCambio={cambiar}
          onMarca={cambiarMarca}
          onPlantilla={cambiarPlantilla}
          onCargarEjemplo={cargarEjemplo}
          hayEjemplos={ejemplos.length > 0}
          conProblema={conProblema}
          baseFotos={BASE_FOTOS}
        />
      </section>

      {/* Vista previa */}
      {/* En el móvil la vista previa va PRIMERO: es lo que se está haciendo. */}
      <section aria-label="Vista previa" className="order-first flex min-h-0 flex-col gap-2 lg:order-none">
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{plantilla?.nombre ?? "Sin plantilla"}</span> · {NOMBRE_FORMATO[borrador.formato]} · {ancho}×{alto}
          </span>
          {servidor.id && (
            <button type="button" onClick={nuevaPieza} className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Empezar una pieza nueva con esto
            </button>
          )}
        </div>
        <VistaPreviaPieza
          documento={documento}
          formato={borrador.formato}
          onMaquetacion={alMaquetar}
          vacio={motivoSinVista ?? undefined}
          className="h-[min(55vh,30rem)] lg:h-auto lg:flex-1"
        />
        <div aria-live="polite" className="max-h-40 shrink-0 space-y-1 overflow-y-auto overscroll-contain" data-testid="problemas-pieza">
          {problemas.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
              {problemas.map((p) => (
                <li key={p} className="flex items-start gap-1.5">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{humanizarProblema(p)}</span>
                </li>
              ))}
            </ul>
          )}
          {avisos.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-700">
              {avisos.map((a) => (
                <li key={a} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{humanizarProblema(a)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Publicar · Historial · Conexión */}
      <Tabs value={lado} onValueChange={setLado} className="flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-3">
        <ChipsSubnivel
          className="flex-wrap gap-1 [&>button]:px-3"
          chips={[
            { valor: "publicar", etiqueta: "Publicar" },
            { valor: "historial", etiqueta: "Historial" },
            { valor: "conexion", etiqueta: "Conexión" },
          ]}
        />
        <TabsContent value="publicar" className={cn(CONTENIDO_LADO)}>
          <AccionesPieza
            pieza={pieza}
            firma={firma}
            formato={borrador.formato}
            bloqueada={problemas.length > 0 || !documento}
            midiendo={midiendo}
            servidor={servidor}
            onServidor={setServidor}
            caption={caption}
            onCaption={setCaption}
            cuenta={cuenta}
            onCuenta={setCuenta}
            onCambioServidor={() => void qc.invalidateQueries({ queryKey: CLAVE_PIEZAS })}
          />
        </TabsContent>
        <TabsContent value="historial" className={CONTENIDO_LADO}>
          <HistorialPiezas baseFotos={BASE_FOTOS} actual={servidor.id} onAbrir={abrirPieza} />
        </TabsContent>
        {/* forceMount: el resultado de «Comprobar» no se pierde al cambiar de chip. */}
        <TabsContent value="conexion" forceMount className={cn(CONTENIDO_LADO, lado !== "conexion" && "hidden")}>
          <ConexionInstagram onEstado={(e) => setCuenta(e.cuenta?.username ?? null)} className="border-0 p-0" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const CONTENIDO_LADO = "mt-0 min-h-0 flex-1 data-[state=inactive]:hidden lg:overflow-y-auto lg:overscroll-contain lg:pr-1";
