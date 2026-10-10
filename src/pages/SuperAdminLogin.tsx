import { auditDeniedAccess } from "@/lib/audit-access";
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const denegado = useRef<string | null>(null);
  const checking = authLoading || (!!user && superAdminLoading);

  useEffect(() => {
    if (!checking && user && isSuperAdmin) {
      navigate("/super-admin");
    }
  }, [checking, user, isSuperAdmin, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // La comprobación de super admin se resuelve en el próximo render vía
    // useSuperAdmin; si no lo es, el bloque de abajo avisa y ofrece cambiar
    // de cuenta.
    await signIn(email.trim().toLowerCase(), password);
    setLoading(false);
  };

  const handleSwitchAccount = async () => {
    setSwitching(true);
    await signOut();
    setSwitching(false);
  };

  // Si hay sesión pero no es super admin, tras la comprobación se avisa y se ofrece cambiar de cuenta.
  useEffect(() => {
    if (!checking && user && !isSuperAdmin) {
      if (denegado.current !== user.id) {
        denegado.current = user.id;
        void auditDeniedAccess("/super-admin/login");
        toast.error("Esta cuenta no tiene permisos de Super Administrador");
      }
    }
  }, [checking, user, isSuperAdmin]);

  if (checking) {
    return (
      <div className="min-h-app flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-app flex items-center justify-center bg-gradient-to-br from-background via-background to-destructive/5 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-3xl font-bold">Super Admin</h1>
          <p className="text-muted-foreground mt-2">
            Acceso restringido de control del sistema
          </p>
        </div>

        {user && !isSuperAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Acceso denegado</CardTitle>
              <CardDescription>
                La cuenta <span className="font-medium">{user.email}</span> no tiene permisos de Super
                Administrador. Cierra sesión para intentarlo con otra cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSwitchAccount}
                disabled={switching}
              >
                {switching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Cerrar sesión e intentar con otra cuenta
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Inicio de sesión seguro</CardTitle>
              <CardDescription>
                Introduce las credenciales de tu cuenta de Super Administrador
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="super-admin-email">Email</Label>
                  <Input
                    id="super-admin-email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    enterKeyHint="next"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="super-admin-password">Contraseña</Label>
                  <Input
                    id="super-admin-password"
                    type="password"
                    autoComplete="current-password"
                    enterKeyHint="go"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" variant="destructive" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {loading ? "Verificando..." : "Acceder"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
