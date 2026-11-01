import { sectorAllowsCustomRequests } from './marketplace-sector.entity';

describe('sectorAllowsCustomRequests', () => {
  it('only an ACTIVE sector with the admin switch ON allows custom requests', () => {
    expect(sectorAllowsCustomRequests({ isActive: true, customRequestsEnabled: true })).toBe(true);
    expect(sectorAllowsCustomRequests({ isActive: true, customRequestsEnabled: false })).toBe(false); // the default
    expect(sectorAllowsCustomRequests({ isActive: false, customRequestsEnabled: true })).toBe(false);
  });

  it('a branch with no sector can never establish suitability', () => {
    expect(sectorAllowsCustomRequests(null)).toBe(false);
    expect(sectorAllowsCustomRequests(undefined)).toBe(false);
  });

  it('an unset flag (a row loaded without it) is not "on"', () => {
    expect(sectorAllowsCustomRequests({ isActive: true } as any)).toBe(false);
  });
});
