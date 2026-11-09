/** Starts a cell a spreadsheet would run as a formula (OWASP "CSV injection"). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Text for a CSV cell that a spreadsheet must show as text: one starting like a formula gets a
 * leading `'` (docs/features/export.md rule 6). Numbers the file means as numbers skip this.
 */
export const csvText = (text: string): string => (FORMULA_START.test(text) ? `'${text}` : text)

/** One RFC 4180 field: quoted when it holds `,`, `"` or a line break, `"` doubled. */
export const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/**
 * A whole CSV file: a UTF-8 BOM (so Excel reads Thai), comma separated, CRLF line ends
 * (export.md rule 5).
 */
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  '\uFEFF' + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'

/**
 * The file name (rule 5): `tangpainai-<profile>-<day>.csv` with the profile's name kept to
 * ASCII letters, digits, `-` and `_` (browsers drop a download name with other characters, so
 * a Thai name is left out: `tangpainai-<day>.csv`).
 */
export const exportFileName = (profileName: string, day: string): string => {
  const part = profileName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return part ? `tangpainai-${part}-${day}.csv` : `tangpainai-${day}.csv`
}
