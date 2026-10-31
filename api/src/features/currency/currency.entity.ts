// docs/features/currency.md → Data model. Names and symbols aren't stored: the web app renders
// them from `code` with Intl.
export interface Currency {
  code: string
  minorUnit: number
  isActive: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  changeSeq: number
}
