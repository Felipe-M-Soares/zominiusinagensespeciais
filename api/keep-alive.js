/**
 * Vercel Cron → mantém o projeto Supabase (plano Free) ativo.
 *
 * Agendado em vercel.json ("crons"). A Vercel envia
 * `Authorization: Bearer <CRON_SECRET>` quando a variável CRON_SECRET existe
 * no projeto — assim ninguém de fora consegue disparar este endpoint.
 *
 * Variáveis usadas (as mesmas do frontend, já configuradas na Vercel):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
 *   CRON_SECRET (opcional, recomendado)
 */
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return res.status(500).json({ ok: false, error: "Supabase env vars ausentes" });
  }

  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/keep_alive`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_source: "vercel-cron" }),
    });
    const body = await r.json().catch(() => null);
    res.setHeader("Cache-Control", "no-store");
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, body });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
