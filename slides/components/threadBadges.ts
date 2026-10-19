// Code with a thread badge per line for <ThreadBadges>.
// A badge appears on click `at` (default 0); `then` swaps it on a later click.

export interface BadgeLine {
  code: string
  badge?: string
  at?: number
  then?: { badge: string, at: number }
}

export const badgeScenarios: Record<string, { lines: BadgeLine[] }> = {
  tracking: {
    lines: [
      { code: 'task<void> loadPreset(Preset preset) {' },
      { code: '  app.setLoading(true);', badge: 'Main', at: 1 },
      { code: '  ScopeExit finish([&] { app.setLoading(false); });', badge: 'Main', at: 1 },
      { code: '  co_await resumeOn(workers);', badge: '→ Worker', at: 2 },
      { code: '  auto tree = buildSamplerTree(preset);', badge: 'Worker', at: 2 },
      { code: '  co_await resumeOn(mainThread);', badge: '→ Main', at: 3 },
      { code: '  sampler.install(tree);', badge: 'Main', at: 3 },
      { code: '  auto location =' },
      { code: '      co_await askUserToLocateSamples();', badge: '?', at: 4 },
      { code: '  sampler.installSamples(*location);', badge: '?', at: 5 },
      { code: '}', badge: '?', at: 5 },
    ],
  },
  mainActor: {
    lines: [
      { code: 'MainActorTask<void> loadPreset(Preset preset) {' },
      { code: '  app.setLoading(true);', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '  ScopeExit finish([&] { app.setLoading(false); });', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '  auto tree = co_await prepareSamplerTree(preset);', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '  sampler.install(tree);', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '  auto location =' },
      { code: '      co_await askUserToLocateSamples();', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '  sampler.installSamples(*location);', badge: '?', then: { badge: 'Main', at: 1 } },
      { code: '}', badge: '?', then: { badge: 'Main', at: 1 } },
    ],
  },
}
