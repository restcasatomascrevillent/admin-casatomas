import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "lucide-react";

export const GenerarEspaciosFicticios = () => {
  const generarEspacios = async () => {
    try {
      const espaciosFicticios = [
        {
          nombre: 'Sala Principal',
          descripcion: 'Espacio principal del restaurante con ambiente elegante',
          capacidad_maxima: 80,
          caracteristicas: {
            ambiente: 'elegante',
            ubicacion: 'interior',
            iluminacion: 'natural y artificial',
            musica: 'ambiente suave'
          },
          activa: true
        },
        {
          nombre: 'Terraza Exterior',
          descripcion: 'Terraza al aire libre con vistas panorámicas',
          capacidad_maxima: 40,
          caracteristicas: {
            ambiente: 'casual',
            ubicacion: 'exterior',
            vista: 'panorámica',
            climatizada: false
          },
          activa: true
        },
        {
          nombre: 'Salón Privado VIP',
          descripcion: 'Espacio reservado para eventos privados y celebraciones',
          capacidad_maxima: 30,
          caracteristicas: {
            ambiente: 'exclusivo',
            ubicacion: 'interior',
            privacidad: 'alta',
            equipamiento: 'audiovisual completo'
          },
          activa: true
        },
        {
          nombre: 'Barra y Coctelería',
          descripcion: 'Zona de barra con ambiente informal',
          capacidad_maxima: 20,
          caracteristicas: {
            ambiente: 'informal',
            ubicacion: 'interior',
            tipo: 'barra alta',
            especialidad: 'cocktails'
          },
          activa: true
        },
        {
          nombre: 'Jardín Interior',
          descripcion: 'Espacio cubierto con decoración botánica',
          capacidad_maxima: 50,
          caracteristicas: {
            ambiente: 'natural',
            ubicacion: 'interior',
            decoracion: 'plantas y jardín vertical',
            iluminacion: 'natural cenital'
          },
          activa: true
        }
      ];

      const { data, error } = await supabase
        .from('espacios_reserva' as any)
        .insert(espaciosFicticios)
        .select();

      if (error) throw error;

      toast.success(`¡Espacios generados! ${data?.length} espacios de reserva creados`);
    } catch (error: any) {
      console.error('Error generando espacios:', error);
      toast.error('Error al generar espacios: ' + error.message);
    }
  };

  return (
    <Button onClick={generarEspacios} variant="outline" className="gap-2">
      <Database className="h-4 w-4" />
      Generar Espacios de Prueba
    </Button>
  );
};
