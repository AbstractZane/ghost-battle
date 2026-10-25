/** Copy-only translation of the existing detector's current instruction. */
const hints: Record<string, string> = {
  'POSITION YOUR FULL BODY IN FRAME': 'Keep your full body in view.',
  'BODY NOT VISIBLE': 'Step back until your full body is visible.',
  'MOVE INTO A PLANK POSITION': 'Get into a straight-arm plank.',
  'MOVE INTO TOP POSITION': 'Return to the top of your push-up.',
  'HOLD A CLEAR TOP POSITION': 'Hold a clear top position.',
  'HOLD TOP POSITION': 'Hold the top position steady.',
  'HOLD POSITION': 'Hold steady while tracking settles.',
  'KEEP BODY STRAIGHT': 'Keep your shoulders, hips and ankles in line.',
  'STRAIGHTEN YOUR LEGS': 'Straighten your legs for this mode.',
  'GO LOWER': 'Lower your chest a little further.',
  'FULLY EXTEND': 'Push back up to straight arms.',
  DESCEND: 'Lower with control.',
  'GOOD DEPTH': 'Good depth. Push back up.',
  PUSH: 'Push back up.',
  READY: 'Ready. Move at your own pace.',
  'PERFECT REP': 'Rep counted. Keep your rhythm.',
  'GOOD REP': 'Rep counted. Keep your rhythm.',
  'FULL REP': 'Rep counted. Keep your rhythm.',
  'REP COUNTED': 'Rep counted. Keep your rhythm.',
  PAUSED: 'Paused. Take your time.',
};
export function cameraGuidance(instruction: string) {
  return hints[instruction] ?? instruction;
}
