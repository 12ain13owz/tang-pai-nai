/**
 * Our own icons (`tpn`, DESIGN.md §7), drawn where lucide has no clear picture: in lucide's
 * style (24 × 24, 2px round stroke, no fill) so the two mix in one grid. Each says what the thing
 * is at a glance, never a bank's or brand's logo. Registered with `provideIcons` like lucide's,
 * and stored by name, so a shipped icon is never renamed or removed; add new ones at the end.
 */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

/** A baht sign (฿) centred on (12, `cy`), `h` tall. */
const baht = (cy: number, h: number): string => {
  const top = cy - h / 2
  const mid = cy
  const bottom = cy + h / 2
  const left = 12 - h / 3.2
  const bowl = h / 4
  return [
    `<path d="M${left} ${top}h${(12 - left + bowl * 0.4).toFixed(2)}a${bowl} ${bowl} 0 0 1 0 ${h / 2}H${left}"/>`,
    `<path d="M${left} ${mid}h${(12 - left + bowl * 0.7).toFixed(2)}a${bowl} ${bowl} 0 0 1 0 ${h / 2}H${left}"/>`,
    `<path d="M${left} ${top}v${h}"/>`,
    `<path d="M12 ${top - 1.5}v1.5"/>`,
    `<path d="M12 ${bottom}v1.5"/>`,
  ].join('')
}

export const TPN_ICONS = {
  /** A classic bank: roof, two columns and a baht sign between them. */
  tpnBankColumns: svg(
    `<path d="M3 8 12 3l9 5"/><path d="M3 8h18"/><path d="M3 21h18"/><path d="M5.5 11v7"/><path d="M18.5 11v7"/>${baht(14.5, 6)}`
  ),
  /** A modern bank tower with a slanted top. */
  tpnBankTower: svg(
    `<path d="M3 21h18"/><path d="M6 21V8l7-5v18"/><path d="M13 9h5v12"/><path d="M9 9v.01"/><path d="M9 13v.01"/><path d="M9 17v.01"/><path d="M16 13v.01"/><path d="M16 17v.01"/>`
  ),
  /** A bank branch: a striped awning over a door and a window. */
  tpnBankBranch: svg(
    `<path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11.5V21h14v-9.5"/><path d="M14 21v-5h3v5"/><rect x="7" y="14" width="4" height="3" rx="0.5"/>`
  ),
  /** A cash machine handing out a note. */
  tpnAtm: svg(
    `<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M7 7h10"/><path d="M7 11h4"/><path d="M15 11h2"/><path d="M7 15v3"/><path d="M17 15v3"/><path d="M9 15v6h6v-6"/>`
  ),
  /** A bank card with a chip. */
  tpnCardChip: svg(
    `<rect x="2" y="5" width="20" height="14" rx="2"/><rect x="5" y="9" width="5" height="4" rx="1"/><path d="M14 15h4"/>`
  ),
  /** A bank card with contactless waves. */
  tpnCardContactless: svg(
    `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15h3"/><path d="M13 10.5a2.5 2.5 0 0 1 0 3"/><path d="M15.5 9a5 5 0 0 1 0 6"/>`
  ),
  /** Two cards, one behind the other. */
  tpnCardsStacked: svg(
    `<path d="M6 5h14a2 2 0 0 1 2 2v8"/><rect x="2" y="9" width="16" height="11" rx="2"/><path d="M2 13h16"/>`
  ),
  /** A coin with a baht sign. */
  tpnBahtCoin: svg(`<circle cx="12" cy="12" r="10"/>${baht(12, 8)}`),
  /** A banknote with a baht sign. */
  tpnBahtNote: svg(
    `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5.5 12h.01"/><path d="M18.5 12h.01"/>${baht(12, 6)}`
  ),
  /** A phone showing a QR code (an e-wallet). */
  tpnEwalletQr: svg(
    `<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="8" y="6" width="3" height="3" rx="0.5"/><rect x="13" y="6" width="3" height="3" rx="0.5"/><rect x="8" y="11" width="3" height="3" rx="0.5"/><path d="M13 11h.01"/><path d="M16 11v.01"/><path d="M14.5 12.5v.01"/><path d="M13 14h3"/><path d="M11 18h2"/>`
  ),
  /** A gold bar. */
  tpnGoldBar: svg(
    `<path d="M2 19h20l-3.5-8h-13z"/><path d="M5.5 11 7 7h10l1.5 4"/><path d="M10 15h4"/>`
  ),
  /** A savings jar with a coin inside. */
  tpnSavingsJar: svg(
    `<path d="M8 2h8"/><path d="M9 2v3"/><path d="M15 2v3"/><path d="M8 5h8a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z"/><circle cx="12" cy="15" r="3"/>`
  ),
  /** An envelope with a note sticking out (cash put aside). */
  tpnCashEnvelope: svg(
    `<path d="M6 9V4h12v5"/><path d="M10 6.5h4"/><rect x="2" y="9" width="20" height="12" rx="2"/><path d="m2 11 10 6 10-6"/>`
  ),
  /** A buffet counter with two serving domes (#7). */
  tpnBuffet: svg(
    `<path d="M2 14h20"/><path d="M3 14a4 4 0 0 1 8 0"/><path d="M13 14a4 4 0 0 1 8 0"/><path d="M7 8.5V10"/><path d="M17 8.5V10"/><path d="M4 14v7"/><path d="M20 14v7"/><path d="M4 18h16"/>`
  ),
  /** A bubble tea: a domed cup with a straw and pearls. */
  tpnBubbleTea: svg(
    `<path d="M5 9h14"/><path d="M6 9a6 4.5 0 0 1 12 0"/><path d="m6.5 9 1.5 12h8l1.5-12"/><path d="m12 4.5 2-3"/><path d="M10 17h.01"/><path d="M14 17h.01"/><path d="M12 19h.01"/>`
  ),
  /** A noodle bowl with chopsticks. */
  tpnNoodleBowl: svg(
    `<path d="M3 12h18a9 8 0 0 1-18 0Z"/><path d="M9 21h6"/><path d="m11 12 8-9"/><path d="m14 12 7-7"/><path d="M6 9.5c1-1 2 1 3 0"/>`
  ),
  /** A tuk-tuk: a three-wheeler with a canopy. */
  tpnTuktuk: svg(
    `<path d="M3 15V7a1 1 0 0 1 1-1h11l4 6v3"/><path d="M3 11h16"/><path d="M9 6v5"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 17h8"/>`
  ),
  /** A water tap with a drop (the water bill). */
  tpnFaucet: svg(
    `<path d="M10 3h6"/><path d="M13 3v4"/><path d="M4 7h11a4 4 0 0 1 4 4v2"/><path d="M4 11h9a2 2 0 0 1 2 2"/><path d="M4 6v6"/><path d="M17 16s-1.5 1.7-1.5 2.8a1.5 1.5 0 0 0 3 0c0-1.1-1.5-2.8-1.5-2.8z"/>`
  ),
  /** A Thai temple: a spire over two roof tiers (merit and donations). */
  tpnTemple: svg(
    `<path d="M12 2v3"/><path d="m6 10 6-5 6 5"/><path d="m3 15 9-7 9 7"/><path d="M5 13.5V21h14v-7.5"/><path d="M10 21v-4h4v4"/><path d="M3 21h18"/>`
  ),
  /** A payslip with a baht sign (salary). */
  tpnPayslip: svg(
    `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><path d="M8 7h3"/>${baht(14.5, 6)}`
  ),
} as const

export type TpnIcon = keyof typeof TPN_ICONS
