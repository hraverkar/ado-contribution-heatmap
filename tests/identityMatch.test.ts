import { describe, expect, it } from 'vitest';

import type { CurrentUser } from '../src/models/user.js';
import {
  buildIdentitySet,
  emailLocalPart,
  isEmailLike,
  matchesIdentity,
  normalizeIdentityValue,
  stripSubaddress,
  MAX_QUERY_ALIASES,
} from '../src/util/identityMatch.js';

const user: CurrentUser = {
  id: '11111111-2222-3333-4444-555555555555',
  uniqueName: 'Ada.Lovelace@Example.com',
  displayName: 'Ada Lovelace',
  descriptor: 'aad.YWJjZGVm',
  imageUrl: '',
};

describe('normalizeIdentityValue', () => {
  it('lower-cases, trims and collapses whitespace', () => {
    expect(normalizeIdentityValue('  Ada   Lovelace ')).toBe('ada lovelace');
    expect(normalizeIdentityValue('ADA@EXAMPLE.COM')).toBe('ada@example.com');
  });

  it('returns an empty string for non-strings', () => {
    expect(normalizeIdentityValue(undefined)).toBe('');
    expect(normalizeIdentityValue(null)).toBe('');
    expect(normalizeIdentityValue(42)).toBe('');
  });
});

describe('isEmailLike', () => {
  it('recognises addresses and rejects names', () => {
    expect(isEmailLike('ada@example.com')).toBe(true);
    expect(isEmailLike('ada lovelace')).toBe(false);
    expect(isEmailLike('@example.com')).toBe(false);
    expect(isEmailLike('ada@')).toBe(false);
  });
});

describe('stripSubaddress', () => {
  it('removes a plus tag', () => {
    expect(stripSubaddress('ada+work@example.com')).toBe('ada@example.com');
  });

  it('returns null when there is nothing to strip', () => {
    expect(stripSubaddress('ada@example.com')).toBeNull();
    expect(stripSubaddress('ada lovelace')).toBeNull();
  });
});

describe('emailLocalPart', () => {
  it('extracts the part before @, without any tag', () => {
    expect(emailLocalPart('ada@example.com')).toBe('ada');
    expect(emailLocalPart('ada+work@example.com')).toBe('ada');
  });

  it('returns null for non-emails', () => {
    expect(emailLocalPart('ada lovelace')).toBeNull();
  });
});

describe('buildIdentitySet', () => {
  it('derives query aliases from the profile', () => {
    const identity = buildIdentitySet(user);
    expect(identity.queryAliases).toEqual(['Ada.Lovelace@Example.com', 'Ada Lovelace']);
  });

  it('matches case-insensitively', () => {
    const identity = buildIdentitySet(user);
    expect(identity.matchValues.has('ada.lovelace@example.com')).toBe(true);
    expect(identity.matchValues.has('ada lovelace')).toBe(true);
  });

  it('includes the identity GUID', () => {
    const identity = buildIdentitySet(user);
    expect(identity.matchValues.has(user.id.toLowerCase())).toBe(true);
  });

  it('appends custom aliases without duplicating existing ones', () => {
    const identity = buildIdentitySet(user, {
      customAliases: ['ada@personal.dev', 'ADA LOVELACE', '  '],
    });
    expect(identity.queryAliases).toEqual([
      'Ada.Lovelace@Example.com',
      'Ada Lovelace',
      'ada@personal.dev',
    ]);
    expect(identity.customAliases).toEqual(['ada@personal.dev', 'ADA LOVELACE']);
  });

  it('caps the number of server-side query aliases', () => {
    const identity = buildIdentitySet(user, {
      customAliases: Array.from({ length: 20 }, (_, index) => `alias${index}@example.com`),
    });
    expect(identity.queryAliases).toHaveLength(MAX_QUERY_ALIASES);
  });

  it('leaves local-part matching empty unless opted in', () => {
    expect(buildIdentitySet(user).matchLocalParts.size).toBe(0);
    expect(buildIdentitySet(user, { matchEmailLocalPart: true }).matchLocalParts.size).toBe(1);
  });

  it('tolerates a profile with missing fields', () => {
    const sparse: CurrentUser = { ...user, uniqueName: '', displayName: '' };
    const identity = buildIdentitySet(sparse);
    expect(identity.queryAliases).toEqual([]);
    expect(identity.matchValues.has(sparse.id.toLowerCase())).toBe(true);
  });
});

describe('matchesIdentity', () => {
  const identity = buildIdentitySet(user, { customAliases: ['ada@personal.dev'] });

  it('matches on email regardless of case', () => {
    expect(matchesIdentity(identity, { email: 'ADA.LOVELACE@EXAMPLE.COM' })).toBe(true);
    expect(matchesIdentity(identity, { email: 'ada.lovelace@example.com' })).toBe(true);
  });

  it('matches on author name when the email differs', () => {
    expect(matchesIdentity(identity, { name: 'Ada Lovelace', email: 'noreply@build.local' })).toBe(
      true,
    );
  });

  it('matches a configured alias', () => {
    expect(matchesIdentity(identity, { email: 'ada@personal.dev' })).toBe(true);
  });

  it('matches an address carrying a plus tag', () => {
    expect(matchesIdentity(identity, { email: 'ada.lovelace+ci@example.com' })).toBe(true);
  });

  it('rejects a different person', () => {
    expect(matchesIdentity(identity, { name: 'Grace Hopper', email: 'grace@example.com' })).toBe(
      false,
    );
  });

  it('rejects missing or empty author metadata', () => {
    expect(matchesIdentity(identity, {})).toBe(false);
    expect(matchesIdentity(identity, { name: '', email: '' })).toBe(false);
    expect(matchesIdentity(identity, { name: null, email: undefined })).toBe(false);
    expect(matchesIdentity(identity, { name: '   ' })).toBe(false);
  });

  it('does not match a different domain by default', () => {
    expect(matchesIdentity(identity, { email: 'ada.lovelace@other.com' })).toBe(false);
  });

  it('matches across domains when local-part matching is enabled', () => {
    const loose = buildIdentitySet(user, { matchEmailLocalPart: true });
    expect(matchesIdentity(loose, { email: 'ada.lovelace@example.onmicrosoft.com' })).toBe(true);
    expect(matchesIdentity(loose, { email: 'grace.hopper@example.com' })).toBe(false);
  });

  it('matches on the Azure DevOps identity id when present', () => {
    expect(matchesIdentity(identity, { identityId: user.id.toUpperCase() })).toBe(true);
  });
});
