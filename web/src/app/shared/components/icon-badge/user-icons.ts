import {
  lucideApple,
  lucideAward,
  lucideBaby,
  lucideBanknote,
  lucideBeer,
  lucideBike,
  lucideBookOpen,
  lucideBriefcase,
  lucideBuilding2,
  lucideBus,
  lucideCakeSlice,
  lucideCar,
  lucideCarTaxiFront,
  lucideChartLine,
  lucideChefHat,
  lucideClapperboard,
  lucideCoffee,
  lucideCoins,
  lucideCreditCard,
  lucideCupSoda,
  lucideDumbbell,
  lucideEllipsis,
  lucideFuel,
  lucideGamepad2,
  lucideGem,
  lucideGift,
  lucideGraduationCap,
  lucideHandCoins,
  lucideHandHeart,
  lucideHeart,
  lucideHeartPulse,
  lucideHotel,
  lucideHouse,
  lucideIceCreamCone,
  lucideKeyRound,
  lucideLandmark,
  lucideLaptop,
  lucideLuggage,
  lucideMotorbike,
  lucideMusic,
  lucidePawPrint,
  lucidePercent,
  lucidePhone,
  lucidePiggyBank,
  lucidePill,
  lucidePizza,
  lucidePlane,
  lucidePopcorn,
  lucideReceipt,
  lucideSandwich,
  lucideScissors,
  lucideShapes,
  lucideShieldCheck,
  lucideShip,
  lucideShirt,
  lucideShoppingBag,
  lucideShoppingCart,
  lucideSmartphone,
  lucideSofa,
  lucideSoup,
  lucideSparkles,
  lucideStar,
  lucideStethoscope,
  lucideStore,
  lucideTicket,
  lucideTrainFront,
  lucideTv,
  lucideUser,
  lucideUsers,
  lucideUtensils,
  lucideUtensilsCrossed,
  lucideVault,
  lucideWallet,
  lucideWifi,
  lucideWine,
  lucideWrench,
  lucideZap,
} from '@ng-icons/lucide'
import { TPN_ICONS } from './tpn-icons'

/**
 * The curated lucide icons a user can pick for a profile (DESIGN.md §7). Stored by export name,
 * so an icon is never renamed or removed here once it has shipped; add new ones at the end.
 */
export const PROFILE_ICONS = {
  lucideUser,
  lucideUsers,
  lucideHandCoins,
  lucideHouse,
  lucideLandmark,
  lucideHeart,
  lucideBaby,
  lucideBriefcase,
  lucideStore,
  lucideBuilding2,
  lucideGraduationCap,
  lucidePlane,
  lucideCar,
  lucideCoins,
  lucideCreditCard,
  lucideGem,
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

/**
 * Every icon a user can pick anywhere (profiles, wallets, later categories): the curated lucide
 * icons plus our own `tpn` set (DESIGN.md §7). Never rename or remove a shipped one.
 */
export const USER_ICONS = {
  ...PROFILE_ICONS,
  lucideLandmark,
  lucideVault,
  lucideCreditCard,
  lucideBanknote,
  lucideCoins,
  lucideHandCoins,
  lucideSmartphone,
  lucideGem,
  lucideShoppingBag,
  lucideApple,
  lucideAward,
  lucideBeer,
  lucideBike,
  lucideBookOpen,
  lucideBus,
  lucideCakeSlice,
  lucideCarTaxiFront,
  lucideChartLine,
  lucideChefHat,
  lucideClapperboard,
  lucideCoffee,
  lucideCupSoda,
  lucideDumbbell,
  lucideEllipsis,
  lucideFuel,
  lucideGamepad2,
  lucideHandHeart,
  lucideHeartPulse,
  lucideHotel,
  lucideIceCreamCone,
  lucideKeyRound,
  lucideLaptop,
  lucideLuggage,
  lucideMotorbike,
  lucideMusic,
  lucidePercent,
  lucidePhone,
  lucidePill,
  lucidePizza,
  lucidePopcorn,
  lucideReceipt,
  lucideSandwich,
  lucideScissors,
  lucideShapes,
  lucideShieldCheck,
  lucideShip,
  lucideShirt,
  lucideShoppingCart,
  lucideSofa,
  lucideSoup,
  lucideSparkles,
  lucideStethoscope,
  lucideTicket,
  lucideTrainFront,
  lucideTv,
  lucideUtensils,
  lucideUtensilsCrossed,
  lucideWifi,
  lucideWine,
  lucideWrench,
  lucideZap,
  ...TPN_ICONS,
} as const

export type UserIcon = keyof typeof USER_ICONS

/** A titled group of icons in a picker (`iconGroups.<key>`). */
export interface IconGroup {
  key: string
  icons: readonly UserIcon[]
}

/**
 * The wallet icon catalogue, grouped by meaning (wallet rule 8): lucide where it fits, `tpn`
 * where it doesn't, with several bank and card drawings so similar wallets stay apart.
 */
export const WALLET_ICON_GROUPS: readonly IconGroup[] = [
  {
    key: 'moneyPlaces',
    icons: [
      'lucideWallet',
      'lucidePiggyBank',
      'tpnSavingsJar',
      'lucideVault',
      'lucideLandmark',
      'tpnBankColumns',
      'tpnBankTower',
      'tpnBankBranch',
      'tpnAtm',
    ],
  },
  {
    key: 'cards',
    icons: ['lucideCreditCard', 'tpnCardChip', 'tpnCardContactless', 'tpnCardsStacked'],
  },
  {
    key: 'cash',
    icons: [
      'lucideBanknote',
      'tpnBahtNote',
      'lucideCoins',
      'tpnBahtCoin',
      'tpnCashEnvelope',
      'lucideHandCoins',
      'tpnGoldBar',
      'lucideGem',
    ],
  },
  { key: 'digital', icons: ['lucideSmartphone', 'tpnEwalletQr'] },
  {
    key: 'other',
    icons: [
      'lucideHouse',
      'lucideBriefcase',
      'lucideStore',
      'lucideShoppingBag',
      'lucidePlane',
      'lucideCar',
      'lucideGraduationCap',
      'lucideGift',
    ],
  },
]

/**
 * The category icon catalogue (category rule 9), grouped by meaning: lucide where it fits, `tpn`
 * where it doesn't (bubble tea, noodles, tuk-tuk, …).
 */
export const CATEGORY_ICON_GROUPS: readonly IconGroup[] = [
  {
    key: 'food',
    icons: [
      'lucideUtensils',
      'lucideUtensilsCrossed',
      'lucideChefHat',
      'tpnBuffet',
      'tpnNoodleBowl',
      'lucideSoup',
      'lucidePizza',
      'lucideSandwich',
      'lucideCoffee',
      'tpnBubbleTea',
      'lucideCupSoda',
      'lucideCakeSlice',
      'lucideIceCreamCone',
      'lucideBeer',
      'lucideWine',
      'lucideApple',
    ],
  },
  {
    key: 'transport',
    icons: [
      'lucideCar',
      'lucideCarTaxiFront',
      'lucideMotorbike',
      'tpnTuktuk',
      'lucideBus',
      'lucideTrainFront',
      'lucideBike',
      'lucideFuel',
      'lucidePlane',
      'lucideShip',
    ],
  },
  {
    key: 'homeBills',
    icons: [
      'lucideHouse',
      'lucideKeyRound',
      'tpnFaucet',
      'lucideZap',
      'lucideWifi',
      'lucidePhone',
      'lucideTv',
      'lucideSofa',
      'lucideWrench',
      'lucideReceipt',
    ],
  },
  {
    key: 'shopping',
    icons: [
      'lucideShoppingBag',
      'lucideShoppingCart',
      'lucideShirt',
      'lucideGem',
      'lucideSmartphone',
      'lucideLaptop',
      'lucideScissors',
    ],
  },
  {
    key: 'funHealth',
    icons: [
      'lucideClapperboard',
      'lucideGamepad2',
      'lucideMusic',
      'lucideTicket',
      'lucidePopcorn',
      'lucideDumbbell',
      'lucideHeartPulse',
      'lucidePill',
      'lucideStethoscope',
    ],
  },
  {
    key: 'familyLife',
    icons: [
      'lucideUsers',
      'lucideBaby',
      'lucidePawPrint',
      'lucideGraduationCap',
      'lucideBookOpen',
      'lucideGift',
      'lucideHandHeart',
      'tpnTemple',
      'lucideShieldCheck',
      'lucideLuggage',
      'lucideHotel',
    ],
  },
  {
    key: 'income',
    icons: [
      'tpnPayslip',
      'lucideAward',
      'lucideChartLine',
      'lucideStore',
      'lucideHandCoins',
      'lucideBanknote',
      'lucideCoins',
      'lucidePiggyBank',
      'lucidePercent',
      'lucideBriefcase',
    ],
  },
  { key: 'other', icons: ['lucideShapes', 'lucideEllipsis', 'lucideSparkles', 'lucideStar'] },
]

/** A new wallet's icon (wallet rule 8), also shown for a wallet icon this build doesn't know. */
export const WALLET_DEFAULT_ICON: UserIcon = 'lucideWallet'

/** `name` if this build can draw it, else `fallback` (a newer device may have picked it). */
export const knownIcon = (name: string, fallback: UserIcon = FALLBACK_ICON): UserIcon =>
  name in USER_ICONS ? (name as UserIcon) : fallback
