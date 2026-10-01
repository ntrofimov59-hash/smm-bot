import { describe, it, expect } from 'vitest';
import { toQueueAccountRef, stripTokensFromItem } from '../../agent/accounts-resolver.js';

describe('accounts-resolver', () => {
  it('toQueueAccountRef omits accessToken', () => {
    const ref = toQueueAccountRef({
      username: 'x',
      igUserId: '1',
      accessToken: 'SECRET',
      city: 'yerevan',
    });
    expect(ref.accessToken).toBeUndefined();
    expect(ref.username).toBe('x');
    expect(ref.city).toBe('yerevan');
  });

  it('stripTokensFromItem removes tokens', () => {
    const item = {
      id: '1',
      accounts: [{ username: 'a', igUserId: '1', accessToken: 'SECRET', city: 'bali' }],
    };
    const next = stripTokensFromItem(item);
    expect(next.accounts[0].accessToken).toBeUndefined();
    expect(next.accounts[0].username).toBe('a');
  });
});
