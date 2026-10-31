import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideFlaskConical, lucidePencil, lucideTrash2 } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import type { SyncProbeFormGroup } from '@/features/account/account-form.type'
import { EmptyState } from '@/shared/components/empty-state'
import { FORM_IMPORTS, InputField, withMessage } from '@/shared/components/form'

interface Probe {
  id: string
  title: string
  amount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

const TABLE = 'sync_probes'
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/

/** `65.5` → 6550 satang, by string, so there's no float maths on money. */
const toSatang = (text: string): number => {
  const [baht, satang = ''] = text.split('.')
  return Number(baht) * 100 + Number(satang.padEnd(2, '0'))
}

const toBahtText = (amount: number): string =>
  amount % 100 === 0
    ? String(amount / 100)
    : `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`

/**
 * Dev only, temporary (offline-sync → Web screens): adds, edits and deletes `sync_probes` through
 * the local database and the outbox, to try sync for real until Wallet (#6) syncs.
 */
@Component({
  selector: 'app-sync-test-page',
  imports: [FORM_IMPORTS, TranslocoPipe, InputField, HlmButton, NgIcon, EmptyState],
  providers: [provideIcons({ lucidePencil, lucideTrash2, lucideFlaskConical })],
  template: `
    @let f = form.controls;
    <div class="flex flex-col gap-6 p-4">
      <p class="rounded-xl bg-muted px-4 py-3 text-sm">{{ 'syncTest.devOnly' | transloco }}</p>

      <section class="flex flex-col gap-3" aria-labelledby="probe-form-heading">
        <h2 id="probe-form-heading" class="text-sm font-medium text-muted-foreground">
          @if (fixingOpId()) {
            {{ 'syncTest.fixing' | transloco }}
          } @else if (editingId()) {
            {{ 'syncTest.edit' | transloco }}
          } @else {
            {{ 'syncTest.add' | transloco }}
          }
        </h2>
        @if (!canWrite()) {
          <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {{ 'syncTest.offlineUntrusted' | transloco }}
          </p>
        }
        <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="save()">
          <app-input-field [control]="f.title" [label]="'syncTest.title' | transloco" />
          <app-input-field
            [control]="f.amount"
            [label]="'syncTest.amount' | transloco"
            inputmode="decimal"
          />
          <div class="flex gap-3">
            @if (editingId()) {
              <button hlmBtn variant="outline" type="button" class="h-11 flex-1" (click)="reset()">
                {{ 'syncTest.cancel' | transloco }}
              </button>
            }
            <button hlmBtn type="submit" class="h-11 flex-1 text-base" [disabled]="!canWrite()">
              {{ 'syncTest.save' | transloco }}
            </button>
          </div>
        </form>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="probe-list-heading">
        <h2 id="probe-list-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'syncTest.listHeading' | transloco }}
        </h2>
        @if (probes().length === 0) {
          <app-empty-state
            [heading]="'syncTest.empty' | transloco"
            [description]="'syncTest.emptyHint' | transloco"
          >
            <ng-icon name="lucideFlaskConical" />
          </app-empty-state>
        } @else {
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            @for (probe of probes(); track probe.id) {
              <li class="flex min-h-14 items-center gap-2 py-2 pr-2 pl-4">
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-base">{{ probe.title }}</span>
                  @if (pendingIds().has(probe.id)) {
                    <span class="text-sm text-muted-foreground">
                      {{ 'syncTest.pending' | transloco }}
                    </span>
                  }
                </span>
                <span class="text-base tabular-nums">{{ money(probe.amount) }}</span>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  type="button"
                  class="size-11"
                  [disabled]="!canWrite()"
                  [attr.aria-label]="'syncTest.editItem' | transloco: { title: probe.title }"
                  (click)="edit(probe)"
                >
                  <ng-icon name="lucidePencil" size="20" aria-hidden="true" />
                </button>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  type="button"
                  class="size-11"
                  [disabled]="!canWrite()"
                  [attr.aria-label]="'syncTest.deleteItem' | transloco: { title: probe.title }"
                  (click)="remove(probe)"
                >
                  <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="currency-heading">
        <h2 id="currency-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'syncTest.currenciesHeading' | transloco }}
        </h2>
        @if (currencies().length === 0) {
          <p class="text-sm text-muted-foreground">{{ 'syncTest.noCurrencies' | transloco }}</p>
        } @else {
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card text-sm text-card-foreground"
          >
            @for (currency of currencies(); track currency.code) {
              <li class="flex items-center justify-between gap-4 px-4 py-3">
                <span>{{ currency.name }}</span>
                <span class="text-muted-foreground tabular-nums">
                  {{ currency.code }} · {{ currency.minorUnit }}
                </span>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class SyncTestPage {
  private nnfb = inject(NonNullableFormBuilder)
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  private networkStatusService = inject(NetworkStatusService)
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)

  protected editingId = signal<string | null>(null)
  protected fixingOpId = signal<string | null>(null)

  form: SyncProbeFormGroup = this.nnfb.group({
    title: [
      '',
      [withMessage(Validators.required, 'syncTest.titleRequired'), Validators.maxLength(50)],
    ],
    amount: [
      '',
      [
        withMessage(Validators.required, 'syncTest.amountInvalid'),
        withMessage(Validators.pattern(AMOUNT), 'syncTest.amountInvalid'),
      ],
    ],
  })

  /** Rule 1: an untrusted device queues nothing offline. */
  protected canWrite = computed(
    () =>
      this.offlineService.isOpen() &&
      (this.offlineService.isTrusted() || this.networkStatusService.isOnline())
  )
  protected probes = computed(() =>
    this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${TABLE} WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`
          )
          .map((row) => fromSql(TABLE, row) as unknown as Probe),
      []
    )
  )
  protected pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(`SELECT row_id FROM outbox WHERE tbl = ? AND status = 'pending'`, [
                TABLE,
              ])
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )
  protected currencies = computed(() => {
    const names = new Intl.DisplayNames([this.languageService.locale()], { type: 'currency' })
    return this.read(
      (db) =>
        db
          .selectObjects(
            'SELECT code, minor_unit FROM currencies WHERE is_active = 1 ORDER BY sort_order, code'
          )
          .map((row) => ({
            code: String(row['code']),
            minorUnit: Number(row['minor_unit']),
            name: names.of(String(row['code'])) ?? String(row['code']),
          })),
      []
    )
  })

  constructor() {
    // "Fix" in the sync sheet opens this page, or changes its query when it's already open.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      if (fix) {
        this.startFix(fix)
      }
    })
  }

  protected money(amount: number): string {
    return new Intl.NumberFormat(this.languageService.locale(), {
      style: 'currency',
      currency: 'THB',
      currencyDisplay: 'narrowSymbol',
    }).format(amount / 100)
  }

  protected edit(probe: Probe): void {
    this.fixingOpId.set(null)
    this.editingId.set(probe.id)
    this.form.setValue({ title: probe.title, amount: toBahtText(probe.amount) })
  }

  protected reset(): void {
    this.editingId.set(null)
    this.fixingOpId.set(null)
    this.form.reset()
    if (this.route.snapshot.queryParamMap.has('fix')) {
      void this.router.navigate([], { queryParams: {}, replaceUrl: true })
    }
  }

  protected save(): void {
    if (this.form.invalid || !this.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const now = Date.now()
    const id = this.editingId() ?? uuidv7(now)
    const fixing = this.fixingOpId()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      queueWrite(db, TABLE, 'upsert', {
        ...current,
        id,
        title: value.title.trim(),
        amount: toSatang(value.amount),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixing) {
        deleteOp(db, fixing)
      }
    })
    toast.success(this.transloco.translate('syncTest.saved'))
    // After this submit event: `MarkTouchedOnSubmit` marks every field touched once ngSubmit ran.
    queueMicrotask(() => this.reset())
  }

  protected remove(probe: Probe): void {
    const now = Date.now()
    this.offlineService.write((db) =>
      queueWrite(db, TABLE, 'delete', { ...probe, updatedAt: now, deletedAt: now })
    )
    if (this.editingId() === probe.id) {
      this.reset()
    }
    toast(this.transloco.translate('syncTest.deleted'), {
      action: {
        label: this.transloco.translate('syncTest.undo'),
        onClick: () => this.restore(probe.id),
      },
    })
  }

  private restore(id: string): void {
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, TABLE, 'upsert', { ...current, updatedAt: Date.now(), deletedAt: null })
      }
    })
  }

  /** "Fix" from the sync sheet: the refused values, on top of the server's current row. */
  private startFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== TABLE) {
      return
    }
    const title = typeof op.row['title'] === 'string' ? op.row['title'] : ''
    const amount = typeof op.row['amount'] === 'number' ? toBahtText(op.row['amount']) : ''
    this.editingId.set(op.rowId)
    this.fixingOpId.set(op.opId)
    this.form.setValue({ title, amount })
    this.form.markAllAsTouched()
  }

  private find(db: LocalDatabase, id: string): Probe | null {
    const row = db.selectObjects(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]).at(0)
    return row ? (fromSql(TABLE, row) as unknown as Probe) : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}
