import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import { PushupDetectorV5 } from '@/exercises/pushup/v5/PushupDetectorV5';
import { PushupDetectorV6 } from '@/exercises/pushup/v6/PushupDetectorV6';
import { PositiveLegPushupDetector } from '@/exercises/pushup/lab/PositiveLegPushupDetector';
import {
  COMPARISON_FAST_START_RULES,
  DEFAULT_PUSHUP_RULES,
  LAB_V4_FLOW_RULES,
  LAB_V6_FORM_RULES,
  LAB_V6_STEADY_RULES,
  WORKOUT_V6_FORM_RULES,
  withLabFrontViewRules,
  type PushupRules,
} from '@/exercises/pushup/pushupRules';

export type LabCandidateId =
  'v4' | 'v4-fast' | 'v5' | 'v6' | 'v4-flow' | 'v6-form' | 'v6-steady' | 'v6-legs';
export interface LabCandidateDefinition {
  id: LabCandidateId;
  label: string;
  version: 'v4' | 'v5' | 'v6';
  input: 'raw' | 'filtered';
  rules: Readonly<PushupRules>;
  description: string;
  create(): ExerciseDetector;
}

/** One registry for live comparison and offline evaluation; not a production selector. */
const BASE_LAB_CANDIDATES: readonly LabCandidateDefinition[] = [
  {
    id: 'v4',
    label: 'V4 BASE',
    version: 'v4',
    input: 'filtered',
    rules: DEFAULT_PUSHUP_RULES,
    description: 'Unchanged V4 reference: strict body/leg checks and current motion gates.',
    create: () => new PushupDetector(),
  },
  {
    id: 'v4-fast',
    label: 'V4 FAST',
    version: 'v4',
    input: 'filtered',
    rules: COMPARISON_FAST_START_RULES,
    description: 'Only shorter setup holds; original V4 depth and form checks.',
    create: () => new PushupDetector({ ...COMPARISON_FAST_START_RULES }),
  },
  {
    id: 'v5',
    label: 'V5 REF',
    version: 'v5',
    input: 'filtered',
    rules: DEFAULT_PUSHUP_RULES,
    description: 'Existing V5, unchanged: temporal readiness and one selected arm.',
    create: () => new PushupDetectorV5(),
  },
  {
    id: 'v6',
    label: 'V6 BASE',
    version: 'v6',
    input: 'raw',
    rules: DEFAULT_PUSHUP_RULES,
    description: 'Current responsive arm-cycle counter. Unknown legs remain permissive.',
    create: () => new PushupDetectorV6(),
  },
  {
    id: 'v4-flow',
    label: 'V4 FLOW',
    version: 'v4',
    input: 'filtered',
    rules: LAB_V4_FLOW_RULES,
    description:
      'Easier top/velocity acquisition and 100-degree depth; retains V4 body/leg checks.',
    create: () => new PushupDetector({ ...LAB_V4_FLOW_RULES }),
  },
  {
    id: 'v6-form',
    label: 'V6 FORM',
    version: 'v6',
    input: 'raw',
    rules: LAB_V6_FORM_RULES,
    description:
      'Same arm readiness; corroborated depth, arm-jump guard and earlier knee/upright vetoes.',
    create: () => new PushupDetectorV6({ ...LAB_V6_FORM_RULES }),
  },
  {
    id: 'v6-steady',
    label: 'V6 STEADY',
    version: 'v6',
    input: 'raw',
    rules: LAB_V6_STEADY_RULES,
    description: 'Same readiness/depth; longer cycle, more bottom corroboration and fuller return.',
    create: () => new PushupDetectorV6({ ...LAB_V6_STEADY_RULES }),
  },
  {
    id: 'v6-legs',
    label: 'V6 LEGS',
    version: 'v6',
    input: 'raw',
    rules: LAB_V6_FORM_RULES,
    description:
      'Count-time positive straight-leg confirmation. Hidden ankles can block a real rep.',
    create: () => new PositiveLegPushupDetector(),
  },
];

export const DETECTOR_LAB_CANDIDATES: readonly LabCandidateDefinition[] = BASE_LAB_CANDIDATES.map(
  (profile) => {
    const rules =
      profile.id === 'v6-form' ? WORKOUT_V6_FORM_RULES : withLabFrontViewRules(profile.rules);
    return {
      ...profile,
      rules,
      description: `${profile.description} Experimental signed front-plank acquisition enabled.`,
      create: () =>
        profile.id === 'v6-legs'
          ? new PositiveLegPushupDetector(rules)
          : profile.version === 'v4'
            ? new PushupDetector({ ...rules })
            : profile.version === 'v5'
              ? new PushupDetectorV5({ ...rules })
              : new PushupDetectorV6({ ...rules }),
    };
  },
);
