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

  if (errors[message]) return errors[message];

  for (const [key, value] of Object.entries(errors)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }

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
    let initialLoadDone = false;

    // Carrega a sessão inicial primeiro e garante que role/approved estejam prontos
    // antes de qualquer guard de rota renderizar.
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
        // FIX: Sem este .catch(), uma falha de rede no getSession() deixava
        // loading=true para sempre, travando o app com spinner infinito.
        console.error("getSession failed:", err);
        initialLoadDone = true;
        setLoading(false);
      });

    // FIX: onAuthStateChange dispara em TODA troca de token (incluindo refresh silencioso).
    // Só atualizamos role/approved em eventos que realmente mudam o usuário logado,
    // evitando renders e fetches desnecessários que causavam o loop.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // TOKEN_REFRESHED não muda o usuário — apenas atualiza a sessão silenciosamente.
      // Processar esse evento causava setState loops desnecessários.
      if (event === "TOKEN_REFRESHED") {
        setSession(session);
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await fetchRoleAndApproval(session.user.id);
      } else {
        setRole(null);
        setApproved(null);
      }

      // Só atualiza loading se a carga inicial já foi concluída,
      // evitando conflito de estado com o getSession() acima.
      if (initialLoadDone) {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
    // fetchRoleAndApproval é estável (useCallback com deps vazias) — seguro incluir
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
      // SEC: Remove caracteres de controle Unicode (U+0000–U+001F, U+007F, U+200B zero-width, etc.)
      // que poderiam causar comportamentos inesperados na renderização de nomes de usuário
      // ou em templates de email (ex.: quebrar linha em email HTML, injetar conteúdo invisível).
      const cleanName = displayName
        .trim()
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F\u200B\u200C\u200D\uFEFF]/g, "")
        .slice(0, 100);

      if (!cleanEmail || !password || !cleanName) {
        return { error: "Todos os campos são obrigatórios." };
      }
      if (password.length < 8) {
        return { error: "A senha deve ter no mínimo 8 caracteres." };
      }
      // SEC: bcrypt trunca silenciosamente senhas acima de 72 caracteres.
      // Informamos o limite ao invés de aceitar e truncar sem avisar.
      if (password.length > 72) {
        return { error: "A senha deve ter no máximo 72 caracteres." };
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
    // FIX: Limpa o estado local imediatamente antes de chamar signOut.
    // Sem isso, nos frames entre o signOut e o onAuthStateChange reagir,
    // componentes como AdminRoute ainda viam isAdmin=true e approved=true,
    // podendo exibir conteúdo protegido brevemente.
    setUser(null);
    setSession(null);
    setRole(null);
    setApproved(null);
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
