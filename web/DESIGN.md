# DESIGN.md

How **ตังค์ไปไหน** looks, reads and behaves on screen. Read it before building or changing a screen.

- **What** a screen contains comes from its feature doc (`docs/features/<feature>.md` → Web screens).
- **How it looks and behaves** is this file.
- **How to write the code** (folders, Angular, forms, lint) is [`AGENTS.md`](AGENTS.md).

If the app and this file disagree, the app wins: fix this file in the same change. A new design
choice that isn't decided yet is marked **Proposal** until the owner confirms it.

---

## 1. Principles

1. **Feels like a native phone app.** Fixed tab bar, bottom sheets, big touch targets, no page
   reloads, no web-isms (hover menus, tiny links, centred modals).
2. **Familiar to a Money Lover user.** The owner and family use Money Lover today, so keep its
   layout and flows (tabs, ➕ in the centre, day-grouped list, category grid) unless there's a reason
   to differ.
3. **One hand, one thumb.** Primary actions sit in the bottom half of the screen. The thing you do
   most (add a transaction) is one tap from anywhere.
4. **Calm by default; colour carries meaning.** The UI is neutral. Colour is reserved for money
   direction (income / expense), status (offline, error) and the user's own wallet/category colours.
5. **Honest about offline.** The app works offline, so never block a screen on the network. When
   something only works online (sign-in, shared wallets as a member), say so in place.

## 2. Layout

- **Design for 375 × 812 first.** Wider screens centre the same column at **max 480px**
  (`mx-auto max-w-[480px]`). There's no tablet or desktop layout.
- **App shell** (`layout/`, built in #3):

  | Part           | Size                                     | Notes                                       |
  | -------------- | ---------------------------------------- | ------------------------------------------- |
  | Header         | 56px (`h-14`) + `safe-area-inset-top`    | Page title left, status right, sticky       |
  | Page           | fills the rest                           | Bottom padding = tab bar height + safe area |
  | Bottom tab bar | 64px (`h-16`) + `safe-area-inset-bottom` | Hidden while the on-screen keyboard is open |

- **Transactions tab header** (#8, Money Lover style; the Reports tab uses it too since #10,
  its ⋮ holding only "ดูตาม"): three columns of which the outer two
  are equal, so the **wallet switcher** (a pill: wallet badge, name, ▾) sits in the very
  centre; the **profile switcher** left, the sync icon and the ⋮ menu right. The profile
  switcher is the same on every data tab (owner, 2026-11): a glass capsule with the profile's
  28px icon and a ▾, no name (it lives in the switch sheet). The Wallets tab uses the same
  three columns with its title in the centre, so the header never changes shape between tabs. The ⋮ menu (#9,
  owner's choice B, so later items fit) is a two-level nav list: rows with an icon ("โอนเงิน",
  "ดูตาม" with the current unit and ›); a row with › turns the menu into its options, headed
  by "‹ ดูตาม" to go back; ← / → move between the levels. Under it
  the balance (ยอดรวม / ยอดเงิน) large and centred, then the period tabs as chips (`09/2026 ·
เดือนที่แล้ว · เดือนนี้ · อนาคต`), swipeable; a sideways swipe over the list changes period.
- **Outside the shell** (no tab bar): sign-in, enter code, PIN lock. These are
  full-screen flows with their own simple header: the app name on the left and the
  **TH | EN** switch on the right (the account page isn't reachable before sign-in), and a
  ghost back button with a label inside the page when there's a step to go back to.
- **Spacing**: page padding `p-4`. Sections are `gap-6` apart; items inside a section are `gap-3`.
  Use Tailwind's scale only, never arbitrary pixel values, except for safe-area `env()` values.
- **Section heading**: `text-sm font-medium text-muted-foreground`, above a group of rows or fields.
- **Cards and grouped rows** (summaries, settings, details): a surface on the page, so it uses the
  card token: `rounded-xl border border-border bg-card text-card-foreground`, with `divide-y` rows,
  each `px-4 py-3`, label left, value or control right.

## 3. Colour

All colour comes from theme tokens. Never use raw palette classes (`bg-slate-50`, `text-red-500`).
Only tokens keep dark mode and the themes below working.

### Themes

The user picks a **theme** (ธีม) and, separately, a **mode** (light / dark / system), both on the
account page. Every theme has a light and a dark version, so there are 8 looks. All of them
share the layout below; only the colours change.

| Id (`data-palette`)       | Name (every language) | Character                                                  |
| ------------------------- | --------------------- | ---------------------------------------------------------- |
| `midnight-gold` (default) | Midnight Gold         | navy page, gold accent: calm like Indigo, bright like Gold |
| `indigo-night`            | Indigo Night          | cool indigo page and accent                                |
| `gold-coin`               | Gold Coin             | warm black page, gold accent ("ตังค์" = coins)             |
| `plum`                    | Plum                  | deep plum page, orchid accent                              |

Theme names are names, not descriptions, so they stay English in both languages (§11).

**In code a theme is called a _palette_** (`data-palette`, `PALETTES`, `PaletteId`, `tpn-palette`),
because `ThemeService` covers both the mode and the palette. Users only ever see "theme" / "ธีม".

- **One file per theme** in `src/styles/themes/<id>.css`, holding its light and dark tokens.
  `styles.css` imports all of them (a few KB together), so switching is instant and works
  offline. `midnight-gold` is the fallback on `:root` / `.dark` and must be imported first.
- Tokens are scoped by attribute (`[data-palette='plum']`, `.dark [data-palette='plum']`), not
  only on `<html>`, so any element with `data-palette` shows that palette. The picker's swatches
  use this to preview each theme in the current mode.
- `ThemeService` (`core/theme`) owns both choices (`tpn-theme`, `tpn-palette` in localStorage;
  absent = default) and sets `.dark` + `data-palette` on `<html>` and the `theme-color` meta. The
  inline script in `index.html` does the same before boot. **Adding a theme** = a new CSS file,
  its import, an entry in `PALETTES` (id, English name, theme colours), and the id + colours in the
  `index.html` script.
- Every text/background pair in every theme must pass WCAG AA (4.5:1; 3:1 for the focus ring).
  Check a new theme's numbers before adding it. The gold `primary` on a light page is the one
  allowed exception (1.8:1 for the ➕ fill): the glyph on it is 9.6:1, and the ring uses the darker
  `brand` gold.
- **The app icon doesn't follow the theme** (it's fixed at install). It's the default's look:
  navy, white wallet, gold ฿.

### Tokens

| Use                         | Token                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Page background / text      | `bg-background` / `text-foreground`                                |
| Cards, sheets (surfaces)    | `bg-card` / `text-card-foreground`                                 |
| Secondary text, inactive    | `text-muted-foreground`                                            |
| Subtle fills (chips, pills) | `bg-muted`                                                         |
| Primary action (one/screen) | `bg-primary text-primary-foreground` (via `hlmBtn`)                |
| Brand text / icons (active) | `text-brand` (the accent, darkened where needed for text contrast) |
| Error, offline, destructive | `text-destructive`, `bg-destructive/10`                            |
| Lines                       | `border-border`                                                    |
| Income / expense amounts    | `text-income` / `text-expense`                                     |

**Money and status colours are the same green / red in every theme**, so their meaning never
changes with the look. `--income` / `--expense` pass 4.5:1 on both `--background` and `--card`.
Don't reuse `destructive` for expenses: an expense isn't an error.

**User colours** (profile, wallet and category `color`) arrive as data and are the only raw colours
allowed. Use them for the icon circle's background with a **white glyph** (owner's choice in #7):
every colour in `USER_COLORS` gives white at least 4.5:1, so a new colour must too (a test
checks). Five colours were darkened one step in #7; a row saved with an old one is drawn with the
new one (`userColor`) and saved with it on its next edit. Never use them for text on the page
background.

**The accent is for "you are here" and "do this", nothing else**: the ➕, the one primary button,
the active tab, the selected option, the focus ring. Don't use it for decoration, headings or
amounts. That keeps it meaningful, and it's what makes the app look like itself rather than Money
Lover's black and green.

## 4. Typography

- **Font: Noto Sans Thai** (variable, weights 100–900), a **loopless** Thai face (ไม่มีหัว), with
  Latin and digits in the same family. It's self-hosted from `@fontsource-variable/noto-sans-thai`
  (imported in `styles.css`, ~75 KB for Thai + Latin + Latin-ext), so the service worker prefetches
  it and it works offline. `--font-sans` puts it first, with the system stack as a fallback. Don't
  add a second family; use weights (`font-medium`, `font-semibold`) for hierarchy.
  Alternatives the owner saw: Anuphan, IBM Plex Sans Thai. Switching is the import plus
  `--font-sans`.
- **Never tighten Thai line height.** Thai stacks vowels and tone marks above and below the line, so
  `leading-none` / `leading-tight` clip them. Keep the default line height for anything that can
  hold Thai.

| Role                 | Classes                                       |
| -------------------- | --------------------------------------------- |
| Page title (header)  | `text-lg font-semibold`                       |
| Big amount (summary) | `text-3xl font-semibold tabular-nums`         |
| Amount input         | `text-4xl font-semibold tabular-nums`         |
| Row title / body     | `text-base` (rows) or `text-sm` (dense lists) |
| Secondary / caption  | `text-sm text-muted-foreground`               |
| Section heading      | `text-sm font-medium text-muted-foreground`   |
| Tab bar label        | `text-[11px]`, the only text below 12px       |

## 5. Money and dates

- **Formats follow the UI language**: Thai uses `th-TH`, English uses `en-GB` (day-month order,
  like Thai). Both show ฿ for baht (`currencyDisplay: 'narrowSymbol'`).
- **Amounts** are integer minor units in data. Format them only with `Intl.NumberFormat(locale, …)`
  and the currency's digits (see `AGENTS.md` → Money & dates). Always use `tabular-nums`, and
  right-align amounts in lists.
- **Direction is shown by sign and colour together**, never by colour alone (colour-blind users,
  dark mode): expense `-฿120.00` in expense colour, income `+฿25,000.00` in income colour.
  **Transfers** (#9, owner's choice Q5, replacing "neutral") follow the money in each wallet: a
  transfer is two rows, the outgoing side `-1,000.00` in the expense colour ("โอนไปยัง X"), then
  the incoming side `+1,000.00` in the income colour ("ได้รับจาก X"), on a muted ⇄ badge. They
  never count in รายรับ / รายจ่าย / สุทธิ or a day's net; the summary card adds a "โอน" line
  with their signed net when the view's transfers don't cancel out.
- **Totals in different currencies** are shown one line per currency, never added together.
- **Dates**: relative words for recent days (วันนี้ / Today, เมื่อวาน / Yesterday), then a short
  date such as `จ. 14 ต.ค.` / `Mon 14 Oct`. Day headers in the transaction list show the date on the left and the day total on
  the right.
- **Era: ค.ศ. everywhere** (owner's choice at the start of #8, replacing พ.ศ. in Thai): both
  languages show the Gregorian year (2026), so nobody converts between eras. Thai formats with
  `th-TH-u-ca-gregory` (`LanguageService.locale()`). Stored dates stay ISO / `YYYY-MM-DD`.
- **Transaction list** (#8): a card per day with the date large on the left (`02`), the
  weekday (or วันนี้ / เมื่อวาน) over the month and year beside it, and the day's net on the
  right. Rows: the category badge, the category name, the user's note under it (nothing when
  there is none), the signed amount right **without the currency symbol** while every row
  shares one currency (the balance above shows it). On "ทุกกระเป๋า" a 20px wallet badge sits
  on the category badge's corner; with one wallet chosen there is none. "รอ sync" is a small
  cloud line.

## 6. Components and patterns

Controls are spartan/ui (`hlm*`). Build these patterns from them instead of inventing new ones.

- **Buttons**: at most **one** `default` (filled) button per screen, the main action. `outline` is
  for secondary actions, `ghost` for header and toolbar icons, `destructive` for delete. Icon-only
  buttons always have an `aria-label`.
- **Forms**: always the shared `*-field` wrappers (`AGENTS.md` → Forms). Fields stack vertically,
  full width, `gap-4`. Inside a field the label sits 12px above the input, and the hint and the
  error 4px under it, so a message reads as part of its field. In a sheet, the Save button stays
  fixed at the bottom, above the keyboard.
- **Compact sheet forms** (owner's choice in #6.2, Money Lover style): a create / edit sheet for
  a named thing with an icon (wallet, profile, later category) has no labels above its fields
  and no hints. Row 1 is the icon on its colour (a 52px button with a small pencil) and the name
  across the rest (`app-name-icon-field`, the label read by screen readers and shown as the
  placeholder); tapping the icon opens an "ไอคอนและสี" view in the same sheet (colours, then the
  icon grid). Picking a colour or an icon only selects it, both alike: the view stays open
  and ‹ takes the choice back to the form (owner, 2026-11: going back on the icon read as "OK"
  while the colour didn't, which confused people). Further rows are one line each (an amount with its +/−
  button and currency, a switch). Errors still show under their row, one at a time. Long forms
  (password, phone) keep labels.
- **Transaction form** (owner's choice in #8, from the Money Lover screenshot): **one card of
  rows told apart by their icons, no labels above them** (labels stay for screen readers):
  wallet, amount (the currency code and the figures large, each number grouped in thousands as
  typed, `8,500`, after #12; a small "จำนวนเงิน" over them since it has no icon), category, note, date (‹ › a day, the middle opens the date
  picker; `app-date-row`, the same row in the transfer, debt and event sheets), and less used
  options folded under "เพิ่มเติม". The amount is typed on an
  **on-screen number keypad** (`app-calc-keypad`: digits, 000, ., ⌫, C and a ✓ that closes it
  ("เสร็จ" to a screen reader), no operators, four 44px rows so the form stays in view) that
  slides up by itself when adding, slides down on ✓ and closes when any other control is used
  (it belongs to the amount row); it covers the main button while it shows (✓, then save;
  nothing moves), with "บันทึกแล้วเพิ่มต่อ" as an outline icon beside the main button when
  adding. **Quick amounts** (8.2) are a chip row on top of the keypad's panel (`20 · 50 · 100 ·
500 · 1,000`, a tap adds), switched off in Account › การแสดงผล. The note is its own view
  (‹ back keeps the text), so it can be long. There are no type tabs on the form (2026-11): the
  category picker holds รายจ่าย / รายรับ tabs and the category sets the type, Money Lover
  style. Editing shows copy and delete in the header. The category picker starts with a "ใช้บ่อย" row (up to 4 badges with names, in a card) over the
  tree.
- **Create / edit / pick = bottom sheet** (spartan `drawer`), never a centred dialog. Dismiss by
  swiping down or tapping the backdrop. No grab handle (owner, 2026-11): the header's ✕ or ‹
  and the swipe are enough, and the bar took 22px (`src/styles.css` hides it for every sheet).
  The header's ✕ / ‹ sits in a **glass disc** and its right-hand icons share one glass capsule
  (`tpn-glass`, iOS style, owner 2026-11), as do the page header's ‹, the in-page "‹ ตั้งค่า"
  pills, the Transactions header's wallet pill and ⋮, and the date row's ‹ ›, so they read as
  buttons. **One size for all of them**: a 36px disc (`size-9`, a pill `h-9`) with an 18px icon,
  its tap area still 44px (`tpn-hit`).
  Closing never asks, even with unsaved input (owner, 2026-11): the forms are short, so typing
  them again costs less than a question on every close.
- **Delete**: act at once, then offer **undo** in a toast (spartan `sonner`). Confirm first only
  when undo is impossible (wiping local data, removing a shared member, deleting a profile or a
  wallet, which go as tombstones other devices act on). The confirm is a view in the same sheet
  (‹ back, a line on what goes with it, a destructive button). **Archive** acts at once and offers
  undo in its toast.
- **Toasts** sit at the **top** of the screen (owner's choice in 8.2, so they never cover the
  keypad or a sheet's main button), above an open sheet, last about 4s, say one short thing, and
  have at most one action (เลิกทำ), which works over a sheet without closing it.
- **Account tab** (owner's choice A1 in #7): who is signed in on top, then titled groups of
  rows (ข้อมูลของฉัน, บัญชีและความปลอดภัย, การตั้งค่า), each row a link with a 40px muted icon
  square, its name, one muted line on what's there and a chevron; settings live on their own
  pages (การแสดงผล, ติดตั้งลงหน้าจอ, เครื่องนี้), never inline. A page inside the tab shows ‹ in the header.
  การแสดงผล has no dropdowns: language (TH / EN) and mode (ตามระบบ / สว่าง / มืด) are segmented
  controls with a visible label (`showLabel`), the theme the grid of colour discs, so the two
  kinds of choice never look alike.
- **Segmented control** (`app-segmented-field`): two or three short choices in a `bg-muted` track,
  the chosen one a `bg-card` chip with `font-semibold` (รายจ่าย / รายรับ). The same look serves
  as tabs above a list (`role="tab"`, Account › หมวดหมู่).
- **Category tree** (owner's choice "3+4" in #8): a parent's sub-categories sit in a panel
  tinted with the parent's colour (`color-mix`, 9% light / 15% dark) with a soft 3px bar in
  that colour on its left (`.tpn-tree` in `styles.css`, `--tree-color` on the element). Used by
  the transaction form's picker, Account › หมวดหมู่ and the wallet's "หมวดหมู่ที่ใช้".
- **Switch list** (`app-toggle-list-field`, #7.2): a card of rows (40px badge, name, a switch
  on the right; children 32px and indented), the whole row is the switch (`role="switch"`). A
  row that follows something else (a child of a hidden parent) shows off, dimmed and disabled,
  with one muted line saying why ("ซ่อนตามหมวดหมู่หลัก"). It sits in a sheet's later view, opened
  from a form row drawn like "หมวดหมู่หลัก" (label left, value right, ›), and saves with the
  form. Used for the wallet's "หมวดหมู่ที่ใช้" and the category's "ใช้ในกระเป๋า".
- **List rows**: at least 56px tall. A 40px icon circle on the left (category/wallet colour), title
  and a muted subtitle (note) in the middle, amount on the right. Tap opens; there are no swipe-only
  actions.
- **Empty states**: `app-empty-state` (icon in a muted circle, one heading, one line of help).
  Where it makes sense, add one button that does the obvious next thing (e.g. "เพิ่มกระเป๋าเงิน").
- **Loading**: local reads are instant, so show no spinner for them. Network actions (sign-in, send
  code, sync) put a spinner in the button that started them and disable it. Use skeletons only for
  online-only lists (shared wallets as a member).
- **Errors from the server** (a wrong code, a rate limit, no connection) show as one line,
  `role="alert"`, `text-sm text-destructive`, right under the field or above the button they're
  about (`-mt-2` under a field, so it sits 8px below it, not the form's 16px). One message at a
  time: a server error clears once the user edits the form. Field-level validation stays in the field (`*-field` wrappers). An "only works online"
  notice is a tinted block (`rounded-xl bg-destructive/10 text-destructive`), and the action it
  blocks is disabled.
- **PIN entry** (`app-pin-pad`, `shared/components/pin`): six dots over an on-screen 3×4 keypad
  of 64px round `bg-muted` keys, so the phone keyboard never opens; Backspace bottom right, a
  hardware keyboard works too. The sixth digit submits. Choosing a PIN is `app-pin-setup` (type,
  then type again; a mismatch starts over with one error line). Errors and the attempts warning
  sit in one `role="alert"` line between the heading and the dots. Used by the lock screen and
  Account › PIN (the PIN is optional since after 16.2). Keypads take
  `touch-manipulation`, so tapping one key twice fast ("33") never zooms the page; pinch zoom
  still works.
- **Tab bar**: the active tab is shown by colour alone: icon and label in `text-brand`, the label
  `font-semibold` and the icon stroke 2.4 (so it doesn't rely on colour only), no pill, fill or
  border (owner's choice in #6.1, so the gold ➕ stays the bar's one strong shape). Inactive tabs
  are `text-muted-foreground`. Focus shows a ring around the icon. A page opened from another
  tab (the Transactions ⋮ → รายการซ้ำ, which lives in Settings) keeps the tab it came from lit,
  so the bar never jumps (owner, 2026-11).
- **Strip under the header**: the update banner: `bg-muted px-4 py-2 text-sm`, the text left
  and one 44px button right. (The expired-session banner went after 16.2: an expired session
  goes to sign-in.)
- **Status**: the header's right side holds the **sync status** (`layout/sync-status`, #4a.2),
  the same 44px icon on **every tab** (owner's choice in #8 for the Transactions tab, every tab
  since #9): a green cloud with a tick (synced), a cloud with the waiting count, a red crossed
  cloud with a count (offline, server not answering), a red cloud with an alert and the count of
  refused items (errors), a spinning arrow while syncing. Shape and colour together, never
  colour alone. The words ("sync แล้ว", "รอ sync 3", "ออฟไลน์ · รอ 2", "เซิร์ฟเวอร์ไม่ตอบ · รอ
  2", "บันทึกไม่สำเร็จ 1") are its label, announced politely (`role="status"`), and the sync
  sheet it opens (last sync, "sync ตอนนี้", rejected items with fix / discard, conflict
  notices) says them in full.
- **Reports tab** (#10, owner's choices from a three-round mock-up; report.md → Web screens):
  the Transactions tab's header and period chips, then, in the order a report is read, the
  summary, the breakdown, the trend (owner, 2026-11). The **summary card (H1)**: the period's
  name small, then รายรับ / รายจ่าย as the headline (`text-xl` bold) in two tiles tinted with
  the money colours (`bg-income/10`, `bg-expense/10`; ↙ / ↗ beside the word, the amount
  coloured only when not zero); "สุทธิ" and the net on one line under them; ยอดเริ่มต้น →
  ยอดสุดท้าย on one line under a rule; then small `bg-muted` chips only when they say
  something (average per day, โอนเงิน, "ไม่รวมในรายงาน n รายการ ›" as a link). The **trend**,
  only for a period longer than a month: a pair of bars per month (quarter, year) of the chosen
  period in the money colours (4px rounded tops), a three-line compact scale, a line above the
  bars with the muted hint or the tapped pair's figures; the tapped pair outlined in
  `ring-brand`, the others at 40%; each pair is a button that never changes the period. The
  **split list** (by category,
  a parent's sub-categories): a thin bar split by category (2px gaps), then rows largest
  first: 40px badge, name and amount, a 6px bar of its size in the category's colour, the
  share and one muted note ("2 หมวดย่อย", "เก็บถาวร", "บันทึกที่หมวดหลักโดยตรง"), › ; the badge and
  name carry identity, since user colours may repeat. Charts are drawn with plain elements and
  tokens, never a chart library.
- **Transfer form** (#9): the transaction form's frame and rows without type tabs or category:
  from wallet and to wallet (each with its balance on the right, a small "จาก" / "ไปยัง" over
  the name) with a round ⇅ swap button on the line between them, then amount (keypad), note,
  date. Opened from the ⋮ menu and from a gold-tinted "โอนเงิน" on the Wallets tab
  (`bg-brand/10 text-brand`, beside the outline "เพิ่มกระเป๋าเงิน": two secondary actions side by
  side must not look the same).
- **Recurring** (#12, owner's choices from a mock-up; recurring.md → Web screens):
  - **"ทำซ้ำ" row**: in the transaction form under "เพิ่มเติม" (the transfer form: a card of its
    own under the date row), the repeat icon, "ไม่ทำซ้ำ" or the rule in `text-brand`
    semibold ("ทุกเดือน วันที่ 1") with its end and how it records in a muted line; the date
    row then reads "เริ่ม" over the date, and a muted line under the card names the next date.
    On a recorded occurrence the same row reads "จากรายการซ้ำ" and opens the rule.
  - **"ทำซ้ำ" view** (a later view of the same sheet, ‹ back keeps the choice): a card of
    radio rows (ไม่ทำซ้ำ, ทุกวัน, ทุกสัปดาห์ / ทุกเดือน / ทุกปี each with the date's weekday,
    day or day and month under it, กำหนดเอง with a −/+ stepper and unit chips), then "สิ้นสุด"
    and "เมื่อถึงกำหนด" as titled cards of radio rows with a muted line each.
  - **Due card**: at the top of the Transactions tab in every period, a 44px+ button tinted
    `bg-brand/10` with a `border-brand/30` line, a round `bg-brand` bell, "ถึงกำหนด n รายการ"
    and which ones; it opens the due sheet (rows with a tinted "บันทึก" and an outline "ข้าม",
    a tap on a row opens the form to edit it first, "บันทึกทั้งหมด (n)" pinned).
  - **Upcoming rows** ("อนาคต" only, never counted): the list's row at 65% opacity, the badge
    in a dashed `outline-muted-foreground` ring, the repeat icon and "ยังไม่บันทึก" in the muted
    line; a tap opens the rule. A recorded occurrence carries a small repeat icon after its
    category name.
  - **Rules page** (Account › รายการซ้ำ): titled groups ("ใช้อยู่ (n)", "หยุดไว้ (n)",
    "สิ้นสุดแล้ว (n)" folded), rows like the list's with the schedule and next date in the
    muted line, a small "ถามก่อน" tag (`bg-brand/10 text-brand`), a stopped rule's reason in
    `text-destructive` with an alert icon; the add buttons under the list (outline + the
    gold-tinted transfer one, as on the Wallets tab).
- **Debts** (#13, owner's choices from a mock-up; debt.md → Web screens):
  - **Wallets tab card "ยืม-คืน"** under the total: two link rows (a muted hand badge, ยืมมา
    / ให้ยืม, "ต้องคืน · n รายการ" with "เลยกำหนด n" in `text-destructive`, the left amount in
    the expense / income colour, ›). ยอดรวม doesn't change.
  - **Debts page**: ยืมมา | ให้ยืม as a `bg-muted` tab track, a card with the total left, then
    rows: badge (the category's for an instalment debt, else the muted hand), the person and a
    gold "ผ่อน" tag, the note, "คืนแล้ว x จาก y" (`text-xs`, no symbol), a 6px bar (brand gold
    for borrowed, income green for lent), the left amount and the due date (red when overdue);
    "ปิดแล้ว (n)" folded, rows at 65% opacity; an outline button under the list that says which way: "เพิ่มรายการยืม" /
    "เพิ่มรายการให้ยืม" (owner 2026-11: "บันทึกหนี้" on the ให้ยืม tab read as my own debt).
  - **Debt page**: a hero card (what is left large, the bar, facts lines, a pencil to edit),
    the instalment rule's row, then **คืนเงิน / รับคืน / จ่ายงวด** (main), **ยืมเพิ่ม /
    ให้ยืมเพิ่ม** (gold tint) and **ปิดหนี้** (outline) in one row; the history with an
    "รายจ่าย" / "รายรับ" tag on counted rows and a muted note on what is uncounted.
  - **Entry rows on the Transactions tab** look like transfer sides (a muted hand badge, the
    action as title, the person under it); a counted row of a debt carries a small hand after
    its category name; the summary card gets "หนี้ (ยืม/คืน)" like "โอน", the report summary a
    "หนี้ ±x" chip.
- **Events / trips** (#14, event.md → Web screens, mock-up `event.html`):
  - **Events page** (⋮ menu and Account): "ยังไม่จบ (n)" rows (badge, name, a gold-tint
    "กำลังใช้" tag while today is in its dates, the dates as a range "7–12 พ.ย. 2026", expense
    and row count on the right), "จบแล้ว (n)" folded, "เพิ่มอีเวนต์" outline under the list.
  - **Event page**: the debt page's hero (expense large in the expense colour, "รับ / สุทธิ"
    under it, facts, a pencil), "จบทริป" / "เปิดอีกครั้ง" (outline) and "เพิ่มรายการ" (gold
    tint) in one row, "ตามหมวด" bars, then the rows by day as on the Transactions tab.
  - **Transaction form**: an "อีเวนต์" row under the date (label over the value, the value in
    the brand colour when set, × to clear); a tagged row on the Transactions tab carries a small
    gold-tint tag (plane + name) after its category name.
- **Family sharing** (16.1, sharing.md → Web screens, mock-up `sharing.html`): managed from
  **Account › แชร์กระเป๋า** for the current profile, never from the wallet sheet. People are
  list rows with an initial in a muted circle and a role tag (`bg-muted`, `text-xs`); an invite
  to me is a `brand/10` card with ปฏิเสธ (outline) and รับคำเชิญ (filled); wallets shared with
  nobody are `brand/10` cards too. The invite / member sheet: email, a segmented role with one
  hint line under it, then the wallets as a switch list (all on for an invite). Everything is
  online: offline, a `destructive/10` line says so and every action is disabled. Pending
  invitations to me put a small `destructive` dot on the Account tab icon.
- **A profile shared with me** (16.2, mock-up `sharing-16.2.html`): a "แชร์กับฉัน" group under
  my profiles in the switch sheet (badge, name, a role tag, "ของ <owner> · n กระเป๋า" with a
  users icon); offline the group is dimmed and disabled under a `destructive/10` line. In use,
  every screen is the **same as an own profile's** (no special page, one ➕, the same sheet):
  the header's profile switcher wears a small people badge (its label says "ของ <owner>"), and what isn't shared is simply not
  there. Where nothing can show (offline, Reports, the profile's own setup pages) an empty state
  says why with an outline "กลับไปโปรไฟล์ของฉัน". A row an editor added carries a muted
  "เพิ่มโดย <name>" line (users icon, `text-xs`) under its note, on both sides.
- **Bottom sheet** (owner's choice in #6.2): **every sheet is the same near-full height**
  (`92dvh`, the page's header still showing above it), so its main action always sits in the same
  place. Inside, `app-sheet-frame`: a header bar with **close (X) on the left** (or **‹ back** in
  a sheet's later view), the **title centred**, and the sheet's other actions as 44px **icon
  buttons on the right** (e.g. archive, delete in red, manage), each with an `aria-label`
  (a sheet with more than two sets `actions`, e.g. `4` for the category form's move /
  archive / merge / delete, so the title centres in the space left); the
  body scrolls; **one main button is pinned at the bottom** (no "ปิด" button: X closes). A view
  with nothing to confirm (the icon picker) has no bottom button. Load a sheet that isn't needed
  at start with `@defer` (see `layout/sync-sheet`).

## 7. Icons

- **lucide**, through its Angular package `@ng-icons/lucide` (`NgIcon` + `provideIcons`),
  outline style, plus **our own `tpn` SVGs** (from #6.2) where lucide has no clear picture. A
  `tpn` icon is drawn in lucide's style (24 × 24, 2px round stroke, no fill) so the two mix.
  Don't add another icon library, and never use a bank's or brand's logo. Sizes: 20px in the tab bar and rows, 24px in
  headers, larger only inside empty-state circles.
- Decorative icons get `aria-hidden="true"`. An icon that is the whole label of a control needs an
  `aria-label` on the control.
- **Profile icons** (#6.1): 16 curated lucide icons in `shared/components/icon-badge/user-icons.ts`
  (`PROFILE_ICONS`), on one of 10 `USER_COLORS`, shown by `app-icon-badge` (40px in rows, 28px
  in the header switcher). Never rename or remove a shipped icon; an unknown name shows
  `lucideUser`.
- **Category and wallet icons**: the user picks from one curated catalogue (lucide + `tpn`),
  grouped by meaning (money places, cards, cash, food, transport, home, …) and shown as a grid in
  the picker. Icons say what the thing is at a glance (a buffet, a coffee cup, a bank); there are
  several bank and card drawings so similar wallets stay apart, and no letter badges. Stored as
  the export name (`lucideCoffee`, `tpnBankColumns`), so there's no image upload. Each new wallet
  or category starts with a default icon the user can change (#6.2 / #7).
- **Wallet icons** (#6.2): `WALLET_ICON_GROUPS` (ที่เก็บเงิน, บัตร, เงินสดและของมีค่า, ดิจิทัล,
  อื่น ๆ), default `lucideWallet` (also shown for an unknown name). The first `tpn` set
  (`tpn-icons.ts`): banks (columns with ฿, tower, branch with awning, ATM), cards (chip,
  contactless, two stacked), baht coin, baht note, e-wallet QR, gold bar, savings jar, cash
  envelope.
- **Category icons** (#7.1): `CATEGORY_ICON_GROUPS` (อาหารและเครื่องดื่ม, การเดินทาง,
  บ้านและค่าใช้จ่าย, ช้อปปิ้ง, บันเทิงและสุขภาพ, ครอบครัวและชีวิต, รายรับ, อื่น ๆ), default
  `lucideShapes`. `tpn` adds buffet, bubble tea, noodle bowl, tuk-tuk, water tap, temple and
  payslip; in 7.2 the buffet became a chafing dish (owner's pick), and the first drawing
  (`tpnServingDomes`), a buffet line and "all you can eat" joined the food group. Sub-categories
  show a 32px badge indented under their parent's 40px one. A new `tpn` icon is checked at 20px in a 40px badge beside lucide's
  before it ships.

## 8. Interaction and motion

- **Touch targets ≥ 44 × 44px.** Pad small icons out to that size instead of making them bigger.
- **No hover-only behaviour.** Every hover style also needs a visible `focus-visible` style and must
  work by tap.
- **Long-press is a shortcut, never the only way.** Reordering a list is an order mode (a
  "จัดลำดับ" button) where each row has one grip handle (`lucideGripVertical`, CDK drag-drop):
  press and hold it for ~0.3 s on touch (at once with a mouse), then drag; the same handle moves
  its row with ↑ / ↓ for keyboards (the place is read at key press, so quick presses add up).
  Profiles (Account › โปรไฟล์) are the reference; wallets
  follow.
- **Motion**: 150–250 ms, ease-out. Sheets slide up, toasts fade and slide. Nothing bounces or
  loops. Honour `prefers-reduced-motion` by dropping the movement and keeping a fade.
  Content that changes along an ordered row (period tabs) slides in from the side it moved to,
  like a carousel page: a later period from the right, an earlier one from the left
  (`appSlide`, `shared/components/slide`; the Transactions tab first). The views inside a sheet
  do the same by depth, like a navigation stack (owner, 2026-11): opening a picker or a step
  (wallet, category, note, a confirm) slides it in from the right, and ‹ or a pick that goes
  back slides the earlier view in from the left. Pages work the same way (owner, 2026-11): the
  header's ‹ goes back to the page it was opened from (not always its parent), a page opened
  deeper inside the tab slides in from the right, and ‹ brings the earlier one back from the
  left. Switching bottom tabs has
  no order to show, so the page fades in with an 8px rise, 250 ms, CSS `ease-out` (`appFadeIn`
  on the shell's `<main>`, keyed on the tab; pages inside a tab don't fade). A dropdown menu
  (the header's ⋮, owner 2026-11) grows from its button's corner with a fade, 150 ms in and
  100 ms out (`animate.enter` / `animate.leave`, a fade only under reduced motion); its second
  level ("ดูตาม ›") slides in from the right and ‹ brings the first back from the left
  (`appSlide`).
- **Keyboard**: numeric fields use `inputmode="decimal"` or `"numeric"`. Keep the focused field
  visible above the keyboard. The tab bar hides itself while the keyboard is open.

## 9. Dark mode

- Light, dark, or follow the system (default). The choice is on the account page. `ThemeService`
  sets `.dark` on `<html>`.
- **Dark = very dark page, lighter surfaces, white text**, tinted by the theme (navy for the
  default). The page (`--background`, L 0.16) is the darkest layer. Cards and sheets (`--card`,
  L 0.22) sit one step lighter, and chips/pills (`--muted`, L 0.29) one more. In the dark,
  elevation reads as "lighter" because shadows don't show, the same as iOS and Material. A very
  dark page also saves battery on OLED phones. The owner chose this over "grey page, black cards".
- Tokens handle almost everything. Check each new screen in light and dark at 375 × 812 with the
  default theme, and flip through the other themes on the account page before the PR. Pay most
  attention to user colours, shadows (nearly invisible in dark) and borders.

## 10. Accessibility

WCAG 2.2 AA, as in `AGENTS.md`:

- Text contrast is at least 4.5:1 (3:1 for large text and icons). `muted-foreground` on
  `background` passes in both themes. Don't put it on `muted`.
- Every control has a visible label or an `aria-label`. The current tab has `aria-current="page"`.
- Focus is always visible. When a sheet opens, focus moves into it, and it returns to the opener on
  close.
- `<html lang="th">` is set. Don't hard-code English in templates, because screen readers would
  read it with Thai rules.

## 11. Writing (UI text)

- **Two languages: Thai (default) and English**, switched on the account page with no reload. Every
  string exists in both (`core/i18n/th.json`, `en.json`; how in `AGENTS.md` → UI text). Write the
  Thai first, then an English line that says the same thing naturally. It doesn't have to be a
  literal translation.
- **Keep English where Thai would sound odd.** Names and terms with no natural Thai form stay in
  English in both languages, rather than a forced translation: theme names (Midnight Gold, …),
  PWA, PIN, OTP, email. The app name stays ตังค์ไปไหน in both. Languages are shown as **TH / EN**
  everywhere (Account and the switch before sign-in): the codes read the same in either
  language, so someone stuck in the wrong one can still find theirs. The label is just the UI
  language's own word (ภาษา / Language), no brackets.
- **Thai: short, friendly, and neutral in politeness.** No ครับ/ค่ะ (the user may be anyone in the
  family) and no stiff official register. Prefer `บันทึกแล้ว` over `ระบบได้ทำการบันทึกข้อมูลเรียบร้อยแล้ว`.
- **English: plain and short, sentence case** ("Add wallet", not "Add Wallet"), no exclamation
  marks.
- **Buttons are verbs**: บันทึก / Save, ยกเลิก / Cancel, ลบ / Delete, เพิ่มกระเป๋าเงิน / Add wallet,
  โหลดใหม่ / Reload.
- **Errors say what happened and what to do**: `ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง`, not just
  `เกิดข้อผิดพลาด`.
- **Glossary**: use these words everywhere, so the same thing is never called two names.

  | Concept          | Thai                                 | English                   | Note                                          |
  | ---------------- | ------------------------------------ | ------------------------- | --------------------------------------------- |
  | Transaction      | ธุรกรรม                              | Transaction               |                                               |
  | Profile          | โปรไฟล์                              | Profile                   | #6.1; a separate area of money                |
  | Wallet           | กระเป๋าเงิน                          | Wallet                    | Thai tab bar label shortens to กระเป๋า        |
  | Category         | หมวดหมู่                             | Category                  |                                               |
  | Sub-category     | หมวดหมู่ย่อย / หมวดหมู่หลัก (parent) | Sub-category              | #7; "Parent category" in English              |
  | Income / expense | รายรับ / รายจ่าย                     | Income / Expense          |                                               |
  | Balance          | คงเหลือ (summary), ยอดเงิน (wallet)  | Balance                   |                                               |
  | Transfer         | โอนเงิน                              | Transfer                  | #9                                            |
  | Budget           | งบประมาณ                             | Budget                    | backlog (was #11)                             |
  | Start / end bal. | ยอดเริ่มต้น / ยอดสุดท้าย             | Starting / Ending balance | #10, a period's balances (not ต้นงวด)         |
  | Report           | รายงาน                               | Report                    |                                               |
  | Recurring        | รายการซ้ำ / ทำซ้ำ (the form's row)   | Recurring / Repeat        | #12; ถึงกำหนด / Due, ข้าม / Skip              |
  | Settings tab     | ตั้งค่า (the account tab)            | Settings                  | Not โปรไฟล์ (a data set) nor บัญชี (a bank)   |
  | Online / offline | ออนไลน์ / ออฟไลน์                    | Online / Offline          |                                               |
  | Sync             | sync                                 | Sync                      | Stays English in Thai: "รอ sync", "sync แล้ว" |
  | Undo             | เลิกทำ                               | Undo                      |                                               |
  | Theme / mode     | ธีม / โหมดสี                         | Theme / Mode              | Theme names themselves stay English           |

## 12. Before opening a PR with UI changes

1. Screenshot the screen at **375 × 812, in light and dark** (default theme), and look at it.
   Then switch through the other themes once on a phone-sized window.
2. Switch to **English** and check that nothing overflows (English labels are often longer) and
   no raw key (`wallets.emptyHeading`) shows anywhere.
3. Check touch targets, safe areas (header and tab bar), and that the keyboard doesn't cover the
   focused field or the Save button.
4. Check the screen offline if it reads local data. It must still render.
5. Use only tokens, translation keys, lucide icons, spartan controls and glossary words, with no new one-off patterns.
   If you need a new pattern, add it here in the same PR.
