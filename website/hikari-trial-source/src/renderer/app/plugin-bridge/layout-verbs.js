import { setSharedLeftRailWidth } from '../shared-left-rail.js';
import { getPluginLeftRailLayout, setPluginLeftRailFolded } from '../plugin-left-rail.js';

export const LAYOUT_VERBS = {
  'app.setContextActions': {
    permission: 'layout',
    handler: (params, { contextActions, frameWindow }) => contextActions.set(params, frameWindow)
  },
  'app.readContextAction': {
    permission: 'layout',
    handler: (params, { contextActions, frameWindow }) => contextActions.read(params, frameWindow)
  },
  'app.respondContextAction': {
    permission: 'layout',
    handler: (params, { contextActions, frameWindow }) => contextActions.respond(params, frameWindow)
  },
  'app.setWorkspaceTools': {
    permission: 'layout',
    handler: (params, { workspaceTools, frameWindow }) => workspaceTools.set(params, frameWindow)
  },
  'app.setAgentChatExpanded': {
    permission: 'agent:chat',
    handler: (params, { workspaceTools, frameWindow }) => workspaceTools.setChatExpanded(params, frameWindow)
  },
  'app.setLeftRailWidth': {
    permission: 'layout',
    handler: (params, { plugin, windowObject }) => {
      if (typeof params?.width !== 'number' || !Number.isFinite(params.width)) {
        throw new Error('app.setLeftRailWidth requires a finite numeric "width".');
      }
      setSharedLeftRailWidth(params.width, { document: windowObject?.document, windowObject });
      return { leftRail: getPluginLeftRailLayout(plugin.id, { windowObject }) };
    }
  },
  'app.setLeftRailFolded': {
    permission: 'layout',
    handler: (params, { plugin, windowObject }) => {
      if (typeof params?.folded !== 'boolean') {
        throw new Error('app.setLeftRailFolded requires a boolean "folded".');
      }
      return { leftRail: setPluginLeftRailFolded(plugin.id, params.folded, { windowObject }) };
    }
  }
};
