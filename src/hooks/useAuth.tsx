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
import { readRawSessionFromStorage } from "@/lib/offlineSessionFallback";

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
  // Marca quando o próprio usuário pediu para sair (botão "Sair") — distingue
  // de um SIGNED_OUT espontâneo disparado pelo SDK quando a renovação
  // automática do token falha por falta de internet (ver onAuthStateChange
  // abaixo). Sem essa distinção, um operador offline seria deslogado contra
  // a vontade assim que o access token expirasse, mesmo com refresh token
  // válido — exatamente o cenário que o suporte a offline da Produção
  // precisa evitar.
  const intentionalSignOutRef = useRef(false);

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
        // FIX: getSession() pode retornar null mesmo com uma sessão válida
        // salva localmente, se o access_token já expirou e a tentativa de
        // renovação automática falhou por falta de rede (comportamento
        // documentado do supabase-js). Sem isso, abrir o app offline depois
        // do token expirar desloga o operador mesmo com refresh_token
        // intacto — exatamente o cenário que o apontamento offline da
        // Produção precisa evitar.
        let effectiveSession = session;
        if (!effectiveSession && !navigator.onLine) {
          const raw = readRawSessionFromStorage();
          if (raw) {
            logger.error("getSession() retornou null offline — usando sessão crua do localStorage.");
            effectiveSession = raw;
          }
        }
        setSession(effectiveSession);
        setUser(effectiveSession?.user ?? null);
        if (effectiveSession?.user) await fetchRoleAndApproval(effectiveSession.user.id);
        initialLoadDone = true;
        setLoading(false);
      })
      .catch((err) => {
        logger.error("getSession failed:", err);
        if (!navigator.onLine) {
          const raw = readRawSessionFromStorage();
          if (raw) {
            logger.error("getSession() rejeitou offline — usando sessão crua do localStorage.");
            setSession(raw);
            setUser(raw.user);
            fetchRoleAndApproval(raw.user.id).finally(() => {
              initialLoadDone = true;
              setLoading(false);
            });
            return;
          }
        }
        initialLoadDone = true;
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "TOKEN_REFRESHED") { setSession(session); return; }
      // USER_UPDATED é disparado quando set_own_password atualiza auth.users.
      // Ignoramos re-fetch do profile aqui — o Realtime do profile já trata isso
      // com o valor definitivo pós-commit, evitando race condition com must_change_password.
      if (event === "USER_UPDATED") { setSession(session); return; }

      // FIX: quando o token de acesso expira enquanto o dispositivo está
      // offline, a tentativa automática de renovação falha e o SDK dispara
      // SIGNED_OUT mesmo com um refresh token ainda válido (comportamento
      // documentado do supabase-js — não há como renovar sem rede). Sem
      // este tratamento, um operador de produção seria deslogado contra a
      // vontade só por ficar sem internet, perdendo acesso ao apontamento
      // offline que dependemos dele conseguir abrir.
      // Mantemos a sessão local intacta e tentamos de novo quando a conexão
      // voltar; só aceitamos o SIGNED_OUT de verdade se foi por ação
      // intencional (botão Sair, bloqueio de acesso) ou se há rede mas o
      // servidor mesmo assim invalidou a sessão (token revogado de fato).
      if (event === "SIGNED_OUT" && !navigator.onLine && !intentionalSignOutRef.current) {
        logger.error("SIGNED_OUT recebido offline — mantendo sessão local até reconectar.");
        if (initialLoadDone) setLoading(false);
        return;
      }
      intentionalSignOutRef.current = false;

      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // FIX: antes, `setLoading(false)` era chamado imediatamente aqui,
        // em paralelo com fetchRoleAndApproval (sem esperar o resultado).
        // Isso liberava o AppShell para montar com role ainda nula — que
        // cai no fallback "estoque" — mostrando só Componentes + Estoque
        // no menu logo após o login, até a pessoa dar F5 (quando a sessão
        // já está pronta antes da query rodar). Agora só liberamos
        // `loading` depois que role/approval realmente terminaram de
        // carregar, garantindo que o menu já nasça completo.
        await fetchRoleAndApproval(session.user.id);
        if (initialLoadDone) setLoading(false);
        return;
      } else {
        setRole(null);
        setApproved(null);
      }
      if (initialLoadDone) setLoading(false);
    });

    // Quando a conexão volta, força uma tentativa de renovação real — se o
    // refresh token ainda for válido, dispara TOKEN_REFRESHED e a sessão
    // volta a ficar 100% confirmada pelo servidor; se não for mais válido
    // (revogado/expirado de verdade), dispara SIGNED_OUT — e aí sim,
    // corretamente, deve deslogar.
    const handleOnlineRetry = () => {
      supabase.auth.refreshSession().catch(() => { /* tratado via onAuthStateChange */ });
    };
    window.addEventListener("online", handleOnlineRetry);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnlineRetry);
    };
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
          intentionalSignOutRef.current = true;
          await supabase.auth.signOut();
          return { error: "Seu acesso foi bloqueado pelo administrador. Entre em contato com o suporte." };
        }
      }
      return { error: null };
    },
    []
  );

  const signOut = useCallback(async () => {
    intentionalSignOutRef.current = true;
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
