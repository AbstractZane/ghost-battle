import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ValueSlider } from '@/components/ValueSlider';
import { GhostMotionView } from './GhostMotionView';
import { videoRivalScore, type VideoRivalClip } from './videoRival';
export function GhostMotionEditor({ clip }: { clip: VideoRivalClip }) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now(),
        delta = now - last;
      last = now;
      setAt((old) => Math.min(clip.durationMs, old + delta));
    }, 50);
    return () => clearInterval(id);
  }, [clip.durationMs, playing]);
  useEffect(() => {
    if (at >= clip.durationMs) setPlaying(false);
  }, [at, clip.durationMs]);
  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        {clip.motion ? (
          <GhostMotionView
            track={clip.motion}
            atMs={at}
            score={videoRivalScore(clip.repTimesMs, at)}
          />
        ) : null}
      </View>
      <ValueSlider
        label="Ghost position"
        value={at}
        min={0}
        max={clip.durationMs}
        step={100}
        valueText={`${(at / 1000).toFixed(1)}s · ${videoRivalScore(clip.repTimesMs, at)} reps`}
        onChange={(value) => {
          setPlaying(false);
          setAt(value);
        }}
      />
      <PrimaryButton
        compact
        variant="secondary"
        label={playing ? 'PAUSE GHOST' : 'PREVIEW GHOST'}
        onPress={() => {
          if (!playing && at >= clip.durationMs) setAt(0);
          setPlaying(!playing);
        }}
      />
      <Text style={styles.copy}>
        Motion-only challenge · {clip.repTimesMs.length} confirmed markers ·{' '}
        {clip.marking === 'detector' ? 'detector-marked, author-reviewed' : 'author-edited markers'}
        . Original footage is not included.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, gap: 10, minHeight: 0 },
  preview: { flex: 1, minHeight: 100, borderRadius: 18, overflow: 'hidden' },
  copy: { color: '#A7B8CF', fontSize: 11, lineHeight: 16 },
});
