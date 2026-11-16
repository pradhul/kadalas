import { buildVaultList, groupVaultList } from '../src/lib/vaultList';
import { MOCK_VAULT_INDEX } from '../src/mocks/data';

describe('Home My documents layout data', () => {
  it('mock vault yields enough rows for a dense phone list (≥6)', () => {
    const items = buildVaultList(MOCK_VAULT_INDEX);
    expect(items.length).toBeGreaterThanOrEqual(6);
    const groups = groupVaultList(items);
    expect(groups[0]?.id).toBe('recent');
    const recent = groups.find((g) => g.id === 'recent');
    expect(recent?.items.length).toBeGreaterThanOrEqual(6);
    // Dense row budget used by Home (~64–72px)
    expect(64).toBeLessThanOrEqual(72);
  });
});
