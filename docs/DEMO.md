# A short Ghost Battle demo

Aim for a two-minute explanation, with the final round length chosen to match
your own selected clip. Rehearse on the actual Android phone before judging.

1. **Problem (15 seconds):** “Friends aren't always free to work out together.
   Ghost Battle lets me compete against a recorded performance whenever I train.”
2. **Make the challenge (25 seconds):** Import your own short workout clip,
   show one rep marker, step backward to demonstrate deterministic counting,
   then save it. Prepare the remaining markers before the presentation so you
   do not spend the demo editing a long video.
3. **Race (your clip's duration):** Open the saved challenge, get into camera
   position, and show the three-second countdown. Perform real push-ups. Explain:
   “The ghost follows actual video playback; my counter uses PushPVP's existing
   on-device detector. Pausing freezes the competition.”
4. **Payoff (15 seconds):** Show the real result, margin and comparison bars,
   then Race again or return to the saved library.
5. **Technical contribution (20 seconds):** Explain the new standalone app,
   challenge library, timing editor, synchronization safeguards, responsive
   scoreboard and test coverage. Credit the existing PushPVP detector and AI help.

Use the local APK without depending on venue Wi-Fi. Have a charged phone,
permission granted by you, a supported clip, marked timestamps, and adequate
camera distance/light. Use a safe, manageable number of reps and stop if needed.
Rehearse Android screen recording and sound yourself; those capabilities have
not been physically certified by the build or UI tests.

If tracking/permission fails, show the recovery honestly. The separate `qa/`
layout fixture is only a visual test and must never be presented as a successful
tracked workout or an actual challenge result.
