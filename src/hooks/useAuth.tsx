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

  // Check exact match
  if (errors[message]) return errors[message];

  // Check partial match
  for (const [key, value] of Object.entries(errors)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }

  // Return original if no translation found
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoleAndApproval(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchRoleAndApproval(session.user.id), 0);
      } else {
        setRole(null);
        setApproved(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchRoleAndApproval]);

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
      const cleanName = displayName.trim().slice(0, 100);

      if (!cleanEmail || !password || !cleanName) {
        return { error: "Todos os campos são obrigatórios." };
      }
      if (password.length < 8) {
        return { error: "A senha deve ter no mínimo 8 caracteres." };
      }

      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { display_name: cleanName },
          emailRedirectTo: window.location.origin,
        },
      });
      return { error: error ? translateError(error.message) : null };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

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
