import { Component, inject } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { DeviceStorageService } from '@/core/pwa'
import { PALETTES, ThemeService } from '@/core/theme'
import type { PaletteId, ThemePreference } from '@/core/theme'
import { SelectField } from '@/shared/components/form'
import type { SelectOption } from '@/shared/types'
import { PalettePicker } from './palette-picker'

@Component({
  selector: 'app-account-page',
  imports: [SelectField, PalettePicker],
  template: `
    <div class="flex flex-col gap-6 p-4">
      <section class="flex flex-col gap-3" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" class="text-sm font-medium text-muted-foreground">การแสดงผล</h2>
        <app-select-field [control]="themeControl" label="โหมดสี" [options]="themeOptions" />
        <app-palette-picker [control]="paletteControl" [palettes]="palettes" />
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="device-heading">
        <h2 id="device-heading" class="text-sm font-medium text-muted-foreground">อุปกรณ์นี้</h2>
        <dl
          class="divide-y divide-border rounded-xl border border-border bg-card text-sm text-card-foreground"
        >
          <div class="flex items-center justify-between gap-4 px-4 py-3">
            <dt>ติดตั้งเป็นแอป</dt>
            <dd class="text-muted-foreground">
              {{ deviceStorageService.isInstalled() ? 'ติดตั้งแล้ว' : 'เปิดในเบราว์เซอร์' }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 px-4 py-3">
            <dt>พื้นที่จัดเก็บถาวร</dt>
            <dd class="text-muted-foreground">
              @switch (deviceStorageService.isPersisted()) {
                @case (true) {
                  เปิดอยู่
                }
                @case (false) {
                  ยังไม่เปิด
                }
                @default {
                  ไม่รองรับ
                }
              }
            </dd>
          </div>
        </dl>
      </section>
    </div>
  `,
})
export class AccountPage {
  private nnfb = inject(NonNullableFormBuilder)
  private themeService = inject(ThemeService)
  protected deviceStorageService = inject(DeviceStorageService)

  protected readonly themeOptions: readonly SelectOption<ThemePreference>[] = [
    { value: 'system', label: 'ตามระบบ' },
    { value: 'light', label: 'สว่าง' },
    { value: 'dark', label: 'มืด' },
  ]

  protected readonly palettes = PALETTES

  protected themeControl = this.nnfb.control<ThemePreference | ''>(this.themeService.preference())
  protected paletteControl = this.nnfb.control<PaletteId>(this.themeService.palette().id)

  constructor() {
    this.themeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((preference) => {
      if (preference) {
        this.themeService.setPreference(preference)
      }
    })
    this.paletteControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.themeService.setPalette(id))
  }
}
