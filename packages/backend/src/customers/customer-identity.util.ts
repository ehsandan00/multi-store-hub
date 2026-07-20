/** Normalize email for cross-site duplicate matching. */
export function normalizeCustomerEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const n = email.trim().toLowerCase();
  return n.length > 0 ? n : null;
}

/** Normalize phone to digits only; returns null if too short to match. */
export function normalizeCustomerPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

export type CustomerMatchType = 'email' | 'phone';

export interface CrossSiteDuplicateGroup {
  matchKey: string;
  matchType: CustomerMatchType;
  customers: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    siteId: string | null;
    siteName: string | null;
  }>;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  siteId: string | null;
  siteName: string | null;
}

/** Build duplicate groups where the same email or phone appears on 2+ sites. */
export function findCrossSiteDuplicateGroups(
  rows: CustomerRow[],
): CrossSiteDuplicateGroup[] {
  const emailMap = new Map<string, CustomerRow[]>();
  const phoneMap = new Map<string, CustomerRow[]>();

  for (const row of rows) {
    const emailKey = normalizeCustomerEmail(row.email);
    if (emailKey) {
      const list = emailMap.get(emailKey) ?? [];
      list.push(row);
      emailMap.set(emailKey, list);
    }
    const phoneKey = normalizeCustomerPhone(row.phone);
    if (phoneKey) {
      const list = phoneMap.get(phoneKey) ?? [];
      list.push(row);
      phoneMap.set(phoneKey, list);
    }
  }

  const groups: CrossSiteDuplicateGroup[] = [];

  for (const [matchKey, customers] of emailMap) {
    const siteIds = new Set(customers.map((c) => c.siteId).filter(Boolean));
    if (siteIds.size > 1) {
      groups.push({ matchKey, matchType: 'email', customers });
    }
  }

  for (const [matchKey, customers] of phoneMap) {
    const siteIds = new Set(customers.map((c) => c.siteId).filter(Boolean));
    if (siteIds.size > 1) {
      groups.push({ matchKey, matchType: 'phone', customers });
    }
  }

  groups.sort((a, b) => a.matchType.localeCompare(b.matchType) || a.matchKey.localeCompare(b.matchKey));
  return groups;
}

/** Customer ids that participate in any cross-site duplicate group. */
export function crossSiteDuplicateCustomerIds(groups: CrossSiteDuplicateGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const c of g.customers) ids.add(c.id);
  }
  return ids;
}
