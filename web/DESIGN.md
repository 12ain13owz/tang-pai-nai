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

- **Outside the shell** (no tab bar): sign-in, enter code, trust prompt, PIN lock. These are
  full-screen flows with their own simple header: the app name on the left and the
  **ไทย | English** switch on the right (the account page isn't reachable before sign-in), and a
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

**User colours** (wallet and category `color`) arrive as data and are the only raw colours allowed.
Use them for the icon circle's background, with a white or black glyph picked for contrast. Never
use them for text on the page background.

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
  Transfers (#9) are neutral, with no sign colour.
- **Totals in different currencies** are shown one line per currency, never added together.
- **Dates**: relative words for recent days (วันนี้ / Today, เมื่อวาน / Yesterday), then a short
  date such as `จ. 14 ต.ค.` / `Mon 14 Oct`. Day headers in the transaction list show the date on the left and the day total on
  the right.
- **Era: พ.ศ. in Thai.** In the Thai UI every year is Buddhist era (พ.ศ. 2569), the default of
  `Intl.DateTimeFormat('th-TH')`; never ค.ศ. The English UI shows the Gregorian year (2026).
  Stored dates stay ISO / `YYYY-MM-DD` (Gregorian); the era is display only.

## 6. Components and patterns

Controls are spartan/ui (`hlm*`). Build these patterns from them instead of inventing new ones.

- **Buttons**: at most **one** `default` (filled) button per screen, the main action. `outline` is
  for secondary actions, `ghost` for header and toolbar icons, `destructive` for delete. Icon-only
  buttons always have an `aria-label`.
- **Forms**: always the shared `*-field` wrappers (`AGENTS.md` → Forms). Fields stack vertically,
  full width, `gap-4`. Inside a field the label sits 12px above the input, and the hint and the
  error 4px under it, so a message reads as part of its field. In a sheet, the Save button stays fixed at the bottom, above the keyboard.
- **Create / edit / pick = bottom sheet** (spartan `drawer`), never a centred dialog. Use a
  full-height sheet for the transaction form and a content-height sheet for pickers and small forms.
  Dismiss by swiping down or tapping the backdrop. If the sheet holds unsaved input, ask first.
- **Delete**: act at once, then offer **undo** in a toast (spartan `sonner`). Confirm first only
  when undo is impossible (wiping local data, removing a shared member, deleting a wallet together
  with its transactions).
- **Toasts** sit above the tab bar, last about 4s, say one short thing, and have at most one action
  (เลิกทำ).
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
  sit in one `role="alert"` line between the heading and the dots. Used by the trust step, the
  lock screen and Account › PIN.
- **Tab bar**: the active tab is shown by colour alone: icon and label in `text-brand`, the label
  `font-semibold` and the icon stroke 2.4 (so it doesn't rely on colour only), no pill, fill or
  border (owner's choice in #6.1, so the gold ➕ stays the bar's one strong shape). Inactive tabs
  are `text-muted-foreground`. Focus shows a ring around the icon.
- **Strip under the header**: the update banner and the expired-session banner
  (`layout/session-banner`) share one look: `bg-muted px-4 py-2 text-sm`, the text left and one
  44px button right.
- **Status**: the header's right side holds the **sync pill** (`layout/sync-status`, #4a.2). A
  small dot plus words, never the dot alone: synced = green dot (`bg-income`) and muted
  "sync แล้ว"; syncing = a spinning refresh icon and "กำลัง sync"; waiting = muted dot and
  "รอ sync 3"; offline = red dot in a red-tinted pill, "ออฟไลน์" or "ออฟไลน์ · รอ 2"; errors =
  the same red pill, "บันทึกไม่สำเร็จ 1". Status changes are announced politely
  (`role="status"`). The pill is a 44px button that opens the sync sheet (last sync, "sync
  ตอนนี้", rejected items with fix / discard, conflict notices).
- **Bottom sheet**: spartan `hlm-drawer` with `hlm-drawer-content` (`mx-auto max-w-[480px]`), a
  `hlmDrawerTitle` heading, content that scrolls inside `max-h-[70vh]`, and the main action plus a
  "ปิด" outline button at the bottom. Load a sheet that isn't needed at start with `@defer`
  (see `layout/sync-sheet`).

## 7. Icons

- **lucide only**, through its Angular package `@ng-icons/lucide` (`NgIcon` + `provideIcons`),
  outline style. Don't add another icon library. Sizes: 20px in the tab bar and rows, 24px in
  headers, larger only inside empty-state circles.
- Decorative icons get `aria-hidden="true"`. An icon that is the whole label of a control needs an
  `aria-label` on the control.
- **Category and wallet icons**: the user picks from a curated lucide set (food, transport, home,
  shopping, …) shown as a grid in the picker. They're stored as the lucide name (e.g.
  `lucideCoffee`), so there's no image upload. The curated list lives in code next to the picker
  (#6 / #7).

## 8. Interaction and motion

- **Touch targets ≥ 44 × 44px.** Pad small icons out to that size instead of making them bigger.
- **No hover-only behaviour.** Every hover style also needs a visible `focus-visible` style and must
  work by tap.
- **Long-press is a shortcut, never the only way.** Reordering a list is an order mode (a
  "จัดลำดับ" button) where each row has one grip handle (`lucideGripVertical`, CDK drag-drop):
  press and hold it for ~0.3 s on touch (at once with a mouse), then drag; the same handle moves
  its row with ↑ / ↓ for keyboards. Profiles (Account › โปรไฟล์) are the reference; wallets
  follow.
- **Motion**: 150–250 ms, ease-out. Sheets slide up, toasts fade and slide. Nothing bounces or
  loops. Honour `prefers-reduced-motion` by dropping the movement and keeping a fade.
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
  PWA, PIN, OTP, email. The app name stays ตังค์ไปไหน in both. Language names are shown in their
  own language (ไทย, English), and the language label carries both ("ภาษา (Language)"), so
  someone stuck in the wrong language can still find the switch.
- **Thai: short, friendly, and neutral in politeness.** No ครับ/ค่ะ (the user may be anyone in the
  family) and no stiff official register. Prefer `บันทึกแล้ว` over `ระบบได้ทำการบันทึกข้อมูลเรียบร้อยแล้ว`.
- **English: plain and short, sentence case** ("Add wallet", not "Add Wallet"), no exclamation
  marks.
- **Buttons are verbs**: บันทึก / Save, ยกเลิก / Cancel, ลบ / Delete, เพิ่มกระเป๋าเงิน / Add wallet,
  โหลดใหม่ / Reload.
- **Errors say what happened and what to do**: `ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง`, not just
  `เกิดข้อผิดพลาด`.
- **Glossary**: use these words everywhere, so the same thing is never called two names.

  | Concept          | Thai                                | English          | Note                                          |
  | ---------------- | ----------------------------------- | ---------------- | --------------------------------------------- |
  | Transaction      | ธุรกรรม                             | Transaction      |                                               |
  | Wallet           | กระเป๋าเงิน                         | Wallet           | Thai tab bar label shortens to กระเป๋า        |
  | Category         | หมวดหมู่                            | Category         |                                               |
  | Income / expense | รายรับ / รายจ่าย                    | Income / Expense |                                               |
  | Balance          | คงเหลือ (summary), ยอดเงิน (wallet) | Balance          |                                               |
  | Transfer         | โอนเงิน                             | Transfer         | #9                                            |
  | Budget           | งบประมาณ                            | Budget           | #11                                           |
  | Report           | รายงาน                              | Report           |                                               |
  | Account (user)   | บัญชีผู้ใช้                         | Account          | Not บัญชี alone (could mean a bank account)   |
  | Online / offline | ออนไลน์ / ออฟไลน์                   | Online / Offline |                                               |
  | Sync             | sync                                | Sync             | Stays English in Thai: "รอ sync", "sync แล้ว" |
  | Undo             | เลิกทำ                              | Undo             |                                               |
  | Theme / mode     | ธีม / โหมดสี                        | Theme / Mode     | Theme names themselves stay English           |

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
