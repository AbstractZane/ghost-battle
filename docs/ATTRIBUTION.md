# Attribution and reuse

This standalone app reuses the project owner's PushPVP source with authorization.
The source inventory is in `REUSE_MANIFEST.json`; preserved detector references
are in `DETECTOR_BASELINE.json`. Modified/adapted files and new contributions are
listed in `IMPLEMENTATION.md`. Reuse and AI assistance must be disclosed.

- **PushPVP:** normalized camera and pose adapters, push-up detectors, workout
  session/readiness code, native YOLO bridge, original vector cosmetics,
  UI primitives, sounds, and victory decoration.
- **MoveNet / TensorFlow:** existing bundled Lightning and Thunder models and
  TFJS browser estimation. See the retained `THIRD_PARTY_NOTICES.md` inventory
  and dependency licenses; do not claim model training as Ghost Battle work.
- **MMPose / ONNX Runtime:** retained native-module/model dependencies. License
  texts are in `assets/licenses/` and are packaged with the Android model.
- **Expo / React / React Native / navigation and other libraries:** existing
  dependencies pinned in the lockfile retain their own licenses.
- **Ghost emblem and new interface:** original vector/code work in this pass,
  created with Codex assistance. No new third-party character artwork was taken.
- **Presenter video/photos:** explicitly selected local files. The presenter is
  responsible for permission to use and show those files. No sample person's
  footage is bundled with the app.

The inherited notices may describe additional PushPVP assets not included in this
standalone app. No repository publication or open-source relicensing is implied.
Do not publish private user footage, app storage, environment files, debug traces,
credentials, or local build caches.
