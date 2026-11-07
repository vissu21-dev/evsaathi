import { describe, expect, it } from 'vitest';
import {
  AI_DENIED_TOOLS,
  decideAiTool,
  isAiToolAllowed,
  isAiToolDenied,
} from './ai-tools';

describe('AI tool ACL', () => {
  it('allows read / user-owned write tools', () => {
    expect(isAiToolAllowed('search_stations')).toBe(true);
    expect(decideAiTool('summarize_costs').allowed).toBe(true);
    expect(decideAiTool('log_manual_soc').allowed).toBe(true);
  });

  it('hard-denies vehicle and charger actuators', () => {
    for (const tool of AI_DENIED_TOOLS) {
      expect(isAiToolDenied(tool)).toBe(true);
      const d = decideAiTool(tool);
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/Hard deny/i);
    }
  });

  it('normalizes aliases and defaults unknown to deny', () => {
    expect(decideAiTool('Remote Charge Start').allowed).toBe(false);
    expect(decideAiTool('vehicle-unlock').allowed).toBe(false);
    expect(decideAiTool('hack_the_planet').allowed).toBe(false);
    expect(decideAiTool('hack_the_planet').reason).toMatch(/default deny/i);
  });
});
