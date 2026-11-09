import type { ShareRole } from './sharing.entity'

interface InviteMail {
  inviterName: string
  walletNames: string[]
  role: ShareRole
  /** The invitee's address, filled in on the sign-in page. */
  email: string
  webOrigin: string
  expiresAt: number
  lang: 'th' | 'en'
}

const ROLE_TEXT: Record<ShareRole, Record<'th' | 'en', string>> = {
  editor: { th: 'ผู้แก้ไข', en: 'an editor' },
  viewer: { th: 'ผู้ดู', en: 'a viewer' },
}

/**
 * Rule 4: the inviter's name and the wallet names only, no free text. The link opens sign-in
 * with the email filled in and grants nothing (the invite matches the verified email).
 */
export const buildInviteMail = (mail: InviteMail) => {
  const link = `${mail.webOrigin}/auth/sign-in?email=${encodeURIComponent(mail.email)}`
  const en = mail.lang === 'en'
  const until = new Intl.DateTimeFormat(en ? 'en-GB' : 'th-TH', {
    dateStyle: 'long',
    timeZone: 'Asia/Bangkok',
  }).format(mail.expiresAt)
  const wallets = mail.walletNames.join(', ')

  const role = ROLE_TEXT[mail.role][mail.lang]
  return en
    ? {
        subject: `${mail.inviterName} shared wallets with you in Tang Pai Nai`,
        text: [
          `${mail.inviterName} invited you as ${role} of ${mail.walletNames.length === 1 ? 'the wallet' : 'the wallets'}: ${wallets}`,
          '',
          `Sign in to ตังค์ไปไหน (Tang Pai Nai) with this email (${mail.email}), then accept`,
          'under Account › Share wallets. An account is created if you have none.',
          link,
          '',
          `The invitation expires on ${until}. If you don't know the sender, ignore this email.`,
        ].join('\n'),
      }
    : {
        subject: `${mail.inviterName} แชร์กระเป๋าให้คุณใน ตังค์ไปไหน`,
        text: [
          `${mail.inviterName} เชิญคุณเป็น${role}ของกระเป๋า ${wallets}`,
          '',
          `เข้าสู่ระบบ ตังค์ไปไหน ด้วยอีเมลนี้ (${mail.email}) แล้วกด "รับ" ที่ บัญชี › แชร์กระเป๋า`,
          'ถ้ายังไม่มีบัญชี ระบบจะสร้างให้',
          link,
          '',
          `คำเชิญหมดอายุ ${until} ถ้าไม่รู้จักผู้เชิญ ไม่ต้องทำอะไร`,
        ].join('\n'),
      }
}
