import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import type { Sustituible } from "@/lib/facturas/documentoLargo";
import { useCorreccionDocumento, usePermisosFacturas } from "@/hooks/usePermisosFacturas";

/** Un documento recién subido que ya existía. */
export interface AvisoDuplicado {
  /** Nombre del fichero que se acaba de subir. */
  nombre: string;
  /** Id del documento que YA estaba (en `facturas`). */
  facturaId?: number;
  tipo: "factura" | "albaran" | null;
  /** Queda en «Pendientes de decidir» (se puede sustituir). */
  pendiente: boolean;
  /** Si es sustituible, el pop-up ofrece decidir aquí mismo. */
  sustituible?: Sustituible | null;
  /** Miniatura de la foto NUEVA (la recién subida), si el navegador aún la tiene. */
  preview?: string;
}

interface Existente {
  numero_documento: string | null;
  proveedor: string | null;
  fecha: string | null;
  total: number | null;
  tipo: string | null;
  drive_url: string | null;
  archivo_path: string | null;
}

interface Props {
  aviso: AvisoDuplicado;
  /** Cuántos avisos más esperan detrás de este. */
  restantes: number;
  onCerrar: () => void;
  onVerFicha: (id: number) => void;
  /** «Decidir» (solo si es pendiente pero no sustituible, p. ej. sin datos): lleva a Cargar. */
  onDecidir: () => void;
  /** «Sustituir por la nueva»: abre la confirmación de sustitución. */
  onSustituir?: (s: Sustituible) => void;
  /** «Dejar la que hay»: descarta el pendiente. */
  onDejar?: (s: Sustituible) => void;
}

/** Botón con la foto del documento ya guardado (lee drive_url/archivo_path por id). */
export function FotoExistente({ id }: { id: number }) {
  const { data } = useExistente(id);
  return (
    <BotonOriginal
      driveUrl={data?.drive_url ?? null}
      archivoPath={data?.archivo_path ?? null}
      variant="mobile"
      label="Ver la foto del que ya está"
    />
  );
}

function useExistente(id: number | undefined) {
  return useQuery({
    queryKey: ["aviso_duplicado_existente", id],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async (): Promise<Existente | null> => {
      const { data, error } = await supabase
        .from("facturas")
        .select("numero_documento, proveedor, fecha, total, tipo, drive_url, archivo_path")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      const fila = Array.isArray(data) ? data[0] : data;
      return (fila as Existente | null) ?? null;
    },
  });
}

/** «2026-10-01» → «01/10/2026». */
const fechaEs = (f: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10).split("-").reverse().join("/") : f);

const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/**
 * Pop-up modal cuando se sube una factura o un albarán que ya estaba subido:
 * enseña los datos del existente y un enlace a SU foto para poder comprobarlo.
 */
export function AvisoDuplicadoDialog({ aviso, restantes, onCerrar, onVerFicha, onDecidir, onSustituir, onDejar }: Props) {
  // Permisos (06/11/2026): sustituir aquí, con «Editar» o, con «Facturas · Subida», si la que
  // ya estaba la subió él; «Ver ficha» (Compras), solo para quien consulta Facturas.
  const { consultar } = usePermisosFacturas();
  const { puede: puedeSustituir, comprobando } = useCorreccionDocumento(aviso.facturaId);
  const s = aviso.sustituible && onSustituir && puedeSustituir ? aviso.sustituible : null;
  const { data: existente, isLoading } = useExistente(aviso.facturaId);

  const esAlbaran = (existente?.tipo ?? aviso.tipo ?? "").toString().toLowerCase().startsWith("albar");
  const sinTipo = aviso.tipo === null && !existente;
  const titulo = sinTipo
    ? "Este documento ya estaba subido"
    : esAlbaran
    ? "Este albarán ya estaba subido"
    : "Esta factura ya estaba subida";
  // Concordancia con el título: «la factura … guardada / otra», «el albarán … guardado / otro».
  const fem = !sinTipo && !esAlbaran;

  const datos: [string, string][] = existente
    ? ([
        ["Número", existente.numero_documento],
        ["Proveedor", existente.proveedor],
        ["Fecha", fechaEs(existente.fecha)],
        ["Total", existente.total === null || existente.total === undefined ? null : eur(Number(existente.total))],
      ].filter(([, v]) => !!v) as [string, string][])
    : [];

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Has subido «{aviso.nombre}», pero ya estaba {fem ? "guardada" : "guardado"}. No se ha creado{" "}
            {fem ? "otra" : "otro"}.
            {s ? (fem ? " ¿Quieres reemplazar la que hay por la nueva?" : " ¿Quieres reemplazar el que hay por el nuevo?") : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Buscando el que ya estaba…</p>
        ) : datos.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {datos.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {consultar
              ? "No se han podido leer los datos del que ya estaba."
              : "No puedes ver los datos del que ya estaba: lo subió otra persona."}
          </p>
        )}

        {aviso.preview && (
          <figure className="space-y-1">
            <img src={aviso.preview} alt={`Foto nueva: ${aviso.nombre}`} className="max-h-40 rounded-md border object-contain" />
            <figcaption className="text-xs text-muted-foreground">La que acabas de subir</figcaption>
          </figure>
        )}
        {aviso.pendiente && !s && !comprobando && (
          <p className="text-sm">
            {aviso.sustituible && onSustituir && !puedeSustituir
              ? "El que ya estaba lo subió otra persona: sustituirlo lo hace quien tiene «Editar» en Facturas. Queda en «Pendientes de decidir» por si prefieres descartar el nuevo."
              : "Queda en «Pendientes de decidir» por si quieres sustituir el que hay."}
          </p>
        )}
        {restantes > 0 && (
          <p className="text-sm text-muted-foreground">
            Hay {restantes} aviso{restantes === 1 ? "" : "s"} más de documentos repetidos.
          </p>
        )}

        {/* Dos filas que se parten solas (hasta 5 botones): nada se sale de la
            pantalla a 1180, 820 ni 390 px. Arriba, comprobar el que ya está;
            abajo, la decisión. */}
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-start sm:space-x-0">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <BotonOriginal
                driveUrl={existente?.drive_url ?? null}
                archivoPath={existente?.archivo_path ?? null}
                variant="mobile"
                label="Ver la foto del que ya está"
              />
            </div>
            {aviso.facturaId && consultar ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 basis-32"
                onClick={() => onVerFicha(aviso.facturaId!)}
              >
                Ver ficha
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {s ? (
              <>
                <Button type="button" variant="ghost" className="h-11 flex-1 basis-28 text-muted-foreground sm:flex-none" onClick={onCerrar}>
                  Decidir luego
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1 basis-36 sm:flex-none" onClick={() => onDejar?.(s)}>
                  Dejar la que hay
                </Button>
                <Button type="button" className="h-11 flex-1 basis-40 sm:flex-none" onClick={() => onSustituir?.(s)}>
                  Sustituir por la nueva
                </Button>
              </>
            ) : (
              <>
                {aviso.pendiente && (
                  <Button type="button" variant="outline" className="h-11 flex-1 basis-28 sm:flex-none" onClick={onDecidir}>
                    Decidir
                  </Button>
                )}
                <Button type="button" className="h-11 flex-1 basis-28 sm:flex-none" onClick={onCerrar}>
                  Cerrar
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
