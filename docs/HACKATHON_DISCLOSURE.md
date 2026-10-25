# HackOHI/O 2026 disclosure draft

Prepared October 25, 2026 (America/New_York). Review against the final submission.
This document does not register, submit, accept a waiver, or certify eligibility.

## Existing work

PushPVP existed before this standalone Ghost Battle pass and had already been
publicly deployed. Its prior implementation included camera pose estimation,
the normalized push-up detector and workout hook, calibration/readiness rules,
local video selection, basic manual rep timestamps, a basic video-opponent round,
editable player names/photos, and shared UI/audio/victory effects. The recent
website-style Studio result preview also existed. None of that is claimed as
newly invented during this pass.

The exact official event start relative to earlier PushPVP work has not been
independently established here. The reuse inventory identifies the source before
this Ghost Battle pass; it is not a fabricated event-start snapshot.

## Work added in this pass

Ghost Vision additionally adds recorded-video analysis, reviewed body-motion
extraction, optional motion rendering, motion-only export/import, an active clock
for motion-only races and measured race recaps. The original video remains the
default view. The underlying detector, models, calibration and camera are reused.

- A separate standalone repository/app/package, isolated from the deployed app.
- A multi-challenge local library with save, edit, replay, and metadata removal.
- A cleaner timing editor with visible markers, previous/next inspection,
  selected-marker removal, undo, and reliable video metadata readiness.
- Browser-local video persistence with fresh Blob URLs after reload.
- Responsive phone/wide battle presentation, large animated scores, lead and rep
  difference, progress, milestone feedback, restart and tracking-stall recovery.
- Actual Ghost Battle WIN/LOSS/TIE recaps, margins and performance comparisons,
  replacing illustrative rating/XP cards.
- Focused synchronization, storage, editing, recovery and end-to-end screen
  tests, detector preservation checks, visual layout review and build evidence.

Codex assisted with code, tests, research, debugging and documentation. The project
owner supplied product direction and the existing PushPVP code; demo footage is
selected by the presenter and needs appropriate permission. Do not claim an
original pose model, a newly trained ML model, live online opponents, or physical
counting accuracy that has not been tested.

## Rules and remaining human checks

The [published Devpost rules](https://hackohio2026.devpost.com/rules) allow prior
projects when new contributions and prior work are accurately disclosed. They
list October 25, 2026 at 10:00 a.m. EDT as the deadline and direct participants to
the guidebook. The pasted waiver additionally excludes commercially deployed
wireless applications and discusses previous awards, IP and recording conduct.

The user reported that organizer eligibility checks were cleared. That is a
user-reported confirmation, not an independent written ruling retained here.
Keep the organizer's actual confirmation with the submission and ensure all team,
age/student, prior-award, track, AI-assistance and presentation requirements are
met. Do not claim that moving code to a new repo erases its prior history.

Use only consensual footage and assets you can lawfully present. The app itself
does not record bystanders or automatically publish footage. This draft makes no
unverified statement about past awards, commercial revenue, or team eligibility.
