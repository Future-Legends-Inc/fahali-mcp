/**
 * Tool definitions for the Fahali MCP server.
 * Each tool maps to an existing /agent/* HTTP endpoint.
 * Input/output shapes follow the canonical SpectraIntelligence schema
 * defined in client/types/ai.ts.
 *
 * Required tier per tool is enforced upstream by Express requireTier()
 * middleware. The tier annotation in each tool's description is advisory
 * for MCP clients that want to surface "this requires Elite/Desk/etc"
 * to the user before making the call.
 */

export const TOOL_DEFINITIONS = [
  {
    name: "fahali_get_market_verdict",
    description:
      "Get structured market verdict for one or more symbols. Returns direction (bullish/bearish/neutral), confidence score, reasoning chain, expected move percentage, and forecast horizon. Optionally includes contagion risk data. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          type: "string",
          description:
            "Comma-separated trading symbols (e.g. 'BTCUSDT,ETHUSDT'). Omitting returns top signals across all symbols.",
        },
        includeContagion: {
          type: "boolean",
          description:
            "If true, enriches response with contagion risk from tail_dependence table. (Contagion enrichment data itself requires Elite tier or higher.)",
          default: false,
        },
      },
    },
    _meta: {
      requiredTier: "professional",
      endpoint: "/agent/verdict",
    },
  },
  {
    name: "fahali_get_portfolio_risk",
    description:
      "Get portfolio risk assessment. Returns overall risk score, value-at-risk, expected drawdown, and per-position risk breakdown. Requires connected exchange accounts. Requires Elite tier or higher.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    _meta: {
      requiredTier: "elite",
      endpoint: "/agent/portfolio-risk",
    },
  },
  {
    name: "fahali_get_contagion_map",
    description:
      "Get cross-asset contagion and tail dependence map. Returns nodes (symbols with risk scores), edges (pairwise correlation strength), and clusters of correlated assets. Requires Elite tier or higher.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    _meta: {
      requiredTier: "elite",
      endpoint: "/agent/contagion",
    },
  },
  {
    name: "fahali_get_capital_flow",
    description:
      "Get capital flow intelligence for a specific symbol. Returns net flow USD, institutional vs retail breakdown, whale activity, and flow trend direction. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Trading symbol (e.g. 'BTCUSDT'). Required.",
        },
      },
      required: ["symbol"],
    },
    _meta: {
      requiredTier: "professional",
      endpoint: "/agent/capital-flow",
    },
  },
];
