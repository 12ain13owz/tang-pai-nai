# Tang Pai Nai (ตังค์ไปไหน)

Personal / family income-expense tracker modelled on Money Lover. One repo, two independent apps:

| Folder           | What                     | Read before coding there                                                          |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `api/`           | Express + TypeScript API | [`api/AGENTS.md`](api/AGENTS.md)                                                  |
| `web/`           | Angular 22 PWA           | [`web/AGENTS.md`](web/AGENTS.md), [`web/DESIGN.md`](web/DESIGN.md) for any screen |
| `docs/features/` | Feature specs (shared)   | [`docs/features/README.md`](docs/features/README.md)                              |

**Start every task by reading [`ROADMAP.md`](ROADMAP.md)** (what's built, what's next, locked
decisions), then the feature's doc in `docs/features/`, then the `AGENTS.md` of the folder you touch.

## Working rules

- There is no root `package.json`. `cd api` or `cd web` before any npm command. The two apps share
  nothing at build time.
- Build a feature as a vertical slice: spec in `docs/features/` → API → web → update `ROADMAP.md`
  (details in ROADMAP → "How we build a feature").
- Before calling a change done, run that app's checks: `npm run fix`, `npm run typecheck`,
  `npm test`, and in `web/` also `npm run build`. CI (`.github/workflows/api.yml` / `web.yml`) runs
  the same checks.
- Reply to the user in Thai. Code, comments, commit messages and docs are in English. User-facing
  UI text exists in Thai (default) and English, as translation keys in `web/src/app/core/i18n/`
  (`web/AGENTS.md` → UI text).

## Git

Branches: **`develop`** is the working branch, and every change lands there first. **`main`** is
the released branch. It only receives merges from `develop`, done by the owner.

- **Remote sessions** (Claude Code on the web/mobile app, or `@claude` in a GitHub issue/PR): the
  task itself is the request to deliver. Start from the latest `develop`
  (`git fetch && git checkout develop && git pull` if the session started elsewhere), create a
  branch from it, commit in small Conventional-Commit slices, push, and open a PR **into `develop`**
  describing what changed and how it was verified. Never push to `develop` or `main` directly, and
  never open a PR into `main`.
- **Local sessions** (VS Code / terminal on the owner's PC): don't commit or push unless asked; suggest
  a commit message instead (`api/AGENTS.md` §10–11).
- Commit format: `<type>(<scope>): <summary>` with a bullet body. Scope is the feature or area, and
  is prefixed `api`/`web` when it helps, e.g. `feat(web/wallet): ...`.
