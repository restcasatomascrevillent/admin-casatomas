import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Star, Calendar, Link as LinkIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useNovedades, Novedad, NuevaNovedad } from "@/hooks/useNovedades";
import { NovedadForm } from "./NovedadForm";
import { usePlatos } from "@/hooks/usePlatos";
import { useVinos } from "@/hooks/useVinos";
import { useBebidas } from "@/hooks/useBebidas";

type FilterType = "todas" | "activas" | "programadas" | "expiradas";

export function GestionNovedades() {
  const {
    novedades,
    isLoading,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    toggleActivo,
    toggleDestacado,
  } = useNovedades();

  const { platos = [] } = usePlatos();
  const { vinos = [] } = useVinos();
  const { bebidas = [] } = useBebidas();

  const [filter, setFilter] = useState<FilterType>("todas");
  const [formOpen, setFormOpen] = useState(false);
  const [editingNovedad, setEditingNovedad] = useState<Novedad | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const hoy = new Date().toISOString().split("T")[0];

  const getEstado = (novedad: Novedad): "activa" | "programada" | "expirada" | "inactiva" => {
    if (!novedad.activo) return "inactiva";
    if (novedad.fecha_inicio > hoy) return "programada";
    if (novedad.fecha_fin && novedad.fecha_fin < hoy) return "expirada";
    return "activa";
  };

  const filteredNovedades = novedades.filter((n) => {
    if (filter === "todas") return true;
    const estado = getEstado(n);
    if (filter === "activas") return estado === "activa";
    if (filter === "programadas") return estado === "programada";
    if (filter === "expiradas") return estado === "expirada" || estado === "inactiva";
    return true;
  });

  const getAsociacionLabel = (novedad: Novedad) => {
    if (novedad.tipo_asociacion === "plato" && novedad.plato_id) {
      const plato = platos.find((p) => p.id === novedad.plato_id);
      return plato ? `Plato: ${plato.nombre}` : "Plato eliminado";
    }
    if (novedad.tipo_asociacion === "vino" && novedad.vino_id) {
      const vino = vinos.find((v) => v.id === novedad.vino_id);
      return vino ? `Vino: ${vino.nombre}` : "Vino eliminado";
    }
    if (novedad.tipo_asociacion === "bebida" && novedad.bebida_id) {
      const bebida = bebidas.find((b) => b.id === novedad.bebida_id);
      return bebida ? `Bebida: ${bebida.nombre}` : "Bebida eliminada";
    }
    if (novedad.tipo_asociacion === "seccion" && novedad.seccion) {
      const secciones: Record<string, string> = {
        carta: "Carta General",
        web: "Web",
        redes: "Redes Sociales",
        promociones: "Promociones",
        eventos: "Eventos",
      };
      return `Sección: ${secciones[novedad.seccion] || novedad.seccion}`;
    }
    return null;
  };

  const getEstadoBadge = (novedad: Novedad) => {
    const estado = getEstado(novedad);
    switch (estado) {
      case "activa":
        return <Badge className="bg-green-500">Activa</Badge>;
      case "programada":
        return <Badge variant="secondary">Programada</Badge>;
      case "expirada":
        return <Badge variant="destructive">Expirada</Badge>;
      case "inactiva":
        return <Badge variant="outline">Inactiva</Badge>;
    }
  };

  const handleSubmit = (data: NuevaNovedad) => {
    if (editingNovedad) {
      actualizarNovedad.mutate(
        { id: editingNovedad.id, ...data },
        {
          onSuccess: () => {
            setFormOpen(false);
            setEditingNovedad(null);
          },
        }
      );
    } else {
      crearNovedad.mutate(data, {
        onSuccess: () => {
          setFormOpen(false);
        },
      });
    }
  };

  const handleEdit = (novedad: Novedad) => {
    setEditingNovedad(novedad);
    setFormOpen(true);
  };

  const handleDelete = () => {
    if (deleteId) {
      eliminarNovedad.mutate(deleteId, {
        onSuccess: () => setDeleteId(null),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Gestión de Novedades</h3>
          <p className="text-sm text-muted-foreground">
            {novedades.length} novedades en total
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Novedad
        </Button>
      </div>

      {/* Filtros */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="activas">Activas</TabsTrigger>
          <TabsTrigger value="programadas">Programadas</TabsTrigger>
          <TabsTrigger value="expiradas">Expiradas</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Lista */}
      {filteredNovedades.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay novedades {filter !== "todas" ? `${filter}` : ""}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredNovedades.map((novedad) => (
            <Card key={novedad.id} className={!novedad.activo ? "opacity-60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {novedad.destacado && (
                      <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    )}
                    <CardTitle className="text-base">{novedad.titulo}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {getEstadoBadge(novedad)}
                  </div>
                </div>
                {novedad.descripcion && (
                  <CardDescription className="line-clamp-2">
                    {novedad.descripcion}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>
                        {format(new Date(novedad.fecha_inicio), "d MMM yyyy", {
                          locale: es,
                        })}
                        {novedad.fecha_fin && (
                          <>
                            {" → "}
                            {format(new Date(novedad.fecha_fin), "d MMM yyyy", {
                              locale: es,
                            })}
                          </>
                        )}
                      </span>
                    </div>
                    {getAsociacionLabel(novedad) && (
                      <div className="flex items-center gap-1">
                        <LinkIcon className="h-3.5 w-3.5" />
                        <span>{getAsociacionLabel(novedad)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 mr-2">
                      <Switch
                        checked={novedad.activo}
                        onCheckedChange={(checked) =>
                          toggleActivo.mutate({ id: novedad.id, activo: checked })
                        }
                        aria-label="Activar/desactivar"
                      />
                      <span className="text-xs text-muted-foreground">Activo</span>
                    </div>
                    <div className="flex items-center gap-1.5 mr-2">
                      <Switch
                        checked={novedad.destacado}
                        onCheckedChange={(checked) =>
                          toggleDestacado.mutate({ id: novedad.id, destacado: checked })
                        }
                        aria-label="Destacar"
                      />
                      <Star className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(novedad)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(novedad.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Form Dialog */}
      <NovedadForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingNovedad(null);
        }}
        novedad={editingNovedad}
        onSubmit={handleSubmit}
        isLoading={crearNovedad.isPending || actualizarNovedad.isPending}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar novedad?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La novedad será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
