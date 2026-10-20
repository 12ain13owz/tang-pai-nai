import type { CredentialChange, MailLanguage } from './auth.entity'

interface SignInMail {
  code: string
  link: string
  lang: MailLanguage
  expiresInMinutes: number
}

/** The one sign-in email: code + magic link, in the app's current language (auth rule 4). */
export const buildSignInMail = ({ code, link, lang, expiresInMinutes }: SignInMail) =>
  lang === 'en'
    ? {
        subject: `${code} is your Tang Pai Nai sign-in code`,
        text: [
          `Your sign-in code for ตังค์ไปไหน (Tang Pai Nai) is:`,
          '',
          `    ${code}`,
          '',
          `Or open this link on the device you're signing in on:`,
          link,
          '',
          `The code and the link expire in ${expiresInMinutes} minutes and work once.`,
          `Don't share this code with anyone. If you didn't ask for it, ignore this email.`,
        ].join('\n'),
      }
    : {
        subject: `${code} คือรหัสเข้าสู่ระบบ ตังค์ไปไหน`,
        text: [
          'รหัสเข้าสู่ระบบ ตังค์ไปไหน ของคุณคือ',
          '',
          `    ${code}`,
          '',
          'หรือเปิดลิงก์นี้บนเครื่องที่กำลังเข้าสู่ระบบ',
          link,
          '',
          `รหัสและลิงก์หมดอายุใน ${expiresInMinutes} นาที และใช้ได้ครั้งเดียว`,
          'ห้ามบอกรหัสนี้กับผู้อื่น ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร',
        ].join('\n'),
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
}

const CHANGE_TEXT: Record<CredentialChange, Record<MailLanguage, string>> = {
  password_set: { th: 'มีการตั้งรหัสผ่าน', en: 'A password was set' },
  password_changed: { th: 'มีการเปลี่ยนรหัสผ่าน', en: 'Your password was changed' },
  password_removed: { th: 'มีการลบรหัสผ่าน', en: 'Your password was removed' },
  google_linked: { th: 'มีการเชื่อม Google', en: 'A Google account was linked' },
  google_unlinked: { th: 'มีการยกเลิกการเชื่อม Google', en: 'Google was unlinked' },
}

/**
 * Rule 31: tells the user a way to sign in changed. No link and no code, so the mail never asks
 * anyone to click. The time is in the user's timezone; Thai uses the Buddhist year (th-TH).
 */
export const buildCredentialChangeMail = ({ change, lang, at, timeZone }: CredentialChangeMail) => {
  // eslint-disable-next-line security/detect-object-injection -- `change` is a union of constants
  const what = CHANGE_TEXT[change][lang]
  const when = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(at)
  return lang === 'en'
    ? {
        subject: `${what} on your Tang Pai Nai account`,
        text: [
          `${what} on your ตังค์ไปไหน (Tang Pai Nai) account on ${when}.`,
          '',
          `If this was you, there's nothing to do.`,
          `If it wasn't, open the app, sign in with an email code, put back what was changed`,
          `and choose "Sign out other devices" on the Security page.`,
        ].join('\n'),
      }
    : {
        subject: `${what} ในบัญชีผู้ใช้ ตังค์ไปไหน`,
        text: [
          `${what} ในบัญชีผู้ใช้ ตังค์ไปไหน ของคุณ เมื่อ ${when}`,
          '',
          'ถ้าคุณทำเอง ไม่ต้องทำอะไร',
          'ถ้าไม่ใช่คุณ ให้เปิดแอป เข้าสู่ระบบด้วยรหัสทางอีเมล แก้สิ่งที่ถูกเปลี่ยนกลับ',
          'แล้วกด "ออกจากระบบอุปกรณ์อื่น" ในหน้าความปลอดภัย',
        ].join('\n'),
      }
}
