import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useNavigate as useRouterNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContext {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: "admin" | "client" | null;
  isAdmin: boolean;
  approved: boolean | null;
  blocked: boolean;
  signIn: (login: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshApproval: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

function translateError(message: string): string {
  const errors: Record<string, string> = {
    "Invalid login credentials": "Login ou senha incorretos.",
    "Invalid email or password": "Login ou senha incorretos.",
    "invalid_credentials": "Login ou senha incorretos.",
    "Password should be at least 6 characters": "A senha deve ter no mínimo 6 caracteres.",
    "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
    "User not found": "Usuário não encontrado.",
    "Too many requests": "Muitas tentativas. Aguarde alguns minutos.",
    "Session expired": "Sua sessão expirou. Faça login novamente.",
    "User is not authorized": "Sem permissão para realizar esta ação.",
    "New password should be different from the old password": "A nova senha deve ser diferente da atual.",
    "Auth session missing": "Sessão não encontrada. Faça login novamente.",
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
  const [blocked, setBlocked] = useState<boolean>(false);

  // SECURITY: rate limiting client-side — evita automação trivial no browser.
  // Não substitui rate limiting server-side do Supabase.
  const signInWindowStartRef = useRef<number>(0); // início da janela de 60s atual
  const signInAttemptsRef = useRef<number>(0);

  const fetchRoleAndApproval = useCallback(async (userId: string) => {
    try {
      // Query unificada: role + approved + blocked em paralelo, mas profiles em UMA query
      // SECURITY: duas queries separadas (approved e blocked) criavam uma janela TOCTOU —
      // entre setApproved(true) e setBlocked(true), o ProtectedRoute rendia acesso brevemente
      // a um usuário bloqueado. Uma query única elimina essa janela.
      const [{ data: roleData }, { data: profileData, error: profileError }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("approved, blocked")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      setRole(roleData?.role ?? "client");

      if (profileError) {
        console.error("fetchRoleAndApproval profiles error:", profileError.message);
        // Erro de rede/banco: assume aprovado para não bloquear acesso,
        // mas mantém blocked=false (nunca assume bloqueado por falha de rede)
        setApproved(true);
        setBlocked(false);
      } else if (profileData == null) {
        // Perfil ainda não existe — race condition pós-cadastro; aguarda
        setApproved(null);
        setBlocked(false);
      } else {
        // Atualiza ambos de uma vez, sem janela entre as duas chamadas
        setBlocked(profileData.blocked ?? false);
        setApproved(profileData.approved ?? true);
      }

    } catch (err) {
      console.error("Failed to fetch role/approval:", err);
      setRole("client");
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

  // SECURITY: Realtime polling — detecta bloqueio pelo admin enquanto o usuário está ativo.
  // Usa polling a cada 30s em vez de Supabase Realtime para evitar expor a tabela profiles
  // via websocket sem RLS adequado no canal realtime.
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
          // Admin bloqueou enquanto o usuário estava ativo.
          // Seta blocked=true PRIMEIRO para mostrar a tela de "Conta Bloqueada"
          // via PendingApproval. O usuário vê a mensagem e sai manualmente.
          setBlocked(true);
          setApproved(false);
          // Não chamamos signOut() aqui — o usuário vê a tela e clica em "Voltar para o login"
        }
      } catch {
        // Silencioso — não interrompe fluxo normal
      }
    };

    const interval = setInterval(poll, 15_000); // a cada 15 segundos
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id, blocked]);

  const clearLocalState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    setApproved(null);
    setBlocked(false);
  }, []);

  const signIn = useCallback(
    async (login: string, password: string): Promise<{ error: string | null }> => {
      // Resolve login (username) → internal email used by Supabase Auth
      const email = `${login.trim().toLowerCase()}@interno.conceptus`;
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) {
        return { error: "Login e senha são obrigatórios." };
      }

      // SECURITY: rate limiting — máx 5 tentativas por janela de 60s.
      const now = Date.now();
      const ONE_MINUTE = 60_000;
      // Abre nova janela se a anterior já expirou
      if (now - signInWindowStartRef.current >= ONE_MINUTE) {
        signInWindowStartRef.current = now;
        signInAttemptsRef.current = 0;
      }
      signInAttemptsRef.current += 1;
      if (signInAttemptsRef.current > 5) {
        const elapsed = now - signInWindowStartRef.current;
        const waitSec = Math.ceil((ONE_MINUTE - elapsed) / 1000);
        return { error: `Muitas tentativas de login. Aguarde ${waitSec > 0 ? waitSec : 1} segundos antes de tentar novamente.` };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) return { error: translateError(error.message) };

      // SEGURANÇA: checa se o usuário está bloqueado ANTES de liberar acesso
      if (data.user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("blocked")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (profileData?.blocked === true) {
          // Desloga imediatamente — não deixa entrar
          await supabase.auth.signOut();
          return {
            error:
              "Seu acesso foi bloqueado pelo administrador. Entre em contato com o suporte para mais informações.",
          };
        }
      }

      return { error: null };
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
          // FIX: usa VITE_SITE_URL quando disponível — mesmo padrão de Login.tsx.
          emailRedirectTo: import.meta.env.VITE_SITE_URL ?? window.location.origin,
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
        blocked,
        signIn,
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
