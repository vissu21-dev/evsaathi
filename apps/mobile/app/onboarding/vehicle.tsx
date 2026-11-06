import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Banner, BrandMark, Button, Field, LoadingBlock, Screen } from '../../src/components';
import { useSession } from '../../src/session';
import { colors, fonts, spacing } from '../../src/theme';

type Spec = {
  id: string;
  make: string;
  model: string;
  variant: string;
  battery_kwh_stated: number;
  battery_kwh_usable: number | null;
  usable_equals_stated: boolean;
  efficiency_wh_per_km_highway: number;
  max_dc_kw: number;
  connector_types: string[];
};

export default function VehicleOnboarding() {
  const { setVehicleId, refreshVehicle } = useSession();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [nickname, setNickname] = useState('My 9S');
  const [usableOverride, setUsableOverride] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ data: Spec[] }>('/vehicle-specs', { auth: false });
        setSpecs(res.data);
        const xev = res.data.find((s) => s.model.includes('XEV 9S') && s.variant.includes('Pack 3'));
        setSelected(xev?.id || res.data[0]?.id || null);
        if (xev) setNickname(`Family ${xev.model}`);
      } catch (e: any) {
        setError(e.message || 'Failed to load vehicle catalog');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const overrides: Record<string, number | null> = {};
      if (usableOverride.trim()) {
        overrides.battery_kwh_usable = Number(usableOverride);
      }
      const res = await api<{ id: string }>('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_spec_id: selected,
          nickname,
          is_primary: true,
          spec_overrides: overrides,
        }),
      });
      await setVehicleId(res.id);
      await refreshVehicle();
    } catch (e: any) {
      setError(e.message || 'Could not save vehicle');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  const current = specs.find((s) => s.id === selected);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <BrandMark />
        <Text style={styles.title}>Configure your EV</Text>
        <Text style={styles.sub}>
          Seed includes Mahindra XEV 9S Pack 3 (79 kWh stated). Specs are editable — never hardcoded as live OEM.
        </Text>

        <Banner text="Usable kWh is separate from stated pack size. Override if your real usable differs." />
        {error ? <Banner tone="warn" text={error} /> : null}

        <Field label="Nickname" value={nickname} onChangeText={setNickname} />

        <Text style={styles.label}>Vehicle profile</Text>
        <View style={{ gap: 8, marginBottom: 16 }}>
          {specs.map((s) => {
            const active = s.id === selected;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSelected(s.id)}
                style={[styles.card, active && styles.cardActive]}
              >
                <Text style={styles.cardTitle}>
                  {s.make} {s.model} · {s.variant}
                </Text>
                <Text style={styles.cardMeta}>
                  Stated {s.battery_kwh_stated} kWh
                  {s.battery_kwh_usable != null ? ` · usable ${s.battery_kwh_usable} kWh` : ''}
                  {' · '}
                  DC {s.max_dc_kw} kW · {s.connector_types.join(', ')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {current ? (
          <Banner
            text={
              current.usable_equals_stated
                ? 'Catalog flags usable = stated for this row.'
                : `Usable ${current.battery_kwh_usable ?? 'unknown'} kWh (not silently equal to stated ${current.battery_kwh_stated}).`
            }
          />
        ) : null}

        <Field
          label="Override usable kWh (optional)"
          value={usableOverride}
          onChangeText={setUsableOverride}
          keyboardType="decimal-pad"
          placeholder="e.g. 72.68"
        />

        <Button title="Save vehicle & open dashboard" onPress={save} loading={saving} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontSize: 26,
    marginTop: spacing[4],
    marginBottom: 8,
  },
  sub: {
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    marginBottom: spacing[4],
    lineHeight: 20,
  },
  label: {
    fontFamily: fonts.sansMed,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 14,
  },
  cardActive: {
    borderColor: colors.teal400,
  },
  cardTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardMeta: {
    fontFamily: fonts.sans,
    color: colors.textTertiary,
    fontSize: 13,
  },
});
