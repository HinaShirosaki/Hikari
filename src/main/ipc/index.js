'use strict';

const { registerDataIpc } = require('./register-data-ipc');
const { registerAgentIpc } = require('./register-agent-ipc');
const { registerSystemIpc } = require('./register-system-ipc');

function registerMainIpc({ data = {}, agent = {}, system = {} } = {}) {
  registerDataIpc(data);
  registerAgentIpc(agent);
  registerSystemIpc(system);
}

module.exports = {
  registerMainIpc
};
