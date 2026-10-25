export interface PushupRules {
  /** Experimental lab acquisition only; production remains on its saved policy. */
  labAllowFrontViewPlank: 0 | 1;
  frontViewHipAboveShoulderRatio: number;
  frontViewWristBelowHipRatio: number;
  frontViewSevereFoldedKneeAngle: number;
  frontViewMinimumLowerLegRatio: number;
  upElbowAngle: number;
  leaveUpElbowAngle: number;
  downElbowAngle: number;
  strongBottomAngle: number;
  leaveDownElbowAngle: number;
  idealBodyAngle: number;
  minimumBodyAngle: number;
  severeBodyAngle: number;
  coreLandmarkConfidence: number;
  supportingLandmarkConfidence: number;
  minimumCoreLandmarkConfidence: number;
  orientationLandmarkConfidence: number;
  minimumCoreSegmentLength: number;
  minimumTorsoLength: number;
  maximumTorsoLength: number;
  minimumArmToTorsoRatio: number;
  maximumArmToTorsoRatio: number;
  maximumBilateralSeparationToTorsoRatio: number;
  sideSwitchFailureMs: number;
  emergencySideFailoverMs: number;
  maximumPlankTorsoAngle: number;
  minimumPlankBodySpan: number;
  lowerBodyLandmarkConfidence: number;
  standardMinimumKneeAngle: number;
  modifiedMaximumKneeAngle: number;
  minimumLegChainAngle: number;
  standardMinimumAnkleExtensionRatio: number;
  modifiedMinimumAnkleDeviationRatio: number;
  lowerBodyVariantConfirmationMs: number;
  contextEntryConfirmationMs: number;
  contextExitConfirmationMs: number;
  trackingGraceMs: number;
  armingConfirmationMs: number;
  bottomConfirmationMs: number;
  topConfirmationMs: number;
  readyConfirmationMs: number;
  minimumRepDurationMs: number;
  minimumMotionVelocity: number;
  nearTopElbowAngle: number;
  topReversalWindowMs: number;
  topReversalVelocity: number;
  poseGlitchDistance: number;
  smoothingAlpha: number;
  motionSmoothingAlpha: number;
  feedbackCooldownMs: number;
  v5ReadinessWindowMs: number;
  v5ReadyEnterQuality: number;
  v5ReadyRemainQuality: number;
  v5CriticalConfidenceEnter: number;
  v5CriticalConfidenceRemain: number;
  v5SupportingConfidenceEnter: number;
  v5StabilityEnter: number;
  v5StabilityRemain: number;
  v5ReadyConfirmationMs: number;
  v5ReadyExitGraceMs: number;
  v5SideScoreAlpha: number;
  v5SideSwitchMargin: number;
  v5SideSwitchConfirmationMs: number;
  v5SideEmergencyConfirmationMs: number;
  v5SideLockMs: number;
  v5MinimumBodySpan: number;
  v5MaximumBodySpan: number;
  v5MaximumTorsoAngle: number;
  v5MaximumStableTorsoMotion: number;
  v5TopConfirmationMs: number;
  v5DescentConfirmationMs: number;
  v5BottomConfirmationMs: number;
  v5AscentConfirmationMs: number;
  v5ReturnTopConfirmationMs: number;
  v5MinimumRepDurationMs: number;
  v5MaximumRepDurationMs: number;
  v5TrackingLossResetMs: number;
  v5MaximumAngularVelocity: number;
  /** V6 is an intentionally small motion-only candidate. Its thresholds are
   * centralized here so camera experiments never hide biomechanics in UI code. */
  v6ArmLandmarkConfidence: number;
  v6ReadyConfirmationMs: number;
  v6TopElbowAngle: number;
  v6StartDescentElbowAngle: number;
  v6BottomElbowAngle: number;
  v6BottomEvidenceElbowAngle: number;
  v6StrongBottomElbowAngle: number;
  v6BottomConfirmationMs: number;
  v6StartAscentElbowAngle: number;
  v6ReturnTopElbowAngle: number;
  v6MinimumRepDurationMs: number;
  v6MaximumRepDurationMs: number;
  v6TrackingGraceMs: number;
  /** Count-time arm-artifact guard; enabled only in the Form candidate. */
  v6RejectArmArtifacts: 0 | 1;
  v6MaximumAngularVelocity: number;
  v6VariantLandmarkConfidence: number;
  v6SupportingAnkleConfidence: number;
  v6ModifiedKneeAngle: number;
  v6ModifiedEvidenceMs: number;
  /** Preserve, but do not accrue, knee evidence during brief UNKNOWN samples. */
  v6ModifiedUnknownGraceMs: number;
  v6UprightTorsoAngle: number;
  v6UprightWristAboveHipRatio: number;
  v6UprightEvidenceMs: number;
}

/** Local R&D-only candidate and safety thresholds for the ML V1 hybrid experiment. */
export interface HybridPushupRules {
  minimumProjectedSegment: number;
  maximumProjectedSegment: number;
  maximumProjectedProportion: number;
  outlierRecoveryMs: number;
  armLandmarkConfidence: number;
  topishElbowAngle: number;
  bottomishElbowAngle: number;
  minimumExcursionDegrees: number;
  reversalDegrees: number;
  returnTopElbowAngle: number;
  minimumDirectionalVelocity: number;
  minimumDurationMs: number;
  maximumDurationMs: number;
  trackingGraceMs: number;
  maximumAngularVelocity: number;
  maximumTorsoAngle: number;
  maximumRootDisplacement: number;
  minimumHorizontalBodyRatio: number;
  minimumReliableArmRatio: number;
  minimumBodySamples: number;
  maximumSevereBodyRatio: number;
  modifiedEvidenceMs: number;
  contextBeforeMs: number;
  contextAfterMs: number;
  modelSampleIntervalMs: number;
}

export const HYBRID_PUSHUP_RULES: Readonly<HybridPushupRules> = {
  minimumProjectedSegment: 0.005,
  maximumProjectedSegment: 0.75,
  maximumProjectedProportion: 4,
  outlierRecoveryMs: 100,
  armLandmarkConfidence: 0.15,
  topishElbowAngle: 135,
  bottomishElbowAngle: 120,
  minimumExcursionDegrees: 35,
  reversalDegrees: 8,
  returnTopElbowAngle: 140,
  minimumDirectionalVelocity: 10,
  minimumDurationMs: 450,
  maximumDurationMs: 8_000,
  trackingGraceMs: 650,
  maximumAngularVelocity: 900,
  maximumTorsoAngle: 60,
  maximumRootDisplacement: 0.16,
  minimumHorizontalBodyRatio: 0.6,
  minimumReliableArmRatio: 0.55,
  minimumBodySamples: 2,
  maximumSevereBodyRatio: 0.4,
  modifiedEvidenceMs: 400,
  contextBeforeMs: 600,
  contextAfterMs: 400,
  modelSampleIntervalMs: 200,
};

export const DEFAULT_PUSHUP_RULES: Readonly<PushupRules> = {
  labAllowFrontViewPlank: 0,
  frontViewHipAboveShoulderRatio: 0.1,
  frontViewWristBelowHipRatio: 0.25,
  frontViewSevereFoldedKneeAngle: 70,
  frontViewMinimumLowerLegRatio: 0.3,
  upElbowAngle: 155,
  leaveUpElbowAngle: 145,
  downElbowAngle: 90,
  strongBottomAngle: 85,
  leaveDownElbowAngle: 105,
  idealBodyAngle: 170,
  minimumBodyAngle: 150,
  severeBodyAngle: 135,
  coreLandmarkConfidence: 0.3,
  supportingLandmarkConfidence: 0.22,
  minimumCoreLandmarkConfidence: 0.18,
  orientationLandmarkConfidence: 0.5,
  minimumCoreSegmentLength: 0.015,
  minimumTorsoLength: 0.04,
  maximumTorsoLength: 0.8,
  minimumArmToTorsoRatio: 0.12,
  maximumArmToTorsoRatio: 2.5,
  maximumBilateralSeparationToTorsoRatio: 0.75,
  sideSwitchFailureMs: 1200,
  emergencySideFailoverMs: 200,
  maximumPlankTorsoAngle: 45,
  minimumPlankBodySpan: 0.2,
  lowerBodyLandmarkConfidence: 0.35,
  standardMinimumKneeAngle: 150,
  modifiedMaximumKneeAngle: 135,
  minimumLegChainAngle: 145,
  standardMinimumAnkleExtensionRatio: 0.55,
  modifiedMinimumAnkleDeviationRatio: 0.55,
  lowerBodyVariantConfirmationMs: 200,
  contextEntryConfirmationMs: 400,
  contextExitConfirmationMs: 100,
  trackingGraceMs: 600,
  armingConfirmationMs: 300,
  bottomConfirmationMs: 50,
  topConfirmationMs: 0,
  readyConfirmationMs: 350,
  minimumRepDurationMs: 220,
  minimumMotionVelocity: 20,
  nearTopElbowAngle: 150,
  topReversalWindowMs: 180,
  topReversalVelocity: 20,
  poseGlitchDistance: 0.22,
  smoothingAlpha: 0.28,
  motionSmoothingAlpha: 0.82,
  feedbackCooldownMs: 750,
  v5ReadinessWindowMs: 700,
  v5ReadyEnterQuality: 72,
  v5ReadyRemainQuality: 58,
  v5CriticalConfidenceEnter: 0.32,
  v5CriticalConfidenceRemain: 0.18,
  v5SupportingConfidenceEnter: 0.12,
  v5StabilityEnter: 0.7,
  v5StabilityRemain: 0.45,
  v5ReadyConfirmationMs: 150,
  v5ReadyExitGraceMs: 600,
  v5SideScoreAlpha: 0.3,
  v5SideSwitchMargin: 0.12,
  v5SideSwitchConfirmationMs: 450,
  v5SideEmergencyConfirmationMs: 250,
  v5SideLockMs: 700,
  v5MinimumBodySpan: 0.2,
  v5MaximumBodySpan: 0.92,
  v5MaximumTorsoAngle: 50,
  v5MaximumStableTorsoMotion: 0.035,
  v5TopConfirmationMs: 160,
  v5DescentConfirmationMs: 60,
  v5BottomConfirmationMs: 80,
  v5AscentConfirmationMs: 60,
  v5ReturnTopConfirmationMs: 80,
  v5MinimumRepDurationMs: 280,
  v5MaximumRepDurationMs: 10000,
  v5TrackingLossResetMs: 500,
  v5MaximumAngularVelocity: 900,
  // V6 deliberately uses only a visible shoulder-elbow-wrist chain to admit
  // a rep. Hip, knee, and ankle data improve the resulting form score when
  // available, but never decide whether the camera is "ready" to count.
  v6ArmLandmarkConfidence: 0.18,
  v6ReadyConfirmationMs: 160,
  v6TopElbowAngle: 150,
  v6StartDescentElbowAngle: 138,
  v6BottomElbowAngle: 100,
  // Corroborate marginal depth across nearby samples without demanding a
  // still bottom hold. A clearly deep sample preserves sparse-frame counting.
  v6BottomEvidenceElbowAngle: 118,
  v6StrongBottomElbowAngle: 85,
  v6BottomConfirmationMs: 60,
  v6StartAscentElbowAngle: 118,
  v6ReturnTopElbowAngle: 145,
  v6MinimumRepDurationMs: 220,
  v6MaximumRepDurationMs: 10_000,
  v6TrackingGraceMs: 650,
  v6RejectArmArtifacts: 0,
  v6MaximumAngularVelocity: 900,
  v6VariantLandmarkConfidence: 0.45,
  v6SupportingAnkleConfidence: 0.22,
  v6ModifiedKneeAngle: 125,
  v6ModifiedEvidenceMs: 250,
  v6ModifiedUnknownGraceMs: 0,
  v6UprightTorsoAngle: 75,
  v6UprightWristAboveHipRatio: 0.2,
  v6UprightEvidenceMs: 300,
};

/** Lab-only hypothesis: setup hold time, not rep depth, is blocking acquisition.
 * Never applied to production workouts. Compare against the untouched V4 rules. */
export const COMPARISON_FAST_START_RULES: Readonly<PushupRules> = {
  ...DEFAULT_PUSHUP_RULES,
  contextEntryConfirmationMs: 150,
  armingConfirmationMs: 120,
};

/** Opt-in lab profiles. Defaults above remain the rollback/production baseline. */
export const LAB_V4_FLOW_RULES: Readonly<PushupRules> = {
  ...COMPARISON_FAST_START_RULES,
  upElbowAngle: 150,
  leaveUpElbowAngle: 140,
  nearTopElbowAngle: 145,
  downElbowAngle: 100,
  leaveDownElbowAngle: 110,
  minimumMotionVelocity: 10,
  topReversalVelocity: 10,
};

export const LAB_V6_FORM_RULES: Readonly<PushupRules> = {
  ...DEFAULT_PUSHUP_RULES,
  // Arm acquisition is unchanged. Side-test quarter reps crossed the old
  // 100-degree/marginal-depth rule; require corroborated 85-degree evidence.
  // A clearly deep 70-degree observation retains sparse-frame support.
  v6BottomElbowAngle: 85,
  v6BottomEvidenceElbowAngle: 85,
  v6StrongBottomElbowAngle: 70,
  v6BottomConfirmationMs: 80,
  v6VariantLandmarkConfidence: 0.35,
  v6ModifiedKneeAngle: 135,
  v6ModifiedEvidenceMs: 160,
  v6ModifiedUnknownGraceMs: 180,
  v6UprightEvidenceMs: 160,
  v6UprightWristAboveHipRatio: 0.1,
  v6RejectArmArtifacts: 1,
};

export const LAB_V6_STEADY_RULES: Readonly<PushupRules> = {
  ...DEFAULT_PUSHUP_RULES,
  v6MinimumRepDurationMs: 400,
  v6BottomConfirmationMs: 100,
  v6ReturnTopElbowAngle: 150,
};

/** Signed projection policy; it does not change server scoring.
 * A vertical torso projection can be a plank. Signed hips/hands evidence is
 * required instead of simply raising the maximum horizontal torso angle. */
export function withLabFrontViewRules(rules: Readonly<PushupRules>): Readonly<PushupRules> {
  return {
    ...rules,
    labAllowFrontViewPlank: 1,
    v6ModifiedUnknownGraceMs: 180,
    // Still requires hips below shoulders AND wrists above hips on both sides.
    v6UprightTorsoAngle: 65,
  };
}

/** Exact V6 Form profile used in the September 28 front/side phone comparison.
 * Keep the reference/default V4 rules above unchanged for reproducible rollback.
 * This is the workout candidate default, not a claim of release acceptance. */
export const WORKOUT_V6_FORM_RULES: Readonly<PushupRules> =
  withLabFrontViewRules(LAB_V6_FORM_RULES);
