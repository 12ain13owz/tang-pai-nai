/** `PASSWORD_BREACH_CHECK`: check new passwords against HIBP, or skip it (auth spec rule 11). */
export enum PasswordBreachCheck {
  HIBP = 'hibp',
  OFF = 'off',
}
