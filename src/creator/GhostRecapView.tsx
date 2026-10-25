import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SoundPressable } from '@/components/SoundPressable';
import { ValueSlider } from '@/components/ValueSlider';
import { GhostMotionView } from './GhostMotionView';
import { buildGhostRecap, type GhostRun } from './ghostRecap';
import type { VideoRivalClip } from './videoRival';

export function GhostRecapView({ run, clip }: { run: GhostRun; clip: VideoRivalClip }) {
  const [expanded, setExpanded] = useState(false);
  const [at, setAt] = useState(0);
  const recap = buildGhostRecap(run, clip.repTimesMs, clip.durationMs);
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>
        {recap.practice ? 'PRACTICE RECAP' : 'WHERE THE RACE TURNED'}
      </Text>
      <View
        style={styles.rail}
        accessibilityLabel="Race lead timeline. Green: you. Purple: ghost. Grey: tied."
      >
        {recap.segments.map((s) => (
          <View
            key={s.fromMs}
            style={{
              flex: s.toMs - s.fromMs,
              backgroundColor: s.lead > 0 ? '#C5F396' : s.lead < 0 ? '#A585E3' : '#53617A',
            }}
          />
        ))}
      </View>
      <Text style={styles.copy}>{recap.headline}</Text>
      <SoundPressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.button}
      >
        <Text style={styles.link}>
          {expanded ? 'CLOSE DETAILS' : 'EXPLORE RACE'} {expanded ? '−' : '＋'}
        </Text>
      </SoundPressable>
      {expanded ? (
        <>
          <Text style={styles.copy}>
            Green: your lead · Purple: ghost lead · Grey: tied. Timings show accepted reps, not
            posture or medical advice.
          </Text>
          {clip.motion ? (
            <View style={styles.replay}>
              <GhostMotionView track={clip.motion} atMs={at} />
            </View>
          ) : null}
          <ValueSlider
            label="Replay position"
            min={0}
            max={clip.durationMs}
            step={100}
            value={at}
            valueText={`${(at / 1000).toFixed(1)}s · You ${run.playerRepTimesMs.filter((t) => t <= at).length} / Ghost ${clip.repTimesMs.filter((t) => t <= at).length}`}
            onChange={setAt}
          />
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 7 },
  heading: { color: '#BCA5E7', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  rail: { flexDirection: 'row', height: 8, overflow: 'hidden', borderRadius: 5 },
  copy: { color: '#A5B6CD', fontSize: 11, lineHeight: 16 },
  button: { minHeight: 44, justifyContent: 'center' },
  link: { color: '#C9ECB0', fontWeight: '800', fontSize: 9 },
  replay: { height: 145, overflow: 'hidden', borderRadius: 12 },
});
