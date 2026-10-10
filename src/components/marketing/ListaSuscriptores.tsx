import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { FilaPlana, ListaPlana } from "@/components/panel/ListaPlana";
import {
  esBajaPorEntrega,
  etiquetaOrigenAlta,
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
 * Activos y dados de baja, en pestañas y como lista plana (una fila de ~56 px por suscriptor). Solo lectura a
 * propósito: las bajas las registra el sistema (enlace del correo, botón one-click, queja de spam, rebote) y
 * un dado de baja no se puede reactivar desde el panel — la base de datos lo impide (migración 20261003171500);
 * solo vuelve si da un consentimiento nuevo al reservar.
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
    // Sin alto fijo: llena el hueco que le deja GestionCorreos y el scroll es el de la propia lista.
    // `data-[state=inactive]:hidden`: Radix deja la pestaña inactiva con el atributo `hidden` y un `flex` le gana.
    <Tabs defaultValue="activos" className="flex min-h-0 flex-1 flex-col">
      <PestanasPagina
        pestanas={[
          { valor: "activos", etiqueta: `Activos (${activos.length})` },
          { valor: "bajas", etiqueta: `Dados de baja (${bajas.length})` },
        ]}
      />

      <TabsContent value="activos" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ListaPlana
          scroll
          aria-label="Suscriptores activos"
          vacio={<p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay suscriptores activos.</p>}
        >
          {activos.map((s) => (
            <FilaPlana
              key={s.id}
              titulo={s.email}
              subtitulo={[s.nombre, etiquetaOrigenAlta(s.origen_alta) && `Se apuntó por: ${etiquetaOrigenAlta(s.origen_alta)}`]}
            />
          ))}
        </ListaPlana>
      </TabsContent>

      <TabsContent value="bajas" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <p className="mb-1 shrink-0 text-xs text-muted-foreground">
          No reciben ninguna newsletter. No se pueden volver a activar desde aquí: solo vuelven a recibirla si se
          apuntan de nuevo al reservar en la web y confirman su reserva desde el email.
        </p>
        <ListaPlana
          scroll
          aria-label="Suscriptores dados de baja"
          vacio={<p className="py-8 text-center text-sm text-muted-foreground">Todavía nadie se ha dado de baja.</p>}
        >
          {bajas.map((s) => (
            <FilaPlana
              key={s.id}
              titulo={<span className="text-muted-foreground line-through">{s.email}</span>}
              subtitulo={`Baja: ${formatearFechaBaja(s.fecha_baja)}`}
              estado={{ texto: etiquetaOrigenBaja(s.origen_baja), tono: esBajaPorEntrega(s.origen_baja) ? "rojo" : "gris" }}
            />
          ))}
        </ListaPlana>
      </TabsContent>
    </Tabs>
  );
}
