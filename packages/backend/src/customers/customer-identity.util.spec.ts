import {
  findCrossSiteDuplicateGroups,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
} from './customer-identity.util';

describe('customer-identity.util', () => {
  it('normalizes email and phone', () => {
    expect(normalizeCustomerEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeCustomerPhone('+98 912 345 6789')).toBe('989123456789');
    expect(normalizeCustomerPhone('123')).toBeNull();
  });

  it('finds email duplicates across different sites only', () => {
    const groups = findCrossSiteDuplicateGroups([
      {
        id: '1',
        name: 'A',
        email: 'same@test.com',
        phone: null,
        siteId: 's1',
        siteName: 'Site 1',
      },
      {
        id: '2',
        name: 'B',
        email: 'same@test.com',
        phone: null,
        siteId: 's2',
        siteName: 'Site 2',
      },
      {
        id: '3',
        name: 'C',
        email: 'same@test.com',
        phone: null,
        siteId: 's1',
        siteName: 'Site 1',
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchType).toBe('email');
    expect(groups[0].customers).toHaveLength(3);
  });

  it('ignores same-site-only matches', () => {
    const groups = findCrossSiteDuplicateGroups([
      {
        id: '1',
        name: 'A',
        email: 'x@test.com',
        phone: '09121234567',
        siteId: 's1',
        siteName: 'Site 1',
      },
      {
        id: '2',
        name: 'B',
        email: 'x@test.com',
        phone: '09121234567',
        siteId: 's1',
        siteName: 'Site 1',
      },
    ]);
    expect(groups).toHaveLength(0);
  });

  it('finds phone duplicates across sites', () => {
    const groups = findCrossSiteDuplicateGroups([
      {
        id: '1',
        name: 'A',
        email: null,
        phone: '0912-111-2222',
        siteId: 's1',
        siteName: 'S1',
      },
      {
        id: '2',
        name: 'B',
        email: null,
        phone: '09121112222',
        siteId: 's2',
        siteName: 'S2',
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchType).toBe('phone');
  });
});
