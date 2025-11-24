import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { useHistorialAjustes } from "@/hooks/useHistorialAjustes";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { TrendingUp, BarChart3, LineChart as LineChartIcon, Info } from "lucide-react";

export function GraficoEvolucionPrecios() {
  const { historial } = useHistorialAjustes();
  const [tipoCartaSeleccionado, setTipoCartaSeleccionado] = useState<"platos" | "bebidas" | "vinos">("platos");
  const [tipoGrafico, setTipoGrafico] = useState<"lineas" | "barras">("lineas");

  const datosGrafico = useMemo(() => {
    if (!historial || historial.length === 0) return [];

    // Filtrar por tipo de carta
    const historialFiltrado = historial.filter(h => h.tipo_carta === tipoCartaSeleccionado);

    // Agrupar por fecha y categoría
    const datosPorFecha = new Map<string, Map<string, { total: number; count: number }>>();

    historialFiltrado.forEach(ajuste => {
      const fecha = format(new Date(ajuste.fecha), "dd/MM/yyyy", { locale: es });
      
      ajuste.snapshot.forEach((item: any) => {
        const categoria = ajuste.categoria === "todas" ? "Todas" : ajuste.categoria;
        
        if (!datosPorFecha.has(fecha)) {
          datosPorFecha.set(fecha, new Map());
        }
        
        const categoriasEnFecha = datosPorFecha.get(fecha)!;
        if (!categoriasEnFecha.has(categoria)) {
          categoriasEnFecha.set(categoria, { total: 0, count: 0 });
        }
        
        const stats = categoriasEnFecha.get(categoria)!;
        stats.total += item.precio_nuevo;
        stats.count += 1;
      });
    });

    // Convertir a formato para el gráfico
    const resultado = Array.from(datosPorFecha.entries())
      .map(([fecha, categorias]) => {
        const punto: any = { fecha };
        
        categorias.forEach((stats, categoria) => {
          punto[categoria] = Number((stats.total / stats.count).toFixed(2));
        });
        
        return punto;
      })
      .reverse(); // Más antiguo primero

    return resultado;
  }, [historial, tipoCartaSeleccionado]);

  const categorias = useMemo(() => {
    if (datosGrafico.length === 0) return [];
    const cats = new Set<string>();
    datosGrafico.forEach(punto => {
      Object.keys(punto).forEach(key => {
        if (key !== "fecha") cats.add(key);
      });
    });
    return Array.from(cats);
  }, [datosGrafico]);

  const colores = [
    "hsl(206, 11%, 25%)", // Primary
    "hsl(38, 59%, 45%)", // Accent gold
    "hsl(25, 13%, 55%)", // Secondary
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#10b981", // Green
    "#f59e0b", // Orange
    "#3b82f6", // Blue
  ];

  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Evolución de Precios Promedio
                </CardTitle>
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80" align="start">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Sobre este gráfico</h4>
                      <p className="text-sm text-muted-foreground">
                        Este gráfico muestra la evolución del <strong>precio promedio</strong> de los productos 
                        a lo largo del tiempo, agrupados por categoría.
                      </p>
                      <div className="space-y-1 text-xs">
                        <p><strong>Eje X (horizontal):</strong> Fechas de los ajustes realizados</p>
                        <p><strong>Eje Y (vertical):</strong> Precio promedio en euros (€)</p>
                        <p><strong>Líneas/Barras de colores:</strong> Cada color representa una categoría diferente</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        💡 <strong>Tip:</strong> Pasa el cursor sobre los puntos para ver valores exactos
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </div>
              <CardDescription className="mt-1">
                Histórico de precios promedio por categoría
              </CardDescription>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={tipoCartaSeleccionado} onValueChange={(v: any) => setTipoCartaSeleccionado(v)}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platos">Platos</SelectItem>
                  <SelectItem value="bebidas">Bebidas</SelectItem>
                  <SelectItem value="vinos">Vinos</SelectItem>
                </SelectContent>
              </Select>

              <ToggleGroup 
                type="single" 
                value={tipoGrafico} 
                onValueChange={(value) => value && setTipoGrafico(value as "lineas" | "barras")}
                className="border rounded-md"
              >
                <ToggleGroupItem 
                  value="lineas" 
                  aria-label="Vista de líneas"
                  className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground gap-2"
                >
                  <LineChartIcon className="h-4 w-4" />
                  Líneas
                </ToggleGroupItem>
                <ToggleGroupItem 
                  value="barras" 
                  aria-label="Vista de barras"
                  className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground gap-2"
                >
                  <BarChart3 className="h-4 w-4" />
                  Barras
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        {datosGrafico.length === 0 ? (
          <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground bg-muted/20 rounded-lg border-2 border-dashed">
            <TrendingUp className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center">
              No hay datos de historial para {getTipoCartaLabel(tipoCartaSeleccionado).toLowerCase()}
            </p>
            <p className="text-sm text-center mt-2">
              Realiza ajustes de precios para ver la evolución
            </p>
          </div>
        ) : (
          <div className="w-full">
            <ResponsiveContainer width="100%" height={400}>
              {tipoGrafico === "lineas" ? (
                <LineChart 
                  data={datosGrafico}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    stroke="hsl(var(--border))" 
                    opacity={0.3}
                  />
                  <XAxis 
                    dataKey="fecha" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickMargin={8}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickMargin={8}
                    width={60}
                    label={{ 
                      value: 'Precio (€)', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { 
                        textAnchor: 'middle',
                        fill: 'hsl(var(--muted-foreground))',
                        fontSize: 12
                      }
                    }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                    labelStyle={{
                      color: "hsl(var(--popover-foreground))",
                      fontWeight: "bold",
                      marginBottom: "4px"
                    }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)}€`, ""]}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Legend 
                    wrapperStyle={{
                      paddingTop: "20px"
                    }}
                    iconType="line"
                  />
                  {categorias.map((categoria, index) => (
                    <Line
                      key={categoria}
                      type="monotone"
                      dataKey={categoria}
                      name={categoria}
                      stroke={colores[index % colores.length]}
                      strokeWidth={3}
                      dot={{ r: 5, strokeWidth: 2, fill: "hsl(var(--background))" }}
                      activeDot={{ r: 7, strokeWidth: 2 }}
                      animationDuration={1000}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart 
                  data={datosGrafico}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    stroke="hsl(var(--border))" 
                    opacity={0.3}
                  />
                  <XAxis 
                    dataKey="fecha" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickMargin={8}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickMargin={8}
                    width={60}
                    label={{ 
                      value: 'Precio (€)', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { 
                        textAnchor: 'middle',
                        fill: 'hsl(var(--muted-foreground))',
                        fontSize: 12
                      }
                    }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                    labelStyle={{
                      color: "hsl(var(--popover-foreground))",
                      fontWeight: "bold",
                      marginBottom: "4px"
                    }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)}€`, ""]}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Legend 
                    wrapperStyle={{
                      paddingTop: "20px"
                    }}
                  />
                  {categorias.map((categoria, index) => (
                    <Bar
                      key={categoria}
                      dataKey={categoria}
                      name={categoria}
                      fill={colores[index % colores.length]}
                      radius={[4, 4, 0, 0]}
                      animationDuration={1000}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
