import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export function useSuperAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (authLoading) return;

    if (!user) {
      setIsSuperAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from("super_admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        setIsSuperAdmin(!error && !!data);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [user, authLoading]);

  return { isSuperAdmin, loading: authLoading || loading };
}
