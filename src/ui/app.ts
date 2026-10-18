/**
 * Application controller.
 *
 * Owns all mutable state and is the single place that decides whether a user
 * action needs new data or only a recalculation. Filters (repository, date
 * range within what has been fetched, sorting, patterns) are pure
 * recalculations over cached events; only a scope change, a widened date range
 * or an explicit refresh reaches the network.
 *
 * State transitions are expressed by replacing the state object rather than
 * mutating it, so every render works from one consistent snapshot.
 */

import type { AzureDevOpsContext } from '../api/azureDevOpsClient.js';
import type { RepositoryScope } from '../api/repositoryService.js';
import { resolveIdentity } from '../api/identityService.js';
import { listProjectMembers } from '../api/projectMemberService.js';
import { buildCalendar } from '../heatmap/calendar.js';
import { computeIntensityThresholds } from '../heatmap/intensity.js';
import type { ContributionEvent } from '../models/contribution.js';
import type { DateRange, DateRangePresetId } from '../models/dateRange.js';
import type { AppError } from '../models/errors.js';
import { toAppError } from '../models/errors.js';
import type { Repository } from '../models/repository.js';
import type { CurrentUser, IdentitySet } from '../models/user.js';
import {
  aggregateContributions,
  dayAt,
  filterEventsByRange,
  filterEventsByRepository,
} from '../services/aggregationService.js';
import type {
  RepositoryFailure,
  ScanProgress,
} from '../services/contributionService.js';
import { ContributionService } from '../services/contributionService.js';
import type { Preferences, ScopeKind } from '../services/preferencesService.js';
import { computeStatistics } from '../services/statisticsService.js';
import { loadPreferences, savePreferences } from '../services/preferencesService.js';
import type { RepositorySort } from '../services/repositoryStatsService.js';
import { summarizeRepositories } from '../services/repositoryStatsService.js';
import { clampDateRange, isRangeClamped, resolveDateRange, todayKey } from '../util/dates.js';
import { matchesIdentity } from '../util/identityMatch.js';
import { logError } from '../util/log.js';
import { dayPanelDescription, dayPanelTitle, renderCommitDetails } from './commitDetails.js';
import { clear, el, replaceChildren } from './dom.js';
import { renderHeatmap } from './heatmap.js';
import { formatRelative } from './format.js';
import type { PanelHandle } from './panel.js';
import { openPanel } from './panel.js';
import { renderRepositoryTable } from './repositoryTable.js';
import type { SettingsValues } from './settingsPanel.js';
import { renderSettingsPanel } from './settingsPanel.js';
import {
  renderEmptyState,
  renderErrorState,
  renderLoadingState,
  renderNotice,
} from './states.js';
import { renderSummary } from './summary.js';
import { renderToolbar } from './toolbar.js';

type Status = 'loading' | 'ready' | 'error';

interface AppState {
  readonly status: Status;
  readonly preferences: Preferences;
  readonly identity: IdentitySet;
  readonly members: readonly CurrentUser[];
  readonly selectedMemberIds: readonly string[];
  readonly membersLoading: boolean;
  readonly membersError: AppError | null;
  readonly repositories: readonly Repository[];
  readonly events: readonly ContributionEvent[];
  readonly selectedRepositoryId: string | null;
  readonly selectedDate: string | null;
  readonly selectedDateContributorId: string | null;
  readonly progress: ScanProgress | null;
  readonly error: AppError | null;
  readonly rangeAdjusted: boolean;
  readonly truncatedRepositories: readonly string[];
  readonly failures: readonly RepositoryFailure[];
  readonly lastUpdated: number | null;
}

export class App {
  private state: AppState;
  private readonly service: ContributionService;
  private readonly regions: {
    toolbar: HTMLElement;
    notices: HTMLElement;
    content: HTMLElement;
    panel: HTMLElement;
    status: HTMLElement;
  };
  private panel: PanelHandle | null = null;
  private inFlight: AbortController | null = null;
  private membersInFlight: AbortController | null = null;

  constructor(
    private readonly context: AzureDevOpsContext,
    root: HTMLElement,
  ) {
    this.service = new ContributionService(context.http);

    // A custom range restored from storage may predate the current bounds, or
    // have been hand-edited. Normalise once on load rather than carrying an
    // undrawable range around in state.
    const stored = loadPreferences();
    const preferences: Preferences =
      stored.presetId === 'custom' && stored.customRange
        ? { ...stored, customRange: clampDateRange(stored.customRange, todayKey()) }
        : stored;
    if (preferences !== stored) {
      savePreferences(preferences);
    }

    this.state = {
      status: 'loading',
      preferences,
      identity: resolveIdentity(context.user, {
        customAliases: preferences.customAliases,
        matchEmailLocalPart: preferences.matchEmailLocalPart,
      }),
      members: [context.user],
      selectedMemberIds: [context.user.id],
      membersLoading: false,
      membersError: null,
      repositories: [],
      events: [],
      selectedRepositoryId: null,
      selectedDate: null,
      selectedDateContributorId: null,
      progress: null,
      error: null,
      rangeAdjusted:
        stored.presetId === 'custom' && stored.customRange !== null
          ? isRangeClamped(stored.customRange, todayKey())
          : false,
      truncatedRepositories: [],
      failures: [],
      lastUpdated: null,
    };

    this.regions = buildLayout(root, context);
  }

  /** Renders the initial shell and performs the first scan. */
  async start(): Promise<void> {
    this.render();
    await Promise.all([this.load({ forceRefresh: false }), this.loadMembers()]);
  }

  // ---------------------------------------------------------------- state

  private setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private updatePreferences(patch: Partial<Preferences>): Preferences {
    const preferences = { ...this.state.preferences, ...patch };
    savePreferences(preferences);
    return preferences;
  }

  private get range(): DateRange {
    const { presetId, customRange } = this.state.preferences;
    return resolveDateRange(presetId, todayKey(), customRange ?? undefined);
  }

  private get scope(): RepositoryScope {
    const project = this.context.currentProject;
    if (this.state.preferences.scope === 'organization' || !project) {
      return { kind: 'organization' };
    }
    return { kind: 'project', projectId: project.id, projectName: project.name };
  }

  // ----------------------------------------------------------------- data

  private async load(options: { forceRefresh: boolean }): Promise<void> {
    const identities = this.selectedIdentities();
    if (identities.length === 0) {
      this.inFlight?.abort();
      this.setState({
        status: 'ready',
        events: [],
        progress: null,
        error: null,
        truncatedRepositories: [],
        failures: [],
      });
      return;
    }

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    this.setState({ status: 'loading', error: null, progress: null });

    try {
      const result = await this.service.scan({
        scope: this.scope,
        range: this.range,
        identity: identities[0] as IdentitySet,
        additionalIdentities: identities.slice(1),
        deepScan: this.state.preferences.deepScan,
        forceRefresh: options.forceRefresh,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) {
            this.setState({ progress });
          }
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      // A repository that vanished between scans must not stay selected.
      const stillPresent = result.repositories.some(
        (repository) => repository.id === this.state.selectedRepositoryId,
      );

      this.setState({
        status: 'ready',
        repositories: result.repositories,
        events: result.events,
        truncatedRepositories: result.truncatedRepositories,
        failures: result.failures,
        selectedRepositoryId: stillPresent ? this.state.selectedRepositoryId : null,
        progress: null,
        lastUpdated: Date.now(),
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      const error = toAppError(caught, 'Unable to retrieve Azure DevOps activity.');
      logError('Scan failed.', caught);
      this.setState({ status: 'error', error, progress: null });
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = null;
      }
    }
  }

  private async loadMembers(): Promise<void> {
    const project = this.context.currentProject;
    if (!project) {
      this.setState({ members: [this.context.user], membersLoading: false, membersError: null });
      return;
    }

    this.membersInFlight?.abort();
    const controller = new AbortController();
    this.membersInFlight = controller;
    this.setState({ membersLoading: true, membersError: null });

    try {
      const projectMembers = await listProjectMembers(this.context.http, project.id, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }

      const members = projectMembers.some((member) => member.id === this.context.user.id)
        ? projectMembers
        : [...projectMembers, this.context.user];
      const memberIds = new Set(members.map((member) => member.id));
      const selectedMemberIds = this.state.selectedMemberIds.filter((id) => memberIds.has(id));
      this.setState({
        members,
        selectedMemberIds:
          selectedMemberIds.length > 0 ? selectedMemberIds : [this.context.user.id],
        membersLoading: false,
        membersError: null,
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      const error = toAppError(caught, 'Unable to retrieve project members.');
      logError('Project member lookup failed.', caught);
      this.setState({ membersLoading: false, membersError: error });
    } finally {
      if (this.membersInFlight === controller) {
        this.membersInFlight = null;
      }
    }
  }

  private selectedIdentities(): IdentitySet[] {
    const membersById = new Map(this.state.members.map((member) => [member.id, member]));
    return this.state.selectedMemberIds.flatMap((id) => {
      const member = membersById.get(id);
      if (!member) {
        return [];
      }
      if (member.id === this.context.user.id) {
        return [this.state.identity];
      }
      return [resolveIdentity(member)];
    });
  }

  // -------------------------------------------------------------- actions

  private onScopeChange = (scope: ScopeKind): void => {
    const preferences = this.updatePreferences({ scope });
    this.setState({ preferences, selectedRepositoryId: null });
    void this.load({ forceRefresh: false });
  };

  private onPresetChange = (presetId: DateRangePresetId): void => {
    const preferences = this.updatePreferences({ presetId });
    this.setState({ preferences, rangeAdjusted: false });
    // Narrowing is served from cache; widening refetches only the extra days.
    void this.load({ forceRefresh: false });
  };

  private onCustomRangeChange = (range: DateRange): void => {
    // Clamped on the way in, so what gets persisted is always drawable, and the
    // fact that clamping happened is recorded so the toolbar can say so.
    const today = todayKey();
    const customRange = clampDateRange(range, today);
    const preferences = this.updatePreferences({ presetId: 'custom', customRange });
    this.setState({ preferences, rangeAdjusted: isRangeClamped(range, today) });
    void this.load({ forceRefresh: false });
  };

  private onRepositoryChange = (selectedRepositoryId: string | null): void => {
    // Pure recalculation over data already held.
    this.setState({ selectedRepositoryId });
  };

  private onMembersChange = (selectedMemberIds: readonly string[]): void => {
    this.panel?.close();
    this.setState({
      selectedMemberIds: [...new Set(selectedMemberIds)],
      selectedDate: null,
      selectedDateContributorId: null,
    });
    void this.load({ forceRefresh: false });
  };

  private onSortChange = (sort: RepositorySort): void => {
    this.setState({ preferences: this.updatePreferences({ sort }) });
  };

  private onPatternsChange = (usePatterns: boolean): void => {
    this.setState({ preferences: this.updatePreferences({ usePatterns }) });
  };

  private onRefresh = (): void => {
    void this.refresh();
  };

  private async refresh(): Promise<void> {
    await this.loadMembers();
    await this.load({ forceRefresh: true });
  }

  private onSelectDay = (date: string, contributorId: string): void => {
    this.setState({ selectedDate: date, selectedDateContributorId: contributorId });
    this.openDayPanel(date, contributorId);
  };

  private onOpenSettings = (): void => {
    this.panel?.close();
    this.panel = openPanel({
      title: 'Author aliases',
      description: 'Control which commit authors count as you.',
      host: this.regions.panel,
      onClose: () => {
        this.panel = null;
      },
      content: renderSettingsPanel({
        identity: this.state.identity,
        values: {
          customAliases: this.state.preferences.customAliases,
          matchEmailLocalPart: this.state.preferences.matchEmailLocalPart,
          deepScan: this.state.preferences.deepScan,
        },
        onCancel: () => this.panel?.close(),
        onApply: (values) => this.applySettings(values),
      }),
    });
  };

  private applySettings(values: SettingsValues): void {
    this.panel?.close();

    const preferences = this.updatePreferences({
      customAliases: values.customAliases,
      matchEmailLocalPart: values.matchEmailLocalPart,
      deepScan: values.deepScan,
    });

    const identity = resolveIdentity(this.context.user, {
      customAliases: values.customAliases,
      matchEmailLocalPart: values.matchEmailLocalPart,
    });

    // Aliases change which commits qualify, so cached results no longer apply.
    this.service.clearCache();
    this.setState({
      preferences,
      identity,
      events: [],
      selectedDate: null,
      selectedDateContributorId: null,
    });
    void this.load({ forceRefresh: true });
  }

  private openDayPanel(date: string, contributorId: string): void {
    const contributor = this.derived().contributors.find(
      (candidate) => candidate.member.id === contributorId,
    );
    if (!contributor) {
      return;
    }
    const day = dayAt(contributor.contributions, date);
    this.panel?.close();
    this.panel = openPanel({
      title: dayPanelTitle(day),
      description: `${contributor.member.displayName || contributor.member.uniqueName}: ${dayPanelDescription(day)}`,
      host: this.regions.panel,
      onClose: () => {
        this.panel = null;
        this.setState({ selectedDate: null, selectedDateContributorId: null });
      },
      content: renderCommitDetails({
        day,
        onOpenCommit: (url) => this.context.openInNewWindow(url),
      }),
    });
  }

  // --------------------------------------------------------------- render

  /** Everything shown is derived from state; nothing is cached across renders. */
  private derived() {
    const range = this.range;
    const inRange = filterEventsByRange(this.state.events, range);
    const visible = filterEventsByRepository(inRange, this.state.selectedRepositoryId);
    const contributors = this.selectedIdentities().map((identity) => {
      const member = this.state.members.find((candidate) => candidate.id === identity.user.id);
      if (!member) {
        return null;
      }
      const memberEvents = visible.filter((event) =>
        matchesIdentity(identity, { name: event.actorName, email: event.actorEmail }),
      );
      const contributions = aggregateContributions(memberEvents);
      const thresholds = computeIntensityThresholds(
        [...contributions.values()].map((day) => day.count),
      );
      return {
        member,
        contributions,
        thresholds,
        grid: buildCalendar(range, contributions, {
          weekStartsOn: this.state.preferences.weekStartsOn,
          thresholds,
        }),
      };
    }).filter((contributor): contributor is NonNullable<typeof contributor> => contributor !== null);

    return {
      range,
      inRange,
      contributors,
      summaries: summarizeRepositories(inRange, this.state.repositories),
    };
  }

  private render(): void {
    const focusedId =
      document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const openDetails = [
      ...this.regions.toolbar.querySelectorAll<HTMLDetailsElement>('details[open][id]'),
    ].map((details) => details.id);

    this.renderToolbar();
    for (const id of openDetails) {
      const details = document.getElementById(id);
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
      }
    }
    this.renderNotices();
    this.renderContent();
    this.renderStatusLine();

    if (focusedId) {
      document.getElementById(focusedId)?.focus();
    }
  }

  private renderToolbar(): void {
    const derived = this.derived();
    replaceChildren(this.regions.toolbar, [
      renderToolbar(
        {
          scope: this.scope.kind === 'project' ? 'project' : 'organization',
          hasProject: this.context.currentProject !== null,
          projectName: this.context.currentProject?.name ?? null,
          repositories: this.state.repositories,
          members: this.state.members,
          selectedMemberIds: this.state.selectedMemberIds,
          membersLoading: this.state.membersLoading,
          membersError: this.state.membersError?.detail ?? this.state.membersError?.message ?? null,
          selectedRepositoryId: this.state.selectedRepositoryId,
          presetId: this.state.preferences.presetId,
          customRange: this.state.preferences.customRange,
          resolvedRange: derived.range,
          usePatterns: this.state.preferences.usePatterns,
          rangeAdjusted: this.state.rangeAdjusted,
          busy: this.state.status === 'loading',
        },
        {
          onScopeChange: this.onScopeChange,
          onRepositoryChange: this.onRepositoryChange,
          onMembersChange: this.onMembersChange,
          onPresetChange: this.onPresetChange,
          onCustomRangeChange: this.onCustomRangeChange,
          onPatternsChange: this.onPatternsChange,
          onRefresh: this.onRefresh,
          onOpenSettings: this.onOpenSettings,
        },
      ),
    ]);
  }

  private renderNotices(): void {
    const notices: HTMLElement[] = [];

    if (this.state.failures.length > 0) {
      const names = this.state.failures.map((failure) => failure.repositoryName);
      notices.push(
        renderNotice(
          `${names.length} ${names.length === 1 ? 'repository' : 'repositories'} could not be read and ${names.length === 1 ? 'is' : 'are'} missing from these totals: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`,
        ),
      );
    }

    if (this.state.truncatedRepositories.length > 0) {
      notices.push(
        renderNotice(
          `Some repositories had more commits than one scan can read (${this.state.truncatedRepositories.slice(0, 3).join(', ')}). Narrow the date range for exact totals.`,
        ),
      );
    }

    replaceChildren(this.regions.notices, notices);
  }

  private renderContent(): void {
    const content = this.regions.content;

    if (this.state.status === 'loading' && this.state.events.length === 0) {
      replaceChildren(content, [renderLoadingState(this.state.progress)]);
      return;
    }

    if (this.state.status === 'error') {
      replaceChildren(content, [
        renderErrorState(this.state.error as AppError, () => this.onRefresh()),
      ]);
      return;
    }

    if (this.state.repositories.length === 0) {
      replaceChildren(content, [
        renderEmptyState({
          title:
            this.scope.kind === 'project'
              ? 'No Azure Repos are available to your account in this project.'
              : 'No Azure Repos are available to your account in this organization.',
          description:
            'Repositories appear here once you have Read permission on at least one of them.',
          hint:
            this.scope.kind === 'project'
              ? 'Switch the scope to “All projects” to look across the whole organization.'
              : undefined,
          actionLabel: 'Retry',
          onAction: this.onRefresh,
        }),
      ]);
      return;
    }

    const derived = this.derived();
    clear(content);

    if (derived.contributors.length === 0) {
      content.appendChild(
        renderEmptyState({
          title: 'Choose contributors to compare.',
          description: 'Open the Contributors dropdown and select one or more project members.',
        }),
      );
    } else {
      for (const contributor of derived.contributors) {
        const name =
          contributor.member.displayName ||
          contributor.member.uniqueName ||
          contributor.member.id;
        const section = el('section', {
          className: 'ch-contributor',
          attrs: { 'aria-label': `${name} contribution summary` },
        });
        section.appendChild(
          el('div', { className: 'ch-contributor__header' }, [
            el('h2', { className: 'ch-heading ch-contributor__name', text: name }),
            contributor.member.uniqueName && contributor.member.uniqueName !== name
              ? el('span', {
                  className: 'ch-contributor__identity',
                  text: contributor.member.uniqueName,
                })
              : null,
          ]),
        );
        section.appendChild(
          renderSummary(
            computeStatistics(contributor.contributions, derived.range, { today: todayKey() }),
            derived.range,
          ),
        );
        if (contributor.contributions.size === 0) {
          section.appendChild(
            el('p', {
              className: 'ch-contributor__empty',
              text: 'No commits found for this contributor in the selected period.',
            }),
          );
        }
        section.appendChild(
          renderHeatmap({
            grid: contributor.grid,
            thresholds: contributor.thresholds,
            usePatterns: this.state.preferences.usePatterns,
            selectedDate:
              this.state.selectedDateContributorId === contributor.member.id
                ? this.state.selectedDate
                : null,
            contributorName: name,
            onSelectDay: (date) => this.onSelectDay(date, contributor.member.id),
          }),
        );
        content.appendChild(section);
      }
    }

    content.appendChild(
      renderRepositoryTable({
        summaries: derived.summaries,
        sort: this.state.preferences.sort,
        selectedRepositoryId: this.state.selectedRepositoryId,
        onSortChange: this.onSortChange,
        onSelectRepository: this.onRepositoryChange,
      }),
    );
  }

  private renderStatusLine(): void {
    const parts: string[] = [];

    if (this.state.status === 'loading' && this.state.events.length > 0) {
      parts.push('Refreshing…');
    } else if (this.state.lastUpdated !== null) {
      parts.push(`Updated ${formatRelative(this.state.lastUpdated)}`);
    }

    if (this.state.repositories.length > 0) {
      parts.push(
        `${this.state.repositories.length} ${this.state.repositories.length === 1 ? 'repository' : 'repositories'} in scope`,
      );
    }

    this.regions.status.textContent = parts.join(' · ');
  }
}

/** Builds the static page chrome and returns the regions the app re-renders. */
function buildLayout(
  root: HTMLElement,
  context: AzureDevOpsContext,
): {
  toolbar: HTMLElement;
  notices: HTMLElement;
  content: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
} {
  clear(root);

  const status = el('p', {
    className: 'ch-header__status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });

  const header = el('header', { className: 'ch-header' }, [
    el('div', { className: 'ch-header__identity' }, [
      el('h1', { className: 'ch-header__title', text: 'Contribution Heatmap' }),
      el('p', {
        className: 'ch-header__subtitle',
        text: context.user.displayName
          ? `Commits by ${context.user.displayName}`
          : 'Your commits across Azure Repos',
      }),
    ]),
    status,
  ]);

  const toolbar = el('div', { className: 'ch-toolbar-host' });
  const notices = el('div', { className: 'ch-notices' });
  const content = el('main', { className: 'ch-content', attrs: { id: 'ch-content' } });
  const panel = el('div', { className: 'ch-panel-host' });

  root.appendChild(header);
  root.appendChild(toolbar);
  root.appendChild(notices);
  root.appendChild(content);
  root.appendChild(panel);

  return { toolbar, notices, content, panel, status };
}
