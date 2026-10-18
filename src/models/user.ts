/**
 * The authenticated Azure DevOps user, plus every string we are willing to
 * treat as "this is me" when matching commit authorship.
 */
export interface CurrentUser {
  /** Azure DevOps identity GUID. */
  readonly id: string;
  /** Login / unique name, normally the user's email address. */
  readonly uniqueName: string;
  /** Display name ("First Last"). */
  readonly displayName: string;
  /** Identity descriptor, e.g. `aad.<base64>`. */
  readonly descriptor: string;
  /** Avatar URL supplied by the host. */
  readonly imageUrl: string;
}

/**
 * A case-insensitive set of author identifiers belonging to the current user.
 *
 * `queryAliases` are sent to Azure DevOps as `searchCriteria.author` values;
 * `matchValues` is the (larger) set used to verify returned commits locally,
 * so a mis-scoped server-side match can never inflate someone's calendar.
 */
export interface IdentitySet {
  readonly user: CurrentUser;
  /** Aliases used for server-side `searchCriteria.author` queries. */
  readonly queryAliases: readonly string[];
  /** Normalised values accepted when verifying a commit author locally. */
  readonly matchValues: ReadonlySet<string>;
  /**
   * Email local parts accepted as a match. Populated only when the user opts
   * into looser matching; empty otherwise.
   */
  readonly matchLocalParts: ReadonlySet<string>;
  /** Extra aliases the user configured manually. */
  readonly customAliases: readonly string[];
}
