/**
 * Identity matching between the authenticated Azure DevOps user and Git commit
 * authorship.
 *
 * Azure DevOps identities and Git commit authorship are separate namespaces: a
 * commit records whatever `user.name` / `user.email` the committer's Git client
 * was configured with, which frequently differs from the Azure DevOps profile.
 *
 * The strategy is therefore two-layered:
 *
 *  1. Server-side narrowing — `searchCriteria.author` is issued once per alias
 *     so Azure DevOps does the bulk filtering and we never download an entire
 *     repository's history.
 *  2. Local verification — every returned commit is re-checked against the full
 *     match set, so a loose or unexpected server-side match cannot attribute
 *     someone else's commit to the current user.
 *
 * Users whose Git email is unrelated to their Azure DevOps profile can add
 * aliases manually; those aliases feed both layers.
 */

import type { CurrentUser, IdentitySet } from '../models/user.js';

/** Maximum aliases issued as server-side queries, to bound request fan-out. */
export const MAX_QUERY_ALIASES = 6;

/** Lower-cases, trims and collapses internal whitespace. */
export function normalizeIdentityValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** `true` when the normalised value looks like an email address. */
export function isEmailLike(value: string): boolean {
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1 && !value.includes(' ');
}

/**
 * Removes an RFC 5233 sub-address (`first.last+tag@example.com` →
 * `first.last@example.com`). Returns `null` when there is nothing to strip.
 */
export function stripSubaddress(email: string): string | null {
  const at = email.indexOf('@');
  if (at <= 0) {
    return null;
  }
  const local = email.slice(0, at);
  const plus = local.indexOf('+');
  if (plus <= 0) {
    return null;
  }
  return `${local.slice(0, plus)}${email.slice(at)}`;
}

/** Returns the part before `@`, or `null` when the value is not email-like. */
export function emailLocalPart(value: string): string | null {
  if (!isEmailLike(value)) {
    return null;
  }
  const local = value.slice(0, value.indexOf('@'));
  const plus = local.indexOf('+');
  return plus > 0 ? local.slice(0, plus) : local;
}

export interface BuildIdentityOptions {
  /** Extra author names or emails supplied by the user. */
  readonly customAliases?: readonly string[];
  /**
   * When true, a commit whose author email shares its local part with one of
   * the user's known emails is treated as a match, regardless of domain. This
   * catches `me@corp.com` vs `me@corp.onmicrosoft.com` but is looser, so it is
   * opt-in.
   */
  readonly matchEmailLocalPart?: boolean;
}

/** Builds the identity set used for both querying and verification. */
export function buildIdentitySet(
  user: CurrentUser,
  options: BuildIdentityOptions = {},
): IdentitySet {
  const customAliases = dedupePreservingOrder(
    (options.customAliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0),
  );

  const seeds = [user.uniqueName, user.displayName, ...customAliases];

  const matchValues = new Set<string>();
  const matchLocalParts = new Set<string>();

  const addMatchValue = (raw: string): void => {
    const normalized = normalizeIdentityValue(raw);
    if (!normalized) {
      return;
    }
    matchValues.add(normalized);
    const withoutSubaddress = stripSubaddress(normalized);
    if (withoutSubaddress) {
      matchValues.add(withoutSubaddress);
    }
    if (options.matchEmailLocalPart) {
      const local = emailLocalPart(normalized);
      if (local) {
        matchLocalParts.add(local);
      }
    }
  };

  for (const seed of seeds) {
    addMatchValue(seed);
  }
  // The identity GUID appears in some Azure DevOps author payloads.
  addMatchValue(user.id);

  const queryAliases = dedupePreservingOrder(
    seeds.filter((seed) => normalizeIdentityValue(seed).length > 0),
    (value) => normalizeIdentityValue(value),
  ).slice(0, MAX_QUERY_ALIASES);

  return { user, queryAliases, matchValues, matchLocalParts, customAliases };
}

export interface CommitAuthorship {
  readonly name?: string | null;
  readonly email?: string | null;
  /** Azure DevOps identity id, when the commit could be resolved to one. */
  readonly identityId?: string | null;
}

/**
 * `true` when the given commit authorship belongs to the identity set.
 *
 * Missing or malformed author metadata never matches, so an unattributable
 * commit is excluded rather than silently credited.
 */
export function matchesIdentity(identity: IdentitySet, author: CommitAuthorship): boolean {
  const candidates = [author.email, author.name, author.identityId];

  for (const candidate of candidates) {
    const normalized = normalizeIdentityValue(candidate);
    if (!normalized) {
      continue;
    }
    if (identity.matchValues.has(normalized)) {
      return true;
    }
    const withoutSubaddress = stripSubaddress(normalized);
    if (withoutSubaddress && identity.matchValues.has(withoutSubaddress)) {
      return true;
    }
    if (identity.matchLocalParts.size > 0) {
      const local = emailLocalPart(normalized);
      if (local && identity.matchLocalParts.has(local)) {
        return true;
      }
    }
  }

  return false;
}

function dedupePreservingOrder(
  values: readonly string[],
  keyOf: (value: string) => string = (value) => value.toLowerCase(),
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}
