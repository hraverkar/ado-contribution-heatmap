/** A single Azure Repos Git repository the current user can read. */
export interface Repository {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Browser URL of the repository, used to build commit deep links. */
  readonly webUrl: string;
  /** Repositories marked disabled by Azure DevOps cannot be queried. */
  readonly isDisabled: boolean;
  /** Repositories with no default branch have never received a commit. */
  readonly defaultBranch?: string;
  /** Approximate repository size in bytes, when reported. */
  readonly size?: number;
}
