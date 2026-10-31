import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { SyncService } from '@/core/offline'
import type { OutboxOp, SyncStatus as Status } from '@/core/offline'
import { SyncStatus } from './sync-status'

describe('SyncStatus', () => {
  let fixture: ComponentFixture<SyncStatus>
  const sync = {
    status: signal<Status>('synced'),
    pendingCount: signal(0),
    rejected: signal<OutboxOp[]>([]),
  }

  const pill = () => (fixture.nativeElement as HTMLElement).querySelector('[role=status]')
  const show = (status: Status, pending = 0, rejected = 0) => {
    sync.status.set(status)
    sync.pendingCount.set(pending)
    sync.rejected.set(Array.from({ length: rejected }, () => ({}) as OutboxOp))
    fixture.detectChanges()
    return pill()?.textContent.trim()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: SyncService, useValue: sync }],
    })
    fixture = TestBed.createComponent(SyncStatus)
  })

  it('says each state in words, never by colour alone', () => {
    expect(show('synced')).toBe(th.sync.synced)
    expect(show('syncing')).toBe(th.sync.syncing)
    expect(show('pending', 3)).toBe('รอ sync 3')
    expect(show('offline')).toBe(th.sync.offline)
    expect(show('offline', 2)).toBe('ออฟไลน์ · รอ 2')
    expect(show('errors', 0, 1)).toBe('บันทึกไม่สำเร็จ 1')
  })

  it('tints offline and errors red, and uses the income dot only when synced', () => {
    show('synced')
    expect(pill()?.querySelector('.bg-income')).not.toBeNull()
    show('errors', 0, 1)
    expect(pill()?.className).toContain('text-destructive')
    show('pending', 1)
    expect(pill()?.className).not.toContain('text-destructive')
  })

  it('labels the button with the status, for screen readers', () => {
    show('pending', 2)
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('สถานะ sync: รอ sync 2 แตะเพื่อดูรายละเอียด')
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog')
  })
})
