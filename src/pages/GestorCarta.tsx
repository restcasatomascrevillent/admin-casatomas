import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Percent } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { PlatoForm } from "@/components/carta/PlatoForm";
import { BebidaForm } from "@/components/carta/BebidaForm";
import { VinoForm } from "@/components/carta/VinoForm";
import { ListaPlatos } from "@/components/carta/ListaPlatos";
import { ListaBebidas } from "@/components/carta/ListaBebidas";
import { ListaVinos } from "@/components/carta/ListaVinos";
import { AjustePreciosModal } from "@/components/carta/AjustePreciosModal";

export default function GestorCarta() {
  const { platos, isLoading: isLoadingPlatos, categorias: categoriasPlatos } = usePlatos();
  const { bebidas, isLoading: isLoadingBebidas, categorias: categoriasBebidas } = useBebidas();
  const { vinos, isLoading: isLoadingVinos, categorias: categoriasVinos } = useVinos();

  const [seccionActiva, setSeccionActiva] = useState<"platos" | "bebidas" | "vinos">("platos");
  const [categoriaPlatos, setCategoriaPlatos] = useState<string>("");
  const [categoriaBebidas, setCategoriaBebidas] = useState<string>("");
  const [categoriaVinos, setCategoriaVinos] = useState<string>("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "activos" | "inactivos">("todos");
  
  const [dialogPlatoOpen, setDialogPlatoOpen] = useState(false);
  const [dialogBebidaOpen, setDialogBebidaOpen] = useState(false);
  const [dialogVinoOpen, setDialogVinoOpen] = useState(false);
  const [dialogAjustePreciosOpen, setDialogAjustePreciosOpen] = useState(false);

  const isLoading = isLoadingPlatos || isLoadingBebidas || isLoadingVinos;

  // Inicializar la primera categoría cuando se carguen los datos
  if (categoriasPlatos.length > 0 && !categoriaPlatos) {
    setCategoriaPlatos(categoriasPlatos[0] || "");
  }
  if (categoriasBebidas.length > 0 && !categoriaBebidas) {
    setCategoriaBebidas(categoriasBebidas[0] || "");
  }
  if (categoriasVinos.length > 0 && !categoriaVinos) {
    setCategoriaVinos(categoriasVinos[0] || "");
  }

  const filtrarPorEstado = <T extends { activado: boolean | null }>(items: T[]): T[] => {
    if (filtroEstado === "activos") {
      return items.filter((item) => item.activado === true);
    }
    if (filtroEstado === "inactivos") {
      return items.filter((item) => item.activado === false);
    }
    return items;
  };

  const getPlatosPorCategoria = (categoria: string) => {
    const platosFiltrados = platos?.filter((p) => p.categoria === categoria) || [];
    return filtrarPorEstado(platosFiltrados);
  };

  const getBebidasPorCategoria = (categoria: string) => {
    const bebidasFiltradas = bebidas?.filter((b) => b.categoria === categoria) || [];
    return filtrarPorEstado(bebidasFiltradas);
  };

  const getVinosPorCategoria = (categoria: string) => {
    const vinosFiltrados = vinos?.filter((v) => v.categoria === categoria) || [];
    return filtrarPorEstado(vinosFiltrados);
  };

  const handleAñadir = () => {
    if (seccionActiva === "platos") {
      setDialogPlatoOpen(true);
    } else if (seccionActiva === "bebidas") {
      setDialogBebidaOpen(true);
    } else {
      setDialogVinoOpen(true);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestor de Carta</h2>
            <p className="text-muted-foreground">
              Gestiona el menú, bebidas y vinos de tu restaurante
            </p>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <ToggleGroup 
              type="single" 
              value={filtroEstado} 
              onValueChange={(value) => value && setFiltroEstado(value as "todos" | "activos" | "inactivos")}
              className="border rounded-md"
            >
              <ToggleGroupItem value="todos" aria-label="Mostrar todos" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                Todos
              </ToggleGroupItem>
              <ToggleGroupItem value="activos" aria-label="Mostrar activos" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                Activos
              </ToggleGroupItem>
              <ToggleGroupItem value="inactivos" aria-label="Mostrar inactivos" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                Inactivos
              </ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" onClick={() => setDialogAjustePreciosOpen(true)}>
              <Percent className="mr-2 h-4 w-4" />
              Ajustar Precios
            </Button>
            <Button onClick={handleAñadir}>
              <Plus className="mr-2 h-4 w-4" />
              Añadir
            </Button>
          </div>
        </div>

        <Tabs 
          defaultValue="platos" 
          className="w-full"
          onValueChange={(value) => setSeccionActiva(value as "platos" | "bebidas" | "vinos")}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="platos">Platos</TabsTrigger>
            <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
            <TabsTrigger value="vinos">Vinos</TabsTrigger>
          </TabsList>

          {/* PLATOS */}
          <TabsContent value="platos" className="space-y-4">
            {categoriasPlatos.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay platos todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle>Platos</CardTitle>
                      <CardDescription>
                        Gestiona los platos de tu carta
                      </CardDescription>
                    </div>
                    <Select value={categoriaPlatos} onValueChange={setCategoriaPlatos}>
                      <SelectTrigger className="w-full sm:w-[280px] bg-background">
                        <SelectValue placeholder="Selecciona categoría" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {categoriasPlatos.map((categoria) => (
                          <SelectItem key={categoria} value={categoria || ""} className="capitalize">
                            {categoria}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <ListaPlatos platos={getPlatosPorCategoria(categoriaPlatos)} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* BEBIDAS */}
          <TabsContent value="bebidas" className="space-y-4">
            {categoriasBebidas.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay bebidas todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle>Bebidas</CardTitle>
                      <CardDescription>
                        Gestiona las bebidas de tu carta
                      </CardDescription>
                    </div>
                    <Select value={categoriaBebidas} onValueChange={setCategoriaBebidas}>
                      <SelectTrigger className="w-full sm:w-[280px] bg-background">
                        <SelectValue placeholder="Selecciona categoría" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {categoriasBebidas.map((categoria) => (
                          <SelectItem key={categoria} value={categoria || ""} className="capitalize">
                            {categoria}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <ListaBebidas bebidas={getBebidasPorCategoria(categoriaBebidas)} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* VINOS */}
          <TabsContent value="vinos" className="space-y-4">
            {categoriasVinos.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay vinos todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle>Vinos</CardTitle>
                      <CardDescription>
                        Gestiona los vinos de tu carta
                      </CardDescription>
                    </div>
                    <Select value={categoriaVinos} onValueChange={setCategoriaVinos}>
                      <SelectTrigger className="w-full sm:w-[280px] bg-background">
                        <SelectValue placeholder="Selecciona categoría" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {categoriasVinos.map((categoria) => (
                          <SelectItem key={categoria} value={categoria || ""} className="capitalize">
                            {categoria}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <ListaVinos vinos={getVinosPorCategoria(categoriaVinos)} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <PlatoForm 
          open={dialogPlatoOpen} 
          onOpenChange={setDialogPlatoOpen}
          categoriaInicial={categoriaPlatos}
        />
        <BebidaForm 
          open={dialogBebidaOpen} 
          onOpenChange={setDialogBebidaOpen}
          categoriaInicial={categoriaBebidas}
        />
        <VinoForm 
          open={dialogVinoOpen} 
          onOpenChange={setDialogVinoOpen}
          categoriaInicial={categoriaVinos}
        />
        
        <AjustePreciosModal
          open={dialogAjustePreciosOpen}
          onOpenChange={setDialogAjustePreciosOpen}
        />
      </div>
    </DashboardLayout>
  );
}
