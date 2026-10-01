import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('orchestrator getModuleFlags', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults: smm/outreach on, supplier only with token', async () => {
    vi.stubEnv('SUPPLIER_BOT_TOKEN', '');
    const { getModuleFlags } = await import('../../agent/orchestrator.js');
    const f = getModuleFlags();
    expect(f.smm).toBe(true);
    expect(f.outreach).toBe(true);
    expect(f.supplier).toBe(false);
  });

  it('supplier on when token set', async () => {
    vi.stubEnv('SUPPLIER_BOT_TOKEN', '123:ABC');
    vi.stubEnv('ENABLE_SUPPLIER_BOT', '1');
    const { getModuleFlags } = await import('../../agent/orchestrator.js');
    expect(getModuleFlags().supplier).toBe(true);
  });

  it('ENABLE_*=0 disables modules', async () => {
    vi.stubEnv('ENABLE_SMM', '0');
    vi.stubEnv('ENABLE_OUTREACH', 'false');
    vi.stubEnv('ENABLE_SUPPLIER_BOT', 'off');
    vi.stubEnv('SUPPLIER_BOT_TOKEN', '123:ABC');
    const { getModuleFlags } = await import('../../agent/orchestrator.js');
    const f = getModuleFlags();
    expect(f.smm).toBe(false);
    expect(f.outreach).toBe(false);
    expect(f.supplier).toBe(false);
  });
});
