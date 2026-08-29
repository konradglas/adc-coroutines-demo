# ADC coroutine demo

A compile-checked version of the preset-loading story used in the talk.

See [`STAGES.md`](STAGES.md) for the developer expectation, QA reality, and teaching
purpose of every stage.

Each executable is one slide-sized stage:

1. `stage_00_synchronous` — correct, linear, and blocking.
2. `stage_01_lost_dependency` — the expensive load is moved away and statement order stops being completion order.
3. `stage_02_callbacks_ship_it` — one callback repairs the original preset load, so we ship it.
4. `stage_03_missed_callback` — QA's missing-sample request adds nested callbacks; cancelling the dialog skips the outer completion.
5. `stage_04_callbacks_qa` — replacement, cancellation, lifetime, error, and cleanup policy accumulate around the callbacks.
6. `stage_05_coroutine` — `stdexec-affine` restores the linear main-actor workflow while `stdexec` runs preparation on a worker pool.

The missing-sample feature first appears after the callback-based preset load has
shipped. It waits for the user to locate a library, loads those samples on a worker,
then returns to main for final publication.

## Build

```sh
git submodule update --init --recursive
cmake --preset debug
cmake --build --preset debug
```

Run a stage from the repository root, for example:

```sh
./build/stage_01_lost_dependency
```

The deliberately broken stages are deterministic. They demonstrate a lost dependency
and a missed completion path without relying on undefined behaviour or actually hanging
the test process.

## Slides

The versioned Slidev deck lives in [`slides/`](slides/). To edit and present it:

```sh
cd slides
npm install
npm run dev
```

See [`slides/README.md`](slides/README.md) for build and export commands.
