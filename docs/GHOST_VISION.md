# Ghost Vision delivery

The original video remains the default opponent view. Ghost Vision is optional.

## Implemented

- Cancellable Android video analysis: sequential MediaExtractor/MediaCodec decoding,
  actual presentation timestamps, bundled ONNX inference and bounded worker queue.
  Web uses MoveNet with a CPU fallback when WebGL is unavailable.
- The existing normalized pose pipeline and unchanged push-up counting thresholds.
  Analyze clips up to five minutes; longer clips retain manual marking. Review
  markers and orange tracking gaps before explicitly saving extracted motion.
- Body-only, quantized 12-joint animation with display-only interpolation. Missing
  joints stay hidden. A simple head shape comes from shoulders, not face landmarks.
- Version-2 challenges with version-1 compatibility. Motion-only rounds use an
  active monotonic clock; original-video rounds follow actual playback.
- Accepted-rep timings, simultaneous-event grouping, lead timeline, factual
  winning-lead explanation and rematch target. Pauses/seeks produce practice recaps.
- Explicit share/import of versioned JSON files under 5 MB. Only body motion,
  rep timings, duration, chosen name/title and marking provenance travel. These
  files are editable challenge data, not anti-cheat certificates.

## Privacy and limits

Original imported videos stay on the device. Live camera frames and live landmark
sequences are never recorded. Imported-video motion is persisted only after
review/save. Export is separate and explicit. This user-requested feature is the
narrow exception to the repository guide's development-only landmark-recording
default; it does not authorize live-camera capture or automatic publication.

Sampling up to 15 Hz can miss fast or poorly visible reps. Review and correction
are mandatory. Unsupported codecs have manual-marker recovery. Analysis speed
depends on device. Browser model loading initially requires internet and CPU
analysis can be slow. The unchanged web live-camera estimator still needs WebGL.

## Verification

Validation: 433 tests across 46 files pass, with format, lint and TypeScript checks.
All 27 protected detector/camera/workout modules match their original baseline.
Android build, signature/alignment checks and web export pass. The updated APK
was installed and opened on the connected Samsung phone. The user confirmed
“Analysis works; battle opens.” Real push-up counting and screen recording remain
the presenter's final rehearsal checks; this is not a blanket accuracy claim.

The browser processed existing Kaggle test clip 85, detected one rep, saved and
exported its ghost, imported it, and replayed its body motion without the source.
Phone layout was reviewed at 390×844. That test clip is not the user's judging
footage or a successful physical live-player race.

Expo Doctor retains native/config and native-module metadata warnings, plus five
patch-version mismatches including installed expo-sharing 57.0.22. No SDK upgrade
was attempted during submission preparation. Logs are in `.local-data/ghost-vision-*.log`.

See `GHOST_VISION_FILES.md` for the exact file inventory and `DEMO.md` for the
presentation. Existing work and AI assistance are disclosed in
`HACKATHON_DISCLOSURE.md`.
