# Presentation Narrative

## First Section: From Callbacks to Coroutines

The synchronous opening version is intentionally the only correct implementation before the coroutine payoff. It establishes the real workflow and scope-bound completion. Its hidden ordering dependency is something the developer overlooked; reveal it only after QA reports the race symptoms.

Every attempted callback-based “improvement” must remain subtly wrong. The escalation is:

1. Move work off main, but mutate the sampler from the worker and race main.
2. Restore ordering and main-thread affinity, but leave the synchronous `ScopeExit` armed. The function reports completion immediately, then the callback reports it again.
3. Fix premature completion by deleting the scope guard and completing manually inside the callback. The happy path works, but RAII and automatic exceptional cleanup are gone.
4. Add the asynchronous missing-sample dialog, but let cancellation return from only the inner callback and strand the operation.
5. Build a “production-ready” asynchronous function that accepts its own `std::function<void(bool)> completion` and visibly schedules sample loading through `workers.run(work, callback)`. The happy path calls completion from the result callback, but missing sample content takes a normal-looking `return` without completing, so the spinner stays forever. This is the final callback bug before taking a breath and exploring coroutines.
6. Finally use a coroutine. Its scope survives suspension, restoring structured programming so the original sequential structure and deferred completion become correct again.

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
