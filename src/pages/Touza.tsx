import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Wine, Loader2 } from "lucide-react";
import { useCocteles } from "@/hooks/useCocteles";
import { ListaCocteles } from "@/components/carta/ListaCocteles";
import { CoctelForm } from "@/components/carta/CoctelForm";

type EstadoFiltro = "todos" | "activos" | "inactivos";

export default function Touza() {
  const { cocteles, isLoading, categorias } = useCocteles();
  
  const [seccionActiva, setSeccionActiva] = useState("cocteles");
  const [filtroEstado, setFiltroEstado] = useState<EstadoFiltro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("todas");
  const [mostrarFormCoctel, setMostrarFormCoctel] = useState(false);

  const filtrarPorEstado = <T extends { activado: boolean | null }>(items: T[], estado: EstadoFiltro): T[] => {
    if (estado === "todos") return items;
    if (estado === "activos") return items.filter(item => item.activado === true);
    return items.filter(item => item.activado !== true);
  };

  const filtrarPorBusqueda = <T extends { nombre: string | null; descripcion?: string | null }>(
    items: T[], 
    termino: string
  ): T[] => {
    if (!termino.trim()) return items;
    const terminoLower = termino.toLowerCase();
    return items.filter(item => 
      item.nombre?.toLowerCase().includes(terminoLower) ||
      item.descripcion?.toLowerCase().includes(terminoLower)
    );
  };

  const coctelesFiltrados = useMemo(() => {
    if (!cocteles) return [];
    let resultado = filtrarPorEstado(cocteles, filtroEstado);
    resultado = filtrarPorBusqueda(resultado, busqueda);
    if (categoriaFiltro !== "todas") {
      resultado = resultado.filter(c => c.categoria === categoriaFiltro);
    }
    return resultado;
  }, [cocteles, filtroEstado, busqueda, categoriaFiltro]);

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
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Touza</h1>
            <p className="text-muted-foreground">
              Gestión de carta para la web de Touza
            </p>
          </div>
          <Button onClick={() => setMostrarFormCoctel(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Añadir Cóctel
          </Button>
        </div>

        {/* Barra de búsqueda y filtros */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as EstadoFiltro)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tabs */}
        <Tabs value={seccionActiva} onValueChange={setSeccionActiva}>
          <TabsList>
            <TabsTrigger value="cocteles" className="gap-2">
              <Wine className="h-4 w-4" />
              Cócteles
              <span className="text-xs text-muted-foreground">({coctelesFiltrados.length})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cocteles" className="mt-6">
            {/* Filtro por categoría */}
            <div className="mb-4">
              <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las categorías</SelectItem>
                  {categorias.map((cat) => (
                    <SelectItem key={cat} value={cat as string}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ListaCocteles cocteles={coctelesFiltrados} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal formulario */}
      <CoctelForm 
        open={mostrarFormCoctel} 
        onOpenChange={setMostrarFormCoctel}
        categoriaInicial={categoriaFiltro !== "todas" ? categoriaFiltro : undefined}
      />
    </DashboardLayout>
  );
}
