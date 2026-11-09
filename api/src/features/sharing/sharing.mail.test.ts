import { describe, expect, it } from 'vitest'
import { buildInviteMail } from './sharing.mail'

describe('buildInviteMail', () => {
  const mail = {
    inviterName: 'Alice',
    walletNames: ['Home', 'Cash'],
    role: 'viewer' as const,
    email: 'bob+1@example.com',
    webOrigin: 'http://localhost:4200',
    expiresAt: Date.UTC(2026, 10, 23),
  }

  it('names the inviter, the role and the wallets, with a sign-in link that holds only the email', () => {
    const { subject, text } = buildInviteMail({ ...mail, lang: 'th' })
    expect(subject).toBe('Alice แชร์กระเป๋าให้คุณใน ตังค์ไปไหน')
    expect(text).toContain('Alice เชิญคุณเป็นผู้ดูของกระเป๋า Home, Cash')
    expect(text).toContain('http://localhost:4200/auth/sign-in?email=bob%2B1%40example.com')
    expect(text).toContain('2569')
  })

  it('speaks English when asked', () => {
    const { subject, text } = buildInviteMail({ ...mail, walletNames: ['Home'], lang: 'en' })
    expect(subject).toBe('Alice shared wallets with you in Tang Pai Nai')
    expect(text).toContain('Alice invited you as a viewer of the wallet: Home')
    expect(text).toContain('23 November 2026')
  })
})
