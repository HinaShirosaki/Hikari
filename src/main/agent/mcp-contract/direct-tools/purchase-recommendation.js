'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');

const PURCHASE_RECOMMENDATION_DIRECT_TOOL = createDirectAppTool('purchase-recommendation');

module.exports = {
  PURCHASE_RECOMMENDATION_MCP_TOOL: PURCHASE_RECOMMENDATION_DIRECT_TOOL.definition,
  callPurchaseRecommendation: PURCHASE_RECOMMENDATION_DIRECT_TOOL.handler
};
