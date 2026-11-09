import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CrearMovil } from "@/components/instagram/movil";

/**
 * /instagram/rapido: el asistente móvil de Instagram a pantalla completa, sin
 * menú lateral. Pensado para guardarlo en la pantalla de inicio del móvil
 * («Añadir a pantalla de inicio») y publicar en un minuto al llegar el género.
 * Permiso: sección «marketing» (la agencia no entra).
 */
export default function InstagramRapido() {
  const navigate = useNavigate();
  useEffect(() => {
    const anterior = document.title;
    document.title = "Instagram rápido · Casa Tomás";
    return () => {
      document.title = anterior;
    };
  }, []);
  return <CrearMovil onSalir={() => navigate("/rrss?red=instagram")} />;
}
