import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { ListaPlana, FilaPlana } from "@/components/panel/ListaPlana";
import { Button } from "@/components/ui/button";
import { Plus, Edit, Trash2, Settings2 } from "lucide-react";
import {
  useEspaciosReserva,
  useEliminarEspacio,
} from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { EspacioForm } from "@/components/reservas/EspacioForm";
import { EditorPlanoEspacio } from "@/components/espacios/EditorPlanoEspacio";
import { salaAdmiteReservas } from "@/lib/reservas/negocios";
import { capacidadDeAforo, esSalaPrivada } from "@/lib/reservas/salaPrivada";
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

export default function Espacios() {
  const { data: todosEspacios = [], isLoading } = useEspaciosReserva() as any;
  // Solo las salas de Casa Tomás: Touza no admite reservas (decisión del dueño,
  // 2026-10-01) y sus salas, aunque sigan en la base de datos, no se enseñan.
  // Se distinguen por su marca, nunca por el nombre (hay dos «Terraza»).
  const espacios = useMemo(() => (todosEspacios as any[]).filter((e) => salaAdmiteReservas(e)), [todosEspacios]);
  const { data: todasMesas = [], refetch: refetchMesas } = useMesas();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showForm, setShowForm] = useState(false);
  const [espacioEditando, setEspacioEditando] = useState<any>();
  const [espacioAEliminar, setEspacioAEliminar] = useState<string | null>(null);
  const [espacioConfigurando, setEspacioConfigurando] = useState<{ id: string; nombre: string } | null>(null);

  const eliminarEspacio = useEliminarEspacio();

  // Obtener cantidad de mesas por espacio
  const getMesasCount = (espacioId: string) => {
    return todasMesas.filter((m) => m.espacio_id === espacioId).length;
  };

  // Deep link `/super-admin/espacios?editar=<espacioId>` (2026-09-26): la
  // pantalla de "Mesas y aforo por espacio" de Configuración enlaza aquí
  // directamente al editor de un espacio, sin pasar por la lista de tarjetas.
  // Se abre con el mismo estado que usa el botón "Configurar Plano y Mesas".
  useEffect(() => {
    const editarId = searchParams.get("editar");
    if (!editarId) return;
    if (espacioConfigurando?.id === editarId) return;
    const espacio = espacios.find((e) => e?.id === editarId);
    if (espacio) {
      setEspacioConfigurando({ id: espacio.id, nombre: espacio.nombre });
    }
  }, [searchParams, espacios, espacioConfigurando]);

  // Callback para volver del editor - refrescar datos
  const handleBackFromEditor = () => {
    setEspacioConfigurando(null);
    refetchMesas(); // Refrescar conteo de mesas
    if (searchParams.has("editar")) {
      const siguientes = new URLSearchParams(searchParams);
      siguientes.delete("editar");
      setSearchParams(siguientes, { replace: true });
    }
  };

  // Si estamos configurando un espacio, mostrar el editor a pantalla completa
  if (espacioConfigurando) {
    return (
      <SuperAdminLayout>
        <div className="h-[calc(100dvh-120px)] min-h-[32rem] flex flex-col">
          <EditorPlanoEspacio
            espacioId={espacioConfigurando.id}
            espacioNombre={espacioConfigurando.nombre}
            onBack={handleBackFromEditor}
          />
        </div>
      </SuperAdminLayout>
    );
  }

  return (
    <SuperAdminLayout>
      <div className="space-y-3">
        {/* Sin título de página (2026-09-25): la pestaña "Espacios" activa en
            el menú lateral ya dice dónde estás. Se conserva el botón, que sí
            es una acción. */}
        <div className="flex justify-end">
          <Button className="h-11 touch-manipulation" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Espacio
          </Button>
        </div>

        {/* Las salas del restaurante con su aforo por turno: la suma de las
            activas, la cifra que valida el trigger validar_capacidad_reserva. */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : espacios.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay espacios creados</p>
        ) : (
          <section aria-label="Espacios del restaurante" className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Aforo por turno:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {capacidadDeAforo(espacios.filter((e: any) => e.activa))}
              </span>{" "}
              plazas
              {espacios.some((e: any) => e.activa && esSalaPrivada(e)) && (
                <span> (sin las salas privadas: están fuera de aforo)</span>
              )}
            </p>
            <ListaPlana aria-label="Salas">
              {espacios.map((espacio: any) => (
                <FilaPlana
                  key={espacio.id}
                  titulo={
                    /* 11/11/2026 (dueño: móvil «perfecto»): `block truncate` para que un nombre largo acabe en «…» y no cortado en seco. */
                    <span className="block truncate">{espacio.nombre}</span>
                  }
                  subtitulo={[
                    espacio.descripcion || "Sin descripción",
                    `Capacidad ${espacio.capacidad_maxima}`,
                    `${getMesasCount(espacio.id)} ${getMesasCount(espacio.id) === 1 ? "mesa" : "mesas"}`,
                  ]}
                  estado={{ texto: espacio.activa ? "Activo" : "Inactivo", tono: espacio.activa ? "verde" : "gris" }}
                  etiquetaMenu={`Más acciones de ${espacio.nombre}`}
                  menu={[
                    {
                      etiqueta: "Configurar plano y mesas",
                      icono: Settings2,
                      onClick: () => setEspacioConfigurando({ id: espacio.id, nombre: espacio.nombre }),
                    },
                    {
                      etiqueta: "Editar espacio",
                      icono: Edit,
                      onClick: () => {
                        setEspacioEditando(espacio);
                        setShowForm(true);
                      },
                    },
                    { etiqueta: "Eliminar", icono: Trash2, destructiva: true, separadorAntes: true, onClick: () => setEspacioAEliminar(espacio.id) },
                  ]}
                />
              ))}
            </ListaPlana>
          </section>
        )}

        <EspacioForm
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) setEspacioEditando(null);
          }}
          espacio={espacioEditando}
          onEspacioCreado={(e) => setEspacioConfigurando({ id: e.id, nombre: e.nombre })}
        />

        <AlertDialog open={!!espacioAEliminar} onOpenChange={() => setEspacioAEliminar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción no se puede deshacer. Se eliminará permanentemente el espacio, 
                incluyendo todas sus mesas y la configuración del plano.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (espacioAEliminar) {
                    eliminarEspacio.mutate(espacioAEliminar);
                    setEspacioAEliminar(null);
                  }
                }}
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SuperAdminLayout>
  );
}
