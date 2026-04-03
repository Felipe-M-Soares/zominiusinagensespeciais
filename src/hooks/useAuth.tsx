import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContext {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: "admin" | "client" | null;
  isAdmin: boolean;
  approved: boolean | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshApproval: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

function translateError(message: string): string {
  const errors: Record<string, string> = {
    "Invalid login credentials": "Email ou senha incorretos.",
    "Invalid email or password": "Email ou senha incorretos.",
    "Email not confirmed": "Confirme seu email antes de entrar. Verifique sua caixa de entrada.",
    "User already registered": "Este email já está cadastrado.",
    "Email already registered": "Este email já está cadastrado.",
    "Email already in use": "Este email já está em uso.",
    "Password should be at least 6 characters": "A senha deve ter no mínimo 6 caracteres.",
    "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
    "Signup requires a valid password": "Informe uma senha válida.",
    "Unable to validate email address: invalid format": "Formato de email inválido.",
    "Invalid email": "Email inválido.",
    "Email link is invalid or has expired": "O link expirou ou é inválido. Solicite um novo.",
    "Token has expired or is invalid": "O link expirou. Solicite um novo.",
    "User not found": "Usuário não encontrado.",
    "Too many requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "Email rate limit exceeded": "Limite de emails atingido. Tente novamente em alguns minutos.",
    "over_email_send_rate_limit": "Limite de emails atingido. Aguarde alguns minutos.",
    "For security purposes, you can only request this after": "Por segurança, aguarde antes de solicitar novamente.",
    "Session expired": "Sua sessão expirou. Faça login novamente.",
    "User is not authorized": "Sem permissão para realizar esta ação.",
    "New password should be different from the old password": "A nova senha deve ser diferente da atual.",
    "Auth session missing": "Sessão não encontrada. Faça login novamente.",
    "signup_disabled": "Novos cadastros estão desativados no momento.",
    "email_not_confirmed": "Confirme seu email antes de entrar.",
    "invalid_credentials": "Email ou senha incorretos.",
  };

  if (errors[message]) return errors[message];

  for (const [key, value] of Object.entries(errors)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }

  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // FIX LENTIDÃO: loading começa false para não bloquear render inicial.
  // Setamos true apenas enquanto fetchRoleAndApproval está em andamento.
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"admin" | "client" | null>(null);
  const [approved, setApproved] = useState<boolean | null>(null);

  const fetchRoleAndApproval = useCallback(async (userId: string) => {
    try {
      const [{ data: roleData }, { data: profileData }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("approved")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      setRole(roleData?.role ?? "client");
      setApproved(profileData?.approved ?? false);
    } catch (err) {
      console.error("Failed to fetch role/approval:", err);
      setRole("client");
      setApproved(false);
    }
  }, []);

  useEffect(() => {
    let initialLoadDone = false;

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchRoleAndApproval(session.user.id);
        }
        initialLoadDone = true;
        setLoading(false);
      })
      .catch((err) => {
        console.error("getSession failed:", err);
        initialLoadDone = true;
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "TOKEN_REFRESHED") {
        setSession(session);
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // FIX LENTIDÃO LOGIN: não bloqueamos setLoading(false) esperando role/approval
        // no evento SIGNED_IN — fazemos fetch em paralelo e só depois atualizamos.
        // Isso evita a trava de 1-3s na tela de login aguardando 2 queries extras.
        fetchRoleAndApproval(session.user.id).finally(() => {
          if (initialLoadDone) setLoading(false);
        });
        // Mas já liberamos o loading para que o router não fique travado
        if (initialLoadDone) setLoading(false);
        return;
      } else {
        setRole(null);
        setApproved(null);
      }

      if (initialLoadDone) {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchRoleAndApproval]);

  const clearLocalState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    setApproved(null);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) {
        return { error: "Email e senha são obrigatórios." };
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      return { error: error ? translateError(error.message) : null };
    },
    []
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string
    ): Promise<{ error: string | null }> => {
      const cleanEmail = email.trim().toLowerCase();
      const cleanName = displayName
        .trim()
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]|\u200B|\u200C|\u200D|\uFEFF/g, "")
        .slice(0, 100);

      if (!cleanEmail || !password || !cleanName) {
        return { error: "Todos os campos são obrigatórios." };
      }
      if (password.length < 8) {
        return { error: "A senha deve ter no mínimo 8 caracteres." };
      }
      if (password.length > 72) {
        return { error: "A senha deve ter no máximo 72 caracteres." };
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { display_name: cleanName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) return { error: translateError(error.message) };

      if (data.session) {
        clearLocalState();
        await supabase.auth.signOut();
      }

      return { error: null };
    },
    [clearLocalState]
  );

  const signOut = useCallback(async () => {
    clearLocalState();
    await supabase.auth.signOut();
  }, [clearLocalState]);

  const refreshApproval = useCallback(async () => {
    // CORREÇÃO: força refresh do token antes de ler do banco.
    // Sem isso, após auto-approve o RLS pode usar o token antigo e retornar
    // approved=false mesmo que o banco já tenha sido atualizado.
    try {
      await supabase.auth.refreshSession();
    } catch {
      // Se refresh falhar, tenta mesmo assim com getSession
    }
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.user) {
      await fetchRoleAndApproval(currentSession.user.id);
    }
  }, [fetchRoleAndApproval]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        role,
        isAdmin: role === "admin",
        approved,
        signIn,
        signUp,
        signOut,
        refreshApproval,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
