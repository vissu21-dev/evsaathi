import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Mahindra XEV 9S Pack 3 — configurable seed (stated 79 kWh; usable set explicitly)
  const xev9s = await prisma.vehicleSpec.upsert({
    where: {
      make_model_variant_modelYear: {
        make: 'Mahindra',
        model: 'XEV 9S',
        variant: 'Pack 3',
        modelYear: 2025,
      },
    },
    update: {},
    create: {
      make: 'Mahindra',
      model: 'XEV 9S',
      variant: 'Pack 3',
      modelYear: 2025,
      batteryKwhStated: 79,
      batteryKwhGross: 79,
      batteryKwhUsable: 72.68,
      usableEqualsStated: false,
      batteryChemistry: 'LFP',
      efficiencyWhPerKmCity: 165,
      efficiencyWhPerKmHighway: 185,
      maxAcKw: 11,
      maxDcKw: 140,
      connectorAc: 'Type2',
      connectorDc: 'CCS2',
      connectorTypesJson: JSON.stringify(['Type2', 'CCS2']),
      recommendedChargeLimitPercent: 100,
      rangeMidcKm: 542,
      source: 'oem_public',
      sourceMetadataJson: JSON.stringify({
        note: 'Seed profile — usable kWh is an explicit catalog value, not silently equal to stated 79',
        verification: 'admin_seed',
      }),
    },
  });

  // Extra catalog entries for multi-brand config support
  const extras = [
    {
      make: 'Tata',
      model: 'Curvv EV',
      variant: '55 kWh',
      modelYear: 2025,
      batteryKwhStated: 55,
      batteryKwhUsable: 51,
      efficiencyWhPerKmCity: 145,
      efficiencyWhPerKmHighway: 165,
      maxAcKw: 7.2,
      maxDcKw: 70,
      connectorAc: 'Type2',
      connectorDc: 'CCS2',
      rangeMidcKm: 502,
    },
    {
      make: 'MG',
      model: 'Windsor',
      variant: 'EV',
      modelYear: 2025,
      batteryKwhStated: 38,
      batteryKwhUsable: 34.5,
      efficiencyWhPerKmCity: 130,
      efficiencyWhPerKmHighway: 150,
      maxAcKw: 7.2,
      maxDcKw: 60,
      connectorAc: 'Type2',
      connectorDc: 'CCS2',
      rangeMidcKm: 331,
    },
  ];

  for (const e of extras) {
    await prisma.vehicleSpec.upsert({
      where: {
        make_model_variant_modelYear: {
          make: e.make,
          model: e.model,
          variant: e.variant,
          modelYear: e.modelYear,
        },
      },
      update: {},
      create: {
        ...e,
        usableEqualsStated: false,
        connectorTypesJson: JSON.stringify(['Type2', 'CCS2']),
        recommendedChargeLimitPercent: 80,
        source: 'manual_admin',
        sourceMetadataJson: JSON.stringify({ note: 'Catalog seed' }),
      },
    });
  }

  const operators = [
    { code: 'statiq', name: 'Statiq (demo)', website: 'https://statiq.in' },
    { code: 'tatapower', name: 'Tata Power EZ Charge (demo)', website: 'https://ezcharge.tatapower.com' },
    { code: 'pulse', name: 'Jio-bp pulse (demo)', website: 'https://www.jio-bp.in' },
    { code: 'chargezone', name: 'ChargeZone (demo)', website: 'https://www.chargezone.com' },
  ];

  const ops: Record<string, string> = {};
  for (const o of operators) {
    const row = await prisma.operator.upsert({
      where: { code: o.code },
      update: { name: o.name },
      create: {
        ...o,
        capabilitiesJson: JSON.stringify(['catalog']),
        status: 'active',
      },
    });
    ops[o.code] = row.id;
  }

  // Demo stations across Indian metros — clearly isDemo=true
  const stations = [
    {
      name: 'Demo · Statiq BKC Hub',
      operator: 'statiq',
      addressLine: 'G Block, Bandra Kurla Complex',
      city: 'Mumbai',
      state: 'MH',
      lat: 19.067, lng: 72.87,
      amenities: ['restroom', 'cafe', 'parking'],
      isOpen24x7: true,
      connectors: [
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
        { connectorType: 'Type2', powerKw: 22, currentType: 'ac' },
      ],
      ratePaise: 1800,
    },
    {
      name: 'Demo · Tata Power Andheri',
      operator: 'tatapower',
      addressLine: 'MIDC Andheri East',
      city: 'Mumbai',
      state: 'MH',
      lat: 19.113, lng: 72.869,
      amenities: ['parking'],
      isOpen24x7: false,
      connectors: [
        { connectorType: 'CCS2', powerKw: 50, currentType: 'dc' },
        { connectorType: 'Type2', powerKw: 7.2, currentType: 'ac' },
      ],
      ratePaise: 1650,
    },
    {
      name: 'Demo · pulse Lonavala Highway',
      operator: 'pulse',
      addressLine: 'Mumbai–Pune Expressway, Lonavala',
      city: 'Lonavala',
      state: 'MH',
      lat: 18.748, lng: 73.407,
      amenities: ['restroom', 'cafe', 'highway'],
      isOpen24x7: true,
      connectors: [
        { connectorType: 'CCS2', powerKw: 120, currentType: 'dc' },
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
      ],
      ratePaise: 2100,
    },
    {
      name: 'Demo · ChargeZone Hinjewadi',
      operator: 'chargezone',
      addressLine: 'Phase 1, Hinjewadi IT Park',
      city: 'Pune',
      state: 'MH',
      lat: 18.591, lng: 73.738,
      amenities: ['parking', 'cafe'],
      isOpen24x7: true,
      connectors: [
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
        { connectorType: 'Type2', powerKw: 22, currentType: 'ac' },
      ],
      ratePaise: 1700,
    },
    {
      name: 'Demo · Statiq Connaught Place',
      operator: 'statiq',
      addressLine: 'Outer Circle, Connaught Place',
      city: 'New Delhi',
      state: 'DL',
      lat: 28.631, lng: 77.217,
      amenities: ['parking', 'restroom'],
      isOpen24x7: false,
      connectors: [
        { connectorType: 'CCS2', powerKw: 30, currentType: 'dc' },
        { connectorType: 'Type2', powerKw: 22, currentType: 'ac' },
      ],
      ratePaise: 1900,
    },
    {
      name: 'Demo · Tata Power Koramangala',
      operator: 'tatapower',
      addressLine: '80 Feet Road, Koramangala',
      city: 'Bengaluru',
      state: 'KA',
      lat: 12.935, lng: 77.624,
      amenities: ['cafe', 'parking'],
      isOpen24x7: true,
      connectors: [
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
        { connectorType: 'CCS2', powerKw: 60, currentType: 'dc' },
      ],
      ratePaise: 1750,
    },
    {
      name: 'Demo · pulse Gurgaon Cyber Hub',
      operator: 'pulse',
      addressLine: 'DLF Cyber Hub',
      city: 'Gurugram',
      state: 'HR',
      lat: 28.495, lng: 77.089,
      amenities: ['cafe', 'parking', 'restroom'],
      isOpen24x7: true,
      connectors: [
        { connectorType: 'CCS2', powerKw: 140, currentType: 'dc' },
        { connectorType: 'Type2', powerKw: 22, currentType: 'ac' },
      ],
      ratePaise: 2200,
    },
    {
      name: 'Demo · ChargeZone Hyderabad Hitec',
      operator: 'chargezone',
      addressLine: 'Hitec City Main Road',
      city: 'Hyderabad',
      state: 'TS',
      lat: 17.448, lng: 78.382,
      amenities: ['parking'],
      isOpen24x7: false,
      connectors: [
        { connectorType: 'CCS2', powerKw: 50, currentType: 'dc' },
      ],
      ratePaise: 1600,
    },
  ];

  // Clear and reseed stations for idempotent demo
  await prisma.tariff.deleteMany();
  await prisma.connector.deleteMany();
  await prisma.station.deleteMany();

  for (const s of stations) {
    const station = await prisma.station.create({
      data: {
        operatorId: ops[s.operator],
        externalId: `demo-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: s.name,
        addressLine: s.addressLine,
        city: s.city,
        state: s.state,
        lat: s.lat,
        lng: s.lng,
        amenitiesJson: JSON.stringify(s.amenities),
        accessType: 'public',
        isOpen24x7: s.isOpen24x7,
        openingHoursJson: s.isOpen24x7
          ? JSON.stringify({ always: true })
          : JSON.stringify({ mon_sun: '08:00-22:00' }),
        status: 'active',
        source: 'admin',
        isDemo: true,
        sourceMetadataJson: JSON.stringify({
          label: 'demo',
          warning: 'Demo catalog — not live operator availability or prices',
        }),
        connectors: {
          create: s.connectors.map((c) => ({
            connectorType: c.connectorType,
            powerKw: c.powerKw,
            currentType: c.currentType,
            statusNominal: 'unknown',
          })),
        },
        tariffs: {
          create: [
            {
              pricingModel: 'per_kwh',
              energyRatePaise: s.ratePaise,
              sessionFeePaise: 0,
              source: 'admin',
            },
          ],
        },
      },
    });
    console.log('Seeded station', station.name);
  }

  console.log('Seeded vehicle spec', xev9s.make, xev9s.model, xev9s.variant);
  console.log('Demo OTP for auth stub: 123456 (also printed on request in server logs)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
