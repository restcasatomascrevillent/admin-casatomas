import { useState, type ReactNode } from "react";
import { CheckCircle, ClipboardCheck, Loader2, SquarePen, Star, ShieldBan } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { tituloHoja } from "@/lib/reservas/libroReservas";
import { etiquetaCanal } from "@/lib/reservas/etiquetaCanal";
import { textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { ElDiaDeLaReserva } from "./ElDiaDeLaReserva";
import { ComoSeHizoReserva, type ReservaConOrigen } from "./ComoSeHizoReserva";

// ============================================================================
// ACEPTAR, CONFIRMAR O VERIFICAR CON EL DÍA A LA VISTA (10/11/2026, petición
// del dueño: «para aceptar cualquier reserva o verificarla, se abre el pop-up
// para ver el día, lo que hay ese día y ver si se puede. Y se ven los datos de
// la persona completos»).
//
// La acción principal de la fila de la Lista («Aceptar», «Confirmar») y
// «Verificar» de «Más» ya no actúan directamente: abren este diálogo con
//   · arriba, los DATOS completos de la persona y la reserva, grandes;
//   · debajo, EL DÍA (`ElDiaDeLaReserva`): aforo por servicio, avisos de
//     cierre/bloqueo/aforo y las reservas del día con esta resaltada;
//   · abajo, la acción en verde, «Editar» y «Cerrar».
// La acción hace EXACTAMENTE lo que hacía el botón de la fila (la Lista pasa su
// mismo manejador): mismos permisos, mismos correos y avisos. «Verificar»
// sigue abriendo el diálogo de verificar (elegir la hora que se le da).
// ============================================================================

export type AccionDialogo = "aceptar" | "confirmar" | "verificar";

const TEXTO: Record<AccionDialogo, { titulo: string; boton: string }> = {
  aceptar: { titulo: "Aceptar reserva", boton: "Aceptar reserva" },
  confirmar: { titulo: "Confirmar reserva", boton: "Confirmar reserva" },
  verificar: { titulo: "Verificar reserva", boton: "Verificar" },
};

/** Lo que se enseña de la reserva (lo que trae la Lista, `select("*")`). */
export interface ReservaDelDialogo {
  id: string;
  nombre: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  notas_cliente?: string | null;
  canal?: string | null;
  importante?: boolean | null;
  en_blacklist?: boolean | null;
  menu_del_dia?: boolean | null;
  menu_cerrado?: boolean | null;
  menu_precio?: number | string | null;
  origen?: unknown;
  created_at?: string | null;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-base text-muted-foreground">{etiqueta}</dt>
      <dd className="break-words text-lg font-medium">{children}</dd>
    </div>
  );
}

export function DialogoAccionReserva({
  reserva,
  accion,
  nombreSala,
  onAccion,
  onEditar,
  onCerrar,
}: {
  reserva: ReservaDelDialogo | null;
  accion: AccionDialogo | null;
  nombreSala?: string | null;
  /** Lo mismo que hacía el botón de la fila. Sin él (sin permiso) no hay botón de acción. */
  onAccion?: () => unknown;
  onEditar?: () => void;
  onCerrar: () => void;
}) {
  const [enCurso, setEnCurso] = useState(false);
  const abierto = !!reserva && !!accion;
  if (!reserva || !accion) return null;

  const texto = TEXTO[accion];
  const nombre = reserva.nombre || "Sin nombre";
  const hora = String(reserva.hora ?? "").slice(0, 5);
  const servicio = reserva.menu_del_dia === true ? "Menú del día" : reserva.menu_del_dia === false ? "Carta" : null;

  const ejecutar = async () => {
    if (!onAccion) return;
    setEnCurso(true);
    try {
      await onAccion();
    } finally {
      setEnCurso(false);
      onCerrar();
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !enCurso && onCerrar()}>
      <DialogContent className="reservas-contraste flex max-h-[94dvh] w-[96vw] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 space-y-2 border-b px-6 py-5 text-left">
          <DialogTitle className="text-2xl">
            {texto.titulo} · {nombre}
          </DialogTitle>
          <DialogDescription className="text-lg">
            {reserva.fecha ? tituloHoja(reserva.fecha) : "Sin fecha"} · {hora} · {reserva.numero_comensales} personas
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-6">
          <section aria-label="Datos de la reserva" className="rounded-lg border px-5 py-3">
            <dl className="divide-y">
              <Dato etiqueta="Nombre">
                <span className="text-xl font-semibold">{nombre}</span>
              </Dato>
              <Dato etiqueta="Teléfono">
                {reserva.telefono ? (
                  <a className="text-primary underline underline-offset-4" href={`tel:${reserva.telefono.replace(/\s+/g, "")}`}>
                    {reserva.telefono}
                  </a>
                ) : (
                  "—"
                )}
              </Dato>
              <Dato etiqueta="Email">{reserva.email?.trim() || "Sin email (no se le manda correo)"}</Dato>
              <Dato etiqueta="Día y hora">
                {reserva.fecha ? tituloHoja(reserva.fecha) : "Sin fecha"} · {hora}
              </Dato>
              <Dato etiqueta="Personas">{reserva.numero_comensales}</Dato>
              <Dato etiqueta="Sala">{nombreSala || "Sin sala asignada"}</Dato>
              <Dato etiqueta="Servicio">{servicio}</Dato>
              <Dato etiqueta="Menú cerrado">{reserva.menu_cerrado ? textoInsigniaMenu(reserva.menu_precio) : null}</Dato>
              <Dato etiqueta="Notas">{reserva.notas_cliente?.trim() || null}</Dato>
              <Dato etiqueta="Canal">{etiquetaCanal(reserva.canal)}</Dato>
              <Dato etiqueta="Importante">
                {reserva.importante ? (
                  <span className="inline-flex items-center gap-2">
                    <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden /> Sí
                  </span>
                ) : null}
              </Dato>
              <Dato etiqueta="Lista negra">
                {reserva.en_blacklist ? (
                  <span className="inline-flex items-center gap-2 text-red-700 dark:text-red-300">
                    <ShieldBan className="h-5 w-5" aria-hidden /> Está en la lista negra
                  </span>
                ) : null}
              </Dato>
            </dl>
            {reserva.origen ? (
              <div className="pt-3">
                <ComoSeHizoReserva reserva={reserva as unknown as ReservaConOrigen} />
              </div>
            ) : null}
          </section>

          {reserva.fecha && <ElDiaDeLaReserva fecha={reserva.fecha} reserva={reserva} />}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t px-6 py-5 sm:flex-row sm:justify-end sm:gap-3">
          <Button type="button" variant="outline" className="h-14 px-6 text-lg" onClick={onCerrar} disabled={enCurso}>
            Cerrar
          </Button>
          {onEditar && (
            <Button
              type="button"
              variant="outline"
              className="h-14 gap-2 px-6 text-lg [&_svg]:size-5"
              onClick={() => {
                onCerrar();
                onEditar();
              }}
              disabled={enCurso}
            >
              <SquarePen /> Editar
            </Button>
          )}
          {onAccion && (
            <Button
              type="button"
              className="h-14 gap-2 bg-emerald-600 px-8 text-lg text-white hover:bg-emerald-700 [&_svg]:size-5"
              onClick={() => void ejecutar()}
              disabled={enCurso}
            >
              {enCurso ? <Loader2 className="animate-spin" /> : accion === "verificar" ? <ClipboardCheck /> : <CheckCircle />}
              {texto.boton}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
