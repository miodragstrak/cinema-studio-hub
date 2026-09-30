// Local store: keeps everything in this browser's localStorage.
// Used when Supabase isn't configured (quick local development, demos).
const KEY = "cinema-hub-v1";

export function readLocalSnapshot() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocalSnapshot() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function createLocalStore() {
  const data = { jobs: {}, brokerages: {}, settings: {}, ...(readLocalSnapshot() || {}) };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
  };

  return {
    kind: "local",
    async start(onChange) {
      onChange(JSON.parse(JSON.stringify(data)));
    },
    async saveJob(job) { data.jobs[job.id] = job; persist(); },
    async deleteJob(id) { delete data.jobs[id]; persist(); },
    async saveBrokerage(b) { data.brokerages[b.id] = b; persist(); },
    async deleteBrokerage(id) { delete data.brokerages[id]; persist(); },
    async saveSettings(s) { data.settings = s; persist(); },
    async accessToken() { return null; },
    async signOut() {},
  };
}
