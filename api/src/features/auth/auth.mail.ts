import type { ChallengePurpose, CredentialChange, MailLanguage } from './auth.entity'

interface SignInMail {
  code: string
  link: string
  lang: MailLanguage
  expiresInMinutes: number
}

interface SignInWords {
  subject: (code: string) => string
  intro: string
  /** The plain-text part has the link itself; the HTML part has a button instead. */
  orLink: string
  orButton: string
  button: string
  expiry: (minutes: number) => string
  safety: string
  thanks: string
  team: string
}

// Thai: neutral politeness, no ครับ/ค่ะ (web/DESIGN.md §11); the app is "แอป".
const SIGN_IN_WORDS: Record<MailLanguage, SignInWords> = {
  th: {
    // The code first: a phone's notification shows it without opening the mail.
    subject: (code) => `${code} รหัสยืนยันการเข้าแอป ตังค์ไปไหน`,
    intro: 'รหัส OTP สำหรับเข้าสู่ระบบ ตังค์ไปไหน ของคุณคือ',
    orLink: 'หรือเปิดลิงก์ด้านล่างบนอุปกรณ์ที่คุณกำลังใช้งาน เพื่อเข้าสู่ระบบทันที',
    orButton: 'หรือกดปุ่มด้านล่างบนอุปกรณ์ที่คุณกำลังใช้งาน เพื่อเข้าสู่ระบบทันที',
    button: 'เข้าสู่ระบบ',
    expiry: (minutes) =>
      `หมายเหตุ: รหัสและลิงก์นี้มีอายุการใช้งาน ${minutes} นาที และใช้ได้เพียงครั้งเดียวเท่านั้น`,
    safety:
      'เพื่อความปลอดภัย โปรดอย่าเปิดเผยรหัสนี้แก่ผู้อื่น หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลฉบับนี้',
    thanks: 'ขอบคุณ',
    team: 'ทีมงาน ตังค์ไปไหน',
  },
  en: {
    subject: (code) => `${code} is your Tang Pai Nai sign-in code`,
    intro: 'Your sign-in code for ตังค์ไปไหน (Tang Pai Nai) is',
    orLink: "Or open the link below on the device you're using to sign in right away.",
    orButton: "Or press the button below on the device you're using to sign in right away.",
    button: 'Sign in',
    expiry: (minutes) => `Note: the code and the link expire in ${minutes} minutes and work once.`,
    safety:
      "For your safety, don't share this code with anyone. If you didn't ask for it, ignore this email.",
    thanks: 'Thank you',
    team: 'The ตังค์ไปไหน team',
  },
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

// Mail clients ignore <style> blocks and web fonts: inline styles, tables, system Thai fonts.
const FONT = "'Noto Sans Thai','Leelawadee UI',Tahoma,'Segoe UI',Arial,sans-serif"
const BRAND = '#f2b33a'
const ON_BRAND = '#2b2418'

/** The HTML part: the code large, a button for the link, the same words as the text part. */
const signInHtml = (
  words: SignInWords,
  { code, link, lang, expiresInMinutes }: SignInMail
): string => {
  const p = (text: string, style = '') =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;${style}">${escapeHtml(text)}</p>`
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(words.subject(code))}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;font-family:${FONT};color:#1c1917;">
<tr><td style="padding:32px 24px 8px;">
${p(words.intro)}
<p style="margin:0 0 24px;font-size:36px;line-height:1.2;font-weight:700;letter-spacing:8px;text-align:center;">${escapeHtml(code)}</p>
${p(words.orButton)}
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 28px;">
<tr><td style="border-radius:999px;background:${BRAND};">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 40px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.4;color:${ON_BRAND};text-decoration:none;border-radius:999px;">${escapeHtml(words.button)}</a>
</td></tr>
</table>
${p(words.expiry(expiresInMinutes), 'font-size:14px;color:#57534e;')}
${p(words.safety, 'font-size:14px;color:#57534e;')}
</td></tr>
<tr><td style="padding:8px 24px 32px;">
${p(words.thanks, 'margin:0;')}
${p(words.team, 'margin:0;')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

/**
 * The one sign-in email: code + magic link, in the app's current language (auth rule 4). HTML with
 * a button, and a plain-text part with the link for clients that show no HTML.
 */
export const buildSignInMail = (mail: SignInMail) => {
  const words = SIGN_IN_WORDS[mail.lang]
  return {
    subject: words.subject(mail.code),
    text: [
      words.intro,
      '',
      `    ${mail.code}`,
      '',
      words.orLink,
      mail.link,
      '',
      words.expiry(mail.expiresInMinutes),
      words.safety,
      '',
      words.thanks,
      words.team,
    ].join('\n'),
    html: signInHtml(words, mail),
  }
}

interface ReauthMail {
  code: string
  lang: MailLanguage
  expiresInMinutes: number
}

/** Step-up code for a signed-in user (rule 13). No link: it must be typed where it was asked. */
export const buildReauthMail = ({ code, lang, expiresInMinutes }: ReauthMail) =>
  lang === 'en'
    ? {
        subject: `${code} is your Tang Pai Nai confirmation code`,
        text: [
          `Use this code to confirm it's you before changing your sign-in settings in`,
          `ตังค์ไปไหน (Tang Pai Nai):`,
          '',
          `    ${code}`,
          '',
          `The code expires in ${expiresInMinutes} minutes and works once.`,
          `Don't share this code with anyone. If you didn't ask for it, ignore this email:`,
          `nothing changes without the code.`,
        ].join('\n'),
      }
    : {
        subject: `${code} คือรหัสยืนยันตัวตน ตังค์ไปไหน`,
        text: [
          'มีการขอยืนยันตัวตนในแอป ตังค์ไปไหน เพื่อแก้ไขการตั้งค่าการเข้าสู่ระบบ รหัสของคุณคือ',
          '',
          `    ${code}`,
          '',
          `รหัสหมดอายุใน ${expiresInMinutes} นาที และใช้ได้ครั้งเดียว`,
          'ห้ามบอกรหัสนี้กับผู้อื่น ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร ไม่มีอะไรเปลี่ยนถ้าไม่มีรหัสนี้',
        ].join('\n'),
      }

interface CredentialChangeMail {
  change: CredentialChange
  lang: MailLanguage
  at: Date
  /** The user's timezone (IANA), for the time in the mail. */
  timeZone: string
  /** A phone change names the number by its last 4 digits (rule 31). */
  phoneLastDigits?: string
}

const CHANGE_TEXT: Record<CredentialChange, Record<MailLanguage, string>> = {
  password_set: { th: 'มีการตั้งรหัสผ่าน', en: 'A password was set' },
  password_changed: { th: 'มีการเปลี่ยนรหัสผ่าน', en: 'Your password was changed' },
  password_removed: { th: 'มีการลบรหัสผ่าน', en: 'Your password was removed' },
  google_linked: { th: 'มีการเชื่อม Google', en: 'A Google account was linked' },
  google_unlinked: { th: 'มีการยกเลิกการเชื่อม Google', en: 'Google was unlinked' },
  phone_added: { th: 'มีการเพิ่มเบอร์มือถือ', en: 'A phone number was added' },
  phone_changed: { th: 'มีการเปลี่ยนเบอร์มือถือ', en: 'Your phone number was changed' },
  phone_removed: { th: 'มีการลบเบอร์มือถือ', en: 'Your phone number was removed' },
}

/**
 * Rule 31: tells the user a way to sign in changed. No link and no code, so the mail never asks
 * anyone to click. The time is in the user's timezone; Thai uses the Buddhist year (th-TH).
 */
export const buildCredentialChangeMail = ({
  change,
  lang,
  at,
  timeZone,
  phoneLastDigits,
}: CredentialChangeMail) => {
  // eslint-disable-next-line security/detect-object-injection -- `change` is a union of constants
  const what = CHANGE_TEXT[change][lang]
  const number = phoneLastDigits
    ? lang === 'en'
      ? ` (ending in ${phoneLastDigits})`
      : ` (ลงท้าย ${phoneLastDigits})`
    : ''
  const when = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(at)
  return lang === 'en'
    ? {
        subject: `${what} on your Tang Pai Nai account`,
        text: [
          `${what}${number} on your ตังค์ไปไหน (Tang Pai Nai) account on ${when}.`,
          '',
          `If this was you, there's nothing to do.`,
          `If it wasn't, open the app, sign in with an email code, put back what was changed`,
          `and choose "Sign out other devices" on the Security page.`,
        ].join('\n'),
      }
    : {
        subject: `${what} ในบัญชีผู้ใช้ ตังค์ไปไหน`,
        text: [
          `${what}${number} ในบัญชีผู้ใช้ ตังค์ไปไหน ของคุณ เมื่อ ${when}`,
          '',
          'ถ้าคุณทำเอง ไม่ต้องทำอะไร',
          'ถ้าไม่ใช่คุณ ให้เปิดแอป เข้าสู่ระบบด้วยรหัสทางอีเมล แก้สิ่งที่ถูกเปลี่ยนกลับ',
          'แล้วกด "ออกจากระบบอุปกรณ์อื่น" ในหน้าความปลอดภัย',
        ].join('\n'),
      }
}

/**
 * Rule 26: the SMS is Thai only and fits one segment (UCS-2: ≤ 70 UTF-16 units). It names the app
 * and the expiry and never holds a link.
 */
export const buildPhoneSms = (
  purpose: Extract<ChallengePurpose, 'sign_in' | 'verify_phone'>,
  code: string,
  expiresInMinutes: number
): string =>
  purpose === 'sign_in'
    ? `รหัสเข้าสู่ระบบ ตังค์ไปไหน: ${code} ใช้ได้ ${expiresInMinutes} นาที ห้ามบอกผู้อื่น`
    : `รหัสยืนยันเบอร์ ตังค์ไปไหน: ${code} ใช้ได้ ${expiresInMinutes} นาที ห้ามบอกผู้อื่น`
