import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="flex min-h-app items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Esta página no existe</p>
        <a href="/" className="inline-flex min-h-11 items-center px-4 text-primary underline hover:text-primary/90">
          Volver al inicio
        </a>
      </div>
    </main>
  );
};

export default NotFound;
