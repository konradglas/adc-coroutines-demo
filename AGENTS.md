# Presentation Narrative

## First Section: From Callbacks to Coroutines

The synchronous opening version is intentionally the only correct implementation before the coroutine payoff. It establishes the real workflow and scope-bound completion. Its hidden ordering dependency is something the developer overlooked; reveal it only after QA reports the race symptoms.

Every attempted callback-based “improvement” must remain subtly wrong. The escalation is:

1. Move work off main, but mutate the sampler from the worker and race main.
2. Restore ordering and main-thread affinity, but leave the synchronous `ScopeExit` armed. The function reports completion and hides the spinner immediately; the callback installs the tree later, silently, and nothing refreshes the UI.
3. Fix premature completion by deleting the scope guard and completing manually inside the callback. The happy path works, but RAII and automatic exceptional cleanup are gone.
4. Add the asynchronous missing-sample dialog as nested completion callbacks. Cancelling the dialog takes a normal-looking `return` from the inner callback without completing, so the spinner stays forever. QA finds it in the last round. This is the final callback bug before taking a breath and exploring coroutines; the coroutine version later has the same early return, and there it is correct.
5. Finally use a coroutine. Its scope survives suspension, restoring structured programming so the original sequential structure and deferred completion become correct again.

## Humor and Reveal Order

The humor comes from developer overconfidence colliding with QA’s calm, concrete observations. Keep the developer defensive, literal, and prematurely ready to ship. Keep QA concise and increasingly specific.

Every QA testing round begins with the developer explicitly asking QA to test the latest fix. Start breezily confident, then make each request more terse and frustrated until the final “test it one last time, then ship it.”

Always preserve this order:

1. Show plausible but incorrect code.
2. Let the developer confidently ship it.
3. Let QA report externally observable symptoms.
4. Only then reveal the relevant code line, execution context, or lifetime mistake.

Never explain or visually flag a mistake before QA observes it. Avoid warning comments, bug labels, red callouts, or diagnostic takeaways on the implementation slide itself. The audience should get a chance to believe the developer—or spot the bug themselves.

## Visual Continuity

Diagnosis slides must repeat enough code to stand on their own; do not rely on the audience remembering code from two slides earlier. Pair QA’s symptom with the responsible code, then connect or highlight the exact line on a later click.

Use progressive reveals for one idea at a time: assumption, observed symptom, responsible execution contexts, consequence. Keep icons small and purposeful, such as the bug marker for a broken line or the race car between Worker and Main.

## Slide Text and Speaker Notes

The audience's attention belongs on the speaker. Slides show what cannot be said out loud: code, call stacks, timelines, diagrams. They do not carry the sentences the speaker is about to say.

On screen:

- Never write out full explanatory sentences. If the speaker would read it aloud, it belongs in the notes.
- Cards and step labels are a heading plus a few words (3–6). Example: "Main is back in its loop", not "The awaiter returns, resume() returns, and Main is back in its event loop."
- No polished lesson sentences or takeaway aphorisms ("The function can suspend without surrendering its structure."). They read like a ghostwriter and steal the speaker's line. End a slide on the code or the picture instead.
- Exception: in-character lines that are part of the humor stay on screen: developer/QA dialogue and the developer's own punchlines ("Ship it 🚢", "RAII is so nice! But cannot use it here :(").
- Avoid vague abstractions ("picks the semantics"). Prefer concrete words the speaker can unpack ("how it starts, ends, resumes").

Speaker notes:

- Every slide except plain bullet/agenda slides gets notes in a trailing `<!-- -->` comment.
- Write cues, not a script: short keywords and arrows ("spawn → frame on heap, nothing ran yet"), one line per click.
- Use one `[click]` marker per click so presenter view highlights the current cue; keep markers in sync with the slide's click count.
- Notes must say more than the screen, never the same thing.
- Stage directions are welcome: "**PAUSE**", "beat", "(don't point at the return yet)".

Comparisons stay fair:

- When old and new code sit side by side, show equivalent code on both sides. Do not hide code (setters, callbacks) to make one version look shorter.
- If the new version adds something, show both at the same length first and reveal the addition on a later click.

Mechanics:

- `CallStacks` and `ThreadTimeline` steps take a short `label` for the screen; the longer `caption` is only a fallback.
- The deck forces `pre` font size with `!important`; shrink code with the `dense-code` class or `CallStacks`' `code-size` prop.
