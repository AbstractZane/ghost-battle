import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { PoseDiagnostics } from '@/pose/poseTypes';
import { DetectorDiagnosticSession } from '@/debug/detectorDiagnostics';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { soloLocalMode } from '@/debug/soloLocalMode';
import { DETECTOR_LAB_ENABLED } from '@/config/features';
import type { SoloHybridLocal } from '@/debug/soloHybridLocal';

import {
  PoseTraceRecorder,
  serializePoseTrace,
  type PoseTrace,
  type PoseTraceRuntimeMetadata,
} from '@/debug/poseTrace';
import { detectorGate } from '@/debug/detectorGate';
import type { PushupDetector } from '@/exercises/pushup/PushupDetector';
import { DEFAULT_PUSHUP_RULES, type PushupRules } from '@/exercises/pushup/pushupRules';
import {
  createWorkoutPushupDetector,
  DEFAULT_WORKOUT_DETECTOR_VERSION,
  getWorkoutPushupRules,
  type PushupDetectorVersion,
} from '@/exercises/pushup/workoutDetector';
import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import { PushupDetectorV5 } from '@/exercises/pushup/v5/PushupDetectorV5';
import { PushupDetectorV6 } from '@/exercises/pushup/v6/PushupDetectorV6';
import type { PushupDiagnosticsV5 } from '@/exercises/pushup/v5/v5Types';
import { calculateLiveXP, calculateWorkoutXP } from '@/game/xp';
import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { PoseJitterBenchmark, type PoseJitterResult } from '@/pose/poseMetrics';
import { DEFAULT_POSE_MODEL, type RuntimePoseModelId } from '@/pose/poseModels';
import {
  evaluatePoseQuality,
  poseSourceGeometry,
  StablePoseReadiness,
  type PoseQualityResult,
} from '@/pose/poseQuality';
import type { PoseLandmarks, PoseResult } from '@/pose/poseTypes';
import { analytics } from '@/services/analytics';
import { localDateKey } from '@/constants/defaults';
import { useAppStore } from '@/store/appStore';
import type { ExerciseRep, WorkoutSession } from '@/types/models';
import { createId } from '@/utils/format';
import {
  DEFAULT_WORKOUT_CONFIG,
  workoutClock,
  workoutComplete,
  type WorkoutConfig,
} from '@/workouts/workoutModes';

const FEEDBACK_PRIORITY: Record<string, number> = {
  'BODY NOT VISIBLE': 100,
  'KEEP BODY STRAIGHT': 90,
  'MOVE INTO TOP POSITION': 80,
  'MOVE INTO A PLANK POSITION': 85,
  'HOLD TOP POSITION': 75,
  DESCEND: 70,
  'GOOD DEPTH': 75,
  PUSH: 75,
  'GO LOWER': 60,
  'FULLY EXTEND': 60,
  'PERFECT REP': 50,
  'GOOD REP': 50,
  'FULL REP': 50,
};

const UI_POSE_INTERVAL_MS = 100;

export type { PushupDetectorVersion } from '@/exercises/pushup/workoutDetector';
type SoloDetectorVersion = PushupDetectorVersion | 'hybrid';

function syntheticPose(
  elbowAngle: number,
  bodyAngle: number,
  timestamp: number,
  confidence = 0.95,
): PoseResult {
  const shoulder = { x: 0.18, y: 0.48, confidence };
  const elbow = { x: 0.36, y: 0.48, confidence };
  const elbowRadians = ((180 - elbowAngle) * Math.PI) / 180;
  const hip = { x: 0.58, y: 0.48, confidence };
  const bodyRadians = ((180 - bodyAngle) * Math.PI) / 180;
  const ankle = {
    x: hip.x + 0.34 * Math.cos(bodyRadians),
    y: hip.y + 0.34 * Math.sin(bodyRadians),
    confidence,
  };
  const knee = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2, confidence };
  const landmarks: PoseLandmarks = {
    nose: { x: 0.1, y: 0.42, confidence },
    leftShoulder: shoulder,
    leftElbow: elbow,
    leftWrist: {
      x: elbow.x + 0.18 * Math.cos(elbowRadians),
      y: elbow.y + 0.18 * Math.sin(elbowRadians),
      confidence,
    },
    leftHip: hip,
    leftKnee: knee,
    leftAnkle: ankle,
    rightShoulder: { ...shoulder, confidence: confidence - 0.25 },
    rightElbow: { ...elbow, confidence: confidence - 0.25 },
    rightWrist: { x: 0.54, y: 0.48, confidence: confidence - 0.25 },
    rightHip: { ...hip, confidence: confidence - 0.25 },
    rightKnee: { ...knee, confidence: confidence - 0.25 },
    rightAnkle: { ...ankle, confidence: confidence - 0.25 },
  };
  return {
    timestamp,
    landmarks,
    rawLandmarks: landmarks,
    inferenceLatencyMs: 0,
    sourceWidth: 192,
    sourceHeight: 192,
    cameraFacing: 'back',
    orientation: 'up',
    inputMirrored: false,
    displayMirrored: false,
  };
}

export function useWorkoutSession(
  config: WorkoutConfig = DEFAULT_WORKOUT_CONFIG,
  options: {
    poseDebug?: boolean;
    localSolo?: boolean;
    initialDetectorVersion?: PushupDetectorVersion;
    /** Experimental posture policy, explicitly enabled only by Detector Lab. */
    labFrontView?: boolean;
    /** Synchronous normalized detector events; no camera pixels or model-specific output. */
    onDetectorFrame?(result: ExerciseDetectionResult, timestamp: number): void;
    /** Game modes may present their own accepted-hit feedback instead of pre-start rep counts. */
    repFeedback?: boolean;
    /** Observe setup/readiness without admitting pre-start reps into a match. */
    acceptReps?: boolean;
  } = {},
) {
  useKeepAwake('pushforge-workout');
  const settings = useAppStore((state) => state.settings);
  const profile = useAppStore((state) => state.profile);
  const completeWorkout = useAppStore((state) => state.completeWorkout);
  const localSolo = soloLocalMode(
    __DEV__,
    options.localSolo === true,
    // React Native aliases window to globalThis, but has no browser location.
    typeof window === 'undefined' ? undefined : window.location?.hostname,
  );
  const initialDetectorVersion =
    DETECTOR_LAB_ENABLED && options.initialDetectorVersion
      ? options.initialDetectorVersion
      : DEFAULT_WORKOUT_DETECTOR_VERSION;
  const initialRules = getWorkoutPushupRules(
    initialDetectorVersion,
    DETECTOR_LAB_ENABLED && options.labFrontView === true,
  );
  const [soloDetector, setSoloDetector] = useState<SoloDetectorVersion>(initialDetectorVersion);
  const [soloModelStatus, setSoloModelStatus] = useState('Loading Hybrid');
  const hybridRef = useRef<SoloHybridLocal | null>(null);
  const pausedRef = useRef(false);
  const detectorRef = useRef<PushupDetector | PushupDetectorV5 | PushupDetectorV6>(
    createWorkoutPushupDetector(initialDetectorVersion, initialRules),
  );
  const detectorVersionRef = useRef<PushupDetectorVersion>(initialDetectorVersion);
  const poseEngineRef = useRef(
    new PoseEngineV3({
      displayStillAlpha: DEFAULT_PUSHUP_RULES.smoothingAlpha,
      displayMotionAlpha: DEFAULT_PUSHUP_RULES.motionSmoothingAlpha,
      outlierDistance: DEFAULT_PUSHUP_RULES.poseGlitchDistance,
      confidenceFloor: DEFAULT_PUSHUP_RULES.minimumCoreLandmarkConfidence,
      signalGraceMs: DEFAULT_PUSHUP_RULES.trackingGraceMs,
    }),
  );
  const readinessTrackerRef = useRef(
    new StablePoseReadiness({
      readyConfirmationMs: DEFAULT_PUSHUP_RULES.readyConfirmationMs,
      landmarkGraceMs: DEFAULT_PUSHUP_RULES.trackingGraceMs,
      messageHoldMs: DEFAULT_PUSHUP_RULES.feedbackCooldownMs,
    }),
  );
  const readinessLogRef = useRef<string | null>(null);
  const motionStateRef = useRef<string | null>(null);
  const previousArmStateRef = useRef<string>('DISARMED');
  const traceRecorderRef = useRef(new PoseTraceRecorder());
  const jitterBenchmarkRef = useRef<PoseJitterBenchmark | null>(null);
  const lastTraceRef = useRef<PoseTrace | null>(null);
  const latestPoseModelRef = useRef<RuntimePoseModelId>(DEFAULT_POSE_MODEL);
  const processingWindowRef = useRef({ startedAt: 0, frames: 0, uiUpdates: 0 });
  const lastUiUpdateRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);
  const endingRef = useRef(false);
  const feedbackRef = useRef({ value: 'POSITION YOUR FULL BODY IN FRAME', changedAt: 0 });
  const [paused, setPausedState] = useState(false);
  const [reps, setReps] = useState<ExerciseRep[]>([]);
  const [latestPose, setLatestPose] = useState<PoseResult | null>(null);
  const [latestRawPose, setLatestRawPose] = useState<PoseResult | null>(null);
  const [latestDetectorPose, setLatestDetectorPose] = useState<PoseResult | null>(null);
  const [detection, setDetection] = useState<ExerciseDetectionResult | null>(null);
  const [readiness, setReadiness] = useState<PoseQualityResult | null>(null);
  const [feedback, setFeedback] = useState(feedbackRef.current.value);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [rules, setRules] = useState<PushupRules>({ ...initialRules });
  const [traceRecording, setTraceRecording] = useState(false);
  const [traceFrameCount, setTraceFrameCount] = useState(0);
  const [jitterTestRunning, setJitterTestRunning] = useState(false);
  const [jitterTestResult, setJitterTestResult] = useState<PoseJitterResult | null>(null);
  const [detectorDiagnostics, setDetectorDiagnostics] = useState({
    processingLatencyMs: 0,
    trackingLatencyMs: 0,
    poseAgeMs: 0,
    uiUpdateFps: 0,
  });
  const [detectorVersion, setDetectorVersion] =
    useState<PushupDetectorVersion>(initialDetectorVersion);
  const [v5Diagnostics, setV5Diagnostics] = useState<PushupDiagnosticsV5 | null>(null);

  useEffect(() => {
    if (!localSolo) analytics.track('workout_started', { exercise: 'pushup' });
    const timer = setInterval(() => {
      const now = pausedAtRef.current ?? Date.now();
      setElapsedSeconds(
        Math.floor((now - startedAtRef.current - pausedDurationRef.current) / 1000),
      );
    }, 250);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPaused(true);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      void Speech.stop();
    };
  }, []);

  const announceRep = useCallback(
    (rep: ExerciseRep) => {
      if (options.repFeedback === false) return;
      if (settings.haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (settings.voiceRepCount) Speech.speak(String(rep.index), { rate: 1.15, pitch: 1 });
    },
    [settings.haptics, settings.voiceRepCount, options.repFeedback],
  );

  const updateFeedback = useCallback(
    (next: string, force = false) => {
      const now = Date.now();
      const currentPriority = FEEDBACK_PRIORITY[feedbackRef.current.value] ?? 0;
      const nextPriority = FEEDBACK_PRIORITY[next] ?? 0;
      if (
        force ||
        nextPriority > currentPriority ||
        now - feedbackRef.current.changedAt >= rules.feedbackCooldownMs
      ) {
        feedbackRef.current = { value: next, changedAt: now };
        setFeedback(next);
      }
    },
    [rules.feedbackCooldownMs],
  );

  const diagnosticSession = useRef<DetectorDiagnosticSession | null>(null);
  const startDiagnostics = useCallback(() => {
    if (!DETECTOR_LAB_ENABLED || diagnosticSession.current) return;
    diagnosticSession.current = new DetectorDiagnosticSession(
      detectorVersionRef.current,
      Date.now(),
    );
  }, []);
  const stopDiagnostics = useCallback((reason = 'completed') => {
    const summary = diagnosticSession.current?.finish(Date.now(), reason);
    diagnosticSession.current = null;
    return summary;
  }, []);
  const reportDiagnosticCamera = useCallback((health: PoseDiagnostics) => {
    diagnosticSession.current?.camera(health);
  }, []);
  const reportDiagnosticPause = useCallback((paused: boolean) => {
    diagnosticSession.current?.lifecycle(paused);
  }, []);
  useEffect(
    () => () => {
      stopDiagnostics('screen closed');
    },
    [stopDiagnostics],
  );

  const processPose = useCallback(
    (incoming: PoseResult) => {
      diagnosticSession.current?.receive();
      latestPoseModelRef.current = incoming.poseModel ?? latestPoseModelRef.current;
      const processingStartedAt = globalThis.performance?.now() ?? Date.now();
      const frame = poseEngineRef.current.update(incoming);
      if (!frame) {
        diagnosticSession.current?.discard();
        return;
      }
      const { rawPose, detectorPose, displayPose } = frame;
      // V6 intentionally admits an arm-only view. The shared filtered branch
      // is tuned for V4/V5's hip-connected posture checks, so feeding it to V6
      // would make a weak hip silently suppress an otherwise reliable arm.
      const detectorInput =
        detectorRef.current instanceof PushupDetectorV6 ? rawPose : detectorPose;
      const result = detectorRef.current.processPose(detectorInput, detectorInput.timestamp);
      if (options.acceptReps === false) {
        // Setup may observe a complete cycle, but it must never bank a workout
        // rep. Battle flows also reset the counter at their actual start boundary.
        result.rep = undefined;
        result.repCompleted = false;
        result.totalReps = 0;
      }
      if (localSolo && soloDetector === 'hybrid') {
        // Reference counter metrics are informational only. Its readiness, state, side selection,
        // and feedback must never gate or describe the independent Hybrid cycle.
        if (!pausedRef.current && !endingRef.current) {
          void hybridRef.current?.addPose(rawPose).catch(() => {
            setSoloModelStatus('Hybrid error — switch to V6 Form or restart local testing');
          });
        }
        const hybrid = hybridRef.current?.getDiagnostics();
        const state = hybrid?.candidateState;
        const locked = state === 'DESCENDING' || state === 'BOTTOM' || state === 'ASCENDING';
        const nextFeedback = pausedRef.current
          ? 'PAUSED'
          : !hybrid
            ? 'LOADING HYBRID'
            : hybrid.trackingHeld
              ? 'TRACKING BRIEFLY OBSCURED — HOLD POSITION'
              : state === 'DESCENDING'
                ? 'DESCEND'
                : state === 'BOTTOM'
                  ? 'PUSH'
                  : state === 'ASCENDING'
                    ? 'FULLY EXTEND'
                    : state === 'VALIDATING'
                      ? 'CHECKING REP'
                      : state === 'ACCEPTED'
                        ? 'FULL REP'
                        : state === 'REJECTED'
                          ? 'REP NOT ACCEPTED'
                          : hybrid.rejectionReason
                            ? `REACQUIRE TOP — ${hybrid.rejectionReason}`
                            : 'HOLD A CLEAR TOP POSITION';
        result.rep = undefined;
        result.repCompleted = false;
        result.rejectedReason = undefined;
        result.feedback = nextFeedback;
        result.totalReps = hybrid?.finalRepCount ?? 0;
        result.state =
          state === 'DESCENDING' || state === 'ASCENDING'
            ? state
            : state === 'BOTTOM'
              ? 'DOWN'
              : 'UP';
        Object.assign(result.metrics, {
          selectedSide: hybrid?.candidateArm ?? result.metrics.selectedSide,
          elbowSource: hybrid?.candidateArm ?? undefined,
          elbowAngle: hybrid?.elbowAngle ?? undefined,
          motionPhase: result.state,
          candidateActive: locked,
          armState: locked ? 'ARMED' : 'DISARMED',
          lastRejectionReason: undefined,
          sideSelectionReason: locked
            ? 'Hybrid candidate arm locked'
            : 'Hybrid seeking coherent descent',
        });
        const now = Date.now();
        const changed = motionStateRef.current !== state;
        motionStateRef.current = state ?? null;
        if (changed || now - lastUiUpdateRef.current >= UI_POSE_INTERVAL_MS) {
          setLatestRawPose(rawPose);
          setLatestDetectorPose(detectorPose);
          setLatestPose(displayPose);
          setReadiness(null);
          setDetection(result);
          lastUiUpdateRef.current = now;
        }
        updateFeedback(nextFeedback, changed);
        return;
      }
      options.onDetectorFrame?.(result, rawPose.timestamp);
      if (options.poseDebug) {
        console.info(
          `[PushPVPPoseDebug] timestamp=${detectorPose.timestamp} signal=${result.metrics.signalQuality} state=${result.state} context=${result.metrics.contextState}`,
        );
      }
      if (
        settings.haptics &&
        options.repFeedback !== false &&
        previousArmStateRef.current !== 'ARMED' &&
        result.metrics.armState === 'ARMED'
      ) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      previousArmStateRef.current = result.metrics.armState;
      const processingLatencyMs =
        (globalThis.performance?.now() ?? Date.now()) - processingStartedAt;
      const processingWindow = processingWindowRef.current;
      const now = Date.now();
      processingWindow.startedAt ||= now;
      processingWindow.frames += 1;
      if (now - processingWindow.startedAt >= 1000) {
        setDetectorDiagnostics({
          processingLatencyMs,
          trackingLatencyMs: frame.trackingLatencyMs,
          poseAgeMs: Math.max(0, now - rawPose.timestamp),
          uiUpdateFps: Math.round(
            (processingWindow.uiUpdates * 1000) / (now - processingWindow.startedAt),
          ),
        });
        processingWindow.startedAt = now;
        processingWindow.frames = 0;
        processingWindow.uiUpdates = 0;
      }
      if (__DEV__ && jitterBenchmarkRef.current) {
        const benchmark = jitterBenchmarkRef.current.add(frame);
        if (benchmark) {
          jitterBenchmarkRef.current = null;
          setJitterTestResult(benchmark);
          setJitterTestRunning(false);
        }
      }
      if (__DEV__ && settings.debugMode && !diagnosticSession.current) {
        const left = result.metrics.leftLandmarks;
        const right = result.metrics.rightLandmarks;
        console.debug(
          `[PoseSides] left(sh=${left.shoulder.toFixed(2)} el=${left.elbow.toFixed(2)} wr=${left.wrist.toFixed(2)} hip=${left.hip.toFixed(2)} kn=${left.knee.toFixed(2)} an=${left.ankle.toFixed(2)} core=${result.metrics.leftCoreConfidence.toFixed(2)} agg=${result.metrics.leftVisibility.toFixed(2)}) right(sh=${right.shoulder.toFixed(2)} el=${right.elbow.toFixed(2)} wr=${right.wrist.toFixed(2)} hip=${right.hip.toFixed(2)} kn=${right.knee.toFixed(2)} an=${right.ankle.toFixed(2)} core=${result.metrics.rightCoreConfidence.toFixed(2)} agg=${result.metrics.rightVisibility.toFixed(2)}) selected=${result.metrics.selectedSide} alternativeBetterMs=${result.metrics.sideSelectionAlternativeBetterMs} reason="${result.metrics.sideSelectionReason}"`,
        );
      }
      const v5Detector =
        detectorVersionRef.current === 'v5' && detectorRef.current instanceof PushupDetectorV5
          ? detectorRef.current
          : null;
      const positioning =
        v5Detector?.getReadiness() ??
        readinessTrackerRef.current.update(
          evaluatePoseQuality(
            detectorPose.landmarks,
            result.metrics.selectedSide,
            {
              coreAggregate: rules.coreLandmarkConfidence,
              supporting: rules.supportingLandmarkConfidence,
              individualCoreFloor: rules.minimumCoreLandmarkConfidence,
              bilateralCore: rules.orientationLandmarkConfidence,
              minimumCoreSegmentLength: rules.minimumCoreSegmentLength,
              minimumTorsoLength: rules.minimumTorsoLength,
              maximumTorsoLength: rules.maximumTorsoLength,
              minimumArmToTorsoRatio: rules.minimumArmToTorsoRatio,
              maximumArmToTorsoRatio: rules.maximumArmToTorsoRatio,
              maximumBilateralSeparationToTorsoRatio: rules.maximumBilateralSeparationToTorsoRatio,
            },
            poseSourceGeometry(detectorPose),
          ),
          detectorPose.timestamp,
        );
      if (
        __DEV__ &&
        detectorVersionRef.current !== 'v6' &&
        positioning.failureReason &&
        positioning.failureReason !== readinessLogRef.current
      ) {
        console.debug(
          `[PoseReadiness] state=${positioning.state} side=${positioning.side} core=${positioning.coreScore.toFixed(2)} individualFloor=${positioning.thresholds.individualCoreFloor.toFixed(2)} coreAggregateThreshold=${positioning.thresholds.coreAggregate.toFixed(2)} supportingThreshold=${positioning.thresholds.supporting.toFixed(2)} blocker="${positioning.failureReason}" geometry=${positioning.geometry ? JSON.stringify(positioning.geometry) : 'not-evaluated'} elbow=${result.metrics.elbowAngle?.toFixed(1) ?? 'null'} body=${result.metrics.bodyAngle?.toFixed(1) ?? 'null'} pushupState=${result.state}`,
        );
        readinessLogRef.current = positioning.failureReason;
      } else if (positioning.failureReason === null) {
        readinessLogRef.current = null;
      }
      diagnosticSession.current?.add(
        rawPose,
        detectorPose,
        result,
        positioning,
        v5Detector?.getDiagnostics() ?? null,
        now,
      );
      if (__DEV__ && traceRecorderRef.current.isRecording()) {
        traceRecorderRef.current.record(
          frame,
          result,
          detectorGate(detectorVersionRef.current, result, positioning),
          positioning,
        );
        const count = traceRecorderRef.current.frameCount();
        if (count % 12 === 0) setTraceFrameCount(count);
      }
      const activeMotion = result.metrics.armState === 'ARMED' || result.state !== 'NOT_READY';
      const displayResult =
        detectorVersionRef.current === 'v6' ||
        activeMotion ||
        positioning.state === 'READY' ||
        result.repCompleted
          ? result
          : { ...result, feedback: positioning.feedback };
      const motionStateChanged = motionStateRef.current !== displayResult.state;
      motionStateRef.current = displayResult.state;
      const shouldPublishUi =
        result.repCompleted ||
        motionStateChanged ||
        now - lastUiUpdateRef.current >= UI_POSE_INTERVAL_MS;
      if (shouldPublishUi) {
        setLatestRawPose(rawPose);
        setLatestDetectorPose(detectorPose);
        setLatestPose(displayPose);
        setReadiness(detectorVersionRef.current === 'v6' ? null : positioning);
        setDetection(displayResult);
        setV5Diagnostics(v5Detector?.getDiagnostics() ?? null);
        lastUiUpdateRef.current = now;
        processingWindow.uiUpdates += 1;
      }
      updateFeedback(displayResult.feedback, result.repCompleted || motionStateChanged);
      if (result.rep) {
        setReps((current) => [...current, result.rep as ExerciseRep]);
        announceRep(result.rep);
        if (!localSolo)
          analytics.track('rep_completed', {
            quality: result.rep.qualityScore,
            index: result.rep.index,
          });
      }
    },
    [
      announceRep,
      rules.coreLandmarkConfidence,
      rules.maximumArmToTorsoRatio,
      rules.maximumBilateralSeparationToTorsoRatio,
      rules.maximumTorsoLength,
      rules.minimumArmToTorsoRatio,
      rules.minimumCoreLandmarkConfidence,
      rules.minimumCoreSegmentLength,
      rules.minimumTorsoLength,
      rules.orientationLandmarkConfidence,
      rules.supportingLandmarkConfidence,
      settings.debugMode,
      settings.haptics,
      options.poseDebug,
      options.onDetectorFrame,
      options.repFeedback,
      options.acceptReps,
      localSolo,
      soloDetector,
      updateFeedback,
    ],
  );

  useEffect(() => {
    if (!localSolo || soloDetector !== 'hybrid') return;
    let cancelled = false;
    let runner: SoloHybridLocal | null = null;
    const abort = new AbortController();
    setSoloModelStatus('Loading Hybrid');
    void (async () => {
      try {
        const { SoloHybridLocal } = await import('@/debug/soloHybridLocal');
        const response = await fetch('http://127.0.0.1:8788/ml-v1-rd.json', {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('Local model unavailable');
        const serialized = await response.text();
        if (cancelled) return;
        runner = new SoloHybridLocal((rep) => {
          if (cancelled || pausedRef.current || endingRef.current) return;
          setReps((current) => [...current, rep]);
          announceRep(rep);
          updateFeedback('FULL REP', true);
        });
        await runner.load(serialized);
        if (cancelled) {
          await runner.dispose();
          return;
        }
        hybridRef.current = runner;
        setSoloModelStatus('Hybrid · Lightning · local R&D');
      } catch {
        if (runner) await runner.dispose();
        if (!cancelled) {
          console.info('[SoloHybrid] model load failed; no Hybrid reps will be counted');
          setSoloModelStatus('Hybrid unavailable — run npm run web:solo-hybrid or select V6 Form');
        }
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      if (hybridRef.current === runner) {
        hybridRef.current = null;
        if (runner) void runner.dispose();
      }
    };
  }, [localSolo, soloDetector, announceRep, updateFeedback]);

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      pausedRef.current = nextPaused;
      if (nextPaused) hybridRef.current?.reset();
      setPausedState((current) => {
        if (current === nextPaused) return current;
        detectorRef.current.setPaused(nextPaused);
        if (nextPaused) {
          readinessTrackerRef.current.reset();
          poseEngineRef.current.reset();
          pausedAtRef.current = Date.now();
          updateFeedback('PAUSED', true);
        } else {
          if (pausedAtRef.current !== null)
            pausedDurationRef.current += Date.now() - pausedAtRef.current;
          pausedAtRef.current = null;
          updateFeedback('REACQUIRE TOP POSITION', true);
        }
        return nextPaused;
      });
    },
    [updateFeedback],
  );

  const finish = useCallback(async (): Promise<{
    session: WorkoutSession;
    previousLifetimeXP: number;
    newAchievementIds: string[];
    localOnly?: boolean;
  } | null> => {
    if (endingRef.current) return null;
    endingRef.current = true;
    setPaused(true);
    const completedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.floor((completedAt.getTime() - startedAtRef.current - pausedDurationRef.current) / 1000),
    );
    const currentDailyReps =
      profile.dailyProgressDate === localDateKey(completedAt) ? profile.dailyPushups : 0;
    const dailyGoalReachedNow =
      currentDailyReps < settings.dailyGoal && currentDailyReps + reps.length >= settings.dailyGoal;
    const xpEarned = calculateWorkoutXP({ reps, completed: true, dailyGoalReachedNow });
    const qualityTotal = reps.reduce((sum, rep) => sum + rep.qualityScore, 0);
    const durationTotal = reps.reduce((sum, rep) => sum + rep.durationMs, 0);
    const session: WorkoutSession = {
      id: createId('workout'),
      exercise: 'pushup',
      mode: config.mode,
      startedAt: new Date(startedAtRef.current).toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds,
      totalReps: reps.length,
      validReps: reps.length,
      averageQuality: reps.length ? Math.round(qualityTotal / reps.length) : 0,
      perfectReps: reps.filter((rep) => rep.qualityScore >= 90).length,
      xpEarned,
      bestRepQuality: reps.length ? Math.max(...reps.map((rep) => rep.qualityScore)) : 0,
      averageRepDuration: reps.length ? Math.round(durationTotal / reps.length) : 0,
      reps,
    };
    try {
      if (localSolo) {
        return {
          session,
          previousLifetimeXP: profile.lifetimeXP,
          newAchievementIds: [],
          localOnly: true,
        };
      }
      const result = await completeWorkout(session);
      analytics.track('workout_completed', { reps: session.validReps, xp: session.xpEarned });
      return {
        session,
        previousLifetimeXP: result.previousLifetimeXP,
        newAchievementIds: result.newAchievementIds,
      };
    } catch {
      endingRef.current = false;
      updateFeedback('WORKOUT COULD NOT BE SAVED — TRY AGAIN', true);
      return null;
    }
  }, [
    completeWorkout,
    config.mode,
    profile.dailyProgressDate,
    profile.dailyPushups,
    profile.lifetimeXP,
    localSolo,
    reps,
    setPaused,
    settings.dailyGoal,
    updateFeedback,
  ]);

  const simulate = useCallback(
    (kind: 'full' | 'bad' | 'lost') => {
      const base = Date.now();
      if (kind === 'lost') {
        processPose(syntheticPose(165, 170, base, 0.1));
        processPose(syntheticPose(165, 170, base + 400, 0.1));
        return;
      }
      const bodyAngle = kind === 'bad' ? 125 : 172;
      [
        [165, 0],
        [165, 550],
        [140, 700],
        [130, 820],
        [85, 960],
        [85, 1080],
        [115, 1250],
        [140, 1380],
        [165, 1540],
        [165, 1680],
      ].forEach(([angle, offset]) =>
        processPose(syntheticPose(angle ?? 165, bodyAngle, base + (offset ?? 0))),
      );
    },
    [processPose],
  );

  const adjustRule = useCallback((key: keyof PushupRules, delta: number) => {
    setRules((current) => {
      const next = { ...current, [key]: current[key] + delta };
      detectorRef.current.setRules(next);
      if (
        key === 'smoothingAlpha' ||
        key === 'motionSmoothingAlpha' ||
        key === 'poseGlitchDistance' ||
        key === 'minimumCoreLandmarkConfidence' ||
        key === 'trackingGraceMs'
      ) {
        poseEngineRef.current.setOptions({
          displayStillAlpha: next.smoothingAlpha,
          displayMotionAlpha: next.motionSmoothingAlpha,
          outlierDistance: next.poseGlitchDistance,
          confidenceFloor: next.minimumCoreLandmarkConfidence,
          signalGraceMs: next.trackingGraceMs,
        });
      }
      if (
        key === 'coreLandmarkConfidence' ||
        key === 'minimumCoreLandmarkConfidence' ||
        key === 'supportingLandmarkConfidence'
      )
        readinessTrackerRef.current.reset();
      return next;
    });
  }, []);

  const resetRules = useCallback(() => {
    const defaults = {
      ...getWorkoutPushupRules(
        detectorVersionRef.current,
        DETECTOR_LAB_ENABLED && options.labFrontView === true,
      ),
    };
    detectorRef.current.setRules(defaults);
    poseEngineRef.current.setOptions({
      displayStillAlpha: defaults.smoothingAlpha,
      displayMotionAlpha: defaults.motionSmoothingAlpha,
      outlierDistance: defaults.poseGlitchDistance,
      confidenceFloor: defaults.minimumCoreLandmarkConfidence,
      signalGraceMs: defaults.trackingGraceMs,
    });
    setRules(defaults);
  }, [options.labFrontView]);

  const resetTracking = useCallback(() => {
    hybridRef.current?.reset(true);
    detectorRef.current.reset();
    poseEngineRef.current.reset();
    readinessTrackerRef.current.reset();
    readinessLogRef.current = null;
    motionStateRef.current = null;
    previousArmStateRef.current = 'DISARMED';
    feedbackRef.current = { value: 'HOLD A CLEAR TOP POSITION', changedAt: Date.now() };
    setReps([]);
    setDetection(null);
    setReadiness(null);
    setLatestRawPose(null);
    setLatestDetectorPose(null);
    setLatestPose(null);
    setV5Diagnostics(null);
    setFeedback(feedbackRef.current.value);
  }, []);

  /** Discard a partial cycle after a source/person change without erasing accepted reps. */
  const invalidatePartialTracking = useCallback(
    (reason = 'tracking-invalidated') => {
      diagnosticSession.current?.trackingReset(reason, Date.now());
      hybridRef.current?.reset();
      detectorRef.current.setPaused(true);
      detectorRef.current.setPaused(false);
      poseEngineRef.current.reset();
      readinessTrackerRef.current.reset();
      readinessLogRef.current = null;
      motionStateRef.current = null;
      previousArmStateRef.current = 'DISARMED';
      setDetection(null);
      setReadiness(null);
      setLatestRawPose(null);
      setLatestDetectorPose(null);
      setLatestPose(null);
      setV5Diagnostics(null);
      updateFeedback('REACQUIRE TOP POSITION', true);
    },
    [updateFeedback],
  );

  const selectSoloDetector = useCallback(
    (version: SoloDetectorVersion) => {
      if (!localSolo || version === soloDetector) return;
      hybridRef.current?.reset(true);
      const detectorVersion = version === 'hybrid' ? DEFAULT_WORKOUT_DETECTOR_VERSION : version;
      const nextRules = getWorkoutPushupRules(detectorVersion);
      detectorVersionRef.current = detectorVersion;
      detectorRef.current = createWorkoutPushupDetector(detectorVersion, nextRules);
      setRules({ ...nextRules });
      resetTracking();
      setDetectorVersion(detectorVersion);
      setSoloDetector(version);
    },
    [localSolo, soloDetector, resetTracking],
  );

  const selectDetectorVersion = useCallback(
    (version: PushupDetectorVersion) => {
      if (!DETECTOR_LAB_ENABLED || detectorVersionRef.current === version) return;
      const nextRules = getWorkoutPushupRules(version, options.labFrontView === true);
      detectorVersionRef.current = version;
      detectorRef.current = createWorkoutPushupDetector(version, nextRules);
      setRules({ ...nextRules });
      poseEngineRef.current.reset();
      readinessTrackerRef.current.reset();
      readinessLogRef.current = null;
      motionStateRef.current = null;
      previousArmStateRef.current = 'DISARMED';
      feedbackRef.current = { value: 'HOLD A CLEAR TOP POSITION', changedAt: Date.now() };
      setReps([]);
      setDetection(null);
      setReadiness(null);
      setLatestRawPose(null);
      setLatestDetectorPose(null);
      setLatestPose(null);
      setV5Diagnostics(null);
      setFeedback(feedbackRef.current.value);
      setDetectorVersion(version);
      setSoloDetector(version);
    },
    [options.labFrontView],
  );

  const startTrace = useCallback(
    (poseModel?: RuntimePoseModelId, runtime?: PoseTraceRuntimeMetadata) => {
      if (!__DEV__) return;
      traceRecorderRef.current.start(new Date(), poseModel ?? latestPoseModelRef.current, runtime);
      lastTraceRef.current = null;
      setTraceFrameCount(0);
      setTraceRecording(true);
    },
    [],
  );

  const stopTrace = useCallback(() => {
    if (!__DEV__) return;
    lastTraceRef.current = traceRecorderRef.current.stop();
    setTraceFrameCount(lastTraceRef.current.frames.length);
    setTraceRecording(false);
  }, []);

  const exportTrace = useCallback((): string | null => {
    if (!__DEV__) return null;
    const trace = traceRecorderRef.current.isRecording()
      ? traceRecorderRef.current.snapshot()
      : lastTraceRef.current;
    return trace ? serializePoseTrace(trace) : null;
  }, []);

  const startJitterTest = useCallback(() => {
    if (!__DEV__) return;
    jitterBenchmarkRef.current = new PoseJitterBenchmark(Date.now());
    setJitterTestResult(null);
    setJitterTestRunning(true);
  }, []);

  const cancelJitterTest = useCallback(() => {
    jitterBenchmarkRef.current = null;
    setJitterTestResult(null);
    setJitterTestRunning(false);
  }, []);

  return {
    paused,
    reps,
    latestPose,
    startDiagnostics,
    reportDiagnosticCamera,
    reportDiagnosticPause,
    stopDiagnostics,
    latestRawPose,
    latestDetectorPose,
    detection,
    readiness,
    feedback,
    elapsedSeconds,
    clockSeconds: workoutClock(config, elapsedSeconds),
    modeComplete: workoutComplete(config, elapsedSeconds, reps.length),
    liveXP: calculateLiveXP(reps),
    processPose,
    setPaused,
    finish,
    simulate,
    rules,
    adjustRule,
    resetRules,
    resetTracking,
    invalidatePartialTracking,
    traceRecording,
    traceFrameCount,
    startTrace,
    stopTrace,
    exportTrace,
    startJitterTest,
    cancelJitterTest,
    jitterTestRunning,
    jitterTestResult,
    detectorDiagnostics,
    detectorVersion,
    selectDetectorVersion,
    v5Diagnostics,
    localSolo,
    soloDetector,
    soloModelStatus,
    selectSoloDetector,
  };
}
