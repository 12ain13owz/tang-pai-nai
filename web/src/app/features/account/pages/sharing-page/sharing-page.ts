import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronRight,
  lucideEllipsisVertical,
  lucideMail,
  lucidePlus,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { SharingService } from '@/core/sharing'
import type { InviteToMe, ShareGroup } from '@/core/sharing'
import { WalletService } from '@/core/wallet'
import { ShareSheet } from '@/features/account/pages/sharing-page/share-sheet'
import type { ShareSheetState } from '@/features/account/pages/sharing-page/share-sheet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'

/**
 * Account › แชร์กระเป๋า (docs/features/sharing.md → Web screens, mock-up frames 2 and 6): invites
 * to me, the current profile's members and pending invites, wallets shared with nobody, and what
 * others share with me. Online only; offline it shows what was read this session.
 */
@Component({
  selector: 'app-sharing-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, IconBadge, ShareSheet],
  providers: [provideIcons({ lucideChevronRight, lucideEllipsisVertical, lucideMail, lucidePlus })],
  template: `
    <div class="flex flex-col gap-6 p-4">
      @if (!sharingService.canCall()) {
        <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'sharing.needsOnline' | transloco }}
        </p>
      } @else if (loadError(); as key) {
        <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {{ key | transloco }}
        </p>
      }

      @if (invites().length > 0) {
        <section class="flex flex-col gap-3" aria-labelledby="sharing-invites">
          <h2 id="sharing-invites" class="text-sm font-medium text-muted-foreground">
            {{ 'sharing.invitesToMe' | transloco: { count: invites().length } }}
          </h2>
          @for (invite of invites(); track invite.id) {
            <article
              class="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3"
            >
              <div class="flex gap-3">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
                  aria-hidden="true"
                  >{{ initial(invite.owner.displayName) }}</span
                >
                <div class="flex min-w-0 flex-col text-sm">
                  <p class="text-base">
                    {{
                      'sharing.inviteText'
                        | transloco
                          : {
                              name: invite.owner.displayName,
                              role: ('sharing.' + invite.role | transloco),
                            }
                    }}
                    <b>{{ names(invite) }}</b>
                  </p>
                  <p class="break-all text-muted-foreground">
                    {{ invite.owner.email }} ·
                    {{ 'sharing.expires' | transloco: { date: date(invite.expiresAt) } }}
                  </p>
                </div>
              </div>
              <div class="flex justify-end gap-2">
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="h-10"
                  [disabled]="busy() || !sharingService.canCall()"
                  (click)="answer(invite, false)"
                >
                  {{ 'sharing.decline' | transloco }}
                </button>
                <button
                  hlmBtn
                  type="button"
                  class="h-10"
                  [disabled]="busy() || !sharingService.canCall()"
                  (click)="answer(invite, true)"
                >
                  {{ 'sharing.accept' | transloco }}
                </button>
              </div>
            </article>
          }
        </section>
      }

      @if (profile(); as current) {
        <p class="-mb-3 text-sm text-muted-foreground">
          {{ 'sharing.profileNote' | transloco: { name: current.name } }}
        </p>
        <section class="flex flex-col gap-3" aria-labelledby="sharing-members">
          <h2 id="sharing-members" class="text-sm font-medium text-muted-foreground">
            {{ 'sharing.members' | transloco: { count: members().length } }}
          </h2>
          @if (members().length === 0) {
            <p
              class="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
            >
              {{ 'sharing.membersEmpty' | transloco }}
            </p>
          } @else {
            <ul class="divide-y divide-border rounded-xl border border-border bg-card">
              @for (member of members(); track member.userId) {
                <li>
                  <button
                    type="button"
                    class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    (click)="sheet.set({ view: 'member', member })"
                  >
                    <span
                      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
                      aria-hidden="true"
                      >{{ initial(member.displayName) }}</span
                    >
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-base">{{ member.displayName }}</span>
                      <span class="truncate text-sm text-muted-foreground"
                        >{{ member.email }} · {{ walletCount(member.walletIds.length) }}</span
                      >
                    </span>
                    <span class="rounded-md bg-muted px-1.5 text-xs font-semibold">{{
                      'sharing.' + member.role | transloco
                    }}</span>
                    <ng-icon
                      name="lucideChevronRight"
                      size="18"
                      class="text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        @if (pending().length > 0) {
          <section class="flex flex-col gap-3" aria-labelledby="sharing-pending">
            <h2 id="sharing-pending" class="text-sm font-medium text-muted-foreground">
              {{ 'sharing.pending' | transloco: { count: pending().length } }}
            </h2>
            <ul class="divide-y divide-border rounded-xl border border-border bg-card">
              @for (invite of pending(); track invite.id) {
                <li>
                  <button
                    type="button"
                    class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    (click)="sheet.set({ view: 'pending', invite })"
                  >
                    <span
                      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      aria-hidden="true"
                      ><ng-icon name="lucideMail" size="18"
                    /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-base">{{ invite.email }}</span>
                      <span class="truncate text-sm text-muted-foreground"
                        >{{ 'sharing.' + invite.role | transloco }} ·
                        {{ walletCount(invite.walletIds.length) }} ·
                        {{ 'sharing.expires' | transloco: { date: date(invite.expiresAt) } }}</span
                      >
                    </span>
                    <ng-icon
                      name="lucideChevronRight"
                      size="18"
                      class="text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              }
            </ul>
          </section>
        }

        @if (members().length > 0) {
          @for (wallet of unshared(); track wallet.id) {
            <div
              class="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3"
            >
              <app-icon-badge [icon]="wallet.icon" [color]="wallet.color" [fallback]="walletIcon" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-base">{{
                  'sharing.unshared' | transloco: { name: wallet.name }
                }}</span>
                <span class="text-sm text-muted-foreground">{{
                  'sharing.unsharedHint' | transloco
                }}</span>
              </span>
            </div>
          }
        }

        <button
          hlmBtn
          type="button"
          class="h-11 w-full text-base"
          [disabled]="!sharingService.canCall()"
          (click)="sheet.set({ view: 'invite' })"
        >
          <ng-icon name="lucidePlus" size="20" aria-hidden="true" />
          {{ 'sharing.invite' | transloco }}
        </button>
      }

      @if (groups().length > 0) {
        <section class="flex flex-col gap-3" aria-labelledby="sharing-with-me">
          <h2 id="sharing-with-me" class="text-sm font-medium text-muted-foreground">
            {{ 'sharing.withMe' | transloco }}
          </h2>
          <ul class="divide-y divide-border rounded-xl border border-border bg-card">
            @for (group of groups(); track group.profileId) {
              <li class="flex min-h-15 items-center gap-3 py-2 pr-1 pl-4">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
                  aria-hidden="true"
                  >{{ initial(group.owner.displayName) }}</span
                >
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-base"
                    >{{ group.owner.displayName }}
                    <span class="ml-1 rounded-md bg-muted px-1.5 text-xs font-semibold">{{
                      'sharing.' + group.role | transloco
                    }}</span></span
                  >
                  <span class="truncate text-sm text-muted-foreground">{{
                    walletList(group)
                  }}</span>
                </span>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  type="button"
                  class="size-11"
                  [attr.aria-label]="'sharing.leave' | transloco: { name: group.owner.displayName }"
                  [disabled]="!sharingService.canCall()"
                  (click)="sheet.set({ view: 'leave', group })"
                >
                  <ng-icon name="lucideEllipsisVertical" size="20" aria-hidden="true" />
                </button>
              </li>
            }
          </ul>
          <p class="text-sm text-muted-foreground">{{ 'sharing.withMeHint' | transloco }}</p>
        </section>
      }
    </div>
    @defer (when sheet()) {
      <app-share-sheet [state]="sheet()" (closed)="sheet.set(null)" />
    }
  `,
})
export class SharingPage {
  protected sharingService = inject(SharingService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  protected walletIcon = WALLET_DEFAULT_ICON
  protected sheet = signal<ShareSheetState | null>(null)
  protected busy = signal(false)
  protected loadError = signal<string | null>(null)

  protected profile = this.profileService.current
  private owner = computed(() => {
    const id = this.profile()?.id
    return id ? this.sharingService.owner(id) : null
  })
  protected members = computed(() => this.owner()?.members ?? [])
  protected pending = computed(() => this.owner()?.invites ?? [])
  protected unshared = computed(() =>
    (this.owner()?.unsharedWalletIds ?? [])
      .map((id) => this.walletService.byId(id))
      .filter((wallet) => wallet !== null)
  )
  protected invites = computed(() => this.sharingService.withMe()?.invites ?? [])
  protected groups = computed(() => this.sharingService.withMe()?.shares ?? [])

  constructor() {
    // Read again whenever the profile changes or the network comes back.
    effect(() => {
      const id = this.profile()?.id
      const online = this.sharingService.canCall()
      if (id && online) {
        untracked(() => void this.load(id))
      }
    })
  }

  protected initial(name: string): string {
    return [...name.trim()].at(0)?.toUpperCase() ?? '?'
  }

  protected date(at: number): string {
    return new Intl.DateTimeFormat(this.languageService.locale(), { dateStyle: 'medium' }).format(
      at
    )
  }

  protected walletCount(count: number): string {
    return this.transloco.translate(`sharing.walletCount${count === 1 ? 'One' : ''}`, { count })
  }

  protected names(invite: InviteToMe): string {
    return invite.wallets.map((wallet) => wallet.name).join(', ')
  }

  protected walletList(group: ShareGroup): string {
    return group.wallets.map((wallet) => wallet.name).join(', ')
  }

  protected async answer(invite: InviteToMe, accept: boolean): Promise<void> {
    this.busy.set(true)
    try {
      if (accept) {
        await this.sharingService.accept(invite.id)
      } else {
        await this.sharingService.decline(invite.id)
      }
      toast.success(this.transloco.translate(accept ? 'sharing.accepted' : 'sharing.declined'))
    } catch (error) {
      toast.error(this.transloco.translate(this.sharingService.failure(error)))
    } finally {
      this.busy.set(false)
    }
  }

  private async load(profileId: string): Promise<void> {
    try {
      await Promise.all([
        this.sharingService.loadOwner(profileId),
        this.sharingService.loadWithMe(),
      ])
      this.loadError.set(null)
    } catch (error) {
      this.loadError.set(this.sharingService.failure(error))
    }
  }
}
