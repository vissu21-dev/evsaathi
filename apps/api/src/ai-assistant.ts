import {
  decideAiTool,
  estimateRange,
  estimateTripEnergy,
  type AiAssistantReply,
  type AiCitation,
} from '@evsaathi/shared';
import { prisma } from './prisma';
import { catalogAdapters } from './adapters/registry';
import { buildDashboard, effectiveSpec, getVehicleForUser, parseJson } from './vehicle-helpers';
import { reliabilitySummary } from './reliability-service';

async function audit(
  userId: string,
  tool: string,
  allowed: boolean,
  reason: string,
  args: unknown,
  result: unknown,
) {
  await prisma.aiToolAudit.create({
    data: {
      userId,
      tool,
      allowed,
      reason,
      argsJson: JSON.stringify(args ?? {}),
      resultJson: JSON.stringify(result ?? {}),
    },
  });
}

export async function runAiAssistant(input: {
  userId: string;
  vehicleId?: string | null;
  message: string;
  requestedTools?: string[];
}): Promise<AiAssistantReply> {
  const denied: string[] = [];
  const used: string[] = [];
  const citations: AiCitation[] = [];
  const tools = input.requestedTools?.length
    ? input.requestedTools
    : inferTools(input.message);

  const toolResults: Record<string, unknown> = {};

  for (const raw of tools) {
    const decision = decideAiTool(raw);
    if (!decision.allowed) {
      denied.push(decision.tool);
      await audit(input.userId, decision.tool, false, decision.reason, { message: input.message }, null);
      continue;
    }

    const result = await executeTool(decision.tool, {
      userId: input.userId,
      vehicleId: input.vehicleId,
      message: input.message,
    });
    used.push(decision.tool);
    toolResults[decision.tool] = result.data;
    citations.push(...result.citations);
    await audit(
      input.userId,
      decision.tool,
      true,
      decision.reason,
      { message: input.message },
      result.data,
    );
  }

  const answer = composeAnswer({
    message: input.message,
    toolResults,
    denied,
    citations,
  });

  return {
    answer,
    citations,
    tools_used: used,
    denied_attempts: denied,
    mode: 'deterministic',
    disclaimer:
      'EVSaathi AI is explainable and non-actuating. Facts vs estimates are cited. Demo adapters are never LIVE. Actuator tools are hard-denied.',
  };
}

function inferTools(message: string): string[] {
  const m = message.toLowerCase();
  const tools: string[] = [];
  if (/unlock|lock|climate|hvac|remote.?start|remote.?stop|actuator|ecu|obd.?write|charge.?command/.test(m)) {
    // Intentionally request a denied tool so ACL is exercised & audited
    if (/unlock|lock/.test(m)) tools.push('vehicle_unlock');
    if (/climate|hvac/.test(m)) tools.push('vehicle_climate');
    if (/remote.?start|start.?charge|charge.?command/.test(m)) tools.push('remote_charge_start');
    if (/remote.?stop|stop.?charge/.test(m)) tools.push('remote_charge_stop');
  }
  if (/station|charger|nearby|map/.test(m)) tools.push('search_stations');
  if (/reliab|score|failure|report/.test(m)) tools.push('explain_reliability');
  if (/trip|range|energy|destination/.test(m)) tools.push('estimate_trip_energy');
  if (/cost|spend|₹|rupee|bill/.test(m)) tools.push('summarize_costs');
  if (/battery|soc|consumption|efficiency/.test(m)) tools.push('summarize_battery');
  if (/fresh|sync|live|adapter|oem|integrat/.test(m)) tools.push('explain_data_freshness');
  if (/adapter|integration|consent/.test(m)) tools.push('list_adapters');
  if (/log.?soc|update.?soc|enter.?soc/.test(m)) tools.push('log_manual_soc');
  if (/draft.?report|report.?failure/.test(m)) tools.push('draft_failure_report');
  if (tools.length === 0) {
    tools.push('summarize_battery', 'explain_data_freshness');
  }
  return [...new Set(tools)];
}

async function executeTool(
  tool: string,
  ctx: { userId: string; vehicleId?: string | null; message: string },
): Promise<{ data: unknown; citations: AiCitation[] }> {
  const citations: AiCitation[] = [];

  switch (tool) {
    case 'list_adapters': {
      const cat = catalogAdapters();
      citations.push({
        kind: 'policy',
        text: 'Demo OEM/operator adapters are simulated — never claim LIVE without a real authorized feed.',
      });
      return { data: cat, citations };
    }
    case 'explain_data_freshness': {
      if (!ctx.vehicleId) {
        return {
          data: { note: 'No vehicle selected' },
          citations: [{ kind: 'policy', text: 'Select a vehicle to inspect freshness.' }],
        };
      }
      const dash = await buildDashboard(ctx.vehicleId, ctx.userId);
      citations.push({
        kind: 'fact',
        data_label: dash?.data_label,
        text: `Latest observation label: ${dash?.data_label ?? 'unknown'}; OEM link: ${dash?.connectivity.oem_link_status}`,
      });
      return {
        data: {
          data_label: dash?.data_label,
          last_sync_at: dash?.connectivity.last_sync_at,
          oem_link_status: dash?.connectivity.oem_link_status,
          labels_note: dash?.labels_note,
        },
        citations,
      };
    }
    case 'summarize_battery': {
      if (!ctx.vehicleId) {
        return { data: { note: 'No vehicle' }, citations: [] };
      }
      const dash = await buildDashboard(ctx.vehicleId, ctx.userId);
      citations.push({
        kind: dash?.data_label === 'estimated' ? 'estimate' : 'fact',
        data_label: dash?.data_label,
        text: `SOC ${dash?.soc_percent ?? 'n/a'}% · range ${dash?.range_km ?? 'n/a'} km`,
      });
      return {
        data: {
          soc_percent: dash?.soc_percent,
          range_km: dash?.range_km,
          consumption_kwh_per_100km: dash?.consumption_recent_kwh_per_100km,
          data_label: dash?.data_label,
        },
        citations,
      };
    }
    case 'summarize_costs': {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const costs = await prisma.costRecord.findMany({
        where: {
          userId: ctx.userId,
          recordedAt: { gte: since },
          ...(ctx.vehicleId ? { vehicleId: ctx.vehicleId } : {}),
        },
      });
      const total = costs.reduce((s, c) => s + c.amountPaise, 0);
      citations.push({
        kind: 'fact',
        data_label: 'manually_entered',
        text: `Last 30d spend ₹${(total / 100).toFixed(0)} from ${costs.length} cost records`,
      });
      return {
        data: { total_paise: total, count: costs.length, period_days: 30 },
        citations,
      };
    }
    case 'search_stations': {
      const stations = await prisma.station.findMany({
        where: { deletedAt: null },
        include: { connectors: true, operator: true },
        take: 5,
        orderBy: { name: 'asc' },
      });
      citations.push({
        kind: 'fact',
        data_label: 'estimated',
        text: 'Station directory from seeded/demo catalog — not live operator availability',
      });
      return {
        data: {
          stations: stations.map((s) => ({
            id: s.id,
            name: s.name,
            city: s.city,
            is_demo: s.isDemo,
            max_kw: Math.max(0, ...s.connectors.map((c) => c.powerKw)),
          })),
        },
        citations,
      };
    }
    case 'explain_reliability': {
      const station = await prisma.station.findFirst({
        where: { deletedAt: null },
        orderBy: { reliabilityScore: 'desc' },
      });
      if (!station) {
        return { data: { note: 'No stations' }, citations: [] };
      }
      const summary = reliabilitySummary(station);
      citations.push({
        kind: 'estimate',
        data_label: 'estimated',
        text: `${station.name} crowdsource score ${summary?.score ?? 'n/a'} — not operator telemetry`,
      });
      return { data: { station_id: station.id, name: station.name, reliability: summary }, citations };
    }
    case 'estimate_trip_energy': {
      if (!ctx.vehicleId) {
        return { data: { note: 'No vehicle' }, citations: [] };
      }
      const vehicle = await getVehicleForUser(ctx.vehicleId, ctx.userId);
      if (!vehicle) return { data: { note: 'Vehicle missing' }, citations: [] };
      const spec = effectiveSpec(vehicle);
      const latest = await prisma.telemetry.findFirst({
        where: { vehicleId: vehicle.id },
        orderBy: { observedAt: 'desc' },
      });
      const soc = latest?.socPercent ?? 70;
      const trip = estimateTripEnergy({
        distanceKm: 120,
        socStartPercent: soc,
        targetSocArrivalPercent: 20,
        usableKwh: spec.usableKwh,
        efficiencyWhPerKm: spec.efficiencyWhPerKmHighway,
      });
      const range = estimateRange({
        socPercent: soc,
        usableKwh: spec.usableKwh,
        efficiencyWhPerKm: spec.efficiencyWhPerKmHighway,
      });
      citations.push({
        kind: 'estimate',
        data_label: 'estimated',
        text: `Example 120 km trip from ${soc}% SOC → dest SOC ${trip.destSocPercent}% (estimated)`,
      });
      return {
        data: { example_distance_km: 120, soc_start: soc, trip, range_km: range.rangeKmWithReserve },
        citations,
      };
    }
    case 'log_manual_soc': {
      citations.push({
        kind: 'policy',
        text: 'SOC write requires explicit user confirmation in the Update SOC screen — AI only drafts guidance.',
      });
      return {
        data: {
          action: 'confirm_required',
          deep_link: '/log-soc',
          note: 'Open Update SOC to enter a value. AI will not invent LIVE SOC.',
        },
        citations,
      };
    }
    case 'draft_failure_report': {
      citations.push({
        kind: 'policy',
        text: 'Failure reports need user confirm submit on the station detail screen.',
      });
      return {
        data: {
          draft: {
            category: 'charger_dead',
            severity: 'medium',
            description: 'Draft from AI — user must review and submit',
          },
          confirm_required: true,
        },
        citations,
      };
    }
    default:
      return { data: { note: 'Unhandled allowlisted tool' }, citations: [] };
  }
}

function composeAnswer(input: {
  message: string;
  toolResults: Record<string, unknown>;
  denied: string[];
  citations: AiCitation[];
}): string {
  const parts: string[] = [];

  if (input.denied.length) {
    parts.push(
      `I cannot run actuator tools (${input.denied.join(', ')}). EVSaathi AI never unlocks, climates, or remote-starts vehicles/chargers.`,
    );
  }

  if (input.toolResults.summarize_battery) {
    const b = input.toolResults.summarize_battery as {
      soc_percent: number | null;
      range_km: number | null;
      data_label: string;
    };
    parts.push(
      `Battery snapshot: SOC ${b.soc_percent ?? 'unknown'}%, estimated range ${b.range_km ?? 'n/a'} km (label: ${b.data_label}).`,
    );
  }

  if (input.toolResults.explain_data_freshness) {
    const f = input.toolResults.explain_data_freshness as {
      oem_link_status?: string;
      data_label?: string;
      labels_note?: string;
    };
    parts.push(
      `Freshness: OEM link ${f.oem_link_status ?? 'none'}, data label ${f.data_label ?? 'n/a'}. ${f.labels_note ?? ''}`,
    );
  }

  if (input.toolResults.summarize_costs) {
    const c = input.toolResults.summarize_costs as { total_paise: number; count: number };
    parts.push(`Last 30 days: ₹${(c.total_paise / 100).toFixed(0)} across ${c.count} cost records (manual/imported).`);
  }

  if (input.toolResults.search_stations) {
    const s = input.toolResults.search_stations as {
      stations: Array<{ name: string; is_demo: boolean }>;
    };
    parts.push(
      `Sample stations: ${s.stations.map((x) => `${x.name}${x.is_demo ? ' [demo]' : ''}`).join('; ') || 'none'}.`,
    );
  }

  if (input.toolResults.estimate_trip_energy) {
    const t = input.toolResults.estimate_trip_energy as {
      trip: { destSocPercent: number; needsCharge: boolean; energyKwhEst: number };
    };
    parts.push(
      `Example trip energy ~${t.trip.energyKwhEst} kWh → arrival SOC ~${t.trip.destSocPercent}%${t.trip.needsCharge ? ' (needs charge)' : ''}. Estimate only.`,
    );
  }

  if (input.toolResults.list_adapters) {
    parts.push('Available adapters are demo/simulated stubs until a real partnership feed is authorized.');
  }

  if (input.toolResults.log_manual_soc) {
    parts.push('To update SOC, confirm in the Update SOC screen — I will not fabricate LIVE values.');
  }

  if (!parts.length) {
    parts.push(
      'Ask about battery, costs, stations, trip energy, adapters, or freshness. I explain with citations and refuse vehicle/charger commands.',
    );
  }

  return parts.join('\n\n');
}

export function parseJsonSafe<T>(raw: string, fallback: T): T {
  return parseJson(raw, fallback);
}
