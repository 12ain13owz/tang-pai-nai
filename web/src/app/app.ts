import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: `
    <main class="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <h1 class="text-2xl font-semibold">เงินไปไหน</h1>
    </main>
    <router-outlet />
  `,
})
export class App {}
