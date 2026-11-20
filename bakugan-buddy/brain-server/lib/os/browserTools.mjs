/**
 * The Playwright MCP tools Preyas may use, as OpenAI tool schemas. The list is
 * curated and pinned to @playwright/mcp 0.0.44 (see brain-server/package.json):
 * every schema here was dumped from that exact version with
 * `node brain-server/tools/mcp-dump.mjs browser`.
 *
 * Why a static list: the browser server must stay off until a browser tool is
 * REALLY used (16 GB Mac), so listing its tools live would defeat the lazy
 * start. The names here must stay in sync with the guard kinds in
 * guardRules.mjs (a test checks that).
 */
export const BROWSER_SERVER = "browser";

/** Read-only browser tools: no confirm card. */
export const BROWSER_READ_TOOLS = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_console_messages",
  "browser_network_requests",
  "browser_tabs",
  "browser_wait_for",
  "browser_take_screenshot",
]);

/** Interactive browser tools: always a Yes/No confirm card (guard R8). */
export const BROWSER_ACTION_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_hover",
  "browser_drag",
  "browser_press_key",
  "browser_file_upload",
  "browser_handle_dialog",
  "browser_evaluate",
]);

const schemas = [
  {
    name: "browser_navigate",
    description:
      "Open a URL in the browser. Only http and https URLs. Use this first, then browser_snapshot to read the page.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The URL to navigate to" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Capture the accessibility snapshot of the current page: URL, page title, and clickable elements with refs. The best way to read what is on the page. Use refs from the snapshot for clicks and typing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_click",
    description: "Click an element on the page. Needs the exact element description and ref from the latest browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        element: { type: "string", description: "Human-readable element description from the snapshot" },
        ref: { type: "string", description: "Exact element reference from the page snapshot" },
        doubleClick: { type: "boolean", description: "Whether to double click" },
      },
      required: ["element", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_type",
    description: "Type text into an editable element. Needs the element description and ref from the latest snapshot. Set submit to true to press Enter after typing (for example to send a message).",
    inputSchema: {
      type: "object",
      properties: {
        element: { type: "string", description: "Human-readable element description from the snapshot" },
        ref: { type: "string", description: "Exact element reference from the page snapshot" },
        text: { type: "string", description: "Text to type" },
        submit: { type: "boolean", description: "Whether to press Enter after typing" },
      },
      required: ["element", "ref", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_fill_form",
    description: "Fill several form fields at once. Each field needs its name, type, ref and value from the latest snapshot. Submitting a form always needs your OK first.",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "Fields to fill",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Human-readable field name" },
              type: { type: "string", enum: ["textbox", "checkbox", "radio", "combobox", "slider"] },
              ref: { type: "string", description: "Exact field reference from the page snapshot" },
              value: { type: "string", description: "Value to fill in" },
            },
            required: ["name", "type", "ref", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["fields"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_select_option",
    description: "Select an option in a dropdown. Needs the element description, ref and values from the latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        element: { type: "string" },
        ref: { type: "string" },
        values: { type: "array", items: { type: "string" } },
      },
      required: ["element", "ref", "values"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_hover",
    description: "Hover over an element. Needs the element description and ref from the latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        element: { type: "string" },
        ref: { type: "string" },
      },
      required: ["element", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_drag",
    description: "Drag one element onto another. Needs both element descriptions and refs from the latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        startElement: { type: "string" },
        startRef: { type: "string" },
        endElement: { type: "string" },
        endRef: { type: "string" },
      },
      required: ["startElement", "startRef", "endElement", "endRef"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_press_key",
    description: "Press a key on the keyboard, for example Enter, Escape or ArrowLeft.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "Name of the key or a character" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_file_upload",
    description: "Upload one or more files through a file input. Only absolute paths under the allowed folders.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Absolute paths of the files to upload" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_handle_dialog",
    description: "Answer a dialog: accept or dismiss it. Accepting a form dialog always needs your OK first.",
    inputSchema: {
      type: "object",
      properties: {
        accept: { type: "boolean", description: "Whether to accept the dialog" },
        promptText: { type: "string", description: "Text for a prompt dialog" },
      },
      required: ["accept"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_evaluate",
    description: "Run a JavaScript expression on the page, for example () => document.title. This can change the page, so it always needs your OK first.",
    inputSchema: {
      type: "object",
      properties: {
        function: { type: "string", description: "() => { /* code */ } or (element) => { /* code */ } when element is provided" },
        element: { type: "string" },
        ref: { type: "string" },
      },
      required: ["function"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_tabs",
    description: "List, create, close or select a browser tab. Use action list to see open tabs.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "new", "close", "select"] },
        index: { type: "number", description: "Tab index for close/select" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate_back",
    description: "Go back to the previous page.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_wait_for",
    description: "Wait for text to appear or disappear, or for a few seconds to pass.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "number", description: "Seconds to wait" },
        text: { type: "string", description: "Text to wait for" },
        textGone: { type: "string", description: "Text to wait for to disappear" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_console_messages",
    description: "Read the page console messages. Useful for debugging a page that does not work.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_network_requests",
    description: "Read the network requests the page made. Useful for debugging a page that does not work.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_take_screenshot",
    description: "Take a screenshot of the page and save it for you to look at. You cannot see the picture yourself; use browser_snapshot to read the page.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["png", "jpeg"], default: "png" },
        filename: { type: "string", description: "File name to save the screenshot to" },
        fullPage: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

/** All curated browser tools, exactly as the guard knows them. */
export function browserToolSpecs() {
  return schemas.map(({ inputSchema, ...rest }) => ({
    ...rest,
    parameters: { ...inputSchema },
  }));
}

/** The exact tool names @playwright/mcp serves (they already carry browser_). */
export const BROWSER_TOOL_NAMES = new Set(schemas.map((spec) => spec.name));
