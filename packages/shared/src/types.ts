/** Data provenance labels — never invent LIVE without a real feed. */
export type DataSourceLabel =
  | 'live'
  | 'recently_synchronized'
  | 'manually_entered'
  | 'imported'
  | 'estimated';

export type DataSourceChip = 'LIVE' | 'SYNCED' | 'MANUAL' | 'IMPORT' | 'EST.';

export const DATA_LABEL_CHIP: Record<DataSourceLabel, DataSourceChip> = {
  live: 'LIVE',
  recently_synchronized: 'SYNCED',
  manually_entered: 'MANUAL',
  imported: 'IMPORT',
  estimated: 'EST.',
};

export interface VehicleSpecConfig {
  battery_kwh_stated: number;
  battery_kwh_gross?: number | null;
  battery_kwh_usable?: number | null;
  usable_equals_stated?: boolean;
  efficiency_wh_per_km_city: number;
  efficiency_wh_per_km_highway: number;
  max_ac_kw: number;
  max_dc_kw: number;
  connector_ac: string;
  connector_dc: string;
  connector_types: string[];
  recommended_charge_limit_percent: number;
  range_midc_km?: number | null;
}

export interface RangeEstimateInput {
  socPercent: number;
  usableKwh: number;
  /** Wh/km — documented assumption */
  efficiencyWhPerKm: number;
  /** Safety reserve SOC % withheld from "usable" range display */
  safetyReservePercent?: number;
}

export interface RangeEstimateResult {
  usableKwhAtSoc: number;
  rangeKm: number;
  rangeKmWithReserve: number;
  kwhPerKm: number;
  kwhPer100Km: number;
  confidence: number;
  assumptions: string[];
  data_label: 'estimated';
}

export interface ChargeCostInput {
  energyKwh: number;
  /** INR paise per kWh */
  energyRatePaisePerKwh: number;
  sessionFeePaise?: number;
  /** Optional idle minutes × rate */
  idleMinutes?: number;
  idleFeePaisePerMin?: number;
  /** AC/home losses factor, e.g. 1.08 = 8% loss */
  lossFactor?: number;
}

export interface ChargeCostResult {
  energyKwhDelivered: number;
  energyKwhFromGrid: number;
  energyCostPaise: number;
  sessionFeePaise: number;
  idleCostPaise: number;
  totalCostPaise: number;
  totalCostInr: number;
  data_label: 'estimated';
}

export interface TripEnergyInput {
  distanceKm: number;
  socStartPercent: number;
  targetSocArrivalPercent: number;
  usableKwh: number;
  efficiencyWhPerKm: number;
  safetyReservePercent?: number;
  /** AC load adder Wh/km */
  cabinAcWhPerKm?: number;
  loadKg?: number;
}

export interface TripEnergyResult {
  energyKwhEst: number;
  destSocPercent: number;
  needsCharge: boolean;
  chargeKwhNeeded: number;
  confidence: number;
  safetyReservePercent: number;
  disclaimer: string;
  data_label: 'estimated';
}

export interface ChargeTimeInput {
  socStart: number;
  socTarget: number;
  usableKwh: number;
  chargerKw: number;
  /** Simple taper: effective power = chargerKw * taperFactor above taperStartSoc */
  taperStartSoc?: number;
  taperFactor?: number;
}

export interface ChargeTimeResult {
  energyKwh: number;
  durationMin: number;
  avgPowerKw: number;
  data_label: 'estimated';
}
