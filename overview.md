# ADO Contribution Heatmap

A contribution calendar for your own Azure Repos commits, right inside Azure DevOps.

It answers one question well: **what did my commit activity actually look like this year?** — as a
day-by-day calendar, a set of headline numbers, a per-repository breakdown, and a click-through to any
day's commits.

## Everything stays inside Azure DevOps

No backend service. No database. No personal access tokens. No third-party service. No external CDN.
No analytics or telemetry of any kind.

The only thing this extension ever talks to is **your own Azure DevOps organisation**, using the
short-lived token the extension host issues for you. Your commit data is read in your browser, rendered
in your browser, and forgotten when you close the tab.

## What you get

**A contribution calendar.** Seven weekday rows, one column per week, one cell per day, shaded by how
many commits you authored. The calendar resizes with the range you pick — a 90-day view uses larger
cells than a full year.

**Headline numbers** for the selected range: total commits, active days, current streak, longest streak,
average commits per active day, and how many repositories you touched.

**A repository breakdown** — a sortable table of repository, commits, active days and last commit.
Click any row to filter the whole page to that repository.

**Day details.** Click a day to see exactly what you committed: repository, message, short SHA and time,
each with an **Open** link straight to the commit in Azure DevOps.

**Filters** for scope (this project or the whole organisation), repository, and date range — 30, 90, 180
or 365 days, the current year, or a custom range.

## Built to be readable

- **The intensity scale adapts to you.** Thresholds are quantiles of your own activity, not fixed
  numbers, so the calendar reads well whether you land one commit a week or forty a day. One unusually
  busy day will not flatten the rest of your year.
- **Intensity is never colour-only.** Every cell states its exact commit and repository counts to screen
  readers and on hover, the legend labels each level with its numeric band, and a **Patterns** toggle
  adds a distinct texture per level.
- **Full keyboard access.** The calendar is a single tab stop — arrow keys move by day and week,
  Home/End jump to either end, Enter opens a day.
- **Light and dark themes** both follow your Azure DevOps theme automatically.

## Permissions

One scope, read-only:

| Scope | What it allows |
| --- | --- |
| **Code (read)** — `vso.code` | List repositories you can already see, and read commit metadata: SHA, author, date, message subject, and the commit's URL. |

That is the entire request. No write access. No access to work items, builds, releases, or your profile.

**Your source code is never requested.** The extension does not read file contents, diffs or change
lists, and does not clone anything. It also cannot show you anything you could not already see — Azure
DevOps applies your own repository permissions to every request.

## Getting started

1. Install the extension into your organisation.
2. Open any project and go to **Repos → ADO Contribution Heatmap**.
3. That's it. The first load scans your repositories and shows progress; after that, changing filters is
   instant.

### Not seeing your commits?

Azure DevOps knows your profile identity, but Git records whatever `user.email` your machine was
configured with — and those often differ. If your calendar looks emptier than it should:

Click **Author aliases** in the toolbar and add the email address you actually commit under. You can
check it with `git config user.email`.

Adding an alias grants no extra access; it only widens which of your *already visible* commits get
counted as yours.

## Good to know

- Days are bucketed in **your browser's local timezone**, so the calendar reflects your days.
- Custom ranges cover **1 January 2000 to today**, up to five years at a time.
- Very large repositories are read up to a generous cap; if that cap is ever reached, the page tells you
  rather than quietly under-reporting.
- Tested against **Azure DevOps Services** (cloud). Azure DevOps Server (on-premises) is untested.

## Open source

Source, issues and full technical documentation:
**[github.com/mainadwitiya/azure-devops-contribution-heatmap](https://github.com/mainadwitiya/azure-devops-contribution-heatmap)**

Licensed under MIT.
