import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SoundPressable as Pressable } from '@/components/SoundPressable';

import { colors, radius, spacing, typography } from '@/constants/theme';
import {
  browserCameraError,
  enumerateBrowserVideoDevices,
  stopMediaStream,
  webCameraConstraints,
  type BrowserVideoDevice,
} from '@/pose/webCamera';
import { WebInferenceScheduler } from '@/pose/webInferenceScheduler';
import { WebBlazePoseEstimator } from '@/pose/WebBlazePoseEstimator.web';
import { WebMoveNetPoseEstimator } from '@/pose/WebMoveNetPoseEstimator.web';
import { webFrameTimestamp } from '@/pose/webPoseMapping';
import {
  BLAZEPOSE_FULL,
  MOVENET_LIGHTNING,
  type YOLOXPOSE_TINY,
  type PoseModelId,
  type PoseModelStatus,
  type RuntimePoseModelId,
} from '@/pose/poseModels';
import type { PoseDiagnostics, PoseResult } from '@/pose/poseTypes';
import type { CameraPermissionAction } from '@/pose/cameraPermissionAction';
import {
  clearBrowserCameraStream,
  publishBrowserCameraStream,
} from '@/multiplayer/video/browserCameraStream';

interface PoseCameraProps {
  isActive: boolean;
  facing: 'front' | 'back';
  onPose(result: PoseResult): void;
  onDiagnostics?(diagnostics: PoseDiagnostics): void;
  debugPreviewEnabled?: boolean;
  onInputPreview?(dataUri: string): void;
  onError?(message: string): void;
  modelPreference?: PoseModelId | typeof YOLOXPOSE_TINY;
  onModelStatus?(status: PoseModelStatus): void;
  onTrackingInvalidated?(): void;
  onFacingResolved?(facing: 'front' | 'back'): void;
  selectedDeviceId?: string;
  onDevicesChanged?(devices: BrowserVideoDevice[]): void;
  onCameraResolution?(resolution: { width: number; height: number }): void;
  inlinePermissionControls?: boolean;
  /** The owning screen supplies its own error message and retry action. */
  showErrorOverlay?: boolean;
  onPermissionAction?(action: CameraPermissionAction | null): void;
  /** V6 can opt into BlazePose without changing native MoveNet runtime code. */
  webEstimator?: 'movenet' | 'blazepose';
}

interface WebPoseEstimator {
  estimate(
    video: HTMLVideoElement,
    cameraFacing: 'front' | 'back',
    timestamp: number,
  ): Promise<PoseResult | null>;
  resetForCameraSourceChange(): void;
  dispose(): void;
}

type CameraState = 'preparing' | 'loading-model' | 'ready' | 'error';
const REQUESTED_FPS = 20;

export const PoseCamera = React.memo(function PoseCamera({
  isActive,
  facing,
  onPose,
  onDiagnostics,
  onError,
  modelPreference = MOVENET_LIGHTNING,
  onModelStatus,
  onFacingResolved,
  selectedDeviceId,
  onDevicesChanged,
  onCameraResolution,
  webEstimator = 'movenet',
  showErrorOverlay = true,
}: PoseCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const estimatorRef = useRef<WebPoseEstimator | null>(null);
  const estimatorKindRef = useRef<'movenet' | 'blazepose' | null>(null);
  const poseCallback = useRef(onPose);
  const diagnosticsCallback = useRef(onDiagnostics);
  const [state, setState] = useState<CameraState>('preparing');
  const [message, setMessage] = useState('Preparing camera…');
  const [retryKey, setRetryKey] = useState(0);
  const [runtimeKey, setRuntimeKey] = useState(0);
  const [trackerError, setTrackerError] = useState(false);

  useEffect(() => {
    poseCallback.current = onPose;
  }, [onPose]);
  useEffect(() => {
    diagnosticsCallback.current = onDiagnostics;
  }, [onDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    let trackerStarting = false;
    const start = async () => {
      setTrackerError(false);
      setState('preparing');
      setMessage('Preparing camera…');
      onModelStatus?.({
        preference: modelPreference,
        activeModel: null,
        state: 'loading',
        fallbackReason: null,
        input: null,
        output: null,
      });
      if (!window.isSecureContext) throw new DOMException('Insecure context', 'SecurityError');
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera API unavailable', 'NotSupportedError');
      }
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      const stream = await navigator.mediaDevices.getUserMedia(
        webCameraConstraints(facing, selectedDeviceId),
      );
      if (cancelled) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      publishBrowserCameraStream(stream);
      const video = videoRef.current;
      if (!video) {
        stopMediaStream(stream);
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cancelled) return;
      const settings = stream.getVideoTracks()[0]?.getSettings();
      const actualFacing =
        settings?.facingMode === 'environment'
          ? 'back'
          : settings?.facingMode === 'user'
            ? 'front'
            : facing;
      onFacingResolved?.(actualFacing);
      onCameraResolution?.({ width: video.videoWidth, height: video.videoHeight });
      onDevicesChanged?.(await enumerateBrowserVideoDevices());
      trackerStarting = true;
      setState('loading-model');
      setMessage('Loading pose tracker…');
      if (!estimatorRef.current || estimatorKindRef.current !== webEstimator) {
        estimatorRef.current?.dispose();
        estimatorRef.current =
          webEstimator === 'blazepose'
            ? await WebBlazePoseEstimator.create()
            : await WebMoveNetPoseEstimator.create();
        estimatorKindRef.current = webEstimator;
      } else {
        // Preserve MoveNet's crop between frames, but do not carry a crop learned
        // from a previous physical camera (or retry stream) into this new source.
        estimatorRef.current.resetForCameraSourceChange();
      }
      if (cancelled) return;
      onModelStatus?.({
        preference: modelPreference,
        activeModel: activeWebModel(webEstimator),
        state: 'ready',
        fallbackReason: null,
        input: null,
        output: null,
      });
      setState('ready');
      setMessage('Position your full body…');
      setRuntimeKey((key) => key + 1);
    };
    void start().catch((error: unknown) => {
      if (cancelled) return;
      const safeMessage = browserCameraError(error, trackerStarting ? 'tracker' : 'camera');
      console.error('Web camera/pose initialization failed', safeMessage);
      setTrackerError(trackerStarting);
      setState('error');
      setMessage(safeMessage);
      onError?.(safeMessage);
      onModelStatus?.({
        preference: modelPreference,
        activeModel: null,
        state: 'error',
        fallbackReason: safeMessage,
        input: null,
        output: null,
      });
    });
    return () => {
      cancelled = true;
      if (streamRef.current) clearBrowserCameraStream(streamRef.current);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [
    facing,
    modelPreference,
    onCameraResolution,
    onDevicesChanged,
    onError,
    onFacingResolved,
    onModelStatus,
    retryKey,
    selectedDeviceId,
    webEstimator,
  ]);

  useEffect(
    () => () => {
      estimatorRef.current?.dispose();
      estimatorRef.current = null;
      estimatorKindRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!isActive || state !== 'ready' || !estimatorRef.current || !videoRef.current) return;
    const video = videoRef.current;
    const scheduler = new WebInferenceScheduler(REQUESTED_FPS);
    let cancelled = false;
    let callbackId = 0;
    let callbackKind: 'video' | 'animation' = 'animation';
    let windowStartedAt = performance.now();
    let inferences = 0;
    let cameraFrames = 0;
    let lastLatencyMs = 0;
    let lastPoseTimestamp = Date.now();
    let attempts = 0;
    let emptyResults = 0;
    let failures = 0;
    let pendingSince: number | null = null;

    const schedule = () => {
      if (cancelled) return;
      if ('requestVideoFrameCallback' in video) {
        callbackKind = 'video';
        callbackId = video.requestVideoFrameCallback((_now, metadata) =>
          tick(metadata.presentationTime),
        );
      } else {
        callbackKind = 'animation';
        callbackId = requestAnimationFrame(() => tick(undefined));
      }
    };
    const tick = (presentationTime: number | undefined) => {
      if (cancelled) return;
      cameraFrames += 1;
      const now = performance.now();
      if (scheduler.tryStart(now)) {
        attempts += 1;
        pendingSince = Date.now();
        const capturedAt = webFrameTimestamp(presentationTime, performance.timeOrigin, Date.now());
        void estimatorRef.current
          ?.estimate(video, facing, capturedAt)
          .then((pose) => {
            if (!pose) emptyResults += 1;
            if (pose && !cancelled) {
              inferences += 1;
              lastLatencyMs = pose.inferenceLatencyMs;
              lastPoseTimestamp = pose.timestamp;
              poseCallback.current(pose);
            }
          })
          .catch((error: unknown) => {
            failures += 1;
            console.error('Web pose inference failed', error);
          })
          .finally(() => {
            pendingSince = null;
            scheduler.complete();
          });
      }
      schedule();
    };
    // Independent of video callbacks: stalled video must still report zero FPS.
    const report = () => {
      const elapsed = performance.now() - windowStartedAt;
      if (elapsed >= 1_000) {
        const poseFps = Math.round((inferences * 1_000) / elapsed);
        diagnosticsCallback.current?.({
          cameraFps: Math.round((cameraFrames * 1_000) / elapsed),
          inferenceFps: poseFps,
          fps: poseFps,
          inferenceLatencyMs: Math.round(lastLatencyMs),
          poseAgeMs: Math.max(0, Date.now() - lastPoseTimestamp),
          droppedFrames: scheduler.skippedFrames,
          modelState: 'ready',
          poseModel: activeWebModel(webEstimator),
          cameraWidth: video.videoWidth,
          cameraHeight: video.videoHeight,
          inferenceAttempts: attempts,
          emptyResults,
          inferenceErrors: failures,
          pendingInferenceMs: pendingSince === null ? 0 : Date.now() - pendingSince,
          visibility: document.visibilityState,
          videoPaused: video.paused,
          trackState: streamRef.current?.getVideoTracks()[0]?.readyState,
        });
        windowStartedAt = performance.now();
        inferences = 0;
        cameraFrames = 0;
        attempts = 0;
        emptyResults = 0;
        failures = 0;
      }
    };
    const reportTimer = setInterval(report, 1000);
    const visibility = () => scheduler.setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibility);
    visibility();
    schedule();
    return () => {
      cancelled = true;
      clearInterval(reportTimer);
      document.removeEventListener('visibilitychange', visibility);
      if (callbackKind === 'video' && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(callbackId);
      } else {
        cancelAnimationFrame(callbackId);
      }
    };
  }, [facing, isActive, runtimeKey, state, webEstimator]);

  const previewStyle = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    backgroundColor: colors.background,
    transform: facing === 'front' ? 'scaleX(-1)' : 'none',
  } as const;

  return (
    <View style={styles.root}>
      {React.createElement('video', {
        ref: (node: HTMLVideoElement | null) => {
          videoRef.current = node;
        },
        autoPlay: true,
        muted: true,
        playsInline: true,
        style: previewStyle,
        'aria-label': `${facing} camera preview`,
      })}
      {state !== 'ready' && (state !== 'error' || showErrorOverlay) ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
          {state !== 'error' ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.title}>
            {state === 'error'
              ? trackerError
                ? 'REP TRACKER UNAVAILABLE'
                : 'CAMERA UNAVAILABLE'
              : state === 'loading-model'
                ? 'LOADING POSE TRACKER'
                : 'PREPARING CAMERA'}
          </Text>
          <Text style={styles.body}>{message}</Text>
          {state === 'preparing' ? (
            <Text style={styles.privacy}>
              Your camera is processed on this device for rep tracking. No microphone is requested.
            </Text>
          ) : null}
          {state === 'error' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry camera setup"
              onPress={() => setRetryKey((key) => key + 1)}
              style={styles.retry}
            >
              <Text style={styles.retryText}>TRY AGAIN</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function activeWebModel(estimator: 'movenet' | 'blazepose'): RuntimePoseModelId {
  return estimator === 'blazepose' ? BLAZEPOSE_FULL : MOVENET_LIGHTNING;
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, overflow: 'hidden' },
  state: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(9,13,18,0.92)',
  },
  title: { ...typography.heading, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 560,
    marginTop: spacing.sm,
  },
  privacy: {
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 480,
    marginTop: spacing.md,
    fontSize: 12,
  },
  retry: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  retryText: { ...typography.label, color: colors.background },
});
