/**
 * Normalised commit record. This is the only commit shape the rest of the
 * application sees; the raw Azure DevOps payload never escapes `src/api`.
 *
 * Only metadata required by the calendar is retained. File contents, diffs and
 * change details are never requested.
 */
export interface CommitRecord {
  /** Full commit SHA. */
  readonly id: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Local calendar day, `YYYY-MM-DD`, derived from {@link timestamp}. */
  readonly date: string;
  /** Epoch milliseconds of the commit's author date. */
  readonly timestamp: number;
  /** First line of the commit message, trimmed. */
  readonly message: string;
  /** Azure DevOps web URL for the commit, or an empty string if unavailable. */
  readonly url: string;
}
