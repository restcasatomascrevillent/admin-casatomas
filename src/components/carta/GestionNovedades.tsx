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
import { Plus, Pencil, Trash2, Star, Calendar, Loader2, UtensilsCrossed, Wine, Coffee, Megaphone } from "lucide-react";
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

  const getItemDetails = (novedad: Novedad) => {
    if (novedad.tipo !== "item_carta") return null;

    if (novedad.plato_id) {
      const plato = platos.find((p) => p.id === novedad.plato_id);
      if (plato) {
        return {
          type: "plato" as const,
          icon: UtensilsCrossed,
          name: plato.nombre,
          description: plato.descripcion,
          price: plato.precio_eur,
          image: plato.imagen_url,
          category: plato.categoria,
        };
      }
    }
    if (novedad.vino_id) {
      const vino = vinos.find((v) => v.id === novedad.vino_id);
      if (vino) {
        return {
          type: "vino" as const,
          icon: Wine,
          name: vino.nombre,
          description: vino.descripcion,
          price: vino.precio_eur,
          image: vino.imagen_url,
          category: vino.categoria,
        };
      }
    }
    if (novedad.bebida_id) {
      const bebida = bebidas.find((b) => b.id === novedad.bebida_id);
      if (bebida) {
        return {
          type: "bebida" as const,
          icon: Coffee,
          name: bebida.nombre,
          description: bebida.descripcion,
          price: bebida.precio_eur,
          image: bebida.imagen_url,
          category: bebida.categoria,
        };
      }
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

  const getTipoBadge = (novedad: Novedad) => {
    if (novedad.tipo === "item_carta") {
      const item = getItemDetails(novedad);
      if (item) {
        const Icon = item.icon;
        return (
          <Badge variant="outline" className="gap-1">
            <Icon className="h-3 w-3" />
            {item.type === "plato" ? "Plato" : item.type === "vino" ? "Vino" : "Bebida"}
          </Badge>
        );
      }
      return <Badge variant="outline">Item eliminado</Badge>;
    }
    return (
      <Badge variant="outline" className="gap-1">
        <Megaphone className="h-3 w-3" />
        Anuncio
      </Badge>
    );
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
          {filteredNovedades.map((novedad) => {
            const itemDetails = getItemDetails(novedad);
            
            return (
              <Card key={novedad.id} className={!novedad.activo ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {novedad.destacado && (
                        <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                      )}
                      {getTipoBadge(novedad)}
                      {getEstadoBadge(novedad)}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={novedad.activo}
                          onCheckedChange={(checked) =>
                            toggleActivo.mutate({ id: novedad.id, activo: checked })
                          }
                          aria-label="Activar/desactivar"
                        />
                        <span className="text-xs text-muted-foreground">Activo</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={novedad.destacado}
                          onCheckedChange={(checked) =>
                            toggleDestacado.mutate({ id: novedad.id, destacado: checked })
                          }
                          aria-label="Destacar"
                        />
                        <Star className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Content based on tipo */}
                  {novedad.tipo === "item_carta" && itemDetails ? (
                    <div className="flex gap-4 mb-3">
                      {itemDetails.image && (
                        <img
                          src={itemDetails.image}
                          alt={itemDetails.name}
                          className="w-20 h-20 object-cover rounded-md"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{itemDetails.name}</h4>
                        {itemDetails.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {itemDetails.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-semibold">{itemDetails.price}€</span>
                          <Badge variant="secondary" className="text-xs">
                            {itemDetails.category}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ) : novedad.tipo === "anuncio" ? (
                    <div className="mb-3">
                      <h4 className="font-medium">{novedad.titulo}</h4>
                      {novedad.descripcion && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {novedad.descripcion}
                        </p>
                      )}
                      {novedad.seccion && (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          Sección: {novedad.seccion}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="mb-3">
                      <p className="text-sm text-muted-foreground italic">
                        Item de carta eliminado
                      </p>
                    </div>
                  )}

                  {/* Footer with dates and actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
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

                    <div className="flex items-center gap-2">
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
            );
          })}
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
