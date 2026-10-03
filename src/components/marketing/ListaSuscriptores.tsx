import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  esBajaPorEntrega,
  etiquetaOrigenBaja,
  formatearFechaBaja,
  type SuscriptorNewsletter,
} from "@/lib/newsletter/bajas";

interface ListaSuscriptoresProps {
  activos: SuscriptorNewsletter[];
  bajas: SuscriptorNewsletter[];
  isLoading: boolean;
}

/**
 * Activos y dados de baja, en pestañas. Solo lectura a propósito: las bajas
 * las registra el sistema (enlace del correo, botón one-click, queja de spam,
 * rebote) y un dado de baja no se puede reactivar desde el panel — la base de
 * datos lo impide (migración 20261003171500); solo vuelve si da un
 * consentimiento nuevo al reservar.
 */
export function ListaSuscriptores({ activos, bajas, isLoading }: ListaSuscriptoresProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="activos">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="activos">Activos ({activos.length})</TabsTrigger>
        <TabsTrigger value="bajas">Dados de baja ({bajas.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="activos">
        {activos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Aún no hay suscriptores activos.</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <ul className="space-y-2">
              {activos.map((s) => (
                <li key={s.id} className="p-2 rounded-md bg-muted/50 min-w-0">
                  <p className="font-medium text-sm break-all">{s.email}</p>
                  {s.nombre && <p className="text-xs text-muted-foreground">{s.nombre}</p>}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </TabsContent>

      <TabsContent value="bajas">
        <p className="text-xs text-muted-foreground mb-2">
          No reciben ningún envío. No se pueden volver a activar desde aquí: solo vuelven si marcan otra vez la
          casilla del newsletter en una reserva nueva.
        </p>
        {bajas.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nadie se ha dado de baja.</p>
        ) : (
          <ScrollArea className="h-[300px]">
            <ul className="space-y-2">
              {bajas.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between p-2 rounded-md bg-muted/30 min-w-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-muted-foreground line-through break-all">{s.email}</p>
                    <p className="text-xs text-muted-foreground">Baja: {formatearFechaBaja(s.fecha_baja)}</p>
                  </div>
                  <Badge
                    variant={esBajaPorEntrega(s.origen_baja) ? "destructive" : "secondary"}
                    className="self-start sm:self-auto shrink-0"
                  >
                    {etiquetaOrigenBaja(s.origen_baja)}
                  </Badge>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </TabsContent>
    </Tabs>
  );
}
