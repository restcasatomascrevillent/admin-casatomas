import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UtensilsCrossed } from "lucide-react";

export default function Auth() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const normalizedInput = loginEmail.trim();
    // If no @ in login, assume it's a username and append @staff.local
    const loginIdentifier = normalizedInput.includes("@")
      ? normalizedInput.toLowerCase()
      : `${normalizedInput.toLowerCase()}@staff.local`;
    const { error } = await signIn(loginIdentifier, loginPassword);
    if (!error) {
      navigate("/dashboard");
    }
    setLoading(false);
  };

  // `min-h-dvh` + scroll natural: con el teclado abierto en vertical la tarjeta no queda cortada.
  return (
    <div className="min-h-app flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <UtensilsCrossed className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Gestión Restaurante</h1>
          <p className="text-muted-foreground mt-2">
            Sistema de gestión integral para tu restaurante
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Acceso al Sistema</CardTitle>
            <CardDescription>
              Inicia sesión para acceder al panel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email o Usuario</Label>
                <Input
                  id="login-email"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  enterKeyHint="next"
                  placeholder="tu@email.com o nombre.usuario"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Empleados: usa solo tu nombre de usuario
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Contraseña</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
