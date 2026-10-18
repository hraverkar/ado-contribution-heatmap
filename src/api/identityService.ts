/**
 * Resolves the identity used to attribute commits to the current user.
 *
 * The authenticated identity comes straight from the host frame, so there is no
 * REST call and no additional permission scope involved. Optional user-supplied
 * aliases widen matching for people whose Git `user.email` differs from their
 * Azure DevOps profile.
 */

import type { IdentitySet } from '../models/user.js';
import type { CurrentUser } from '../models/user.js';
import { buildIdentitySet } from '../util/identityMatch.js';

export interface IdentityOptions {
  readonly customAliases?: readonly string[];
  readonly matchEmailLocalPart?: boolean;
}

export function resolveIdentity(user: CurrentUser, options: IdentityOptions = {}): IdentitySet {
  return buildIdentitySet(user, {
    customAliases: options.customAliases ?? [],
    matchEmailLocalPart: options.matchEmailLocalPart ?? false,
  });
}

/** Short, user-facing description of how commits are being matched. */
export function describeIdentity(identity: IdentitySet): string {
  const aliases = identity.queryAliases;
  if (aliases.length === 0) {
    return 'No author aliases are configured.';
  }
  return `Matching commits authored by: ${aliases.join(', ')}`;
}
