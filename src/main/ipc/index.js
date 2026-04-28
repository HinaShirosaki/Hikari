'use strict';

const { registerDataIpc } = require('../helpers/main/register-data-ipc');
const { registerAgentIpc } = require('../helpers/main/register-agent-ipc');
const { registerSystemIpc } = require('../helpers/main/register-system-ipc');

function registerMainIpc({ data = {}, agent = {}, system = {} } = {}) {
  registerDataIpc(data);
  registerAgentIpc(agent);
  registerSystemIpc(system);
}

module.exports = {
  registerMainIpc
};
