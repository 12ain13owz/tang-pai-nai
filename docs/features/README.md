# Feature docs

One file per feature: **what it does and the rules it enforces**, in plain language, so a human or an
AI can understand a feature without reading its code. These docs are the shared spec for both
`api/` and `web/`.

| Feature        | Doc                                | Status               |
| -------------- | ---------------------------------- | -------------------- |
| Auth           | [auth.md](auth.md)                 | Built (4.1–4.4b)     |
| Currency       | [currency.md](currency.md)         | API with 4a.2        |
| Profile        | [profile.md](profile.md)           | Built (6.1)          |
| Wallet         | [wallet.md](wallet.md)             | Spec, #6.2           |
| Category       | [category.md](category.md)         | Spec — not built yet |
| Transaction    | [transaction.md](transaction.md)   | Spec — not built yet |
| Offline & sync | [offline-sync.md](offline-sync.md) | Built (4a.1, 4a.2)   |

Order of work and project-wide decisions live in [`../../ROADMAP.md`](../../ROADMAP.md), not here.

## What goes where

| File                                | Answers                                            |
| ----------------------------------- | -------------------------------------------------- |
| `ROADMAP.md` (repo root)            | What we build, in what order, decisions locked     |
| `docs/features/<feature>.md` (this) | What a feature does: data, rules, endpoints, flows |
| `api/AGENTS.md`, `web/AGENTS.md`    | How to write the code                              |
| `api/src/features/docs/spec/`       | Exact request/response shapes                      |

Don't repeat another file's content; link to it instead, because duplicates drift.

## Workflow

1. **Before coding** a feature, write (or update) its doc and agree on it. Commit it on its own
   (`docs(<feature>): ...`).
2. Build the feature against the doc (API first, then web).
3. If a rule changes while building, update the doc **in the same commit** as the code.
4. If the doc and the code disagree, the code wins, so fix the doc.

## Template

Keep it short, roughly one or two screens. Use the sections that apply and skip the rest.

```md
# <Feature>

> Status: Spec | Built — code in `src/features/<feature>/`

## Purpose

What it does, for whom. One paragraph.

## Out of scope

What it deliberately does not do (and where that lives instead, if anywhere).

## Data model

Tables, key fields, relations. Point to the Drizzle schema file instead of pasting it.

## Business rules

Numbered, testable statements ("A wallet's currency can't change once it has transactions").

## Endpoints

| Method | Path | Auth | What |
| ------ | ---- | ---- | ---- |

Shapes live in OpenAPI — list routes and their purpose only.

## Web screens

Which screens/sheets the web app needs, and how they behave on a phone.

## Interactions

What other features read from / write to this one.

## Open questions

Undecided points, with a proposal.
```
