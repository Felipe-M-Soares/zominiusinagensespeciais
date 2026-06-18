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
import { translateError } from "@/lib/authErrors";

interface AuthContext {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  isComercial: boolean;
  isFinanceiro: boolean;
  isProducao: boolean;
  isQualidade: boolean;
  isEstoque: boolean;
  approved: boolean | null;
  blocked: boolean;
  mustChangePassword: boolean;
  clearMustChangePassword: () => void;
  signIn: (login: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshApproval: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

// SECURITY: taxa máxima de tentativas de login (client-side, não substitui server-side)
const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]         = useState<User | null>(null);
  const [session, setSession]   = useState<Session | null>(null);
  const [loading, setLoading]   = useState(true);
  const [role, setRole]         = useState<AppRole | null>(null);
  const [approved, setApproved]               = useState<boolean | null>(null);
  const [blocked, setBlocked]                 = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Flag que impede fetchRoleAndApproval de sobrescrever mustChangePassword=false
  // imediatamente após a troca de senha (o onAuthStateChange pode disparar antes
  // do commit em profiles, relendo must_change_password=true do banco)
  const passwordJustChangedRef = useRef(false);

  const signInWindowStartRef = useRef<number>(0);
  const signInAttemptsRef    = useRef<number>(0);

  const fetchRoleAndApproval = useCallback(async (userId: string) => {
    try {
      const [{ data: roleData }, { data: profileData, error: profileError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.from("profiles").select("approved, blocked, must_change_password").eq("user_id", userId).maybeSingle(),
      ]);
      setRole((roleData?.role as AppRole) ?? "estoque");
      if (profileError) {
        logger.error("fetchRoleAndApproval profiles error:", profileError.message);
        setApproved(true);
        setBlocked(false);
        setMustChangePassword(false);
      } else if (profileData == null) {
        setApproved(true);
        setBlocked(false);
        setMustChangePassword(false);
      } else {
        setBlocked(profileData.blocked ?? false);
        setApproved(profileData.approved ?? true);
        // Só atualiza mustChangePassword se a senha não acabou de ser trocada
        // (evita loop: onAuthStateChange → fetchRoleAndApproval → lê true → redireciona)
        if (!passwordJustChangedRef.current) {
          setMustChangePassword((profileData as { must_change_password?: boolean }).must_change_password ?? false);
        }
      }
    } catch (err) {
      logger.error("Failed to fetch role/approval:", err);
      setRole("estoque");
      setApproved(true);
      setBlocked(false);
      setMustChangePassword(false);
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
      // USER_UPDATED é disparado quando set_own_password atualiza auth.users.
      // Ignoramos re-fetch do profile aqui — o Realtime do profile já trata isso
      // com o valor definitivo pós-commit, evitando race condition com must_change_password.
      if (event === "USER_UPDATED") { setSession(session); return; }
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

  // FIX: Substituído polling a cada 15s por canal Realtime (WebSocket).
  // Dispara somente quando o dado muda no banco, eliminando N×4 queries/min.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`profile-status:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const updated = payload.new as { blocked?: boolean; approved?: boolean; must_change_password?: boolean };
          setBlocked(updated.blocked ?? false);
          setApproved(updated.approved ?? true);
          // Realtime: sempre confia no valor do banco (é o evento pós-commit real)
          // Reseta a flag de proteção pois agora temos o valor definitivo
          passwordJustChangedRef.current = false;
          setMustChangePassword(updated.must_change_password ?? false);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const clearLocalState = useCallback(() => {
    setUser(null); setSession(null); setRole(null); setApproved(null);
    setBlocked(false); setMustChangePassword(false);
    passwordJustChangedRef.current = false;
  }, []);

  const signIn = useCallback(
    async (login: string, password: string): Promise<{ error: string | null }> => {
      const trimmedLogin = login.trim();
      if (!trimmedLogin || !password) return { error: "Login e senha são obrigatórios." };

      const now = Date.now();
      if (now - signInWindowStartRef.current >= WINDOW_MS) {
        signInWindowStartRef.current = now;
        signInAttemptsRef.current = 0;
      }
      signInAttemptsRef.current += 1;
      if (signInAttemptsRef.current > MAX_ATTEMPTS) {
        const elapsed = now - signInWindowStartRef.current;
        const waitSec = Math.ceil((WINDOW_MS - elapsed) / 1000);
        // Exponential backoff: after MAX_ATTEMPTS, each extra attempt doubles wait
        const extra = signInAttemptsRef.current - MAX_ATTEMPTS;
        const backoffSec = Math.min(Math.pow(2, extra) * 5, 300); // cap at 5 min
        return { error: `Muitas tentativas de login. Aguarde ${Math.max(waitSec, backoffSec)} segundos.` };
      }

      const email = `${trimmedLogin.toLowerCase()}@interno.conceptus`;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: translateError(error.message) };

      if (data.user) {
        const { data: profileData } = await supabase
          .from("profiles").select("blocked").eq("user_id", data.user.id).maybeSingle();
        if (profileData?.blocked === true) {
          await supabase.auth.signOut();
          return { error: "Seu acesso foi bloqueado pelo administrador. Entre em contato com o suporte." };
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
    try { await supabase.auth.refreshSession(); } catch { /* fallback */ }
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user) await fetchRoleAndApproval(s.user.id);
  }, [fetchRoleAndApproval]);

  return (
    <AuthContext.Provider value={{
      user, session, loading, role,
      isAdmin:      role === "admin",
      isComercial:  role === "comercial",
      isFinanceiro: role === "financeiro",
      isProducao:   role === "producao",
      isQualidade:  role === "qualidade",
      isEstoque:    role === "estoque",
      approved, blocked, mustChangePassword,
      clearMustChangePassword: () => {
        passwordJustChangedRef.current = true;
        setMustChangePassword(false);
        // Libera a flag após 5s — tempo suficiente para o commit propagar
        setTimeout(() => { passwordJustChangedRef.current = false; }, 5000);
      },
      signIn, signOut, refreshApproval,
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
