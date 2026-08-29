# Demo stages

The demo follows one preset load as it evolves from correct synchronous code into
callback-driven asynchronous code and finally back into linear coroutine code.

`demo::App` represents application state owned by the main thread. Its mutating
operations verify that they are called from that thread. `CallbackWorkers` performs
work on background threads and posts completion callbacks to the simulated main queue.
The user interaction is simulated, but it has the same completion shape as an
asynchronous file dialog in a GUI application.

Two executables intentionally return failure. CTest marks those as `WILL_FAIL`; their
failures are the behavior being demonstrated, not undefined behavior or test flakiness.

## Stage 00: Correct synchronous code

Source: [`src/stage_00_synchronous.cpp`](src/stage_00_synchronous.cpp)

### What I think is happening

The preset load is straightforward and correct. Mixer state is applied, the sampler
tree is prepared and installed, the key-switch map is rebuilt, the user locates the
missing sample library, and those samples are loaded. `PresetLoaded` is sent only when
everything is ready.

The loading indicator is protected by `ScopeExit`, so it is cleared on normal return,
early return, or exception.

### What is actually happening / QA

That understanding is accurate. Every subsystem ends with the same preset and QA's
consistency check passes.

However, tree preparation, the modal user interaction, and sample loading all execute
on the main thread. During those operations the application cannot process normal GUI
events.

> QA: “Loading a preset freezes the application.”

### What it demonstrates

- Statement order directly expresses every dependency.
- Function return means the complete operation has finished.
- Errors and cleanup follow ordinary C++ control flow and RAII.
- Correct synchronous code can still be unacceptable in an interactive application.

## Stage 01: Move the slow part away

Source: [`src/stage_01_lost_dependency.cpp`](src/stage_01_lost_dependency.cpp)

### What I think is happening

Sampler preparation is the expensive part, so it is moved to a worker. Its completion
callback installs the new tree. The rest of the existing load function appears to
remain in the same order.

The callback even sends another `PresetLoaded` notification after installation. An
extra notification seems harmless.

### What is actually happening / QA

`workers.run()` starts an operation and returns immediately. The following statements
do not wait for its callback:

- The key-switch map is rebuilt from the initial sampler tree.
- The missing-sample query examines the initial tree and asks for the initial library.
- Samples belonging to that initial state are installed.
- `PresetLoaded` is sent before the new sampler tree exists.
- `ScopeExit` turns the loading indicator off when `loadPreset()` returns, not when the
  asynchronous operation completes.

The worker eventually installs the new sampler tree and sends `PresetLoaded` again.
QA now sees the new mixer and sampler alongside the old key-switch and sample state.

### What it demonstrates

- Starting asynchronous work does not preserve the dependency represented by the next
  source-code statement.
- A lexical guard cannot cover work that outlives its scope.
- A notification called “loaded” becomes ambiguous once completion is fragmented.
- This is a deterministic ordering bug; no data race is required.

## Stage 02: Repair the order with callbacks

Source: [`src/stage_02_callbacks_ship_it.cpp`](src/stage_02_callbacks_ship_it.cpp)

### What I think is happening

Every dependent operation is moved inside the previous completion callback:

1. Prepare the sampler tree.
2. Install it and inspect its missing samples on main.
3. Ask the user to locate the library.
4. Load its samples.
5. Install the result, notify the GUI, and clear the spinner.

The new QA feature works on the developer machine. The state check passes.

> Developer: “It is ugly, but it works. Ship it.”

### What is actually happening / QA

Only the happy path exists in the type and control flow. Every operation is assumed to
produce a value and every callback captures surrounding state by reference.

There is no representation yet for:

- the user cancelling the dialog,
- an I/O or parsing error,
- a replacement preset request,
- the loader or application closing before completion.

QA's happy-path test passes, but the callbacks have made completion and cleanup a
convention at the deepest indentation level.

### What it demonstrates

- Callbacks can restore correct ordering.
- Restoring ordering creates nesting because each later operation needs values from the
  previous one.
- Success is easy to demonstrate before cancellation, errors, and lifetime have been
  designed.
- This is the point where a useful product request starts feeling disproportionately
  dangerous to implement.

## Stage 03: Miss one completion

Source: [`src/stage_03_missed_callback.cpp`](src/stage_03_missed_callback.cpp)

### What I think is happening

The location dialog now returns `std::nullopt` when the user cancels. Cancellation is
not an error, so the callback simply returns without loading samples.

### What is actually happening / QA

That local early return also skips the completion responsibilities belonging to the
whole preset load:

- `finished` is never set.
- The loading indicator is never cleared.
- No final success or cancellation notification is sent.
- The sampler tree and key-switch map contain the new preset, while the installed
  samples still belong to the initial preset.

The test harness stops after observing the dialog callback so that the executable does
not really hang. Its final state is the state QA would observe while the spinner remains
forever.

> QA: “Cancel the dialog. The spinner stays forever.”

### What it demonstrates

- In callback code, every branch must remember the completion contract of the entire
  outer operation.
- A locally reasonable `return` can strand global UI state.
- Partial publication makes failure more complicated than merely reporting an error.
- The bug is omission, not an exotic thread race.

## Stage 04: Harden the callback implementation

Source: [`src/stage_04_callbacks_qa.cpp`](src/stage_04_callbacks_qa.cpp)

### What I think is happening

The loader is made production-worthy:

- A new request stops the previous request.
- A request number rejects stale completions.
- Weak ownership prevents callbacks from retaining or dereferencing a destroyed loader.
- Each operation returns a value, cancellation, or exception.
- Every current-request exit path calls `finishRequest()`.

### What is actually happening / QA

The rapid-replacement scenario in the executable passes. The first preset is cancelled,
its stale completion is ignored, and the second preset becomes consistent across mixer,
sampler, key switches, and samples.

The implementation is now much harder to audit. The product sequence is distributed
across `loadPreset()`, `completeSampler()`, `completeLocation()`, and
`completeSamples()`. Request identity, stop-token propagation, weak lifetime, result
translation, and cleanup policy surround every business operation.

The demo handles the paths it models, but correctness depends on conventions shared by
all four functions. Adding another asynchronous step would require extending every one
of those policies again.

### What it demonstrates

- Robust callback code is possible.
- The machinery required for cancellation, replacement, errors, and lifetime can
  dominate the feature being implemented.
- Main-thread dispatch solves thread affinity but not operation ownership or stale
  completion by itself.
- The code has reconstructed a state machine manually, spread across functions and
  captures.

## Stage 05: Restore the workflow with an affine coroutine

Source: [`src/stage_05_coroutine.cpp`](src/stage_05_coroutine.cpp)

### What I think is happening

The final `loadPreset()` reads like the synchronous version again:

1. Apply main-owned mixer state.
2. Await sampler preparation on a worker.
3. Install the tree and inspect main-owned derived state.
4. Await the user's library selection.
5. Await sample loading on a worker.
6. Install the samples and notify the GUI.

`ScopeExit` remains alive in the coroutine frame until the complete workflow exits.

### What is actually happening / QA

The trace shows the intended affinity transitions:

```text
main   -> capture application state
worker -> prepare sampler tree
main   -> install tree and rebuild key switches
user   -> resolve missing library
worker -> load samples
main   -> install samples, notify, and clear loading state
```

`stdexec` senders run the bounded operations away from main. `stdexec-affine` resumes
the body of `MainActorTask` on the main executor after each `co_await`. QA's consistency
check passes.

The demo's user response is simulated by a sender. A real GUI build would adapt the
file-dialog completion callback into an awaitable operation.

This stage intentionally demonstrates linear control flow, lexical cleanup, value and
exception propagation, and continuation affinity. It does **not** yet demonstrate rapid
replacement, owner destruction, or structured shutdown. Those require task ownership
and cancellation policy and belong to the later structured-concurrency section of the
talk.

### What it demonstrates

- `co_await` restores visible data dependencies without blocking the main thread.
- Locals and RAII guards live across suspension in the coroutine frame.
- The main-actor task owns application mutation; awaited work exchanges self-contained
  values with it.
- Main-actor affinity removes accidental cross-thread state access, but suspension still
  permits logical interleaving with other main-actor tasks.
- Coroutines make the rejected missing-sample feature look like its product requirements
rather than its scheduling implementation.
