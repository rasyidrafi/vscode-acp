import type { AvailableCommand } from '@agentclientprotocol/sdk';
import type { ReactElement } from 'react';

import type { RankedCommand } from '../lib/commandSearch';

interface ComposerCommandMenuProps {
  commands: RankedCommand[];
  activeIndex: number;
  onSelect: (command: AvailableCommand) => void;
  onHover: (index: number) => void;
}

export function ComposerCommandMenu({
  commands,
  activeIndex,
  onSelect,
  onHover,
}: ComposerCommandMenuProps): ReactElement | null {
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="command-menu" role="listbox" aria-label="Slash commands">
      <div className="command-menu-header">Commands</div>
      {commands.map((result, index) => (
        <button
          key={result.command.name}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'command-menu-item active' : 'command-menu-item'}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(result.command)}
        >
          <span className="command-menu-name">/{result.command.name}</span>
          <span className="command-menu-description">{result.command.description}</span>
        </button>
      ))}
    </div>
  );
}
