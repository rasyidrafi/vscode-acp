import { describe, expect, it } from 'vitest';

import type { AvailableCommand } from '@agentclientprotocol/sdk';
import { searchCommands } from './commandSearch';

describe('searchCommands', () => {
  it('ranks exact, prefix, boundary, includes, then fuzzy matches', () => {
    const results = searchCommands([
      command('p_l_a_n', 'Fuzzy command'),
      command('myplan', 'Includes command'),
      command('planner', 'Prefix command'),
      command('plan', 'Exact command'),
      command('create_plan', 'Create a plan'),
      command('research_codebase', 'Investigate project code'),
    ], 'plan');

    expect(results.map((result) => result.command.name)).toEqual([
      'plan',
      'planner',
      'create_plan',
      'myplan',
      'p_l_a_n',
    ]);
    expect(results.map((result) => result.matchKind)).toEqual([
      'exact',
      'prefix',
      'boundary',
      'includes',
      'fuzzy',
    ]);
  });

  it('prefers command name matches over description matches when both are close', () => {
    const results = searchCommands([
      command('review', 'Create a plan'),
      command('plan', 'Plan changes'),
    ], 'plan');

    expect(results[0]).toMatchObject({
      command: { name: 'plan' },
      matchKind: 'exact',
    });
  });

  it('uses deterministic name ordering for equal matches', () => {
    const results = searchCommands([
      command('zeta', 'Runs a task'),
      command('alpha', 'Runs a task'),
      command('beta', 'Runs a task'),
    ], '');

    expect(results.map((result) => result.command.name)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('honors the result limit', () => {
    expect(searchCommands([
      command('one'),
      command('two'),
      command('three'),
    ], '', 2)).toHaveLength(2);
  });
});

function command(name: string, description = `${name} description`): AvailableCommand {
  return { name, description };
}
