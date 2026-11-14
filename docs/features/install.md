# Install to the home screen

> Status: Built: web only, `features/account/pages/install-page`, `features/auth/pages/install-guide-page`, `core/pwa`

## Purpose

Show people how to put ตังค์ไปไหน on their phone's home screen, and let them do it in one tap where
the browser allows it. An installed app opens full screen like a native one, and on iPhone it is the
only way the local data is kept for good: Safari may clear a site's storage, a home-screen app's it
keeps ([offline-sync.md](offline-sync.md): `navigator.storage.persist()` and iOS). What was synced
comes back with the next pull either way, but what wasn't is lost.

## Out of scope

- A reminder card, banner or popup anywhere (owner, 2026-11). The only other way in is the quiet
  link on the sign-in page (rule 5).
- App stores (the app is a PWA, ROADMAP locked decisions).

## Business rules

1. **Installed** means the app runs as one (`display-mode: standalone`, or iOS
   `navigator.standalone`). Then the page only says so.
2. **One-tap install** where the browser offers it (`beforeinstallprompt`: Chrome, Edge, Samsung
   Internet on Android and desktop). The event is caught at app start, kept, and used once by the
   "ติดตั้งแอป" button; the browser's own dialog answers. After `appinstalled` the page says it is
   installed and to open it from the icon.
3. **Steps** for everyone else. iPhone / iPad (Safari has no install API): Share → "เพิ่มไปยังหน้าจอ
   โฮม" → "เพิ่ม". Android: ⋮ → "ติดตั้งแอป" (or "เพิ่มไปยังหน้าจอหลัก") → "ติดตั้ง". A
   segmented control picks the platform; it starts on the phone's own (iPadOS counts as iPhone).
4. Nothing is stored and nothing is sent to the server.
5. **Before sign-in** (owner, 2026-11): the sign-in page links to the same steps, unless the app
   is already installed. On iPhone the home-screen app keeps its own storage, apart from Safari,
   so installing first means signing in once, inside the app, and nothing left behind in Safari.

## Web screens

- **Account › การตั้งค่า › ติดตั้งลงหน้าจอ** (`/account/install`), between การแสดงผล and เครื่องนี้.
  The row's line says "ติดตั้งแล้ว" or "ยังไม่ได้ติดตั้ง".
- The page: "ประโยชน์ของการติดตั้ง" (three short points: opens from its icon, works offline, saved
  data is kept), the "ติดตั้งแอป" button when rule 2 applies, then "วิธีติดตั้ง" ("หรือติดตั้งเอง
  ตามขั้นตอนนี้" under the button) with the platform control and numbered steps, each with the
  icon the person will look for. Steps call it "แอปตังค์ไปไหน"; the words are user-facing, never
  technical ("the browser clears storage").
- **Sign-in › ติดตั้งแอปลงหน้าจอ** (`/auth/install`, rule 5): a text link with the download icon
  at the bottom of the sign-in page, hidden in the installed app. It opens the same page inside
  the sign-in layout, with "ติดตั้งลงหน้าจอ" as its heading and "กลับไปหน้าเข้าสู่ระบบ" at the
  bottom. Open to everyone, signed in or not.
