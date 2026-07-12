#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ouraGet } from "./ouraClient.js";

const server = new McpServer({
  name: "oura-mcp-server",
  version: "1.0.0",
});

const dateShape = {
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe(
    "Start date, inclusive, format YYYY-MM-DD"
  ),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe(
    "End date, inclusive, format YYYY-MM-DD"
  ),
};

function asToolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function registerDailyEndpoint(name, endpointPath, description) {
  server.registerTool(
    name,
    {
      title: name,
      description,
      inputSchema: dateShape,
    },
    async ({ start_date, end_date }) => {
      const data = await ouraGet(endpointPath, { start_date, end_date });
      return asToolResult(data);
    }
  );
}

registerDailyEndpoint(
  "oura_get_daily_sleep",
  "usercollection/daily_sleep",
  "Daily sleep score summaries (0-100 score plus contributors like REM, deep sleep, efficiency, restfulness) for a date range."
);

registerDailyEndpoint(
  "oura_get_daily_readiness",
  "usercollection/daily_readiness",
  "Daily readiness score summaries (0-100 score plus contributors like HRV balance, resting heart rate, recovery index, sleep balance) for a date range."
);

registerDailyEndpoint(
  "oura_get_daily_activity",
  "usercollection/daily_activity",
  "Daily activity score summaries (steps, active calories, activity score and contributors) for a date range."
);

registerDailyEndpoint(
  "oura_get_daily_spo2",
  "usercollection/daily_spo2",
  "Daily average blood oxygen (SpO2) saturation recorded during sleep, for a date range."
);

server.registerTool(
  "oura_get_sleep_periods",
  {
    title: "oura_get_sleep_periods",
    description:
      "Detailed, per-sleep-period data (not just the daily score): actual HRV time series average, lowest/average resting heart rate during sleep, sleep stage durations, bedtime start/end, temperature deviation, etc. Use this for the raw physiological numbers rather than the summary score.",
    inputSchema: dateShape,
  },
  async ({ start_date, end_date }) => {
    const data = await ouraGet("usercollection/sleep", { start_date, end_date });
    return asToolResult(data);
  }
);

server.registerTool(
  "oura_get_heartrate",
  {
    title: "oura_get_heartrate",
    description:
      "Raw heart rate time-series samples (5-minute resolution) between two ISO datetimes. Useful for looking at intraday HR patterns, not just daily summaries.",
    inputSchema: {
      start_datetime: z
        .string()
        .describe("Start of range, ISO 8601, e.g. 2026-07-10T00:00:00-07:00"),
      end_datetime: z
        .string()
        .describe("End of range, ISO 8601, e.g. 2026-07-11T00:00:00-07:00"),
    },
  },
  async ({ start_datetime, end_datetime }) => {
    const data = await ouraGet("usercollection/heartrate", {
      start_datetime,
      end_datetime,
    });
    return asToolResult(data);
  }
);

server.registerTool(
  "oura_get_workouts",
  {
    title: "oura_get_workouts",
    description:
      "Workout sessions (auto-detected or manually logged) in a date range: activity type, duration, calories, intensity.",
    inputSchema: dateShape,
  },
  async ({ start_date, end_date }) => {
    const data = await ouraGet("usercollection/workout", { start_date, end_date });
    return asToolResult(data);
  }
);

server.registerTool(
  "oura_get_tags",
  {
    title: "oura_get_tags",
    description:
      "User-entered tags/notes in the Oura app (e.g. 'alcohol', 'stress', 'illness') for a date range — useful for correlating self-reported events with metrics.",
    inputSchema: dateShape,
  },
  async ({ start_date, end_date }) => {
    const data = await ouraGet("usercollection/tag", { start_date, end_date });
    return asToolResult(data);
  }
);

server.registerTool(
  "oura_get_personal_info",
  {
    title: "oura_get_personal_info",
    description: "Basic profile info on file with Oura: age, weight, height, biological sex, email.",
    inputSchema: {},
  },
  async () => {
    const data = await ouraGet("usercollection/personal_info", {});
    return asToolResult(data);
  }
);

server.registerTool(
  "oura_call_endpoint",
  {
    title: "oura_call_endpoint",
    description:
      "Escape hatch: GET any Oura v2 usercollection endpoint not covered by a dedicated tool above (e.g. 'usercollection/sleep_time', 'usercollection/rest_mode_period', 'usercollection/ring_configuration', 'usercollection/session'). Restricted to read-only usercollection paths; refuses anything else (e.g. webhook management).",
    inputSchema: {
      path: z
        .string()
        .describe("Path segment after /v2/, e.g. 'usercollection/session'"),
      params: z
        .record(z.string(), z.string())
        .optional()
        .describe("Query params, e.g. { start_date: '2026-07-01', end_date: '2026-07-10' }"),
    },
  },
  async ({ path, params }) => {
    const data = await ouraGet(path, params || {});
    return asToolResult(data);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
