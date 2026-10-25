# PushForge agent guide

Read the exact Expo SDK 57 documentation at <https://docs.expo.dev/versions/v57.0.0/> before changing native packages.

## Required practices

- Use TypeScript strict mode. Avoid `any` unless a native boundary makes it unavoidable and document the reason.
- Run `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test` before completing work.
- Preserve the `PoseEstimator` and normalized `PoseResult` boundaries. UI and exercise detectors must not consume library-specific model output.
- Keep pose estimation, pushup classification, workout session logic, game progression, storage, and UI separate.
- Do not upload, log, or persist camera frames. Landmark recording must remain explicit, development-only, and opt-in if added later.
- Maintain or expand synthetic sequence tests whenever detector transitions change.
- Keep every biomechanics threshold in `src/exercises/pushup/pushupRules.ts`. Document real-world threshold changes in `docs/POSE_TUNING.md`.
- Do not silently change XP amounts, level curves, streak semantics, daily-goal behavior, or achievement criteria.
- Do not add a large dependency without documenting why the existing stack cannot solve the problem.
- Keep high-frequency pose state local to the workout flow; do not send frame-by-frame values through the global store.
- A native camera or pose change requires a new development build. Expo Go is not a valid test environment for pose inference.
- Never claim camera alignment or recognition accuracy without testing on representative physical Android and iOS devices.
- Do not break pose tracking.
- Do not trust a client-provided score; the server calculates official results.
- Do not store raw video by default.
- Do not use real creator branding without authorization.
- Do not bypass moderation requirements.
- Run the complete test suite after multiplayer changes.
- Keep bot and human opponent states explicit. Never disguise bots as humans.

## Completion checks

Search for TODOs/placeholders, inspect changed files, run `npm run validate`, run `npx expo-doctor`, and attempt the relevant native or EAS build. Update the known limitations if hardware validation was not possible.
