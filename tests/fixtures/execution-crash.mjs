import { Workroom } from '../../src/core/service.mjs';
import { createCommands } from '../../src/control/commands.mjs';
import { ControlService } from '../../src/control/service.mjs';

process.on('message', ({ database, request }) => {
  const room = new Workroom(database);
  const commands = createCommands({ room, getEngine: () => null });
  const original = commands.core;
  commands.core = async (...args) => {
    await original(...args);
    process.send({ effectCommitted: true });
    // Parent terminates this isolated process after the report commit, before operation completion.
    return new Promise(() => {});
  };
  const control = new ControlService({ room, commands, getEngine: () => null });
  control.execute(request);
});
