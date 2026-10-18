# Contribution Heatmap for Azure DevOps

[![CI](https://github.com/mainadwitiya/azure-devops-contribution-heatmap/actions/workflows/ci.yml/badge.svg)](https://github.com/mainadwitiya/azure-devops-contribution-heatmap/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A contribution calendar for your own Azure Repos commits, rendered as a hub inside Azure DevOps.

It answers one question well: *what did my commit activity look like over the last year?* — as a day-by-day
calendar, a set of headline numbers, a per-repository breakdown, and a click-through to any day's commits.

**It runs entirely inside Azure DevOps.** No backend service, no database, no personal access tokens, no
third-party SaaS, no external CDN, and no telemetry. The only network destination is your own Azure DevOps
organisation's REST API, called with the short-lived token the extension host issues for the signed-in user.

---

## Contents

- [What it does](#what-it-does)
- [Screwing it together: install and run](#install-and-run)
- [Permissions and why they are needed](#permissions-and-why-they-are-needed)
- [Authentication](#authentication)
- [What data it accesses](#what-data-it-accesses)
- [Security guarantees](#security-guarantees)
- [How commits are attributed to you](#how-commits-are-attributed-to-you)
- [Performance and caching](#performance-and-caching)
- [Local development](#local-development)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Marketplace publishing](#marketplace-publishing)
- [Known limitations](#known-limitations)

---

## What it does

**Contribution calendar.** Seven weekday rows by one column per week, one cell per day, shaded by how many
commits you authored that day. The calendar resizes with the selected range — a 30-day view uses larger cells
than a 365-day view.

**Summary statistics**, computed over the selected range: total commits, active days, current streak, longest
streak, average commits per active day, and repositories with activity.

**Repository breakdown**: a sortable table of repository, commits, active days and last commit. Selecting a row
filters the calendar and every statistic to that repository.

**Day details**: clicking a day opens a panel listing that day's commits — repository, message subject, author,
short SHA and time — each with an **Open** action that navigates to the Azure DevOps commit page.

**Filters**: scope (current project or the whole organisation), repository, and date range (30 / 90 / 180 / 365
days, current year, or a custom range).

### Design notes

- **Intensity thresholds are derived from your own data**, not hard-coded. Level 1 always means "at least one
  commit"; the remaining cut points are quantiles of your active days, rounded and forced strictly increasing.
  A single 400-commit day does not flatten the rest of the year.
- **Intensity is never conveyed by colour alone.** Every cell's accessible name and tooltip state the exact
  commit and repository counts, the legend labels each level with its numeric band (`0 · 1–5 · 6–10 · …`), and
  a **Patterns** toggle adds a distinct texture per level.
- **Themes** follow Azure DevOps. Chrome colours read the CSS custom properties the host injects; the calendar
  ramp is chosen from the host's background luminance, so both light and dark themes stay legible.
- **Keyboard access**: the calendar is a single tab stop with a roving tabindex. Left/right move by one week,
  up/down by one day, Home/End jump to the first/last day, PageUp/PageDown move four weeks, Enter opens the
  day panel.

---

## Install and run

### 1. Build and package

```bash
npm install
npm run build
npm run package
```

`npm run package` writes the extension to the repository root:

```
hraverkar.azure-devops-contribution-heatmap-1.0.1.vsix
```

The file name is `{publisher}.{id}-{version}.vsix`. To stamp your own publisher without editing the manifest:

```bash
npm run package -- --publisher your-publisher-id
# or: VSIX_PUBLISHER=your-publisher-id npm run package
```

### 2. Create a publisher (one-time)

Even for private, internal-only use, Azure DevOps requires a Marketplace publisher to own the extension.

1. Go to <https://marketplace.visualstudio.com/manage>.
2. Sign in with the same Microsoft account you use for Azure DevOps.
3. **Create publisher** — pick an ID (for example `contoso-internal`) and a display name.
4. Set `"publisher"` in `vss-extension.json` to that ID, or pass `--publisher` as shown above.

### 3. Upload the extension (private)

1. At <https://marketplace.visualstudio.com/manage>, select your publisher.
2. **New extension → Azure DevOps**.
3. Upload the `.vsix`. The manifest sets `"public": true`, so once Microsoft's virus scan clears it the
   listing is publicly visible. Set it back to `false` if you want a private build.
4. Once it appears, open the **⋯** menu → **Share/Unshare**, and add the Azure DevOps organisation(s) that
   should be able to install it.

### 4. Install into your organisation

1. In Azure DevOps: **Organization settings → Extensions → Shared**.
2. Select **ADO Contribution Heatmap → Get it free → Install**, choosing the target organisation.
3. Consent to the requested scope (see [Permissions](#permissions-and-why-they-are-needed)).

### 5. Open it

Navigate to any project → **Repos** → **ADO Contribution Heatmap** in the left-hand hub list.

### 6. Uninstall

**Organization settings → Extensions → Installed → ADO Contribution Heatmap → ⋯ → Uninstall.**

To remove it entirely, also **Remove** it from your publisher at
<https://marketplace.visualstudio.com/manage>. Nothing else needs cleaning up — the extension stores no
server-side state. Author aliases and display preferences live in your browser's `localStorage` and can be
cleared with the rest of your site data.

---

## Permissions and why they are needed

The manifest requests exactly one scope:

| Scope | Name | Access | Why |
| --- | --- | --- | --- |
| `vso.code` | Code (read) | **Read-only** | List the Git repositories you can already see, and read commit *metadata* (SHA, author, date, message subject, commit URL) so days can be counted and linked. |

No other scope is requested. In particular:

- **No write scope of any kind.** `vso.code_write`, `vso.code_manage` and `vso.code_full` are not requested,
  so the extension cannot create, modify or delete anything.
- **No `vso.project`.** Listing repositories at organisation scope returns each repository's project inline,
  so the Project and Team scope is unnecessary.
- **No `vso.profile`, `vso.identity` or `vso.graph`.** Your identity comes from the extension host via
  `SDK.getUser()`, which is not a REST call and needs no scope.
- **No `vso.extension.data`.** Preferences are stored in the browser, not in Azure DevOps.

`scripts/validate.mjs` fails the build if any scope matching `_write`, `_manage`, `_full`, `_execute` or
`user_impersonation` ever appears in the manifest.

### What the scope does *not* grant

`vso.code` is the scope ceiling, not the effective permission. Azure DevOps still applies your own repository
ACLs to every request: repositories you cannot read are simply absent from the response. The extension cannot
see anything you could not already see by browsing **Repos** yourself.

---

## Authentication

There are **no personal access tokens** anywhere in this extension — none entered, none stored, none prompted for.

Authentication uses the standard extension flow:

1. The page calls `SDK.init()` and `SDK.ready()` to complete the handshake with the Azure DevOps host frame
   (`azure-devops-extension-sdk`, the official Microsoft package).
2. `SDK.getUser()` returns the signed-in identity — id, unique name, display name — with no REST call.
3. `SDK.getAccessToken()` asks the host to mint a short-lived bearer token, scoped to what the manifest
   declares and to the current user's own permissions.
4. That token is attached as `Authorization: Bearer …` on REST calls to your organisation, and nowhere else.

The token is held in a module-local variable for at most five minutes and is re-requested from the host after
that. It is never written to `localStorage`, `sessionStorage`, cookies, IndexedDB or any log. Closing the tab
discards it.

Two auth edge cases are handled explicitly:

- **Expired session.** Azure DevOps answers an unauthenticated request with a sign-in *page* under HTTP 200/203
  rather than a 401. The client checks the response content type, treats a non-JSON body as an auth failure,
  forces one token refresh, and surfaces "Your Azure DevOps session could not be verified" if that also fails.
- **Iframe redirect.** Every request sends `X-TFS-FedAuthRedirect: Suppress` so federated-auth redirects fail
  fast rather than silently rendering a login page inside the frame.

---

## What data it accesses

Two REST endpoints, both read-only, both `GET`:

| Call | Purpose | Fields used |
| --- | --- | --- |
| `GET {org}/[{project}/]_apis/git/repositories?api-version=7.1` | Discover repositories you can read | `id`, `name`, `project`, `webUrl`, `defaultBranch`, `isDisabled`, `size` |
| `GET {org}/{project}/_apis/git/repositories/{repo}/commits?api-version=7.1&searchCriteria…` | Commit metadata within the date window | `commitId`, `author.{name,email,date}`, `comment` (first line only), `remoteUrl` |

The commit query pins every content-bearing flag off:

```
searchCriteria.includeLinks=false
searchCriteria.includeWorkItems=false
searchCriteria.includePushData=false
searchCriteria.includeUserImageUrl=false
```

### What it never touches

**Repository source code is never requested.** The extension does not call `/items`, `/blobs`, `/trees`,
`/diffs` or `/pushes`, does not clone anything, and does not read file contents, diffs or change lists. Only
the first line of a commit message is retained, for display in the day panel. `scripts/validate.mjs` greps the
built bundle for those endpoint paths and fails the build if any appears.

---

## Security guarantees

Each of these is asserted mechanically by `npm run validate`, not just claimed here:

| Guarantee | How it is enforced |
| --- | --- |
| No backend service | Nothing in the repository is a server. The only origin contacted is your Azure DevOps organisation. |
| No external network calls | The bundle is scanned for absolute URLs; anything outside `dev.azure.com` / `*.visualstudio.com` fails the build. |
| No CDN scripts | Everything, including the SDK, is bundled locally by esbuild. The HTML references only `heatmap.css` and `heatmap.js`. |
| No analytics or telemetry | The bundle is scanned for `sendBeacon`, `XMLHttpRequest`, `googletagmanager` and `analytics`. |
| No source code access | The bundle is scanned for content-bearing Git endpoints. |
| Read-only permissions | Manifest scopes are checked against a write-scope pattern. |
| No secrets in the repository | All source files are scanned for PAT-shaped tokens, bearer literals, JWTs, and assigned-secret patterns. |
| No token persistence | The token lives in one module-local variable with a 5-minute lifetime; there is no storage write anywhere in `src/api`. |

Two further practices, enforced by design rather than by a script:

- **No `innerHTML`, anywhere.** All rendering goes through `src/ui/dom.ts`, which only ever sets `textContent`
  and attributes. A crafted commit message or repository name cannot become markup.
- **Navigation is scheme-checked.** URLs from API responses are parsed and rejected unless `http(s)`, so a
  malformed `remoteUrl` cannot produce a `javascript:` or `data:` navigation.

What *is* stored locally: your display preferences and any author aliases you add, under the single
`localStorage` key `adoContributionHeatmap.preferences.v1`. That is display configuration — no credentials, no
Azure DevOps content. Storage being unavailable (private browsing, blocked site data) is handled; preferences
simply do not persist.

---

## How commits are attributed to you

This is the one genuinely hard part, and it deserves explaining.

Azure DevOps identities and Git commit authorship are **separate namespaces**. A commit records whatever
`user.name` and `user.email` the committer's Git client was configured with, which is frequently not the Azure
DevOps profile — a laptop configured with a personal address, a corporate tenant where `@corp.com` and
`@corp.onmicrosoft.com` both exist, a CI machine committing on your behalf.

The extension uses a **two-layer** strategy:

1. **Server-side narrowing.** For each repository, it issues one request per known alias using
   `searchCriteria.author`, bounded by `fromDate`/`toDate`. Azure DevOps does the bulk filtering, so only your
   commits cross the wire instead of a repository's entire history.
2. **Local verification.** Every returned record is re-checked against the full identity set before it is
   counted. A loose or unexpected server-side match therefore cannot attribute someone else's commit to you.

Aliases are seeded from `SDK.getUser()` — your unique name and display name — and normalised case-insensitively.
RFC 5233 sub-addresses are handled, so `ada.lovelace+ci@example.com` matches `ada.lovelace@example.com`.
Records with missing or unparseable author metadata are dropped rather than guessed at.

### If commits are missing

Open **Author aliases** in the toolbar. Three controls, in increasing order of looseness:

- **Additional author names or emails** — add the address you actually commit under. This is the right fix
  for the common case, and is what the empty state suggests.
- **Match any domain for these addresses** — treats `me@corp.com` and `me@corp.onmicrosoft.com` as the same
  person. Looser, so it is off by default.
- **Deep scan** — drops the server-side `author` filter entirely and matches every commit in range locally.
  This is dramatically more expensive in requests; use it only when aliases alone are not enough.

Adding an alias grants no additional access. It only widens which *already readable* commits are counted as yours.

---

## Performance and caching

For a project with tens of repositories and a year of history, a cold load is a repository list plus roughly
one request per repository per alias. Subsequent interactions are usually free.

- **Session cache.** Repository lists and commit results are cached in memory for the life of the page
  (15-minute TTL). Nothing is written to disk; reloading the hub starts empty.
- **Range containment.** The cache records the date range it actually covers. Narrowing 365 days to 30 is
  answered from memory with no request. Widening refetches the *union*, so the cache never claims to cover days
  it has not read.
- **Free interactions.** Changing the repository filter, sorting the table, toggling patterns, and opening a
  day panel are pure recalculations over cached events. Only a scope change, a widened range, an alias change,
  or **Refresh** reaches the network.
- **Bounded concurrency.** Repositories are scanned through a fixed 6-worker pool, never `Promise.all` over the
  whole list.
- **Server-side date filtering.** `fromDate`/`toDate` are always sent; commits outside the range are never
  transferred.
- **Cheap skips.** Disabled repositories, and repositories Azure DevOps reports as zero bytes with no default
  branch, are filtered out before they cost a request.
- **Throttling.** HTTP 429 is retried with `Retry-After` honoured, falling back to exponential backoff with
  full jitter (4 attempts, capped at 10s). 5xx and network errors retry on the same policy; 403 and 404 do not.
- **Bounded scans.** Paging stops at 40 pages (20,000 commits) per repository/alias. When that ceiling is hit
  the UI says so rather than silently under-reporting.
- **Partial failure.** One inaccessible repository produces a warning strip naming it; the rest of the page
  still renders.
- **Progress.** The loading state reports `Scanning repositories 7 / 24…` with a progress bar, so a large
  organisation scan never looks hung.

---

## Local development

Azure DevOps extensions run inside an iframe served from Microsoft's CDN, so there is **no localhost dev
server** — the page needs the host frame to hand it an identity and a token. The development loop is
build → package → upload → reload.

```bash
npm install          # install dependencies
npm run build        # typecheck + bundle into dist/
npm run package      # produce the .vsix
```

Useful during iteration:

```bash
npm run watch        # rebuild dist/ on every source change
npm run typecheck    # tsc --noEmit
npm test             # unit tests
npm run test:watch   # unit tests in watch mode
npm run coverage     # coverage report (80% line/function threshold)
npm run lint         # eslint
npm run validate     # manifest, scope, bundle and secret checks
npm run verify       # lint + test + build + validate, in one command
```

### Iterating against a real organisation

Use a **test organisation** and a separate extension id while developing, so you never overwrite a shared
install:

1. In `vss-extension.json`, temporarily set `"id"` to something like
   `azure-devops-contribution-heatmap-dev`.
2. Bump `"version"` on every upload — Azure DevOps caches extension assets aggressively and will not pick up
   new files under an unchanged version. `npm run package:dev` passes `--rev-version` to do this for you.
3. Re-upload at <https://marketplace.visualstudio.com/manage> and hard-reload the hub (Ctrl+Shift+R).

Browser devtools work normally inside the extension iframe. Diagnostics are prefixed `[contribution-heatmap]`
and go through `src/util/log.ts`; nothing is sent anywhere.

---

## Project structure

```
azure-devops-contribution-heatmap/
├── vss-extension.json          Extension manifest (hub contribution, scopes, files)
├── package.json                Scripts and dependencies
├── tsconfig.json               Strict TypeScript configuration
├── eslint.config.mjs           Lint rules
├── vitest.config.ts            Test and coverage configuration
├── README.md
│
├── images/
│   └── icon.png                Extension icon
│
├── scripts/
│   ├── clean.mjs               Remove dist/
│   ├── build.mjs               esbuild bundle + static copy
│   ├── package.mjs             tfx-cli .vsix packaging
│   └── validate.mjs            Manifest, scope, bundle and secret checks
│
├── static/
│   ├── heatmap.html            Hub page shell
│   └── heatmap.css             Theme-aware stylesheet
│
├── src/
│   ├── main.ts                 Entry point: handshake, context, bootstrap
│   │
│   ├── config/
│   │   └── constants.ts        API version, resource area ids, limits
│   │
│   ├── api/                    Everything that talks to Azure DevOps
│   │   ├── azureDevOpsClient.ts  SDK bridge: identity, token, base URL, navigation
│   │   ├── httpClient.ts         Auth, retry, 429 handling, error taxonomy
│   │   ├── identityService.ts    Resolves the identity set
│   │   ├── repositoryService.ts  Repository discovery and normalisation
│   │   └── commitService.ts      Commit paging, querying and normalisation
│   │
│   ├── models/                 Shared types
│   │   ├── user.ts  repository.ts  commit.ts
│   │   ├── contribution.ts       Generic contribution model (see below)
│   │   ├── dateRange.ts  errors.ts
│   │
│   ├── services/               Orchestration and pure computation
│   │   ├── contributionService.ts  Scan orchestration + caching
│   │   ├── aggregationService.ts   Events → per-day buckets
│   │   ├── statisticsService.ts    Totals and streaks
│   │   ├── repositoryStatsService.ts  Per-repository rollup and sorting
│   │   ├── cacheService.ts  concurrency.ts  preferencesService.ts
│   │
│   ├── heatmap/                Pure calendar logic (no DOM)
│   │   ├── calendar.ts           Week/weekday grid geometry
│   │   └── intensity.ts          Dynamic threshold derivation
│   │
│   ├── ui/                     Rendering
│   │   ├── app.ts                State ownership and render orchestration
│   │   ├── heatmap.ts            Calendar grid, legend, keyboard navigation
│   │   ├── summary.ts  toolbar.ts  repositoryTable.ts
│   │   ├── commitDetails.ts  settingsPanel.ts  panel.ts
│   │   ├── states.ts             Loading, empty and error states
│   │   ├── dom.ts                textContent-only element helpers
│   │   └── theme.ts  format.ts
│   │
│   └── util/
│       ├── dates.ts              Local-calendar day arithmetic
│       ├── identityMatch.ts      Identity matching
│       └── log.ts                Console diagnostics seam
│
├── tests/                      295 unit tests
└── dist/                       Build output (generated)
```

The boundary that matters: **`src/api` is the only layer that knows Azure DevOps exists**, and
`src/api/azureDevOpsClient.ts` is the only module that imports the SDK. Everything below it works on plain
data, which is why the calendar, statistics and identity logic are all testable in Node without a browser.

### Designed for more contribution types

Version 1 counts commits only, deliberately. The model underneath is already generic:

```ts
type ContributionType = 'commit';        // future: 'pull-request' | 'review' | 'work-item'

interface ContributionEvent {
  type: ContributionType;
  id; repositoryId; repositoryName; projectId; projectName;
  date; timestamp; title; actorName; actorEmail; url;
  source: CommitRecord;                   // type-specific payload
}

interface DayContribution {
  date; count; repositories;
  countsByType: Record<ContributionType, number>;
  events: ContributionEvent[];
}
```

Aggregation, statistics, calendar geometry and the entire UI are keyed on `ContributionType`. Adding pull
requests later means adding a producer in `src/api` that emits `ContributionEvent`s and extending the union —
the heatmap itself does not change.

---

## Testing

```bash
npm test          # 295 tests
npm run coverage  # with thresholds
```

Coverage is enforced at 80% lines/functions, 75% branches, over the logic layers (`util`, `heatmap`,
`services`, and the API modules). DOM rendering and the SDK bridge are exercised in the browser instead of
being mocked into meaninglessness.

Covered explicitly, including the edge cases: date aggregation and bucketing; contribution counts; calendar
positioning and month labels; dynamic intensity thresholds; current and longest streaks; repository
aggregation and sorting; date-range resolution and filtering; and identity matching.

Edge cases with dedicated tests: zero commits · exactly one commit · many commits on one day · commits across a
year boundary · leap years and 29 February · Sunday/Monday week-start boundaries · full 365-day ranges ·
repositories with no commits · duplicate commit records (including the same SHA in two repositories) ·
pagination, including the page ceiling · author email case differences · missing author email · missing
repository metadata · malformed and partial API responses · inverted date ranges · HTTP 429, 401, 403, 404 and
5xx · network failures and aborts.

---

## Marketplace publishing

Public listing is **not required** — the private flow above is the intended path for internal use. If you do
want to publish publicly:

1. Set `"public": true` in `vss-extension.json`.
2. Replace `"publisher"` with your verified publisher ID.
3. Update `links.support.uri` to a real support URL.
4. Expand this README — it becomes the Marketplace listing via `content.details.path`.
5. Add screenshots and set `"galleryFlags"` as needed.
6. `npm run package`, then upload, or use `tfx extension publish` with a token that has Marketplace (publish)
   scope.

Note that a public extension is reviewed by Microsoft and the requested scopes are shown to every installer.

---

## Known limitations

Stated plainly, because they affect how you read the numbers:

- **Days are bucketed in your browser's local timezone.** A commit made at 23:30 in one timezone may land on a
  different calendar day for a viewer elsewhere. This matches what "my day" means to the person looking at it.
- **Commits are read through the Git Commits API per repository.** Which branches that covers is Azure DevOps'
  behaviour, not this extension's; no branch is specified in the query. Commits in repositories you cannot read
  never appear, by design.
- **Attribution depends on commit author metadata**, with the alias controls described above as the escape
  hatch. There is no server-side identity join that would make this exact for every configuration.
- **Very large repositories are capped** at 40 pages per repository/alias. The UI names any repository where
  this happened rather than silently under-reporting.
- **Custom ranges are bounded** to dates between 1 January 2000 and today, and to at most 1826 days (five
  years). Wider ranges are clamped, and the toolbar says so — an unbounded range would mean hundreds of
  thousands of day cells.
- **Organisation scope can be slow** on organisations with hundreds of repositories. Project scope is the
  default for exactly that reason.
- **Azure DevOps Server (on-premises)** is untested. The base URL is resolved through the host's location
  service rather than hard-coded, so it is expected to work, but it has only been exercised against Azure
  DevOps Services.

---

## Licence

MIT — see [LICENSE](LICENSE).
