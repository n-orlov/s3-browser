import { describe, it, expect, vi, beforeEach } from "vitest";

const config = vi.hoisted(() => vi.fn());
const monacoStub = vi.hoisted(() => ({ marker: "local-monaco" }));
const workerClasses = vi.hoisted(() => ({ made: [] as string[] }));

vi.mock("monaco-editor", () => monacoStub);
vi.mock("@monaco-editor/react", () => ({ loader: { config } }));
const workerMock = (name: string) => ({
  default: class {
    constructor() {
      workerClasses.made.push(name);
    }
  },
});
vi.mock("monaco-editor/editor/editor.worker?worker&inline", () =>
  workerMock("editor"),
);
vi.mock("monaco-editor/language/json/json.worker?worker&inline", () =>
  workerMock("json"),
);
vi.mock("monaco-editor/language/css/css.worker?worker&inline", () =>
  workerMock("css"),
);
vi.mock("monaco-editor/language/html/html.worker?worker&inline", () =>
  workerMock("html"),
);
vi.mock(
  "monaco-editor/language/typescript/ts.worker?worker&inline",
  () => workerMock("ts"),
);

import { configureMonaco, createMonacoWorker } from "../renderer/monacoSetup";

describe("configureMonaco", () => {
  beforeEach(() => {
    config.mockClear();
    workerClasses.made.length = 0;
  });

  it("configures the loader with the monaco-editor package imported from node_modules", () => {
    configureMonaco();
    expect(config).toHaveBeenCalledTimes(1);
    const arg = config.mock.calls[0][0];
    expect(arg.monaco.marker).toBe(monacoStub.marker);
    expect(arg.paths).toBeUndefined();
  });

  it("installs a MonacoEnvironment that serves workers locally", async () => {
    configureMonaco();
    const env = (
      self as unknown as {
        MonacoEnvironment: { getWorker: typeof createMonacoWorker };
      }
    ).MonacoEnvironment;
    expect(env.getWorker).toBe(createMonacoWorker);
  });

  it.each([
    ["json", "json"],
    ["css", "css"],
    ["scss", "css"],
    ["html", "html"],
    ["typescript", "ts"],
    ["javascript", "ts"],
    ["plaintext", "editor"],
    ["yaml", "editor"],
  ])("creates the bundled worker for label %s", async (label, expected) => {
    await createMonacoWorker("workerMain.js", label);
    expect(workerClasses.made).toEqual([expected]);
  });
});
