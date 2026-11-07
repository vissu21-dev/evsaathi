/**
 * AI assistant tool ACL (P3-M06).
 * Hard deny vehicle/charger actuators — even if a human UI control path exists later.
 */

export type AiToolName =
  | 'search_stations'
  | 'explain_reliability'
  | 'estimate_trip_energy'
  | 'summarize_costs'
  | 'summarize_battery'
  | 'log_manual_soc'
  | 'draft_failure_report'
  | 'explain_data_freshness'
  | 'list_adapters';

/** Explicit deny list — schema-level rejection */
export const AI_DENIED_TOOLS = [
  'remote_charge_start',
  'remote_charge_stop',
  'set_connector_current',
  'unlock_cable',
  'vehicle_lock',
  'vehicle_unlock',
  'vehicle_climate',
  'vehicle_hvac',
  'drive_enable',
  'obd_write',
  'ecu_write',
  'precondition_start',
  'schedule_charge_write',
  'wallet_pay',
  'any_actuator',
] as const;

export type AiDeniedTool = (typeof AI_DENIED_TOOLS)[number];

export const AI_ALLOWED_TOOLS: readonly AiToolName[] = [
  'search_stations',
  'explain_reliability',
  'estimate_trip_energy',
  'summarize_costs',
  'summarize_battery',
  'log_manual_soc',
  'draft_failure_report',
  'explain_data_freshness',
  'list_adapters',
] as const;

export function isAiToolAllowed(name: string): name is AiToolName {
  return (AI_ALLOWED_TOOLS as readonly string[]).includes(name);
}

export function isAiToolDenied(name: string): name is AiDeniedTool {
  return (AI_DENIED_TOOLS as readonly string[]).includes(name);
}

export interface AiToolDecision {
  allowed: boolean;
  reason: string;
  tool: string;
}

export function decideAiTool(name: string): AiToolDecision {
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isAiToolDenied(normalized)) {
    return {
      allowed: false,
      tool: normalized,
      reason:
        'Hard deny: AI cannot issue vehicle or charger actuator commands. Use manual OEM/operator apps if authorized control is needed.',
    };
  }
  if (isAiToolAllowed(normalized)) {
    return {
      allowed: true,
      tool: normalized,
      reason: 'Allowlisted read / user-owned write tool',
    };
  }
  return {
    allowed: false,
    tool: normalized,
    reason: 'Unknown tool — default deny',
  };
}

export interface AiCitation {
  kind: 'fact' | 'estimate' | 'policy';
  data_label?: string;
  text: string;
}

export interface AiAssistantReply {
  answer: string;
  citations: AiCitation[];
  tools_used: string[];
  denied_attempts: string[];
  mode: 'deterministic' | 'llm_stub';
  disclaimer: string;
}
