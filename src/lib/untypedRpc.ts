/**
 * untypedRpc — chamada de RPC sem a tipagem gerada do Supabase.
 *
 * Usado para funções que ainda não estão em `types.ts` (ou cuja assinatura
 * gerada não aceita `null` explícito), sem recorrer a `any`. O retorno fica
 * como `unknown` para forçar o chamador a fazer o narrowing/cast adequado.
 */

import { supabase } from "@/integrations/supabase/client";

export interface UntypedRpcResult {
  data: unknown;
  error: { message: string } | null;
}

type UntypedRpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<UntypedRpcResult>;

export function untypedRpc(fn: string, args?: Record<string, unknown>): PromiseLike<UntypedRpcResult> {
  // .call preserva o `this` do client (rpc depende dele internamente)
  return (supabase.rpc as unknown as UntypedRpcFn).call(supabase, fn, args);
}
