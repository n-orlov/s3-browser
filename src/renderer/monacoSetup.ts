import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

type WorkerFactory = () => Promise<{ default: new () => Worker }>;

/**
 * Monaco web workers, bundled from node_modules and inlined as blob workers so
 * that they load under `worker-src blob:` without any remote origin.
 * Each worker is loaded on first use.
 */
const workerFactories: Record<string, WorkerFactory> = {
  json: () =>
    import("monaco-editor/esm/vs/language/json/json.worker?worker&inline"),
  css: () =>
    import("monaco-editor/esm/vs/language/css/css.worker?worker&inline"),
  scss: () =>
    import("monaco-editor/esm/vs/language/css/css.worker?worker&inline"),
  less: () =>
    import("monaco-editor/esm/vs/language/css/css.worker?worker&inline"),
  html: () =>
    import("monaco-editor/esm/vs/language/html/html.worker?worker&inline"),
  handlebars: () =>
    import("monaco-editor/esm/vs/language/html/html.worker?worker&inline"),
  razor: () =>
    import("monaco-editor/esm/vs/language/html/html.worker?worker&inline"),
  typescript: () =>
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline"),
  javascript: () =>
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline"),
};

const editorWorker: WorkerFactory = () =>
  import("monaco-editor/esm/vs/editor/editor.worker?worker&inline");

export async function createMonacoWorker(
  _moduleId: string,
  label: string,
): Promise<Worker> {
  const factory = workerFactories[label] ?? editorWorker;
  const { default: WorkerClass } = await factory();
  return new WorkerClass();
}

/**
 * Point @monaco-editor/react at the locally bundled monaco-editor package
 * instead of its default CDN loader.
 */
export function configureMonaco(): void {
  (
    self as unknown as { MonacoEnvironment: monaco.Environment }
  ).MonacoEnvironment = {
    getWorker: createMonacoWorker,
  };
  loader.config({ monaco });
}
