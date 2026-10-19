import type { MailLanguage } from './auth.entity'

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
