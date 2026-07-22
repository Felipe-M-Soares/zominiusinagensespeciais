import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórias.'
  );
}

// Retry automático para erros de rede em mobile (sem keepalive — causa falha em payloads grandes)
const fetchWithRetry: typeof fetch = async (input, init) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(input, init); // sem keepalive
    } catch (err) {
      lastError = err;
      const isNetworkError =
        err instanceof TypeError &&
        (err.message.includes('Failed to fetch') ||
          err.message.includes('Network request failed'));
      if (!isNetworkError || attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 300 * Math.pow(3, attempt)));
    }
  }
  throw lastError;
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'x-client-info': 'concept-usinagens/1.0',
    },
    fetch: fetchWithRetry,
  },
});
