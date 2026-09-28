/**
 * Aba Clientes do Comercial: busca (nome, documento, cidade, telefone, e-mail),
 * ordenação, cards com contato rápido, último pedido, total comprado e crédito
 * de devolução disponível. Clique no card abre o detalhe do cliente.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Loader2, MapPin, Pencil, Search, ShoppingCart, Trash2, User, UserPlus, Users, Wallet, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { ContatoBotoes, soDigitos } from "@/components/comercial/ContatoBotoes";
import { STATUS_VENDA, totalPedido, type Cliente, type PedidoCompleto } from "@/types/comercial";

type Ordem = "nome" | "recentes" | "maior";

interface Stats { total: number; pedidos: number; ultimo: string | null }

interface Props {
  clientes: Cliente[];
  pedidos: PedidoCompleto[];
  loading: boolean;
  isAdmin: boolean;
  verTudo: boolean;
  qtdDuplicados: number;
  onNovo: () => void;
  onEditar: (c: Cliente) => void;
  onExcluir: (c: Cliente) => void;
  onPedido: (c: Cliente) => void;
  onDetalhe: (c: Cliente) => void;
  onDuplicados: () => void;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LIMITE = 60;

export function ClientesPanel({ clientes, pedidos, loading, isAdmin, verTudo, qtdDuplicados, onNovo, onEditar, onExcluir, onPedido, onDetalhe, onDuplicados }: Props) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>(() => {
    try { return (localStorage.getItem("comercial.clientes.ordem") as Ordem) || "nome"; } catch { return "nome"; }
  });
  const [limite, setLimite] = useState(LIMITE);
  const [creditos, setCreditos] = useState<Map<string, number>>(new Map());

  useEffect(() => { try { localStorage.setItem("comercial.clientes.ordem", ordem); } catch { /* preferência de UI */ } }, [ordem]);
  useEffect(() => { setLimite(LIMITE); }, [busca, ordem]);

  // Crédito de devolução em aberto por cliente (se o perfil não enxergar, fica vazio).
  useEffect(() => {
    let cancel = false;
    supabase.from("contas_financeiras")
      .select("valor, pedidos_comerciais!inner(cliente_id)")
      .eq("categoria", "credito_devolucao_cliente")
      .in("status", ["aberto", "vencido"])
      .then(({ data }) => {
        if (cancel || !data) return;
        const m = new Map<string, number>();
        for (const r of data as { valor: number; pedidos_comerciais: { cliente_id: string } | null }[]) {
          const id = r.pedidos_comerciais?.cliente_id;
          if (id) m.set(id, (m.get(id) ?? 0) + (Number(r.valor) || 0));
        }
        setCreditos(m);
      });
    return () => { cancel = true; };
  }, []);

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const p of pedidos) {
      if (p.status === "cancelado") continue;
      const s = m.get(p.cliente_id) ?? { total: 0, pedidos: 0, ultimo: null };
      if (!s.ultimo || p.created_at > s.ultimo) s.ultimo = p.created_at;
      if (STATUS_VENDA.includes(p.status)) { s.total += totalPedido(p); s.pedidos += 1; }
      m.set(p.cliente_id, s);
    }
    return m;
  }, [pedidos]);

  const lista = useMemo(() => {
    const termos = semAcento(busca.trim()).split(/\s+/).filter(Boolean);
    const digitos = soDigitos(busca);
    const f = clientes.filter(c => {
      if (!termos.length) return true;
      if (digitos.length >= 3 && (soDigitos(c.documento).includes(digitos) || soDigitos(c.telefone).includes(digitos))) return true;
      const alvo = semAcento(`${c.nome} ${c.documento ?? ""} ${c.municipio ?? ""} ${c.uf ?? ""} ${c.email ?? ""} ${c.telefone ?? ""}`);
      return termos.every(t => alvo.includes(t));
    });
    const st = (c: Cliente) => stats.get(c.id);
    return f.sort((a, b) => {
      if (ordem === "recentes") return (st(b)?.ultimo ?? "").localeCompare(st(a)?.ultimo ?? "") || a.nome.localeCompare(b.nome, "pt-BR");
      if (ordem === "maior") return (st(b)?.total ?? 0) - (st(a)?.total ?? 0) || a.nome.localeCompare(b.nome, "pt-BR");
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [clientes, busca, ordem, stats]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, documento ou cidade..." className="h-11 pl-9 pr-9" aria-label="Buscar cliente" />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button className="h-11 gap-1.5" onClick={onNovo} aria-label="Novo cliente"><UserPlus className="h-4 w-4" />Novo<span className="hidden sm:inline"> cliente</span></Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Ordenar clientes">
          <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground mx-1.5 shrink-0" />
          {([["nome", "A–Z"], ["recentes", "Compra recente"], ["maior", "Mais comprou"]] as [Ordem, string][]).map(([id, l]) => (
            <button key={id} type="button" role="radio" aria-checked={ordem === id} onClick={() => setOrdem(id)}
              className={cn("h-9 px-2.5 rounded-lg text-sm font-medium whitespace-nowrap", ordem === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {verTudo && qtdDuplicados > 0 && (
          <Button variant="outline" className="h-11 gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-400" onClick={onDuplicados} title="Cadastros com o mesmo CPF/CNPJ ou nome">
            <Users className="h-4 w-4" />{qtdDuplicados} repetido{qtdDuplicados > 1 ? "s" : ""}
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">{lista.length} cliente{lista.length !== 1 ? "s" : ""}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando clientes...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border bg-card text-center py-14 px-6 space-y-3">
          <User className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="font-medium">{busca ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
          <p className="text-sm text-muted-foreground">{busca ? "Confira a grafia ou busque pelo CPF/CNPJ." : "Cadastre o primeiro cliente para começar a vender."}</p>
          {busca
            ? <Button variant="outline" onClick={() => setBusca("")}>Limpar busca</Button>
            : <Button onClick={onNovo} className="gap-1.5"><UserPlus className="h-4 w-4" />Cadastrar cliente</Button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {lista.slice(0, limite).map(c => {
              const s = stats.get(c.id);
              const credito = creditos.get(c.id) ?? 0;
              const local = [c.municipio, c.uf].filter(Boolean).join("/");
              return (
                <div key={c.id} className="rounded-2xl border bg-card overflow-hidden flex flex-col">
                  <button type="button" onClick={() => onDetalhe(c)} className="p-4 text-left flex flex-col justify-start gap-2 flex-1 hover:bg-muted/30 transition-colors" aria-label={`Ver detalhes de ${c.nome}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold leading-tight truncate" title={c.nome}>{c.nome}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {local && <><MapPin className="inline h-3 w-3 -mt-0.5 mr-0.5" />{local}</>}
                          {local && c.documento ? " · " : ""}{c.documento}
                          {!local && !c.documento && "Sem cidade e documento"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums leading-tight">{s?.total ? formatBRL(s.total) : "—"}</p>
                        <p className="text-xs text-muted-foreground">{s?.pedidos ? `${s.pedidos} pedido${s.pedidos !== 1 ? "s" : ""}` : "sem compras"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {s?.ultimo ? `último pedido ${new Date(s.ultimo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}` : "nunca comprou"}
                      </span>
                      {credito > 0 && <span className="rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-400 px-2 py-0.5 font-medium inline-flex items-center gap-1"><Wallet className="h-3 w-3" />crédito {formatBRL(credito)}</span>}
                      {!c.telefone && !c.email && <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5">sem contato</span>}
                    </div>
                  </button>
                  <div className="border-t bg-muted/20 p-2.5 flex flex-wrap items-center gap-1.5">
                    <ContatoBotoes telefone={c.telefone} email={c.email} compacto />
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onEditar(c)} aria-label="Editar cadastro" title="Editar cadastro"><Pencil className="h-4 w-4" /></Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-destructive" onClick={() => onExcluir(c)} aria-label="Excluir cliente" title="Excluir cliente"><Trash2 className="h-4 w-4" /></Button>
                      )}
                      <Button className="h-10 gap-1.5" onClick={() => onPedido(c)}><ShoppingCart className="h-4 w-4" />Pedido</Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {lista.length > limite && (
            <div className="text-center">
              <Button variant="outline" className="h-11" onClick={() => setLimite(l => l + LIMITE)}>Mostrar mais ({lista.length - limite} restantes)</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
