# Ghost Battle

A standalone push-up challenge app built on the existing PushPVP tracking core.
Import a workout video, discover its reps, review the markers, and race that
recorded performance with your own live camera. The **original video is the default
opponent view**. Ghost Vision is optional. Reviewed motion ghosts can be shared
without their original footage. Opponents are clearly identified as recorded.

Android is the primary judging target. The same interface also runs on web.
There are no accounts, server costs, subscriptions, ranked ratings, or pretend XP.

## Try it

The packaged APK is in `.local-data/releases/` on the development machine.
Its app name is **Ghost Battle**, package `com.pushpvp.ghostbattle`. It installs
alongside PushPVP and uses its own private storage; it does not update or reset
the existing PushPVP app.

1. Open Ghost Battle and choose **Create your first ghost**.
2. Choose your own video. Use footage you have permission to use.
3. Tap **Auto-find reps** for clips up to five minutes. Inspect its markers and
   orange tracking gaps; correct misses with **Mark +1**, Remove or Undo.
   Confirm review to save extracted body motion. Manual-only videos up to
   30 minutes continue to work.
4. Choose **Save & race ghost**, or save to the library for later.
5. Allow camera access, place the phone so your body is visible, and get into
   the detector's ready position. Fresh tracking starts the three-second countdown.
6. Do push-ups. Your accepted reps compete against the video's marked reps.
   The full clip sets the round length. The scoreboard shows the lead, difference,
   remaining time, and progress. Muting is available in the battle menu.
7. View WIN, LOSS, or TIE, the actual scores, margin, and comparison bars.
   Open **Where did the race turn?** for the measured lead timeline. Paused or
   sought rounds are identified as practice. Rematch races the same performance.
8. **Share motion ghost** exports reviewed body motion, timings and chosen
   name/title. **Import a shared ghost** replays it without the original footage.
   Challenge files are user-authored, not verified ranked results.

The battle menu pauses both sides, lets you recover/flip the camera, restart the
challenge, or return to the library. Resuming gives the camera a fresh liveness
window and discards partial rep tracking. Saved challenges are replayable after
restarting the app. Editing requires an explicit save; imported original files
are never deleted by the app.

## Develop and verify

Use Node 22+ and the locked Expo SDK 57 dependencies:

```powershell
npm ci
npm run validate
npm run verify:detector
npm run web
```

For Android camera inference, use a native build rather than Expo Go:

```powershell
npm run android
# Or the local ARM64 standalone release variant, debug-signed for testing:
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/build-android.ps1
```

The local script expects the documented toolchain layout in
`.tools/android-toolchain`, or the directory named by `GHOST_ANDROID_TOOLCHAIN`:
JDK `java/jdk-17.0.20.1+1`, Android SDK in `sdk`, SDK/build tools 36,
NDK 27.1.12297006, and CMake 3.30.5. The installed machine uses ignored junctions
to an existing dependency/toolchain installation to avoid duplicating gigabytes.
Those junctions are not part of the repo. A fresh clone uses `npm ci` and its own
toolchain. All source, local native-module code, bundled models and model licenses
needed by the app are in this repo; no PushPVP environment file is required.

Web camera tracking requires localhost or HTTPS and browser permission. The
browser stores selected video Blobs and metadata in IndexedDB; reload creates
fresh playback URLs. Its first pose-model load needs internet. Browser storage
can be cleared/evicted by the browser, and unsupported codecs must be re-imported
as a compatible MP4. Android uses the existing bundled inference models.

## Reliability and privacy

- Ghost score is the count of unique, sorted timestamps at or before actual
  playback time. It is not an incrementing wall-clock simulation.
- Pauses/buffering stop camera scoring. Explicit media seeks recompute the ghost
  position without adding or removing accepted camera reps.
- A restart creates a fresh round and detector session. Clip completion, not an
  independent timer, finalizes the result.
- Missing files, decoding errors, camera errors and camera stalls have recovery
  or library exits. Paused/stale/duplicate camera rep indices cannot score.
- Live camera frames and landmarks stay on-device and are not saved or uploaded.
  Imported-video body motion is saved only after explicit review/save. Exports
  omit video, audio, facial landmarks, portraits and local paths. Android backup,
  microphone and phone-state access are disabled for this standalone app.
- No new backend, external AI service, automatic pose simulation, or changed
  counting thresholds. Twenty-seven protected camera/workout/detector modules
  are checked against the original PushPVP baseline.

See [verification](docs/VERIFICATION.md), [the demo walkthrough](docs/DEMO.md),
[prior-work disclosure](docs/HACKATHON_DISCLOSURE.md), and
[the exact implementation file list](docs/IMPLEMENTATION.md).

## Attribution

PushPVP's existing video challenge, pose/workout code, custom native camera
module, original cosmetics and victory effects were reused with the project
owner's authorization. This is an AI-assisted implementation, not a claim that
the entire stack was written during the hackathon. See
[attribution](docs/ATTRIBUTION.md) and [the reuse inventory](docs/REUSE_MANIFEST.json).
