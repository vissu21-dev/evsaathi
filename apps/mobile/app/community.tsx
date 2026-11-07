import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../src/api';
import {
  Banner,
  BrandMark,
  Button,
  Chip,
  EmptyState,
  LoadingBlock,
  Screen,
  SectionTitle,
} from '../src/components';
import { colors, fonts, spacing } from '../src/theme';

type Space = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  kind: string;
  make?: string;
  model?: string;
};

type Post = {
  id: string;
  title: string;
  body: string;
  post_type: string;
  author_display: string;
  useful_count: number;
  vehicle: { make?: string | null; model?: string | null };
  space?: { slug: string; title: string };
  created_at: string;
};

type Reputation = {
  score: number;
  tier: string;
  display_label: string;
  daily_post_cap: number;
  verified_report_count: number;
  helpful_post_count: number;
};

export default function CommunityScreen() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [rep, setRep] = useState<Reputation | null>(null);
  const [spaceSlug, setSpaceSlug] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [postType, setPostType] = useState('tip');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, feed, r] = await Promise.all([
        api<{ data: Space[] }>('/community/spaces'),
        api<{ data: Post[] }>('/community/feed?limit=20'),
        api<Reputation>('/me/reputation'),
      ]);
      setSpaces(s.data);
      setPosts(feed.data);
      setRep(r);
      if (s.data[0] && !s.data.find((x) => x.slug === spaceSlug)) {
        setSpaceSlug(s.data[0].slug);
      }
    } catch (e: any) {
      setError(e.message || 'Community unavailable');
    } finally {
      setLoading(false);
    }
  }, [spaceSlug]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await api('/community/posts', {
        method: 'POST',
        body: JSON.stringify({
          space_slug: spaceSlug,
          post_type: postType,
          title: title.trim(),
          body: body.trim(),
        }),
      });
      setTitle('');
      setBody('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Post failed');
    } finally {
      setPosting(false);
    }
  };

  const voteUseful = async (id: string) => {
    try {
      await api(`/community/posts/${id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'useful' }),
      });
      await load();
    } catch (e: any) {
      setError(e.message || 'Vote failed');
    }
  };

  if (loading && !posts.length) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.teal400} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Profile</Text>
        </Pressable>
        <BrandMark />
        <SectionTitle>Community</SectionTitle>
        <Text style={styles.sub}>
          Verified-owner spaces for station tips, trips, range, and costs — crowdsource ≠ LIVE availability.
        </Text>

        {rep ? (
          <View style={styles.card}>
            <Text style={styles.label}>Your reputation</Text>
            <Text style={styles.value}>
              {rep.display_label} · {rep.score} pts
            </Text>
            <Text style={styles.meta}>
              Tier {rep.tier} · daily cap {rep.daily_post_cap} · verified reports{' '}
              {rep.verified_report_count} · helpful posts {rep.helpful_post_count}
            </Text>
          </View>
        ) : null}

        <Banner text="Photos from newcomers may await moderation. Never invent LIVE partner status." />

        <Text style={styles.section}>Spaces</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          {spaces.map((s) => (
            <Pressable
              key={s.id}
              onPress={async () => {
                setSpaceSlug(s.slug);
                try {
                  const r = await api<{ data: Post[] }>(`/community/spaces/${s.slug}/posts`);
                  setPosts(r.data);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
              style={[styles.spaceChip, spaceSlug === s.slug && styles.spaceChipOn]}
            >
              <Text style={styles.spaceText}>{s.title}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.card}>
          <Text style={styles.label}>Share with owners</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
            {['tip', 'station_experience', 'trip_share', 'range_share', 'cost_share'].map((t) => (
              <Pressable key={t} onPress={() => setPostType(t)}>
                <Chip label={t.replace('_', ' ')} tone={postType === t ? 'synced' : 'manual'} />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Title"
            placeholderTextColor={colors.textTertiary}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, { minHeight: 80 }]}
            placeholder="What did you observe?"
            placeholderTextColor={colors.textTertiary}
            value={body}
            onChangeText={setBody}
            multiline
          />
          <Button title={posting ? 'Posting…' : 'Publish'} onPress={submit} disabled={posting} />
        </View>

        {error ? <Banner tone="warn" text={error} /> : null}

        <Text style={styles.section}>Feed</Text>
        {!posts.length ? (
          <EmptyState title="No posts yet" body="Be the first to share a tip in this space." />
        ) : (
          posts.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={styles.value}>{p.title}</Text>
                <Chip label={p.post_type.replace('_', ' ')} tone="est" />
              </View>
              <Text style={styles.meta}>
                {p.author_display}
                {p.vehicle.make ? ` · ${p.vehicle.make} ${p.vehicle.model}` : ''}
                {p.space ? ` · ${p.space.title}` : ''}
              </Text>
              <Text style={styles.body}>{p.body}</Text>
              <Pressable onPress={() => voteUseful(p.id)}>
                <Text style={styles.vote}>Useful · {p.useful_count}</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing[4], paddingBottom: 48, gap: 8 },
  back: { fontFamily: fonts.sansMed, color: colors.teal400, marginBottom: 8 },
  sub: { fontFamily: fonts.sans, color: colors.textSecondary, marginBottom: 8 },
  section: {
    fontFamily: fonts.sansSemi,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  label: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12 },
  value: { fontFamily: fonts.sansSemi, color: colors.textPrimary, fontSize: 16, marginTop: 4, flex: 1 },
  meta: { fontFamily: fonts.sans, color: colors.textTertiary, fontSize: 12, marginTop: 4 },
  body: { fontFamily: fonts.sans, color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  vote: { fontFamily: fonts.sansSemi, color: colors.teal400, marginTop: 10 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    padding: 12,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    marginBottom: 8,
  },
  spaceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginRight: 8,
    backgroundColor: colors.bgElevated,
  },
  spaceChipOn: { borderColor: colors.teal400 },
  spaceText: { fontFamily: fonts.sansMed, color: colors.textPrimary, fontSize: 12 },
});
