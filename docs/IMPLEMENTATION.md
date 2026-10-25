# Exact implementation file inventory

All application work is in this separate repo. The original PushPVP baseline was restored.
The inherited source inventory and hashes are in `REUSE_MANIFEST.json`.

## New source files

- `src/creator/GhostChallengeLibrary.tsx`
- `src/creator/GhostClipEditor.tsx`
- `src/creator/GhostInsignia.tsx`
- `src/creator/GhostResultsOverlay.tsx`
- `src/creator/GhostScoreboard.tsx`
- `src/creator/browserStore.ts`
- `src/creator/clipRepository.web.test.ts`
- `src/creator/clipRepository.web.ts`
- `src/creator/ghostChallengeRepository.test.ts`
- `src/creator/ghostChallengeRepository.ts`
- `src/creator/ghostChallenges.test.ts`
- `src/creator/ghostChallenges.ts`
- `src/creator/ghostPersistence.ts`
- `src/creator/ghostPersistence.web.ts`
- `src/creator/studioProfilesRepository.web.ts`

## Adapted inherited files

- `App.tsx`
- `android/app/build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/settings.gradle`
- `scripts/build-android.ps1`
- `src/components/PlayerAvatar.tsx`
- `src/creator/CreatorStudioScreen.test.tsx`
- `src/creator/CreatorStudioScreen.tsx`
- `src/creator/StudioProfilesEditor.tsx`
- `src/creator/VideoBattleScreen.test.tsx`
- `src/creator/VideoBattleScreen.tsx`
- `src/creator/clipRepository.ts`
- `src/creator/studioProfiles.ts`
- `src/creator/videoRival.ts`
- `src/store/appStore.ts`
- `src/types/models.ts`
- `src/types/navigation.ts`

## Bundled native model/license inputs

- `assets/models/yoloxpose_tiny_416_raw.onnx` (existing licensed model, not new training)
- `assets/licenses/MMPose-LICENSE.txt`
- `assets/licenses/onnxruntime-1.22.0-LICENSE.txt`

## New standalone tooling/documentation

- `README.md`, `app.json`, `index.ts`, `.gitignore`
- `package.json`, `package-lock.json` (standalone name and portable lockfile)
- `qa/ResultsLayout.tsx`, `qa/index.results.ts` (separate visual test only)
- `scripts/verify-detector-reuse.mjs`
- `docs/DETECTOR_BASELINE.json`, `docs/REUSE_MANIFEST.json`
- `docs/HACKATHON_DISCLOSURE.md`, `docs/ATTRIBUTION.md`
- `docs/DEMO.md`, `docs/VERIFICATION.md`, `docs/IMPLEMENTATION.md`

## Excluded from the standalone copy

Unneeded rating/reward/card assets and types were removed only from the new repo.
The original PushPVP copies were not deleted.

- `assets/ranks/bronze.png`
- `assets/ranks/diamond.png`
- `assets/ranks/emerald.png`
- `assets/ranks/forge-master.png`
- `assets/ranks/gold.png`
- `assets/ranks/inferno.png`
- `assets/ranks/iron.png`
- `assets/ranks/master.png`
- `assets/ranks/platinum.png`
- `assets/ranks/silver.png`
- `src/components/ForgedRankEmblem.tsx`
- `src/components/RankEmblem.tsx`
- `src/components/rankArtwork.ts`
- `src/components/rankMotion.ts`
- `src/game/levels.ts`
- `src/game/ranking/rankTiers.ts`
- `src/game/ranking/rankingTypes.ts`
- `src/multiplayer/results/MatchRewardCard.tsx`
- `src/multiplayer/results/RankResultCard.tsx`
- `src/multiplayer/results/battleResultPresentation.ts`
- `src/multiplayer/results/matchResultModels.ts`
- `src/multiplayer/rivalry/rivalryModels.ts`
- `src/multiplayer/types.ts`
