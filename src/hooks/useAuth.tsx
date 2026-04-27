import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { AppRole } from "@/types/roles";
import { logger } from "@/lib/logger";

interface AuthContext {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  approved: boolean | null;
  blocked: boolean;
  signIn: (login: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshApproval: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

const ERROR_MAP: Record<string, string> = {
  "Invalid login credentials":   "Login ou senha incorretos.",
  "Invalid email or password":   "Login ou senha incorretos.",
  "invalid_credentials":         "Login ou senha incorretos.",
  "Password should be at least 6 characters": "A senha deve ter no mínimo 6 caracteres.",
  "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
  "User not found":              "Usuário não encontrado.",
  "Too many requests":           "Muitas tentativas. Aguarde alguns minutos.",
  "Session expired":             "Sua sessão expirou. Faça login novamente.",
  "User is not authorized":      "Sem permissão para realizar esta ação.",
  "New password should be different from the old password": "A nova senha deve ser diferente da atual.",
  "Auth session missing":        "Sessão não encontrada. Faça login novamente.",
};

function translateError(message: string): string {
  if (ERROR_MAP[message]) return ERROR_MAP[message];
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return message;
}

// SECURITY: taxa máxima de tentativas de login (client-side, não substitui server-side)
const MAX_ATTEMPTS  = 5;
const WINDOW_MS     = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole]       = useState<AppRole | null>(null);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [blocked, setBlocked]   = useState(false);

  const signInWindowStartRef  = useRef<number>(0);
  const signInAttemptsRef     = useRef<number>(0);

  const fetchRoleAndApproval = useCallback(async (userId: string) => {
    try {
      // Uma query única elimina janela TOCTOU entre setApproved/setBlocked
      const [{ data: roleData }, { data: profileData, error: profileError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.from("profiles").select("approved, blocked").eq("user_id", userId).maybeSingle(),
      ]);

      setRole((roleData?.role as AppRole) ?? "funcionario");

      if (profileError) {
        logger.error("fetchRoleAndApproval profiles error:", profileError.message);
        setApproved(true);
        setBlocked(false);
      } else if (profileData == null) {
        setApproved(null);
        setBlocked(false);
      } else {
        setBlocked(profileData.blocked ?? false);
        setApproved(profileData.approved ?? true);
      }
    } catch (err) {
      logger.error("Failed to fetch role/approval:", err);
      setRole("funcionario");
      setApproved(true);
      setBlocked(false);
    }
  }, []);

  useEffect(() => {
    let initialLoadDone = false;

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) await fetchRoleAndApproval(session.user.id);
        initialLoadDone = true;
        setLoading(false);
      })
      .catch((err) => {
        logger.error("getSession failed:", err);
        initialLoadDone = true;
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "TOKEN_REFRESHED") { setSession(session); return; }

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        fetchRoleAndApproval(session.user.id).finally(() => {
          if (initialLoadDone) setLoading(false);
        });
        if (initialLoadDone) setLoading(false);
        return;
      } else {
        setRole(null);
        setApproved(null);
      }

      if (initialLoadDone) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchRoleAndApproval]);

  // Polling a cada 15s para detectar bloqueio pelo admin
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const { data } = await supabase
          .from("profiles")
          .select("blocked, approved")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;
        if (data?.blocked === true) {
          setBlocked(true);
          setApproved(false);
        }
      } catch { /* silencioso */ }
    };

    const interval = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id]);

  const clearLocalState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    setApproved(null);
    setBlocked(false);
  }, []);

  const signIn = useCallback(
    async (login: string, password: string): Promise<{ error: string | null }> => {
      // FIX: valida ANTES de construir o email — cleanEmail nunca será falsy depois
      const trimmedLogin = login.trim();
      if (!trimmedLogin || !password) {
        return { error: "Login e senha são obrigatórios." };
      }

      // Rate limiting client-side
      const now = Date.now();
      if (now - signInWindowStartRef.current >= WINDOW_MS) {
        signInWindowStartRef.current = now;
        signInAttemptsRef.current = 0;
      }
      signInAttemptsRef.current += 1;
      if (signInAttemptsRef.current > MAX_ATTEMPTS) {
        const elapsed  = now - signInWindowStartRef.current;
        const waitSec  = Math.ceil((WINDOW_MS - elapsed) / 1000);
        return { error: `Muitas tentativas de login. Aguarde ${Math.max(waitSec, 1)} segundos.` };
      }

      const email = `${trimmedLogin.toLowerCase()}@interno.conceptus`;

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: translateError(error.message) };

      // SEGURANÇA: verifica bloqueio antes de liberar acesso
      if (data.user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("blocked")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (profileData?.blocked === true) {
          await supabase.auth.signOut();
          return {
            error: "Seu acesso foi bloqueado pelo administrador. Entre em contato com o suporte.",
          };
        }
      }

      return { error: null };
    },
    []
  );

  const signOut = useCallback(async () => {
    clearLocalState();
    await supabase.auth.signOut();
  }, [clearLocalState]);

  const refreshApproval = useCallback(async () => {
    try { await supabase.auth.refreshSession(); } catch { /* fallback para getSession */ }
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.user) await fetchRoleAndApproval(currentSession.user.id);
  }, [fetchRoleAndApproval]);

  return (
    <AuthContext.Provider value={{
      user, session, loading, role,
      isAdmin: role === "admin",
      approved, blocked, signIn, signOut, refreshApproval,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
