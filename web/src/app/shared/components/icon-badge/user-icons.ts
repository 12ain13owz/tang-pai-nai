import {
  lucideBaby,
  lucideBriefcase,
  lucideBuilding2,
  lucideCar,
  lucideGift,
  lucideGraduationCap,
  lucideHeart,
  lucideHouse,
  lucidePawPrint,
  lucidePiggyBank,
  lucidePlane,
  lucideStar,
  lucideStore,
  lucideUser,
  lucideUsers,
  lucideWallet,
} from '@ng-icons/lucide'

/**
 * The curated lucide icons a user can pick for a profile (DESIGN.md §7). Stored by export name,
 * so an icon is never renamed or removed here once it has shipped; add new ones at the end.
 */
export const PROFILE_ICONS = {
  lucideUser,
  lucideUsers,
  lucideHouse,
  lucideHeart,
  lucideBaby,
  lucideBriefcase,
  lucideStore,
  lucideBuilding2,
  lucideGraduationCap,
  lucidePlane,
  lucideCar,
  lucidePiggyBank,
  lucideWallet,
  lucideGift,
  lucidePawPrint,
  lucideStar,
} as const

export type ProfileIcon = keyof typeof PROFILE_ICONS

export const PROFILE_ICON_NAMES = Object.keys(PROFILE_ICONS) as ProfileIcon[]

/** Shown for an icon name this build doesn't know (a newer device picked it, profile rule 3). */
export const FALLBACK_ICON: ProfileIcon = 'lucideUser'

export const knownIcon = (name: string): ProfileIcon =>
  name in PROFILE_ICONS ? (name as ProfileIcon) : FALLBACK_ICON
