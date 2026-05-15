/**
 * ProdutosPanel — Cadastro de Produtos
 * Código, descrição, tempo de ciclo, pç/hora, material, lead time, controle dimensional
 */

import { useState } from "react";
import { Plus, X, Search, Package, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type TipoMaterial = "aco_inox" | "aco_carbono" | "aluminio" | "latao" | "polimero" | "outro";

interface Produto {
  id: string;
  codigo: string;
  descricao: string;
  tempoCiclo: number; // segundos por peça
  pecasPorHora: number;
  tipoMaterial: TipoMaterial;
  leadTime: number; // dias
  dimensoes: { comprimento?: number; largura?: number; altura?: number; diametro?: number };
  peso?: number; // gramas
  ativo: boolean;
}

const MATERIAL_LABEL: Record<TipoMaterial, string> = {
  aco_inox: "Aço Inox", aco_carbono: "Aço Carbono", aluminio: "Alumínio",
  latao: "Latão", polimero: "Polímero", outro: "Outro",
};

const MOCK_PRODUTOS: Produto[] = [
  { id: "1", codigo: "PÇ-001", descricao: "Eixo Principal 25mm", tempoCiclo: 180, pecasPorHora: 20,
    tipoMaterial: "aco_inox", leadTime: 3, dimensoes: { diametro: 25, comprimento: 200 }, peso: 850, ativo: true },
  { id: "2", codigo: "PÇ-002", descricao: "Flange de Fixação", tempoCiclo: 240, pecasPorHora: 15,
    tipoMaterial: "aco_carbono", leadTime: 5, dimensoes: { comprimento: 120, largura: 120, altura: 25 }, peso: 1200, ativo: true },
  { id: "3", codigo: "PÇ-003", descricao: "Tampa Vedante", tempoCiclo: 90, pecasPorHora: 40,
    tipoMaterial: "aluminio", leadTime: 2, dimensoes: { diametro: 80, altura: 15 }, peso: 120, ativo: true },
  { id: "4", codigo: "PÇ-004", descricao: "Bucha de Bronze", tempoCiclo: 120, pecasPorHora: 30,
    tipoMaterial: "latao", leadTime: 4, dimensoes: { diametro: 40, comprimento: 60 }, peso: 380, ativo: false },
];

// ── Modal Produto ─────────────────────────────────────────────────────────────

function ProdutoModal({ open, produto, onClose, onSaved }: {
  open: boolean; produto?: Produto; onClose: () => void; onSaved: (p: Produto) => void;
}) {
  const [form, setForm] = useState({
    codigo: produto?.codigo || "",
    descricao: produto?.descricao || "",
    tempoCiclo: String(produto?.tempoCiclo || ""),
    pecasPorHora: String(produto?.pecasPorHora || ""),
    tipoMaterial: produto?.tipoMaterial || "aco_carbono" as TipoMaterial,
    leadTime: String(produto?.leadTime || ""),
    comprimento: String(produto?.dimensoes?.comprimento || ""),
    largura: String(produto?.dimensoes?.largura || ""),
    altura: String(produto?.dimensoes?.altura || ""),
    diametro: String(produto?.dimensoes?.diametro || ""),
    peso: String(produto?.peso || ""),
  });

  if (!open) return null;

  function save() {
    if (!form.codigo || !form.descricao || !form.tempoCiclo) {
      toast.error("Código, descrição e tempo de ciclo são obrigatórios");
      return;
    }
    const p: Produto = {
      id: produto?.id || Date.now().toString(),
      codigo: form.codigo, descricao: form.descricao,
      tempoCiclo: Number(form.tempoCiclo),
      pecasPorHora: Number(form.pecasPorHora) || Math.round(3600 / Number(form.tempoCiclo)),
      tipoMaterial: form.tipoMaterial,
      leadTime: Number(form.leadTime) || 0,
      dimensoes: {
        comprimento: form.comprimento ? Number(form.comprimento) : undefined,
        largura: form.largura ? Number(form.largura) : undefined,
        altura: form.altura ? Number(form.altura) : undefined,
        diametro: form.diametro ? Number(form.diametro) : undefined,
      },
      peso: form.peso ? Number(form.peso) : undefined,
      ativo: produto?.ativo ?? true,
    };
    onSaved(p);
    toast.success(produto ? "Produto atualizado!" : "Produto cadastrado!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="text-sm font-semibold">{produto ? "Editar Produto" : "Novo Produto"}</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Código *</label>
              <Input placeholder="PÇ-005" value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Material</label>
              <select value={form.tipoMaterial} onChange={e => setForm(f => ({ ...f, tipoMaterial: e.target.value as TipoMaterial }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                {(Object.keys(MATERIAL_LABEL) as TipoMaterial[]).map(m => (
                  <option key={m} value={m}>{MATERIAL_LABEL[m]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Descrição *</label>
            <Input placeholder="Descrição do produto" value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} className="rounded-xl" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Ciclo (seg) *</label>
              <Input type="number" min={1} placeholder="120" value={form.tempoCiclo} onChange={e => setForm(f => ({ ...f, tempoCiclo: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pç/Hora</label>
              <Input type="number" min={1} placeholder="Auto" value={form.pecasPorHora} onChange={e => setForm(f => ({ ...f, pecasPorHora: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lead Time (d)</label>
              <Input type="number" min={0} placeholder="3" value={form.leadTime} onChange={e => setForm(f => ({ ...f, leadTime: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Controle Dimensional (mm)</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "comprimento", label: "Comprimento" },
                { key: "largura", label: "Largura" },
                { key: "altura", label: "Altura / Esp." },
                { key: "diametro", label: "Diâmetro" },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[10px] text-muted-foreground mb-1 block">{f.label}</label>
                  <Input type="number" min={0} step={0.01} placeholder="–"
                    value={(form as Record<string, string>)[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Peso (g)</label>
            <Input type="number" min={0} placeholder="0" value={form.peso} onChange={e => setForm(f => ({ ...f, peso: e.target.value }))} className="rounded-xl" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl" onClick={save}>{produto ? "Salvar" : "Cadastrar"}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ProdutosPanel({ isAdmin }: { isAdmin: boolean }) {
  const [produtos, setProdutos] = useState<Produto[]>(MOCK_PRODUTOS);
  const [search, setSearch] = useState("");
  const [filtroMaterial, setFiltroMaterial] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<Produto | undefined>();

  const filtered = produtos.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q);
    const matchMaterial = filtroMaterial === "todos" || p.tipoMaterial === filtroMaterial;
    return matchSearch && matchMaterial;
  });

  function save(p: Produto) {
    setProdutos(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next; }
      return [p, ...prev];
    });
    setEditando(undefined);
  }

  function toggleAtivo(id: string) {
    setProdutos(prev => prev.map(p => p.id === id ? { ...p, ativo: !p.ativo } : p));
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: produtos.length, color: "text-primary" },
          { label: "Ativos", value: produtos.filter(p => p.ativo).length, color: "text-green-500" },
          { label: "Inativos", value: produtos.filter(p => !p.ativo).length, color: "text-muted-foreground" },
        ].map(item => (
          <div key={item.label} className="rounded-2xl border bg-card/60 p-3 text-center">
            <p className={cn("text-2xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl text-sm h-9" />
        </div>
        <select value={filtroMaterial} onChange={e => setFiltroMaterial(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos materiais</option>
          {(Object.keys(MATERIAL_LABEL) as TipoMaterial[]).map(m => (
            <option key={m} value={m}>{MATERIAL_LABEL[m]}</option>
          ))}
        </select>
        {isAdmin && (
          <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => { setEditando(undefined); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        )}
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border bg-card/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                {["Código", "Descrição", "Material", "Ciclo", "Pç/Hora", "Lead Time", "Status", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filtered.map(p => (
                <tr key={p.id} className={cn("hover:bg-muted/20 transition-colors", !p.ativo && "opacity-50")}>
                  <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{p.codigo}</td>
                  <td className="px-4 py-3 text-xs font-medium">{p.descricao}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{MATERIAL_LABEL[p.tipoMaterial]}</td>
                  <td className="px-4 py-3 text-xs tabular-nums">{p.tempoCiclo}s</td>
                  <td className="px-4 py-3 text-xs tabular-nums">{p.pecasPorHora}</td>
                  <td className="px-4 py-3 text-xs tabular-nums">{p.leadTime}d</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full",
                      p.ativo ? "bg-green-500/10 text-green-500" : "bg-muted/40 text-muted-foreground")}>
                      {p.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditando(p); setModalOpen(true); }}
                          className="h-6 w-6 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
                          <Edit2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button onClick={() => toggleAtivo(p.id)}
                          className="h-6 w-6 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  )}
                  {!isAdmin && <td />}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Nenhum produto encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProdutoModal
        open={modalOpen} produto={editando}
        onClose={() => { setModalOpen(false); setEditando(undefined); }}
        onSaved={save}
      />
    </div>
  );
}
