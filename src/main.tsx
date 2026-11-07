import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registrarServiceWorker } from "./registrarServiceWorker";
import { AvisoActualizacion } from "./actualizacion/AvisoActualizacion";
import { escucharInstalacion } from "./lib/instalarApp";

// Antes de pintar: `beforeinstallprompt` llega una sola vez al cargar (botón «Instalar app»).
escucharInstalacion();

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <AvisoActualizacion />
  </>,
);

registrarServiceWorker();
