import { FormControl } from '@angular/forms'
import { passwordPolicyValidator } from './password-policy'

const errorsFor = (value: string, email = 'mom.2024@example.com') =>
  passwordPolicyValidator(() => email)(new FormControl(value))

describe('passwordPolicyValidator', () => {
  it('accepts 8+ characters with lower, upper, digit and another character', () => {
    expect(errorsFor('Gr33n Mango Tree')).toBeNull()
    expect(errorsFor('Ab1 ทองคำ')).toBeNull()
  })

  it('leaves an empty value to Validators.required', () => {
    expect(errorsFor('')).toBeNull()
  })

  it.each([
    ['Ab1!xyz', { passwordTooShort: 'auth.passwordTooShort' }],
    [`Aa1!${'x'.repeat(125)}`, { passwordTooLong: 'auth.passwordTooLong' }],
    ['abcdefgh12!', { passwordWeak: 'auth.passwordWeak' }],
    ['ABCDEFGH12!', { passwordWeak: 'auth.passwordWeak' }],
    ['Abcdefgh!!', { passwordWeak: 'auth.passwordWeak' }],
    ['Abcdefgh12', { passwordWeak: 'auth.passwordWeak' }],
  ])('refuses %j', (value, errors) => {
    expect(errorsFor(value)).toEqual(errors)
  })

  it('counts code points like the API, not UTF-16 units', () => {
    // 7 code points, 8 UTF-16 units.
    expect(errorsFor('Ab1 😀xy')).toEqual({ passwordTooShort: 'auth.passwordTooShort' })
  })

  it('refuses the email or its local part, whatever the case', () => {
    expect(errorsFor('Mom.2024')).toEqual({ passwordSameAsEmail: 'auth.passwordSameAsEmail' })
    expect(errorsFor('Mom.2024@Example.com')).toEqual({
      passwordSameAsEmail: 'auth.passwordSameAsEmail',
    })
  })
})
