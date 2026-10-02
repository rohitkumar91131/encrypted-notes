# Encrypted Notes

A browser-based workspace for notes, daily progress threads, and a movie watchlist. Built with vanilla JavaScript, Web Crypto, IndexedDB, and Supabase.

**[Open the live app](https://stillnote-encrypted.vercel.app)**

## Features

- Block editor with rich text, slash commands, tables, toggles, and code blocks.
- Nested pages, page references, backlinks, folders, search, and recently viewed pages.
- Archive and recycle bin with restore and permanent deletion.
- Daily threads with a monthly check-in grid and reorderable rows.
- Movie watchlist with watched status and supported link previews.
- Google sign-in and encrypted cloud sync across devices.
- Automatic sync when returning to the app or reconnecting to the internet, including updates to an open note.
- Installable PWA with cached app files and locally saved encrypted notes.
- Recovery-key export/import, QR transfer, and optional device lock using fingerprint, Face ID, or device PIN on supported browsers.

## Run locally

No frontend build step or npm install is required.

```bash
git clone git@github.com:rohitkumar91131/encrypted-notes.git
cd encrypted-notes
python3 -m http.server 8000
```

Open **http://localhost:8000/encrypted-notes.html**. The Python server serves static files; Vercel provides the `/` rewrite and `/api/movie-preview` endpoint. Use Vercel CLI's `vercel dev` to exercise those routes locally.

Local notes work without signing in. Cloud sync requires a configured Supabase project and internet access. Open the app through localhost or HTTPS rather than directly as a file.

## Configure Supabase

The checked-in app points to the existing Supabase project. For your own deployment:

1. Create a Supabase project and run [supabase-notes-setup.sql](supabase-notes-setup.sql) in its SQL Editor. This configures the notes table, per-user access policies, and Realtime.
2. Enable the Google authentication provider and configure its OAuth credentials and callback URL.
3. Set your app's site URL and allowed redirect URLs in Supabase Authentication, including your local URL when developing.
4. Update `SUPABASE_URL` and `SUPABASE_KEY` in [encrypted-notes.html](encrypted-notes.html) with your project URL and browser publishable key. The current app reads these constants directly, not from environment variables.
5. Sign in and save the account recovery key. Use the same account and recovery key to unlock another device.

See [SUPABASE-SETUP.md](SUPABASE-SETUP.md) for database, sync, recovery, PWA, and device-lock details. Never use a Supabase service-role key in browser code.

## Encryption and recovery

Note bodies are encrypted on the device with AES-256-GCM before local or cloud storage. Each note has a separate key wrapped with the account/device master key. Folder relationships, daily checks, movie details, and lifecycle state are included in the encrypted payload.

**Note titles are currently stored in plaintext**, alongside record IDs, user IDs, and update timestamps. Encryption protects note content, not all metadata.

Without device lock, the master key is stored in browser local storage. Enabling device lock wraps keys in an encrypted vault using WebAuthn PRF on supported devices. The account recovery key and the device-lock recovery key serve different purposes; keep the backups presented during each setup.

Google sign-in does not replace the recovery key. Keep that key private and backed up before clearing browser data or moving to a new device.

## Install and update

Open the live HTTPS app and use **Account settings → Install app**, or your browser's install menu. On iPhone/iPad, use **Safari → Share → Add to Home Screen**.

Offline access depends on previously cached app files, saved notes, and the device's encryption keys. Authentication, database requests, and external media are not cached by the service worker.

New app-shell releases wait until all app windows/tabs close before activation. Close and reopen the app to pick up an update. Bump `CACHE` in [sw.js](sw.js) whenever app-shell files change.

## Deploy

The repository includes [vercel.json](vercel.json) for static hosting, the home-page rewrite, service-worker headers, and the movie-preview function.

With Vercel CLI installed and authenticated:

```bash
vercel deploy --prod
```

Link your own Vercel project on first deployment and configure its URL in Supabase Authentication. Local `.env` files and Vercel project-link files are excluded from Git.

## Checks

Browser checks use Python Playwright and currently expect Chrome at `/usr/bin/google-chrome`. Install the Python dependency in your development environment:

```bash
python3 -m pip install playwright
```

Run the relevant checks from the repository root:

```bash
python3 tests/run-editor-browser-tests.py --loading
python3 tests/run-editor-browser-tests.py
python3 tests/pwa-browser-tests.py
python3 tests/device-lock-browser-tests.py
python3 tests/location-browser-tests.py
python3 tests/smart-movies-browser-tests.py
node tests/movie-preview-api-tests.js
```

The loading checks include regressions for realtime rendering, returning to the app, reconnecting, and recovery-key validation. The API checks require Node.js 18 or newer.

## Project files

| File | Purpose |
| --- | --- |
| `encrypted-notes.html` | App entry point, encryption, persistence, authentication, and sync |
| `editor-features.js` / `.css` | Editor commands and formatting |
| `workspace.js` / `.css` | Navigation, pages, threads, and movies |
| `device-lock.js` / `.css` | Device key vault and unlock interface |
| `pwa.js`, `sw.js`, `manifest.webmanifest` | Installation and cached app shell |
| `api/movie-preview.js` | Supported public movie-link metadata |
| `supabase-notes-setup.sql` | Database schema, access policies, and Realtime setup |
| `tests/` | Browser and API regression checks |
