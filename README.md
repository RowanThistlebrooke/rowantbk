# BODY — your first Wire page

**A graph. The readings behind it. Your progress photos.**

[index.html](index.html) is the whole page: plain HTML, CSS and JavaScript, with a pinned Supabase browser client. It starts with measured weight and grows as you add readings. No framework or build step.

## First: deploy BODY

Already created your database and login? Start at step 4.

1. Create a Supabase project; leave the optional GitHub repository blank.
2. Run [setup.sql](setup.sql) in SQL Editor once. Set your timezone first. If you already ran the original Wire table SQL, keep it and skip this step.
3. In Authentication → Users, create and confirm your personal user.
4. **[Deploy your own BODY page](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2Fwire-starter&env=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY&project-name=body&repository-name=wire-starter)**. Choose your GitHub account to create your own copy of this repository.
5. On Vercel's configuration screen, set `SUPABASE_URL` to your project URL and `SUPABASE_PUBLISHABLE_KEY` to its **publishable key** (`sb_publishable_…`). Find both in your Supabase project's **Connect** dialog. Use framework **Other**, no build command, and the project root as output.
6. Select **Deploy**, open your new page, and sign in with the email/password from step 3.
7. Log your measured weight, choose **kg** or **lbs**, and confirm when you measured it. Save, then refresh: the same reading should remain on the graph and in its history.

Project settings are configured once on Vercel. The page gets only the public URL and publishable key from `/api/config`; visitors just sign in. Never use a secret or service-role key. The browser sends the login directly to Supabase, and the signed-in session stays in this tab. The database password is not your login password.

## Optional: progress photos

Run [photos.sql](photos.sql) once in the same project, then use the page's photo option. Existing `events` rows and the weight setup stay unchanged.

- Photos are private and dated. The gallery reads them with your signed-in account.
- Use JPEG, PNG or WebP, up to **6 MiB**. Export HEIC to JPEG first.
- A photo is a visual record; it does not generate body-fat, muscle or weight values.
- Uploads use new paths. Existing photos and event rows are not overwritten or deleted.

The optional SQL is safe to rerun. It stops if an existing bucket has incompatible settings or other Storage policies might grant broader access. It does not silently change those settings.

## What the graph means

Each point is a recorded reading, shown in its original units. Weight in kg and weight in lbs stay separate. Additional BODY measurements can use the same layout, one measurement and unit at a time; they are never averaged into a body score.

Lines connect readings. Dashed spans are more than a day apart and do not fill in missing values. Readings retain both **when measured** and **when saved**. This starter shows the original raw record; it does not apply corrections/voids, estimate values, or claim what caused a change.

## One record, different inputs

**Page → events → BODY.** Future MCP and iOS inputs can append to the same record. They do not need another dashboard.

The page currently implements manual weight logging and optional photo uploads. **An MCP server and an automated iOS logging Shortcut are not included yet.**

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
| `source` | `pad` for this page | `pad` for this page |
| `source_id` | Stable UUID for one save/retry | Stable UUID for one save/retry |
| `context` | `{ "area": "body" }` | Fields below |

Photo context contains `area: "body"`, `schema_version: 1`, `bucket: "body-progress"`, `path`, `mime_type`, `bytes` and `sha256`. The path is `<authenticated user ID>/<upload UUID>.<extension>`; it references a private Storage object. Do not store photo bytes, public URLs or expiring signed URLs in the event.

Upload the photo with `upsert: false`, confirm the stored object, then append its event. Reuse the same upload path and source ID when retrying that operation. If upload succeeds but the event fails, retain that pending operation so a retry can finish it; do not replace the image or claim the check-in was saved. The browser downloads photos with authentication into temporary Blob URLs and releases them on sign-out.

Future MCP writes use `source: "claude"`: show the exact proposed rows and save only after the user's approval. Future direct Shortcut writes use `source: "shortcut"`. Both supply the authenticated user's ID and reuse an operation ID for uncertain retries. An assistant transcribes a supplied reading; it never invents a measurement or infers weight from a photo.

## If access fails

Check the project URL and Auth login first. If you used the original table SQL with automatic table exposure disabled, run:

```sql
grant usage on schema public to authenticated;
grant select, insert on public.events to authenticated;
```

Keep row-level security enabled. Only a publishable key belongs in this page; never use a secret or service-role key.

Local preview (Node.js 22+): copy `.env.example` to `.env.local`, fill in the two public settings, then run `node --env-file=.env.local dev.js` and open `http://localhost:8797`. The preview serves the page and `/api/config`; an ordinary static file server cannot provide the connection settings. `.env.local` is ignored by Git.

## Film this

> “This is the output. I log my weight, it becomes a point on my graph, and the reading stays underneath. Over time I can add progress photos. Later, my assistant and a phone shortcut can feed the same record.”

[Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) · [Storage access policies](https://supabase.com/docs/guides/storage/security/access-control) · [Upload](https://supabase.com/docs/reference/javascript/file-buckets-upload) · [Private download](https://supabase.com/docs/reference/javascript/file-buckets-download) · [Public API keys](https://supabase.com/docs/guides/api/api-keys)
