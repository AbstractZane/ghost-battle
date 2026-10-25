import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoundPressable as Pressable } from '@/components/SoundPressable';
import { createYoloPose, type YoloPose } from '@pushpvp/yolo-pose-android';
import { makeShareable, scheduleOnRN } from 'react-native-worklets';
import {
  Camera,
  type CameraDevice,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';

import moveNetLightningModel from '../../assets/models/movenet-lightning-f16.tflite';
import moveNetThunderModel from '../../assets/models/movenet-thunder-f16.tflite';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { cameraDisplayPolicy } from '@/pose/cameraDisplay';
import { resolveAvailableCameraFacing } from '@/pose/cameraSelection';
import {
  frameToMoveNetInput,
  moveNetInputToPngDataUri,
  type MoveNetInputTransform,
} from '@/pose/frameConversion';
import { normalizeMoveNetOutput } from '@/pose/moveNet';
import {
  DROP_INFERENCE_FRAMES_WHILE_BUSY,
  poseInferenceIntervalMs,
  poseInferenceTargetFps,
  shouldSchedulePoseInference,
} from '@/pose/poseInferenceSchedule';
import {
  DEFAULT_POSE_MODEL,
  fallbackModelAfterFailure,
  getPoseModelConfig,
  MOVENET_LIGHTNING,
  YOLOXPOSE_TINY,
  safePoseModelError,
  validatePoseModelContract,
  type PoseModelId,
  type PoseModelStatus,
} from '@/pose/poseModels';
import type { PoseDiagnostics, PoseResult } from '@/pose/poseTypes';
import type { CameraPermissionAction } from '@/pose/cameraPermissionAction';
import { parseYoloPoseSample, YoloPoseAdapter } from '@/pose/yoloPoseAdapter';
import { useBundledTensorflowModel } from '@/pose/useBundledTensorflowModel';

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
  onTrackingInvalidated?(reason?: string): void;
  onFacingResolved?(facing: 'front' | 'back'): void;
  selectedDeviceId?: string;
  onDevicesChanged?(devices: Array<{ deviceId: string; label: string }>): void;
  onCameraResolution?(resolution: { width: number; height: number }): void;
  inlinePermissionControls?: boolean;
  /** Web overlay parity; native runtime errors are forwarded to the owning screen. */
  showErrorOverlay?: boolean;
  onPermissionAction?(action: CameraPermissionAction | null): void;
  /** Accepted for platform-parity with web; native remains on its bundled MoveNet models. */
  webEstimator?: 'movenet' | 'blazepose';
}

interface RuntimeProps extends Omit<PoseCameraProps, 'modelPreference' | 'onFacingResolved'> {
  device: CameraDevice;
  modelId: PoseModelId;
  preference: PoseModelId;
  fallbackReason: string | null;
  onLoadFailure(model: PoseModelId, reason: string): void;
}

const DIAGNOSTIC_WINDOW_MS = 1000;
// VisionCamera uses resolution identity to own its native output/thread/runtime.
const YOLO_FRAME_RESOLUTION = { width: 416, height: 416 };

export const PoseCamera = React.memo(function PoseCamera({
  isActive,
  facing,
  onPose,
  onDiagnostics,
  debugPreviewEnabled = false,
  onInputPreview,
  onError,
  modelPreference = DEFAULT_POSE_MODEL,
  onModelStatus,
  onTrackingInvalidated,
  onFacingResolved,
  inlinePermissionControls = true,
  onPermissionAction,
}: PoseCameraProps) {
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const permission = useCameraPermission();
  const [runtimeModel, setRuntimeModel] = useState<PoseModelId | typeof YOLOXPOSE_TINY>(
    modelPreference,
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const { hasPermission, canRequestPermission, requestPermission } = permission;
  useEffect(() => {
    onPermissionAction?.(
      hasPermission
        ? null
        : {
            label: canRequestPermission ? 'ALLOW CAMERA' : 'OPEN CAMERA SETTINGS',
            request: () => {
              const result = canRequestPermission ? requestPermission() : Linking.openSettings();
              void result.catch(() =>
                onError?.('Camera access could not be requested. Please try again.'),
              );
            },
          },
    );
    return () => onPermissionAction?.(null);
  }, [hasPermission, canRequestPermission, requestPermission, onPermissionAction, onError]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setFallbackReason(null);
    setRuntimeModel(modelPreference);
  }, [modelPreference]);

  const resolvedFacing = resolveAvailableCameraFacing(facing, {
    front: Boolean(frontDevice),
    back: Boolean(backDevice),
  });
  const device = resolvedFacing === 'front' ? frontDevice : backDevice;

  useEffect(() => {
    if (resolvedFacing && resolvedFacing !== facing) onFacingResolved?.(resolvedFacing);
  }, [facing, onFacingResolved, resolvedFacing]);

  const handleLoadFailure = useCallback(
    (failedModel: PoseModelId, reason: string) => {
      const fallback = fallbackModelAfterFailure(failedModel);
      if (fallback) {
        console.warn(`Thunder initialization failed: ${reason}\nFalling back to MoveNet Lightning`);
        setFallbackReason(reason);
        setRuntimeModel(fallback);
        return;
      }
      onModelStatus?.({
        preference: modelPreference,
        activeModel: null,
        state: 'error',
        fallbackReason: reason,
        input: null,
        output: null,
      });
      onError?.('Pose tracker failed to initialize.');
    },
    [modelPreference, onError, onModelStatus],
  );

  if (!permission.hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>CAMERA ACCESS</Text>
        <Text style={styles.body}>
          Camera access is required for automatic rep counting. Frames stay on this device.
        </Text>
        {inlinePermissionControls ? (
          <Pressable
            accessibilityRole="button"
            style={styles.permissionButton}
            onPress={() => {
              if (permission.canRequestPermission) void permission.requestPermission();
              else void Linking.openSettings();
            }}
          >
            <Text style={styles.permissionButtonText}>
              {permission.canRequestPermission ? 'ALLOW CAMERA' : 'OPEN SETTINGS'}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.body}>Open the encounter menu to allow camera access.</Text>
        )}
      </View>
    );
  }

  if (!device || !resolvedFacing) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Camera unavailable on this device.</Text>
      </View>
    );
  }

  const switchingPreference = runtimeModel !== modelPreference && fallbackReason === null;
  if (runtimeModel === YOLOXPOSE_TINY) {
    if (Platform.OS !== 'android' || process.env.EXPO_PUBLIC_ENABLE_YOLO_LAB !== 'true') {
      return (
        <View style={styles.centered}>
          <Text style={styles.body}>YOLO is available only in the private Android lab build.</Text>
        </View>
      );
    }
    if (!isActive || !foreground || switchingPreference) return <View style={styles.centered} />;
    return (
      <YoloPoseCameraRuntime
        key={`${device.id}-${resolvedFacing}`}
        device={device}
        facing={resolvedFacing}
        onPose={onPose}
        onDiagnostics={onDiagnostics}
        onError={onError}
        onModelStatus={onModelStatus}
        onTrackingInvalidated={onTrackingInvalidated}
      />
    );
  }
  return (
    <PoseModelCameraRuntime
      key={runtimeModel}
      debugPreviewEnabled={debugPreviewEnabled}
      device={device}
      facing={resolvedFacing}
      fallbackReason={fallbackReason}
      isActive={isActive && !switchingPreference}
      modelId={runtimeModel}
      onDiagnostics={onDiagnostics}
      onError={onError}
      onInputPreview={onInputPreview}
      onLoadFailure={handleLoadFailure}
      onModelStatus={onModelStatus}
      onPose={onPose}
      preference={modelPreference === YOLOXPOSE_TINY ? runtimeModel : modelPreference}
    />
  );
});

function YoloPoseCameraRuntime({
  device,
  facing,
  onPose,
  onDiagnostics,
  onError,
  onModelStatus,
  onTrackingInvalidated,
}: Pick<
  PoseCameraProps,
  'onPose' | 'onDiagnostics' | 'onError' | 'onModelStatus' | 'onTrackingInvalidated'
> & {
  device: CameraDevice;
  facing: 'front' | 'back';
}) {
  const plugin = useMemo<YoloPose | null>(() => {
    try {
      return createYoloPose();
    } catch {
      return null;
    }
  }, []);
  const adapter = useRef(new YoloPoseAdapter());
  const diagnosticWindow = useRef({ startedAt: 0, poses: 0, dropped: 0 });
  const cameraWindow = useMemo(() => makeShareable({ startedAt: 0, frames: 0, fps: 0 }), []);
  const displayPolicy = cameraDisplayPolicy(facing);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plugin) {
      setState('error');
      setError('Android YOLO module unavailable. Select MoveNet.');
      return;
    }
    adapter.current.reset();
    onModelStatus?.({
      preference: YOLOXPOSE_TINY,
      activeModel: null,
      state: 'loading',
      fallbackReason: null,
      input: null,
      output: null,
    });
    try {
      plugin.start();
    } catch {
      setState('error');
      setError('YOLO model failed to initialize. Select MoveNet.');
    }
    return () => {
      adapter.current.reset();
      plugin.stop();
    };
  }, [onModelStatus, plugin]);

  useEffect(() => {
    if (state === 'error' && error) {
      onModelStatus?.({
        preference: YOLOXPOSE_TINY,
        activeModel: null,
        state: 'error',
        fallbackReason: error,
        input: null,
        output: null,
      });
      onError?.(error);
    }
  }, [error, onError, onModelStatus, state]);

  const deliverResult = useCallback(
    (raw: string, cameraFps: number) => {
      const sample = parseYoloPoseSample(raw);
      if (sample === 'ready') {
        setState('ready');
        onModelStatus?.({
          preference: YOLOXPOSE_TINY,
          activeModel: YOLOXPOSE_TINY,
          state: 'ready',
          fallbackReason: null,
          input: { name: 'bgr_image', dataType: 'float32', shape: [1, 3, 416, 416] },
          output: { name: 'raw_predictions', dataType: 'float32', shape: [1, 3549, 57] },
        });
        return;
      }
      if (sample === 'error' || !sample) {
        setState('error');
        setError('YOLO inference output invalid. Select MoveNet.');
        return;
      }
      if (sample === 'absent') {
        if (adapter.current.markAbsent())
          onTrackingInvalidated?.('yolo-pose-absence-grace-expired');
        return;
      }
      const result = adapter.current.process(sample, facing, displayPolicy.displayMirrored);
      if (result.kind !== 'pose') {
        if (result.invalidate) onTrackingInvalidated?.(`yolo-${result.kind}`);
        return;
      }
      onPose(result.pose);
      const now = Date.now();
      const window = diagnosticWindow.current;
      if (window.startedAt === 0) window.startedAt = now;
      window.poses++;
      if (now - window.startedAt >= DIAGNOSTIC_WINDOW_MS) {
        const fps = Math.round((window.poses * 1000) / (now - window.startedAt));
        onDiagnostics?.({
          cameraFps,
          inferenceFps: fps,
          fps,
          inferenceLatencyMs: sample.inferenceLatencyMs,
          poseAgeMs: Math.max(0, now - sample.capturedAt),
          droppedFrames: window.dropped,
          modelState: 'ready',
          poseModel: YOLOXPOSE_TINY,
          cameraWidth: sample.sourceWidth,
          cameraHeight: sample.sourceHeight,
        });
        window.startedAt = now;
        window.poses = 0;
      }
    },
    [
      displayPolicy.displayMirrored,
      facing,
      onDiagnostics,
      onModelStatus,
      onPose,
      onTrackingInvalidated,
    ],
  );

  const frameOutput = useFrameOutput({
    targetResolution: YOLO_FRAME_RESOLUTION,
    pixelFormat: 'rgb',
    enablePhysicalBufferRotation: true,
    enablePreviewSizedOutputBuffers: true,
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      const now = Date.now();
      if (cameraWindow.startedAt === 0) cameraWindow.startedAt = now;
      cameraWindow.frames++;
      if (now - cameraWindow.startedAt >= DIAGNOSTIC_WINDOW_MS) {
        cameraWindow.fps = Math.round(
          (cameraWindow.frames * 1000) / (now - cameraWindow.startedAt),
        );
        cameraWindow.startedAt = now;
        cameraWindow.frames = 0;
      }
      try {
        const completed = plugin?.submit(frame);
        if (completed) scheduleOnRN(deliverResult, completed, cameraWindow.fps);
      } finally {
        frame.dispose();
      }
    },
    onFrameDropped() {
      diagnosticWindow.current.dropped++;
    },
  });
  const outputs = useMemo(() => [frameOutput], [frameOutput]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        outputs={outputs}
        constraints={[{ resolutionBias: frameOutput }]}
        isActive={plugin !== null && state !== 'error'}
        mirrorMode={displayPolicy.mirrorMode}
        orientationSource="device"
        resizeMode="cover"
        allowHapticsAndSystemSoundsPlayback
        onError={() => onError?.('Camera unavailable. Try reopening Detector Lab.')}
      />
      {state !== 'ready' ? (
        <View style={styles.modelLoading}>
          {state === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.modelLoadingText}>{error ?? 'LOADING YOLO POSE TRACKER'}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PoseModelCameraRuntime({
  isActive,
  facing,
  onPose,
  onDiagnostics,
  debugPreviewEnabled = false,
  onInputPreview,
  onError,
  onModelStatus,
  device,
  modelId,
  preference,
  fallbackReason,
  onLoadFailure,
}: RuntimeProps) {
  const config = getPoseModelConfig(modelId);
  const inferenceIntervalMs = poseInferenceIntervalMs(poseInferenceTargetFps(modelId));
  const modelAsset = modelId === MOVENET_LIGHTNING ? moveNetLightningModel : moveNetThunderModel;
  const plugin = useBundledTensorflowModel(modelAsset);
  const droppedFramesRef = useRef(0);
  const [activationReady, setActivationReady] = useState(false);
  const diagnosticWindowRef = useRef({ startedAt: 0, inferences: 0 });
  const reportedFailureRef = useRef(false);
  const inferenceSchedule = useMemo(() => makeShareable({ lastInferenceAt: 0 }), []);
  const previewSchedule = useMemo(() => makeShareable({ lastPreviewAt: 0 }), []);
  const cameraSchedule = useMemo(() => makeShareable({ startedAt: 0, frames: 0, fps: 0 }), []);
  const displayPolicy = cameraDisplayPolicy(facing);
  const loadedModel = plugin.state === 'loaded' ? plugin.model : null;
  const contract = useMemo(
    () =>
      loadedModel
        ? validatePoseModelContract(loadedModel, config)
        : { valid: false, reason: null, input: null, output: null },
    [config, loadedModel],
  );

  useEffect(() => {
    if (reportedFailureRef.current) return;
    const reason =
      plugin.state === 'error'
        ? safePoseModelError(plugin.error)
        : plugin.state === 'loaded' && !contract.valid
          ? (contract.reason ?? 'Model contract validation failed.')
          : null;
    if (!reason) return;
    reportedFailureRef.current = true;
    onLoadFailure(modelId, reason);
  }, [contract.reason, contract.valid, modelId, onLoadFailure, plugin]);

  useEffect(() => {
    if (plugin.state !== 'loaded' || !contract.valid) {
      setActivationReady(false);
      onModelStatus?.({
        preference,
        activeModel: null,
        state: 'loading',
        fallbackReason,
        input: contract.input,
        output: contract.output,
      });
      return;
    }
    onModelStatus?.({
      preference,
      activeModel: modelId,
      state: fallbackReason ? 'fallback' : 'ready',
      fallbackReason,
      input: contract.input,
      output: contract.output,
    });
    setActivationReady(true);
  }, [contract, fallbackReason, modelId, onModelStatus, plugin.state, preference]);

  const deliverPose = useCallback(
    (
      values: number[],
      capturedAt: number,
      sourceWidth: number,
      sourceHeight: number,
      inputMirrored: boolean,
      orientation: 'up' | 'down' | 'left' | 'right',
      latency: number,
      cameraFps: number,
      transform: MoveNetInputTransform,
    ) => {
      const now = Date.now();
      const result = normalizeMoveNetOutput(
        values,
        capturedAt,
        latency,
        {
          sourceWidth,
          sourceHeight,
          cameraFacing: facing,
          orientation,
          inputMirrored,
          displayMirrored: displayPolicy.displayMirrored,
          poseModel: modelId,
        },
        transform,
      );
      if (result) onPose(result);
      const window = diagnosticWindowRef.current;
      if (window.startedAt === 0) window.startedAt = now;
      window.inferences += 1;
      const elapsed = now - window.startedAt;
      if (elapsed >= DIAGNOSTIC_WINDOW_MS) {
        const inferenceFps = Math.round((window.inferences * 1000) / elapsed);
        onDiagnostics?.({
          cameraFps,
          inferenceFps,
          fps: inferenceFps,
          inferenceLatencyMs: latency,
          poseAgeMs: Math.max(0, now - capturedAt),
          droppedFrames: droppedFramesRef.current,
          modelState: 'ready',
          poseModel: modelId,
        });
        window.startedAt = now;
        window.inferences = 0;
      }
    },
    [displayPolicy.displayMirrored, facing, modelId, onDiagnostics, onPose],
  );

  const deliverInputPreview = useCallback(
    (rgb: number[]) =>
      onInputPreview?.(moveNetInputToPngDataUri(rgb, config.inputWidth, config.inputHeight)),
    [config.inputHeight, config.inputWidth, onInputPreview],
  );

  const model =
    plugin.state === 'loaded' && contract.valid && activationReady ? plugin.model : undefined;
  // Diagnostic/pose renders must not recreate the native camera worklet runtime.
  const targetResolution = useMemo(
    () => ({ width: config.inputWidth, height: config.inputHeight }),
    [config.inputWidth, config.inputHeight],
  );
  const frameOutput = useFrameOutput({
    targetResolution,
    pixelFormat: 'rgb',
    enablePhysicalBufferRotation: true,
    enablePreviewSizedOutputBuffers: true,
    dropFramesWhileBusy: DROP_INFERENCE_FRAMES_WHILE_BUSY,
    onFrame(frame) {
      'worklet';
      if (model === undefined) {
        frame.dispose();
        return;
      }
      const startedAt = Date.now();
      if (cameraSchedule.startedAt === 0) cameraSchedule.startedAt = startedAt;
      cameraSchedule.frames += 1;
      const cameraElapsed = startedAt - cameraSchedule.startedAt;
      if (cameraElapsed >= DIAGNOSTIC_WINDOW_MS) {
        cameraSchedule.fps = Math.round((cameraSchedule.frames * 1000) / cameraElapsed);
        cameraSchedule.startedAt = startedAt;
        cameraSchedule.frames = 0;
      }
      if (
        !shouldSchedulePoseInference(
          inferenceSchedule.lastInferenceAt,
          startedAt,
          inferenceIntervalMs,
        )
      ) {
        frame.dispose();
        return;
      }
      inferenceSchedule.lastInferenceAt = startedAt;
      try {
        const input = frameToMoveNetInput(frame, config.inputWidth, config.inputHeight);
        const outputs = model.runSync([input.buffer]);
        const output = outputs[0];
        if (output !== undefined) {
          const keypoints = new Float32Array(output);
          const serializable: number[] = [];
          for (let index = 0; index < keypoints.length; index += 1) {
            serializable.push(keypoints[index] ?? 0);
          }
          scheduleOnRN(
            deliverPose,
            serializable,
            startedAt,
            frame.width,
            frame.height,
            frame.isMirrored,
            frame.orientation,
            Date.now() - startedAt,
            cameraSchedule.fps,
            input.transform,
          );
        }
        if (
          debugPreviewEnabled &&
          startedAt - previewSchedule.lastPreviewAt >= DIAGNOSTIC_WINDOW_MS
        ) {
          previewSchedule.lastPreviewAt = startedAt;
          const inputBytes = new Uint8Array(input.buffer);
          const previewPixels: number[] = [];
          for (let index = 0; index < inputBytes.length; index += 1) {
            previewPixels.push(inputBytes[index] ?? 0);
          }
          scheduleOnRN(deliverInputPreview, previewPixels);
        }
      } finally {
        frame.dispose();
      }
    },
    onFrameDropped() {
      droppedFramesRef.current += 1;
    },
  });

  const outputs = useMemo(() => [frameOutput], [frameOutput]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        outputs={outputs}
        constraints={[{ resolutionBias: frameOutput }]}
        isActive={isActive && model !== undefined}
        mirrorMode={displayPolicy.mirrorMode}
        orientationSource="device"
        resizeMode="cover"
        allowHapticsAndSystemSoundsPlayback
        onError={() => onError?.('Camera unavailable. Try reopening the workout.')}
      />
      {model === undefined ? (
        <View style={styles.modelLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.modelLoadingText}>LOADING {config.label} POSE TRACKER</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  permissionButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  permissionButtonText: { ...typography.label, color: colors.background },
  modelLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  modelLoadingText: { ...typography.label, color: colors.textMuted },
});
