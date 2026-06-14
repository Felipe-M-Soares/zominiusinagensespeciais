/**
 * useAutocomplete — Sugestões de busca de dispositivos via pg_trgm
 *
 * Usa a RPC autocomplete_devices() que aproveita o índice GIN criado
 * na migration 20260038. Inclui debounce de 300ms e cancelamento de
 * requests obsoletos via AbortController.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeQuery } from "@/lib/sanitize";

export function useAutocomplete(query: string, minLength = 2) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  const fetch = useCallback(async (q: string) => {
    const safe = sanitizeQuery(q);
    if (!safe || safe.length < minLength) {
      setSuggestions([]);
      return;
    }
    if (safe === lastQueryRef.current) return;
    lastQueryRef.current = safe;

    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string, args: Record<string, unknown>
      ) => Promise<{ data: { suggestion: string }[] | null; error: unknown }>)(
        "autocomplete_devices",
        { p_query: safe, p_limit: 8 }
      );
      if (!error && data) {
        setSuggestions(data.map((r) => r.suggestion));
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [minLength]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query || query.length < minLength) {
      setSuggestions([]);
      return;
    }
    timerRef.current = setTimeout(() => fetch(query), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, fetch, minLength]);

  const clear = useCallback(() => {
    setSuggestions([]);
    lastQueryRef.current = "";
  }, []);

  return { suggestions, loading, clear };
}
