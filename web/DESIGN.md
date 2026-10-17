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
  full-screen flows with their own simple header (back button or none).
- **Spacing**: page padding `p-4`. Sections are `gap-6` apart; items inside a section are `gap-3`.
  Use Tailwind's scale only, never arbitrary pixel values, except for safe-area `env()` values.
- **Section heading**: `text-sm font-medium text-muted-foreground`, above a group of rows or fields.
- **Cards and grouped rows** (summaries, settings, details): a surface on the page, so it uses the
  card token: `rounded-xl border border-border bg-card text-card-foreground`, with `divide-y` rows,
  each `px-4 py-3`, label left, value or control right.

## 3. Colour

All colour comes from the theme tokens in `src/styles.css` (spartan `neutral` theme). Never use raw
palette classes. That's what keeps dark mode working.

| Use                         | Token                                               |
| --------------------------- | --------------------------------------------------- |
| Page background / text      | `bg-background` / `text-foreground`                 |
| Cards, sheets (surfaces)    | `bg-card` / `text-card-foreground`                  |
| Secondary text, inactive    | `text-muted-foreground`                             |
| Subtle fills (chips, pills) | `bg-muted`                                          |
| Primary action (one/screen) | `bg-primary text-primary-foreground` (via `hlmBtn`) |
| Error, offline, destructive | `text-destructive`, `bg-destructive/10`             |
| Lines                       | `border-border`                                     |
| Income / expense amounts    | `text-income` / `text-expense` (added in #6)        |

**Money tokens.** Added with the first screen that shows amounts (Wallet, #6):
`--income` (green) and `--expense` (red), each with a light and a dark value that pass 4.5:1
contrast on `--background`, exposed as `text-income` / `text-expense`. Don't reuse `destructive`
for expenses: an expense isn't an error.

**User colours** (wallet and category `color`) arrive as data and are the only raw colours allowed.
Use them for the icon circle's background, with a white or black glyph picked for contrast. Never
use them for text on the page background.

**No brand accent.** The UI stays neutral (black primary in light, white in dark). The green of the
app icon's ฿ is the only brand colour, and the UI doesn't use it.

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

- **Amounts** are integer minor units in data. Format them only with `Intl.NumberFormat('th-TH', …)`
  and the currency's digits (see `AGENTS.md` → Money & dates). Always use `tabular-nums`, and
  right-align amounts in lists.
- **Direction is shown by sign and colour together**, never by colour alone (colour-blind users,
  dark mode): expense `-฿120.00` in expense colour, income `+฿25,000.00` in income colour.
  Transfers (#9) are neutral, with no sign colour.
- **Totals in different currencies** are shown one line per currency, never added together.
- **Dates**: relative words for recent days (วันนี้, เมื่อวาน), then a short Thai date such as
  `จ. 14 ต.ค.`. Day headers in the transaction list show the date on the left and the day total on
  the right.
- **Era: พ.ศ.** Wherever a year is shown, use the Buddhist era (พ.ศ. 2569), which is the default of
  `Intl.DateTimeFormat('th-TH')`. Never switch to ค.ศ. Stored dates stay ISO / `YYYY-MM-DD`
  (Gregorian); the era is display only.

## 6. Components and patterns

Controls are spartan/ui (`hlm*`). Build these patterns from them instead of inventing new ones.

- **Buttons**: at most **one** `default` (filled) button per screen, the main action. `outline` is
  for secondary actions, `ghost` for header and toolbar icons, `destructive` for delete. Icon-only
  buttons always have an `aria-label`.
- **Forms**: always the shared `*-field` wrappers (`AGENTS.md` → Forms). Fields stack vertically,
  full width, `gap-4`. In a sheet, the Save button stays fixed at the bottom, above the keyboard.
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
- **Status**: the header's right side holds the connection pill today and the sync status from #4a.
  Status changes are announced politely (`role="status"`).

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
- **Long-press is a shortcut, never the only way** (e.g. wallet reorder also gets an "edit order"
  mode).
- **Motion**: 150–250 ms, ease-out. Sheets slide up, toasts fade and slide. Nothing bounces or
  loops. Honour `prefers-reduced-motion` by dropping the movement and keeping a fade.
- **Keyboard**: numeric fields use `inputmode="decimal"` or `"numeric"`. Keep the focused field
  visible above the keyboard. The tab bar hides itself while the keyboard is open.

## 9. Dark mode

- Light, dark, or follow the system (default). The choice is on the account page. `ThemeService`
  sets `.dark` on `<html>`.
- **Dark = near-black page, lighter grey surfaces, white text.** The page (`--background`,
  `#0a0a0a`) is the darkest layer. Cards and sheets (`--card`, about `#1c1c1c`) sit one step
  lighter, and chips/pills (`--muted`) one more. In the dark, elevation reads as "lighter", because
  shadows don't show, the same as iOS and Material. A near-black page also saves battery on OLED
  phones. The owner chose this over "grey page, black cards".
- Tokens handle almost everything. Check each new screen in **both** themes at 375 × 812 before the
  PR, paying most attention to user colours, shadows (nearly invisible in dark) and borders.

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

- **Thai, short, friendly, and neutral in politeness.** No ครับ/ค่ะ (the user may be anyone in the
  family) and no stiff official register. Prefer `บันทึกแล้ว` over `ระบบได้ทำการบันทึกข้อมูลเรียบร้อยแล้ว`.
- **Buttons are verbs**: บันทึก, ยกเลิก, ลบ, เพิ่มกระเป๋าเงิน, ส่งรหัส, โหลดใหม่.
- **Errors say what happened and what to do**: `ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง`, not just
  `เกิดข้อผิดพลาด`.
- **Glossary**: use these words everywhere, so the same thing is never called two names.

  | Concept          | Thai                                | Note                                        |
  | ---------------- | ----------------------------------- | ------------------------------------------- |
  | Transaction      | ธุรกรรม                             |                                             |
  | Wallet           | กระเป๋าเงิน                         | Tab bar label shortens to กระเป๋า           |
  | Category         | หมวดหมู่                            |                                             |
  | Income / expense | รายรับ / รายจ่าย                    |                                             |
  | Balance          | คงเหลือ (summary), ยอดเงิน (wallet) |                                             |
  | Transfer         | โอนเงิน                             | #9                                          |
  | Budget           | งบประมาณ                            | #11                                         |
  | Report           | รายงาน                              |                                             |
  | Account (user)   | บัญชีผู้ใช้                         | Not บัญชี alone (could mean a bank account) |
  | Online / offline | ออนไลน์ / ออฟไลน์                   |                                             |
  | Undo             | เลิกทำ                              |                                             |

## 12. Before opening a PR with UI changes

1. Screenshot the screen at **375 × 812, in light and dark**, and look at it.
2. Check touch targets, safe areas (header and tab bar), and that the keyboard doesn't cover the
   focused field or the Save button.
3. Check the screen offline if it reads local data. It must still render.
4. Use only tokens, lucide icons, spartan controls and glossary words, with no new one-off patterns.
   If you need a new pattern, add it here in the same PR.
