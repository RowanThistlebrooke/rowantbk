# BODY — your space

**A graph. The readings behind it. Your progress photos.**

[index.html](index.html) is the page: plain HTML, CSS and JavaScript, with a pinned Supabase browser client and the shared Wire index reader. It starts with measured weight and grows as you add readings. No framework or build step.

## First: deploy BODY

Already created your database and login? Start at step 4.

1. Create a Supabase project; leave the optional GitHub repository blank.
2. Run [setup.sql](setup.sql) in SQL Editor once. Set your timezone first. If you already ran the original Wire table SQL, keep it and skip this step.
3. In Authentication → Users, create and confirm your personal user.
4. **[Deploy your own BODY page](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2Fwire-starter&env=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,WIRE_EMAIL,WIRE_PASSWORD,WIRE_TOKEN&project-name=body&repository-name=wire-starter)**. Choose your GitHub account to create your own copy of this repository.
5. On Vercel's configuration screen, set `SUPABASE_URL` to your project URL and `SUPABASE_PUBLISHABLE_KEY` to its **publishable key** (`sb_publishable_…`). Find both in your Supabase project's **Connect** dialog. The three `WIRE_…` settings are for logging from your phone through Claude (below); fill them in now or leave them for later. Use framework **Other**, no build command, and the project root as output.
6. Select **Deploy**, open your new page, and sign in with the email/password from step 3.
7. Log your measured weight, choose **kg** or **lbs**, and confirm when you measured it. Save, then refresh: the same reading should remain on the graph and in its history.

Project settings are configured once on Vercel. The page gets only the public URL and publishable key from `/api/config`; visitors just sign in. Only `/api/mcp` reads the `WIRE_…` settings, and it never sends them anywhere but Supabase's sign-in. Never use a secret or service-role key. The browser sends the login directly to Supabase and remembers the session in local browser storage, with automatic token refresh. Your password is not saved by the page. **Sign out** clears that remembered session and the private view in other tabs on the same site. The database password is not your login password.

Use the same production URL each time, including for your Home Screen shortcut. Browser sessions belong to an origin: a different preview or immutable deployment URL has a separate login. Clearing site data, private browsing, or the project's session expiry settings can require another sign-in. This update clears the old tab-only session without copying it; sign in once more to start the remembered session. If browser storage is blocked, the page explains that instead of silently using a temporary login.

## Optional: progress photos

Run [photos.sql](photos.sql) once in the same project, then use the page's photo option. Existing `events` rows and the weight setup stay unchanged.

- Photos are private and dated. The gallery reads them with your signed-in account.
- Use JPEG, PNG or WebP, up to **6 MiB**. Export HEIC to JPEG first.
- A photo is a visual record; it does not generate body-fat, muscle or weight values.
- Uploads use new paths. Existing photos and event rows are not overwritten or deleted.
- **Remove from gallery** hides a photo, including one that cannot load. Use **Undo last removal** or **Removed photos → Restore** to bring it back. This changes gallery visibility; it does not permanently erase the private image.

The optional SQL is safe to rerun. It stops if an existing bucket has incompatible settings or other Storage policies might grant broader access. It does not silently change those settings.

## Log from your phone with Claude

[api/mcp.mjs](api/mcp.mjs) is an MCP endpoint at `/api/mcp`, the same approach as [The Wire](https://github.com/RowanThistlebrooke/wire). It signs into Supabase as you, with your email, password and the publishable key, and writes to the same `events` table under the same rules as the page. Three steps:

1. In Vercel, under Settings → Environment Variables, set `WIRE_EMAIL` and `WIRE_PASSWORD` (the user from step 3 above) and `WIRE_TOKEN` (a long random string you make, for example with `openssl rand -hex 32`), then redeploy.
2. In claude.ai, under Settings → Connectors, add a custom connector with the URL `https://YOUR-PAGE.vercel.app/api/mcp`, choose no sign-in, and add the header `Authorization` with the value `Bearer ` followed by your token.
3. On your phone, tell Claude: **"log my weight, 158"**. Claude asks anything it does not know (kg or lbs, when you measured), shows you the exact row, and saves it only after you say yes. Refresh BODY: the reading is on the graph, marked **MCP**.

The endpoint has two tools. **record** takes `metric`, `value`, `unit` and `occurred_at`; called without confirmation it returns the exact row and writes nothing, and it writes only when called again with `confirmed: true` after your yes. **history** takes `metric` and `days` and reads your readings back. Claude transcribes a number you gave it; it never estimates, rounds, converts or invents one. There is no update and no delete.

Every request must carry `WIRE_TOKEN`; without the token, or with `WIRE_TOKEN` unset, nothing gets in. Row-level security still applies, because the endpoint holds only the publishable key and your own login. Treat the token like a password: anyone who has it can append to your record. Rotate it in Vercel if it leaks. The local preview also serves `/api/mcp` when the five settings are in `.env.local`, after `npm install`.

## What the graph means

Each point is a recorded reading, shown in its original units. Weight in kg and weight in lbs stay separate. Additional BODY measurements use the same layout, one measurement and unit at a time. The graph always shows recorded values, separate from the sidebar index.

Lines connect readings. Dashed spans are more than a day apart and do not fill in missing values. Readings retain both **when measured** and **when saved**. This starter shows the original raw record; it does not apply corrections/voids, estimate values, or claim what caused a change.

## Your BODY index

The sidebar uses **100 as a reference baseline**, not as a default score. Open **Baseline details** and choose whether higher, lower, or staying within a range represents your own progress. You can also keep a measurement out of your index and include it again later.

The shared [you-reader.js](you-reader.js) supplies the same index gates as The Wire. The first 30 recorded days form the baseline; the baseline is marked as forming until it freezes. A flat history, missing readings, mixed units or unusable variation produces no score. For each measurement, ten index points means one baseline standard deviation, **not 10%**.

BODY shows the average of available eligible measurement indices for the database's current day, with coverage. Hover over the score to see which measurements count and which do not. This is a display of movement relative to your chosen rules, not a health rating. The index applies recorded corrections and voids; the raw graph continues to show the original readings.

No new SQL is needed for this update if the existing setup is complete. Photo visibility and direction changes append events under the signed-in account; they never update or delete a row.

## One record, different inputs

**Page → events → BODY.** The page and the MCP endpoint append to the same record; a future iOS input can too. They do not need another dashboard.

The page implements manual weight logging and optional photo uploads. The MCP endpoint at `/api/mcp` logs readings through Claude. **An automated iOS logging Shortcut is not included yet.**

A simple optional iOS Shortcut can use **Open URLs** with your deployed page's `/?log=weight` address, then be [added to your Home Screen](https://support.apple.com/guide/shortcuts/apd735880972/ios). The page opens weight entry after sign-in; you still enter and save the reading yourself. Put no keys, passwords or tokens in that URL. This repository does not create or install the Shortcut.

### Shared input contract

All inputs append to `public.events`. Read every page of history in a stable order; a failed page must be shown as an error, never as complete history.

| Field | Measured weight | Progress photo |
| --- | --- | --- |
| `event_type` | `measurement` | `progress_photo` |
| `metric` | `weight` | `body_progress` |
| `value` | User-supplied numeric value | `null` |
| `unit` | `kg` or `lbs`, explicitly supplied | `null` |
| `occurred_at` | User-confirmed measurement time | User-confirmed photo time |
| `source` | `pad` for this page, `claude` for MCP | `pad` for this page |
| `source_id` | Stable ID for one save/retry | Stable UUID for one save/retry |
| `context` | `{ "area": "body" }` | Fields below |

Photo context contains `area: "body"`, `schema_version: 1`, `bucket: "body-progress"`, `path`, `mime_type`, `bytes` and `sha256`. The path is `<authenticated user ID>/<upload UUID>.<extension>`; it references a private Storage object. Do not store photo bytes, public URLs or expiring signed URLs in the event.

Upload the photo with `upsert: false`, confirm the stored object, then append its event. Reuse the same upload path and source ID when retrying that operation. If upload succeeds but the event fails, retain that pending operation so a retry can finish it; do not replace the image or claim the check-in was saved. The browser downloads photos with authentication into temporary Blob URLs and releases them on sign-out.

Photo removal and restoration append `event_type: "photo_visibility"`, `metric: "body_progress"`, `value: null`, `unit: null`, and `context: { "photo_id": "the original photo event ID", "hidden": true }` (or `false` to restore). The latest event by `recorded_at`, then `id`, controls that exact photo. The page uses `source: "pad"` and a stable `source_id` for retries. No Storage object is changed.

MCP writes use `source: "claude"`: the tool returns the exact proposed row first and saves only after the user's approval. Its `source_id` is derived from the row itself, so an uncertain retry of the same reading lands once and a different reading is a new row. Future direct Shortcut writes use `source: "shortcut"`. Both supply the authenticated user's ID. An assistant transcribes a supplied reading; it never invents a measurement or infers weight from a photo.

## If access fails

Check the project URL and Auth login first. If you used the original table SQL with automatic table exposure disabled, run:

```sql
grant usage on schema public to authenticated;
grant select, insert on public.events to authenticated;
```

Keep row-level security enabled. Only a publishable key belongs in this page; never use a secret or service-role key.

Local preview (Node.js 22+): copy `.env.example` to `.env.local`, fill in the two public settings, then run `node --env-file=.env.local dev.js` and open `http://localhost:8797`. The preview serves the page and `/api/config`, and `/api/mcp` once you run `npm install` and fill in the three `WIRE_…` settings; an ordinary static file server cannot provide the connection settings. `.env.local` is ignored by Git.

[Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) · [Storage access policies](https://supabase.com/docs/guides/storage/security/access-control) · [Upload](https://supabase.com/docs/reference/javascript/file-buckets-upload) · [Private download](https://supabase.com/docs/reference/javascript/file-buckets-download) · [Public API keys](https://supabase.com/docs/guides/api/api-keys)
