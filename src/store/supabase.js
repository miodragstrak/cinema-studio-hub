// Supabase store: shared data for the signed-in team, with live updates.
// Each table stores one JSON document per row (id + data), mirroring the app's objects.
// Schema and access rules: supabase/schema.sql
import { createClient } from "@supabase/supabase-js";

export function createSupabaseStore(url, anonKey) {
  const sb = createClient(url, anonKey);

  async function upsert(table, id, data) {
    const { error } = await sb.from(table).upsert({ id, data, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  async function remove(table, id) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
  }
  async function loadTable(table) {
    const { data, error } = await sb.from(table).select("id, data");
    if (error) throw error;
    const out = {};
    for (const row of data) out[row.id] = { ...row.data, id: row.id };
    return out;
  }

  return {
    kind: "cloud",
    client: sb,

    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((_event, session) => cb(session));
    },
    async signIn(email) {
      // shouldCreateUser: false → only people invited in the Supabase dashboard can sign in.
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
      });
      if (error) throw error;
    },
    async signOut() { await sb.auth.signOut(); },
    async accessToken() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token || null;
    },

    async start(onChange) {
      const load = async (tables = ["jobs", "brokerages", "settings"]) => {
        try {
          const patch = {};
          for (const t of tables) {
            const rows = await loadTable(t);
            if (t === "settings") patch.settings = rows.main ? { ...rows.main } : {};
            else patch[t] = rows;
          }
          if (patch.settings) delete patch.settings.id;
          onChange(patch);
        } catch (e) {
          console.error("Load failed", e);
        }
      };
      await load();

      // Reload a table shortly after any change to it (from any teammate).
      const timers = {};
      sb.channel("studio-hub")
        .on("postgres_changes", { event: "*", schema: "public" }, (msg) => {
          const t = msg.table;
          clearTimeout(timers[t]);
          timers[t] = setTimeout(() => load([t]), 250);
        })
        .subscribe();
    },

    saveJob: (job) => upsert("jobs", job.id, job),
    deleteJob: (id) => remove("jobs", id),
    saveBrokerage: (b) => upsert("brokerages", b.id, b),
    deleteBrokerage: (id) => remove("brokerages", id),
    saveSettings: (s) => upsert("settings", "main", s),
  };
}
