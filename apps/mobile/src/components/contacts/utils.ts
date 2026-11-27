import type { ContactView, Policy } from '@chappie/shared';

export type ContactMode = 'manual' | 'draft' | 'auto' | 'off';

export function displayName(c: ContactView): string {
  return c.alias?.trim() || c.user.name;
}

export function contactPolicy(policies: Policy[], peerId: string): Policy | undefined {
  return policies.find((p) => p.scopeType === 'contact' && p.scopeId === peerId);
}
