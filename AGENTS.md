# #Cinema Studios Studio Hub — context for AI assistants

## What this is
The studio manager's home screen for #Cinema Studios (Adam Ekblad / Hashtag Cinema), a video production studio in Clearwater, FL (real estate, commercial, events). It books jobs, tracks them through production stages, and **orchestrates** handoffs to other tools rather than replacing them:
- **Dropbox**: file storage. The hub generates the standard job folder path.
- **ClickUp**: production tasks. The hub generates task title/description with the QC checklist.
- **GHL (GoHighLevel)**: client/CRM pipeline. Location ID `uP15oHnQhnPefyoobZNV`.
- **Make.com**: automation glue. `/api/make` relays a job payload to a Make webhook.

## Stack
- Vite + vanilla JS (no framework). Entry: `src/main.js`, styles in `src/styles.css`.
- Storage is pluggable (`src/store/`): `local.js` (localStorage) when Supabase env vars are absent, `supabase.js` (shared, magic-link auth, realtime) when present.
- Supabase tables `jobs`, `brokerages`, `settings`, each row = `{id, data jsonb, updated_at}`. Schema + RLS in `supabase/schema.sql`.
- Vercel hosts the static build and the serverless function in `api/`.

## Rules
- Never put secrets in client code or `VITE_*` vars except the Supabase anon key (safe because of RLS). Webhook URLs and API tokens go in server-only env vars used from `api/`.
- Production stages, in order: Booked, Scheduled, Shot, In edit, QC, Client review, Revision, Delivered, Archived.
- Guardrails to preserve: no Client review until the QC checklist is complete; no In edit without an editor; real estate jobs can't be Delivered until the brokerage logo pack is complete (Florida advertising compliance).
- Keep the visual language: Archivo (condensed for headings), cyc-wall neutrals, "tally light" red used sparingly for live/urgent states. Colors are CSS variables with light/dark themes in `src/styles.css`.
- UI copy: sentence case, plain verbs, buttons say exactly what they do.

## Roadmap
1. Replace manual handoffs one at a time with Make scenarios (Dropbox folder creation first).
2. Pull GHL pipeline stages / ClickUp status back into the hub.
3. Brokerage logo uploads (Supabase Storage) instead of checkboxes.
