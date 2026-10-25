# Verification and physical acceptance

October 25, 2026. Android is the primary demo target. Build/test records are under
`.local-data/`; they are private artifacts, not repository source or submissions.

Final result: **416 passing tests / 44 passing files**, strict TypeScript, lint,
formatting and the 27-module preservation check passed. Android ARM64 assembly,
signature and alignment passed; the final web export passed. The portable
lockfile passed an offline `npm ci --dry-run` check without the original repo.
The APK is `.local-data/releases/GhostBattle-Android-2026-10-25.apk`.
SHA-256: `936AB19C13126E91091D5A59DD199C263EB38E27ADB648B440FB0A2A52C98554`.
It is 120,741,438 bytes, version 0.1.0, package `com.pushpvp.ghostbattle`.
Installation is pending because no ADB device is attached.

## Automated and browser checks

- Formatting, ESLint, strict TypeScript and the full copied-core/new-feature test
  suite are required by `npm run validate`. Exact final counts are recorded in
  the release receipt and `.local-data/ghost-validate-final.log`.
- `npm run verify:detector` checks 27 camera/workout/push-up modules against the
  original PushPVP baseline, normalizing only CRLF/LF line endings. Counting
  thresholds and the normalized pose interface have not changed.
- Tests cover sorted/duplicate markers, backward/forward seek state, real rep
  deduplication, paused/buffering frames, clip completion and early endings,
  wins/losses/ties, margins, concurrent library writes, retry after storage
  errors, missing files, picker cancellation, edits, undo and complete setup
  navigation. Screen tests use explicitly synthetic detector fixtures; they
  do not demonstrate physical recognition accuracy.
- Native release-before-cleanup regressions still throw if a released video
  player is paused. Tests cover consecutive video replacements and mounted blur.
- Additional tests cover a silent camera stall, deliberate recovery, restart,
  a fresh liveness window after a long pause, and stale event payloads.
- Browser video storage tests verify that a reload recreates valid playback
  URLs from saved Blobs instead of persisting an expired URL as usable media.
- A local browser check imported an original, clearly labeled QA-only color clip,
  marked two positions, rewound the counter, saved, reloaded, reopened the editor,
  and entered the actual camera setup. It did not fabricate a tracked workout.
  That browser preview retains the clearly labeled QA challenge; no test video
  or fake performance is bundled into the Android app.
- Phone-size library/editor layouts and full-frame video were reviewed at
  390×844. Results are additionally reviewed using `qa/ResultsLayout.tsx`, a
  separate static visual-test entry never imported by the real app.

The browser check found and corrected two real integration issues: SDK 57 web
readiness does not emit `sourceLoad`, and an absolutely positioned HTML video
needs explicit percentage width/height to avoid retaining its intrinsic size.

## Builds and known tooling findings

Android ARM64 release assembly, debug signing, 16 KB alignment and standalone
package checks are performed by `scripts/build-android.ps1`. The final APK receipt
records the exact hash. A separate package prevents replacing PushPVP.

Expo Doctor reports 18/21 checks passing. Remaining inherited findings concern
native/config synchronization, native-module metadata/New Architecture support,
and four Expo patch versions. These warnings were not hidden or addressed with
an unrelated SDK upgrade. The native manifest is checked directly for the app
ID, orientation, disabled backup and removed microphone/phone-state permissions.

The lockfile must contain normal registry/local-package references, with no
`../pushforge` or machine-specific paths. The development machine's ignored
dependency/toolchain junctions are a local convenience, not a runtime dependency.
No environment file, production credentials or selected personal video is copied
into the repository or web export.

## Still needs a real phone

ADB had no attached device during this pass. APK build success is not an install
or a physical acceptance test. Before presenting:

1. Install Ghost Battle on the Android recording phone. It should coexist with
   PushPVP, request camera access, and require no microphone permission.
2. Choose the presenter's actual clip and test decoding, marker accuracy,
   rotation/letterboxing, portrait and landscape layouts, names and photos.
3. Perform representative real push-ups in the intended camera position/light.
   Confirm one accepted rep per completed movement, readiness/countdown, the
   existing form criteria and tracking-loss recovery. No new accuracy claim is
   made by this work.
4. Test backgrounding, calls, a long pause, camera flip, restart, app relaunch,
   low storage, inaccessible media and a full natural win/loss/tie.
5. Check simultaneous camera inference/video performance, heat/battery use,
   mute, haptics, reduced motion, enlarged text and Android screen-recording sound.

No online sharing, challenge leaderboard, personal-best ranking, paid feature,
production deployment or hackathon submission is included. Those optional items
were deferred to keep the core mode and its claims focused.
