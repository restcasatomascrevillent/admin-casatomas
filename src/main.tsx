import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registrarServiceWorker } from "./registrarServiceWorker";
import { AvisoActualizacion } from "./actualizacion/AvisoActualizacion";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <AvisoActualizacion />
  </>,
);

registrarServiceWorker();
