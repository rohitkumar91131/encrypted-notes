For this update, an already working Supabase setup needs no new SQL, table,
column, or Storage bucket.

Folders use encrypted records in the existing `public.encrypted_notes` table.
Folder names, folder membership, archive state and recycle-bin state live inside
the encrypted payload. Folder rows show the generic title `Folder` in the table;
ordinary note titles continue to use the existing title column.

If you have not set up the database yet, or see `Supabase setup needed`:

1. Open your Supabase project → SQL Editor → New query.
2. Paste the entire `supabase-notes-setup.sql` file and run it. It creates the
   table if needed, adds the title column, configures per-user access policies,
   and adds the table to Realtime. It does not delete existing notes.
3. Refresh the app and sign in with the same Google account.
4. Unlock with your existing recovery key if prompted.

Use the same recovery key on every device. No upload bucket is needed; the file
upload feature has been removed.

Delete moves a note to the recycle bin. Restore keeps its original folder and
archive state. There is no automatic expiration. Permanent deletion removes the
note content and leaves an encrypted deletion marker in the cloud so another
device cannot bring the note back through an old saved copy.

Supabase references:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/realtime/postgres-changes

Nested pages and page references use the same encrypted note payload. `folderId`
can identify either a legacy folder or a parent page; the existing lifecycle
merge timestamp resolves moves. Inline page references store `data-page-id` in
sanitized, encrypted block HTML. Backlinks are computed on the device from the
unlocked notes. No additional Supabase table or migration is required.

## Daily threads and date mentions

Threads are pages (`kind: "thread"`) with one checkbox state per calendar date.
Each date stores `{checked, updatedAt, eventId}` inside the encrypted note body;
explicit unchecked entries are retained so stale devices cannot undo an untick.
Sync merges dates independently. For the same date, the newer change wins, with
an event ID tie-breaker. Thread timezone is captured when it is created, so daily
boundaries stay consistent across devices. Future days cannot be ticked.

The month picker changes the visible grid only; it does not reset prior months.
Click a thread name to write in its note. Archive/bin/restore work like other
pages. Date mentions (`@today`, `@yesterday`, `@tomorrow`, `@now`) store a fixed
calendar date or UTC timestamp in encrypted block HTML, not a relative date that
changes every day. These mentions do not create reminders or notifications.

If encrypted sync already works, you need **no new Supabase table, column,
Storage bucket, Edge Function, or scheduled job** for this feature. The existing
`encrypted_notes` table, per-user RLS and Realtime subscription are reused.

Optional listing index for accounts with many notes (SQL Editor → New query):

```sql
create index if not exists encrypted_notes_user_updated_idx
  on public.encrypted_notes (user_id, updated_at desc);
```

For first-time setup run `supabase-notes-setup.sql`, enable Google authentication
and configure your deployed site URL in Supabase Authentication → URL
Configuration. Sign in with the same account on every device, then unlock with
the same recovery key. Never put the service-role key in the browser.

Per-user access uses Supabase RLS:
https://supabase.com/docs/guides/database/postgres/row-level-security
Realtime updates use Postgres Changes:
https://supabase.com/docs/guides/realtime/postgres-changes

Thread management: Threads and their subpages are excluded from ordinary note
lists and search. Deleted threads have a separate recycle-bin view under
Threads; restore retains daily checks and order. Threads can be reordered using
the drag handle with mouse or touch. Keyboard users can press Space on the
handle, use arrow keys to choose a position, then Space to drop (Escape cancels). Order metadata is
encrypted and merged separately from check-ins, so ticking a date does not
reset the saved order. No additional SQL is required.

Typing `@newpage` offers a new child page named "New page"; typing `@name` offers
"Create subpage" using that name. Choosing it creates and links the child while
the parent editor stays open. The Subpages footer and editor hint are removed.
On devices waiting for a recovery key, the UI offers one workspace unlock gate
rather than mixing encrypted notes and threads before their types are known.

Movies use encrypted `kind: "movie"` records in the same table. Movie links,
watched state and watched-change metadata are encrypted with the note body.
Movies and their child pages are excluded from ordinary notes and search, with
Watchlist, Watched and Movie recycle bin views in the separate Movies section.
Watched state merges independently of edits to the title or link. No new SQL,
API key or Storage bucket is needed.

Enter a movie name to create a named card; no external movie database lookup or
automatic poster/title fetching is performed. YouTube/Vimeo links have an
on-demand embedded player, direct video/image URLs have media previews, and
other website links have cards with an original-link action. Playback depends
on the source permitting embedding. YouTube player documentation:
https://developers.google.com/youtube/player_parameters

## Installable app

The app is now a PWA at the same HTTPS address. No Supabase migration is required for installation. Open Account settings → Install app, or the browser installation menu. On iPhone/iPad, use Safari → Share → Add to Home Screen.

The service worker caches only an allowlist of public app files, including the local Supabase SDK. Previously saved encrypted notes continue to use IndexedDB; database/auth requests and external media are never put in the service-worker cache. A first visit and account unlock need connectivity; offline access requires the existing device key and cached notes. Device lock must be enabled separately in Account settings.

When deploying changes to app shell files, bump `CACHE` in `sw.js`. An update waits until all app windows/tabs close, preventing automatic reloads during editing. Browser checks: `python3 tests/pwa-browser-tests.py`.

## Fingerprint / Face ID device lock

No Supabase schema or authentication changes are required. This is a local encryption lock; Google sign-in and encrypted sync are unchanged. In Account settings → Fingerprint / Face ID, save/download the recovery key, tick the backup confirmation, then choose Enable device lock. The OS can verify with fingerprint, Face ID or device PIN; the website cannot force fingerprint-only verification.

Enable requires HTTPS, a platform authenticator and a working WebAuthn PRF extension. It creates a passkey and verifies its PRF through a separate authentication request before changing key storage. If unsupported or cancelled, original note keys remain intact.

A random vault key encrypts all device/account master keys. That vault key has separate AES-GCM wrappers derived with HKDF from the passkey PRF output and the setup recovery key. Only the encrypted vault, credential ID and salts are stored in `stillnote-device-lock-v1`. Plaintext master-key entries are removed after a verified vault is committed; future account keys go into the encrypted vault. Nothing biometric is sent to Supabase.

A normal reload of an already unlocked tab stays unlocked. On page exit, a vault-key bridge is written to that tab’s sessionStorage with a 15-second expiry, tied to the current credential and key wrapper; only reload navigation can consume it, and it is removed immediately on startup. Manual/background/idle locking removes this bridge before restarting. The bridge temporarily contains the vault unlock key, so device lock protects locked sessions rather than requiring a new biometric check for each refresh. Reopening, backgrounding, five minutes of inactivity, or Lock now triggers locking. Current edits are encrypted into IndexedDB before queued saves finish; the document then restarts to discard decrypted editor/history/key state. Unlock happens before note/key loading, without a loading timeout while waiting for the user. Cancelled verification and wrong recovery keys stay locked. Recovery unlock accepts the original setup key or its downloaded JSON, and permits disabling/replacing a lost passkey. Keep the recovery key saved when this lock was enabled, even if you later change Google accounts or import another account key. Each browser/device must enable its own lock.

Verification: `python3 tests/device-lock-browser-tests.py` uses Chrome's real virtual platform authenticator with PRF for registration and unlock, plus recovery, unsupported PRF, background/idle locking and pre-lock edit persistence. Physical phone verification still depends on the phone/browser support.

## Smart movie previews

Movies can fetch public titles and thumbnails for YouTube and Vimeo links, plus public Open Graph previews for IMDb title pages when IMDb permits access. This runs through `api/movie-preview.js`, a Vercel Node function; no API key or Supabase migration is needed. Hosts and URL shapes are allowlisted, requests use canonical public URLs without tracking parameters, redirects are rejected, and upstream requests have size/time limits. Other links and name-only movies remain usable without metadata. A failed preview never blocks saving.

Movie preview metadata (`movieMeta`) and original added time (`movieAddedAt`) live inside the existing encrypted note envelope. Manually entered titles are preserved. Automatic metadata for the old URL is discarded after a link change, and stale saves cannot erase a newer matching preview. Existing generic movie cards are enriched in the background when you visit Movies. Requests are limited to three at a time, failed lookups are not repeatedly retried in the same session, and the card’s menu offers Refresh preview.

The Movies library has search, title/date sort, tab counts and duplicate detection across YouTube URL forms. Watched status stays separate from preview metadata; movie pages remain excluded from All notes and Recently viewed. Card editing/deletion is in the hover/focus `…` menu, always visible on mobile. Previews and external players need connectivity; previously saved titles remain available offline.

Checks: `node tests/movie-preview-api-tests.js` and `python3 tests/smart-movies-browser-tests.py`.
