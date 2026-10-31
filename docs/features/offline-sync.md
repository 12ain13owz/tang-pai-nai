# Offline & sync

> Status: **4a.1 built** (rules 1–7 on the web), 4a.2 (sync) not yet. Built in two parts (decided at the start of #4a, one PR each):
> **4a.1** trusted device, encrypted local database, PIN lock and the wipe rules (rules 1–7, web
> only: the API already answers `SESSION_REVOKED` / `SESSION_EXPIRED`); **4a.2** sync (rules
> 8–12: sync tables, `/sync/push`, `/sync/pull`, outbox, sync status). Server code will live in
> `api/src/features/sync/` with the per-table registry in `api/src/core/sync/`. The web side
> (local database, outbox, app lock) lives in `web/src/app/core/offline/`.

## Purpose

The app works **fully offline** on a device its owner trusts: add, edit, delete, see balances and
reports, and close and reopen it, all with no internet, like a native app. The **local database on
the device is what the screens read and write**. The server is where changes meet: each device
pushes its changes when it's online, and pulls other devices' changes. Money Lover works this way,
and so does a reading app like Meb.

## Out of scope

- **First sign-in while offline.** Signing in needs the server (an email or SMS code), so a device
  works offline only after one online sign-in.
- **Offline on untrusted devices** (rule 1). They work online only.
- **Offline for wallets shared with you.** Only their owner has them offline. A member can queue
  _new_ transactions offline, and nothing else (rule 14).
- Real-time push between devices (websockets). Devices sync when they come online, when the app
  opens, and every few minutes while it's open.
- Receipt photos and other attachments (backlog).

## Layers

| Layer          | Offline?                                                    | How                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell      | ✅ always                                                   | Angular service worker (`@angular/pwa`) caches HTML/JS/CSS/icons. It does **not** cache API responses, because data comes from the local DB, not the SW cache. Built in #3. |
| Data           | ✅ on trusted devices                                       | An encrypted local database in the browser (rules 4–6), plus an outbox of pending changes (rule 8).                                                                         |
| Auth           | Sign-in online; reopening on a trusted device works offline | The app unlocks with a PIN (rules 2–3). The server stays the authority whenever the device is online (rule 7).                                                              |
| Shared wallets | Owner offline; members online, plus offline _adds_          | Rules 13–16.                                                                                                                                                                |

## Data model

### Server: columns on every synced table

Synced tables are wallets, categories, transactions, and every later user-data table (budgets,
recurring rules, debts, events). Each one carries:

- `id`: a UUIDv7 **generated on the device** and accepted by the server, so a row has its permanent
  id from the moment it's created offline. The server rejects an id that already belongs to a
  different owner (`409`).
- `createdAt`, `updatedAt`: epoch ms. `updatedAt` is the device's edit time, clamped by the server
  to no later than the server's own now (rule 10).
- `deletedAt?`: **soft delete** (a tombstone), so other devices learn about deletions. Feature
  "delete" rules become "set `deletedAt`". Tombstones older than **90 days** are purged; a device
  that hasn't synced for longer than that does a full resync (rule 9).
- `changeSeq`: an integer the **server** assigns on every write, from one counter for the whole
  database (`sync_state.lastSeq`). Pull uses it as a cursor, because device clocks can't be trusted.
- `updatedBy`: the user id that made the change (owner or member), for history and notices.

Master data (currencies) is read-only for clients and is pulled the same way.

### Server: sync tables

`src/core/database/schema/sync.ts`

- **sync_state**: a single row, `lastSeq`, and `purgedSeq` (the highest `changeSeq` of a purged
  tombstone; a pull with `since` below it answers `410`, rule 9).
- **sync_ops**: `opId` (PK, generated on the device), `userId`, `deviceId`, `appliedAt`, `result`.
  This makes push idempotent, so a retried push never applies an op twice. Rows older than 90
  days are purged.
- **change_history**: `id`, `table`, `rowId`, `walletId?`, `overwrittenBy` (user id),
  `previous` (JSON of the losing version), `loserUserId`, `changeSeq`, `createdAt`. It keeps the
  version that lost a conflict (rule 12), so nothing disappears silently. Its `changeSeq` lets
  pull carry the notice to the loser's devices with the rows (rule 12).

### Device: local database (web)

- **Engine** (decided at the start of #4a after a spike, see Open questions): the official SQLite
  WASM build (`@sqlite.org/sqlite-wasm`) running **in memory**. On a trusted device the whole
  database is exported, encrypted (rule 4) and saved as **one snapshot in IndexedDB** (`tpn-vault`);
  unlocking decrypts it back into memory. An untrusted device runs the same engine and never saves
  a snapshot. The wasm file is copied to `/sqlite/` and prefetched by the service worker, so it
  works offline.
- Beside the snapshot, `tpn-vault` keeps the clear-text facts the lock screen needs before the PIN:
  `userId`, the PBKDF2 salt and iterations, the wrapped data key, and the wrong-PIN count.
- It holds **only the signed-in user's own data plus master data**. It never holds data of wallets
  shared with them, apart from their own pending adds (rule 14).
- The tables mirror the server's synced tables, plus:
  - **outbox**: ordered pending ops `{ opId, table, op: upsert | delete, row, baseSeq, createdAt }`.
  - **sync_meta**: `cursor` (the last `changeSeq` pulled), `deviceId`, `userId`.
- Balances, reports and month summaries are **computed locally** from transactions, never stored
  (ROADMAP → Money & data).

## Business rules

**Trusted device & app lock**

1. Right after a successful sign-in (any method) on a device with no local database, a **trust
   step** (`/auth/trust`, outside the shell) asks **"ใช้งานออฟไลน์บนเครื่องนี้"** (use offline on
   this device). It defaults to **on** when the PWA is installed (`display-mode: standalone`) and
   **off** in a normal browser tab. The choice can be changed later in Account → Security (turn
   on: set a PIN; turn off: wipe).
   - **Off (untrusted)**: data is kept in memory only. Nothing is written to browser storage and
     nothing is queued offline. Closing the tab forgets everything except the refresh cookie.
   - **On (trusted)**: the user sets a **6-digit PIN**, and the local database is created encrypted
     (rule 4).
2. The app **locks** every time it's opened, and after **5 minutes** in the background or idle. To
   unlock it needs the PIN. Later, a passkey or biometric unlock (WebAuthn PRF) can unwrap the same
   key. "Idle" means no tap, click or key press for 5 minutes while the app is on screen. Locking
   drops the key and the in-memory database (after saving it).
   - **One tab at a time** (decided at the start of #4a): each tab would hold its own in-memory
     copy, so the app runs in one tab only (a Web Lock, `tpn-local-db`). Another tab shows "แอป
     เปิดอยู่ในแท็บอื่น" with "ใช้ที่แท็บนี้", which saves and locks the first tab and takes over.
3. **5 wrong PINs in a row** wipe the local database on that device. The user then signs in again
   online and the data downloads from the server. Unsynced changes on that device are lost, and the
   lock screen warns about this from the 3rd wrong attempt. The count is stored in clear and
   survives a reload; a right PIN resets it.
4. **Encryption at rest**: a random 256-bit data key (AES-GCM, WebCrypto) encrypts the local
   database snapshot (a fresh 12-byte IV per save). The key is stored only **wrapped** (AES-KW) by
   a key derived from the PIN (PBKDF2-SHA256, 600,000 iterations, random 16-byte salt). Without
   the PIN, the stored data is unreadable, even through DevTools. A wrong PIN fails the unwrap, so
   no PIN hash is stored. Changing the PIN re-wraps the same data key.
   - **Honest limit:** a 6-digit PIN stops someone who just picks up the device. It doesn't stop a
     determined attacker who copies the browser profile and brute-forces 10⁶ PINs offline. Passkey
     unlock (rule 2) is the stronger option.
5. `navigator.storage.persist()` is requested on trusted devices. On iOS, data survives only when
   the PWA is **installed to the home screen**. The trust prompt says so on iOS Safari.
6. The access token stays **in memory only** (auth spec). Offline, no token is needed, because the
   app reads the local database. Online, it refreshes as usual.

**Server is the authority**

7. On every return online, the app first calls `/auth/refresh`, then syncs.
   - **Revoked session** (signed out on another device, "sign out other devices", or a disabled
     user): the device **wipes** its local database and goes to sign-in. Unsynced changes are lost.
     That's intended, because revocation is a security action.
   - **Expired session** (idle > 30 days or past the 180-day cap): the local data is kept but stays
     locked to sync until the **same user** signs in again online; then the outbox is pushed. If a
     **different** user signs in, the local data is wiped first. Meanwhile the app keeps working
     on the local data after the PIN, online or not (decided at the start of #4a), with a banner
     "เข้าสู่ระบบอีกครั้งเพื่อ sync" that opens sign-in.
   - **API unreachable** (offline, or the server down): a trusted device opens on its local data
     after the PIN; an untrusted one waits on the sign-in page as before (auth spec).
   - **Sign-out** pushes the outbox first. If that fails (offline), it warns "มีรายการที่ยังไม่ได้
     sync" before wiping.

**Sync protocol**

8. Every local write goes to the local database **and** the outbox in one local transaction. The UI
   updates immediately; it never waits for the server. On a trusted device the snapshot is saved
   right after each write transaction (writes during a save are coalesced into one more save),
   and again when the app goes to the background (`visibilitychange` / `pagehide`).
9. **Pull** (`GET /sync/pull?since=<cursor>&limit=500`) returns every row the user may sync with
   `changeSeq > cursor` (tombstones included), ordered by `changeSeq`, plus the new cursor. The
   device applies them and saves the cursor. A cursor older than the tombstone retention returns
   `410`, and the device does a full resync.
10. **Push** (`POST /sync/push`) sends outbox ops in order, in batches.
    - For each op the server checks access and **runs the feature's own validation** (same service
      rules as the feature specs), applies it, stamps `changeSeq`, clamps `updatedAt` to the
      server's now, and records `opId`.
    - It returns a per-op result: `applied`, `overridden` (a conflict was resolved against it; the
      winning row is returned), or `rejected` (a validation error, with the message).
    - Rejected ops stay visible to the user ("บันทึกไม่สำเร็จ", with fix or discard); they are never
      dropped silently.
11. **Push before pull.** Each sync round pushes, then pulls. Running two rounds at once is
    prevented with a Web Lock (`navigator.locks`), so two tabs don't sync together.

**Conflicts**

12. A conflict is an op whose `baseSeq` (the `changeSeq` the device last saw for that row) is older
    than the row's current `changeSeq`.
    - **Own wallet, the same user's two devices**: the later `updatedAt` wins (after the clamp in
      rule 10). If they're equal, the one the server received first wins.
    - **Shared wallet**: the **owner always wins** over a member, whatever the times. Between
      members, conflicts can't happen, because members edit online only (rule 14).
    - **Delete beats edit**: if either side deleted the row, it stays deleted.
    - The losing version goes to `change_history`, and the person whose change lost sees a notice
      ("รายการนี้ถูกแก้ไขโดย …") the next time they sync: a push answers `overridden` to the
      device that lost, and pull returns the user's `change_history` entries newer than the
      cursor, for a device whose edit was already `applied` and lost later.
    - Adding new rows never conflicts (each has its own id), and balances are computed, so they can
      never "conflict".

**Shared wallets (#16; the table exists from #6)**

13. A wallet has one **owner** (`wallets.userId`) and zero or more members in `wallet_members` with
    role `editor` or `viewer`. Only the owner can change the wallet itself (name, currency, archive,
    delete) and manage members.
14. What each role can do:

    |                                 | Owner            | Editor                                      | Viewer      |
    | ------------------------------- | ---------------- | ------------------------------------------- | ----------- |
    | See the wallet and transactions | online + offline | online only                                 | online only |
    | Add a transaction               | online + offline | online + **offline** (queued, synced later) | ❌          |
    | Edit / delete a transaction     | online + offline | **online only**                             | ❌          |
    - An editor's offline add shows in that editor's own list as "รอ sync" until it's pushed.
    - Edit and delete buttons are disabled for editors while offline.
    - On the server, an editor's update or delete must carry a `baseSeq` equal to the row's current
      `changeSeq`; otherwise it's `rejected` and the editor refreshes.

15. Members read shared wallets through ordinary online endpoints (feature REST `GET`s with access
    checks). That data is held in memory only, never written to the member's local database.
16. Losing membership (removed by the owner) takes effect on the next request. Queued adds for that
    wallet are then `rejected` and shown to the member.

## Endpoints

| Method | Path         | Auth   | What                                                                  |
| ------ | ------------ | ------ | --------------------------------------------------------------------- |
| GET    | `/sync/pull` | Bearer | `?since=&limit=` → changed rows (incl. tombstones) + new cursor       |
| POST   | `/sync/push` | Bearer | `{ deviceId, ops: [...] }` → per-op `applied`/`overridden`/`rejected` |

Feature REST endpoints stay. They serve shared wallets (members, online), admin/debug, and tests.
The web app's **own** data goes through the local database + sync.

## Web screens

All of them except the sync status and Security sit outside the shell (DESIGN.md §2). PINs are
typed on an **on-screen 3×4 keypad** with six dots (like a banking app), so the phone keyboard never
opens.

- **Trust step** `/auth/trust` after sign-in on a device with no local database (4a.1): the offline
  switch (rule 1), the iOS "add to home screen" note (rule 5), then set the PIN and type it again.
  Continue goes to `returnUrl`.
- **Lock screen** `/lock` (4a.1): the user's name, the keypad, the attempts warning from the 3rd
  wrong PIN (rule 3), and "ออกจากระบบ" (sign out, rule 7). Later "use fingerprint/face".
- **Another tab** (4a.1): "แอปเปิดอยู่ในแท็บอื่น" with "ใช้ที่แท็บนี้" (rule 2).
- **Expired session banner** under the header (4a.1, rule 7).
- **Sync status** in the header (4a.2): synced ✓ / syncing / offline (n pending) / errors (n).
  Tapping it lists rejected ops to fix or discard, and conflict notices.
- **Account → Security** (4a.1): a "This device" group with "Use offline on this device" (turn on:
  set a PIN; turn off: asks, then wipes local data) and "Change PIN" (current PIN, then the new
  one twice), beside the devices list (auth sessions).

## Interactions

- **Auth** owns sessions and revocation. This spec adds trusted-device, lock and wipe rules on the
  web.
- **Wallet, category, transaction** and later features add the sync columns, use soft delete, and
  expose a per-table "apply op" in their service, which `/sync/push` calls. Features can't import
  each other (`api/AGENTS.md` §2), so each one registers its table handler (validate, apply, pull
  query) in a registry in `core/sync` from its `index.ts`, and `features/sync` reads the registry.
- **App shell (#3)** provides the service worker and storage persistence only. The local database
  and sync arrive with #4a.

## Open questions

- **Local database library**: decided at the start of #4a, **SQLite WASM in memory + one
  encrypted snapshot in IndexedDB** (Data model → Device). Spike in headless Chromium with made-up
  transactions:

  |                                 | SQLite WASM + snapshot                         | Dexie, per-record encryption             |
  | ------------------------------- | ---------------------------------------------- | ---------------------------------------- |
  | Download (gzip)                 | 58 KB JS + 406 KB wasm, lazy, cached by the SW | 34 KB                                    |
  | Month-by-category report        | 7 ms at 5k and at 20k rows (SQL)               | 190 ms / 640 ms (decrypt all, sum in JS) |
  | One write                       | 30 ms / 150 ms (whole snapshot, async)         | 4–6 ms                                   |
  | Unlock (PBKDF2 600k + load)     | ~400 ms (PBKDF2 ~300 ms of it)                 | PBKDF2 only, then decrypt per query      |
  | Stored size, 5k rows            | 1.1 MB                                         | 8.5 MB                                   |
  | In clear                        | nothing                                        | ids, `changeSeq`, any indexed field      |
  | Several tabs                    | one tab at a time (rule 2)                     | native                                   |
  | Untrusted (memory only, rule 1) | same engine, no snapshot                       | a second in-memory store                 |

  IndexedDB beat OPFS for the snapshot (12 ms vs 36 ms for 1.1 MB) and works on the main thread in
  every browser, including iOS Safari. Angular's build bundles the package as a lazy chunk once
  `locateFile` points at the copied wasm. A family's five years (~18k rows) is a ~4 MB snapshot.

- **First synced table for 4a.2**: no synced table exists before #5 / #6. Proposal: fold Currency
  (#5, pull-only master data) into 4a.2 and prove push with a test-only table in the API tests;
  decide at the start of 4a.2.
- **Auto-lock timeout** 5 min and **PIN length** 6: adjustable in settings later?
