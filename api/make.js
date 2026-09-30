// Vercel serverless function: relays a job payload to the Make.com webhook.
// The webhook URL stays server-side (MAKE_WEBHOOK_URL) and only signed-in team members can call this.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  const hook = process.env.MAKE_WEBHOOK_URL;
  if (!hook) return res.status(501).json({ error: "MAKE_WEBHOOK_URL isn't set in Vercel yet" });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(501).json({ error: "Sign-in isn't configured, so the Make relay is off" });

  // Confirm the caller is a signed-in hub user.
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in again" });
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!who.ok) return res.status(401).json({ error: "Sign in again" });
  const user = await who.json();

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  }
  if (!payload || typeof payload !== "object" || !payload.job_no) {
    return res.status(400).json({ error: "Missing job payload" });
  }

  const r = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, sent_by: user.email, sent_at: new Date().toISOString() }),
  });
  if (!r.ok) return res.status(502).json({ error: `Make responded with ${r.status}` });
  return res.status(200).json({ ok: true });
}
