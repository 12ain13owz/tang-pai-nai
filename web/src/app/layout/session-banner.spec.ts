import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { SessionBanner } from './session-banner'

@Component({ template: '' })
class Blank {}

describe('SessionBanner', () => {
  let fixture: ComponentFixture<SessionBanner>
  let store: AuthStore

  const text = () => (fixture.nativeElement as HTMLElement).textContent

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([{ path: '**', component: Blank }])],
    })
    store = TestBed.inject(AuthStore)
    fixture = TestBed.createComponent(SessionBanner)
  })

  it('shows nothing while signed in or merely unreachable', () => {
    store.status.set('signedIn')
    fixture.detectChanges()
    expect(text()).toBe('')
    store.status.set('unreachable')
    fixture.detectChanges()
    expect(text()).toBe('')
  })

  it('offers sign-in, back to this page, once the session expired (offline-sync rule 7)', async () => {
    await TestBed.inject(Router).navigateByUrl('/reports')
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate')
    store.clear('expired')
    fixture.detectChanges()
    expect(text()).toContain(th.session.expired)

    ;(fixture.nativeElement as HTMLElement).querySelector('button')?.click()
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { returnUrl: '/reports' },
    })
  })
})
