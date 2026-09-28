/**
 * Encontra cadastros de cliente repetidos (mesmo CPF/CNPJ ou mesmo nome) e
 * permite juntar num só. Os pedidos e o histórico do cadastro removido passam
 * para o que fica (RPC `mesclar_clientes`, só admin/gerente).
 */
import { useMemo, useState } from "react";
import { Loader2, Merge, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Cliente } from "@/types/comercial";
import { agruparDuplicados } from "@/lib/clientesDuplicados";

function completude(c: Cliente) {
  return [c.documento, c.telefone, c.email, c.cep, c.logradouro, c.numero, c.municipio, c.uf].filter(v => (v ?? "").toString().trim()).length;
}

export function DuplicadosClientesDialog({ open, onClose, clientes, onMesclado }: {
  open: boolean; onClose: () => void; clientes: Cliente[]; onMesclado: () => void;
}) {
  const grupos = useMemo(() => agruparDuplicados(clientes), [clientes]);
  const [manter, setManter] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);

  const escolhido = (i: number, g: Cliente[]) =>
    manter[i] ?? [...g].sort((a, b) => completude(b) - completude(a) || a.created_at.localeCompare(b.created_at))[0].id;

  async function mesclar(i: number, g: Cliente[]) {
    const fica = escolhido(i, g);
    setOcupado(i);
    let movidos = 0;
    for (const c of g) {
      if (c.id === fica) continue;
      const { data, error } = await supabase.rpc("mesclar_clientes", { p_manter: fica, p_remover: c.id });
      const r = data as { ok?: boolean; error?: string; pedidos_movidos?: number } | null;
      if (error || !r?.ok) { setOcupado(null); toast.error(r?.error ?? error?.message ?? "Não foi possível juntar os cadastros."); onMesclado(); return; }
      movidos += r.pedidos_movidos ?? 0;
    }
    setOcupado(null);
    toast.success(`Cadastros juntados${movidos ? ` · ${movidos} pedido${movidos > 1 ? "s" : ""} transferido${movidos > 1 ? "s" : ""}` : ""}.`);
    setManter(m => { const n = { ...m }; delete n[i]; return n; });
    onMesclado();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-violet-500" />Clientes repetidos</DialogTitle>
          <DialogDescription>
            Cadastros com o mesmo CPF/CNPJ ou o mesmo nome. Escolha qual fica — os pedidos e o histórico dos outros passam para ele e os campos vazios são completados.
          </DialogDescription>
        </DialogHeader>
        {grupos.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum cadastro repetido encontrado. 👍</p>
        ) : (
          <div className="space-y-3">
            {grupos.map((g, i) => {
              const fica = escolhido(i, g);
              return (
                <section key={g.map(c => c.id).join()} className="rounded-xl border">
                  <ul className="divide-y">
                    {g.map(c => (
                      <li key={c.id}>
                        <label className={cn("flex items-start gap-3 px-3 py-2.5 cursor-pointer", c.id === fica && "bg-violet-500/5")}>
                          <input type="radio" className="mt-1 accent-violet-600" name={`grupo-${i}`} checked={c.id === fica} onChange={() => setManter(m => ({ ...m, [i]: c.id }))} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{c.nome}{c.id === fica && <span className="ml-2 text-[11px] font-semibold text-violet-600">fica</span>}</span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {[c.documento, c.telefone, c.email, c.municipio && `${c.municipio}${c.uf ? `/${c.uf}` : ""}`].filter(Boolean).join(" · ") || "sem dados de contato"}
                              {" · criado "}{new Date(c.created_at).toLocaleDateString("pt-BR")}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end px-3 py-2 border-t bg-muted/30">
                    <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-500" disabled={ocupado !== null} onClick={() => mesclar(i, g)}>
                      {ocupado === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
                      Juntar {g.length} cadastros
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
