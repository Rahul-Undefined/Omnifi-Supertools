# Adding a tool

A tool is a registry entry plus a processor function. Nothing else needs to change: search, categories, favorites, the command palette, the tool page and the workflow builder all derive from the registry.

## 1. Write the processor

Pick the family that matches the tool (`src/processors/<family>/index.ts`) and export a function.

```ts
// src/processors/image/index.ts
export const grayscale: FileProcessor = async (files, { options, onProgress, signal }) => {
  return perFile(files, onProgress, signal, async (file) => {
    const { canvas } = await blobToCanvas(file);
    const ctx = ctx2d(canvas);
    ctx.filter = "grayscale(1)";
    ctx.drawImage(canvas as CanvasImageSource, 0, 0);
    return emit(canvas, file, outMime(file, { keepFormat: true }), 0.92, "-gray");
  });
};
```

Rules:

- Throw `ProcessorError("What went wrong", "What to do about it")` for user-facing failures.
- Call `onProgress(fraction, label)` for anything that takes more than a second.
- Check `signal` (`throwIfAborted(signal)`) inside loops so Cancel works.
- Return `stats` such as `sizeStats(originalBytes, outputBytes)` so the result panel can show "Saved 70.6%".
- Never return a larger file than you received for a compress-type tool.

Text and calculator processors follow the same shape with `(input, ctx)` or `(ctx)`.

## 2. Register it

Add an entry to the right file in `src/tools/definitions/`.

```ts
{
  id: "grayscale-image",
  name: "Grayscale image",
  category: "images",
  description: "Convert an image to black and white.",
  keywords: ["grayscale", "black and white", "mono"],
  input: ["image/jpeg", "image/png", "image/webp"],
  output: ["jpg", "png", "webp"],
  processor: "image.grayscale",      // <family>.<export name>
  kind: "file",
  status: "ready",
  runtime: "browser",
  multiple: true,                    // batch support
  chainable: true,                   // usable in workflows
  icon: "Contrast",                  // any lucide-react icon name
  options: [                         // rendered automatically
    { type: "range", key: "strength", label: "Strength", default: 1, min: 0, max: 1, step: 0.1 },
  ],
  related: ["compress-image"],
}
```

Field notes:

- `input`: extensions (`"pdf"`) or MIME types (`"image/*"`, `"image/png"`). `["*"]` accepts anything.
- `kind`: `file` (dropzone), `text` (textarea), `calculator` (options only), `generator` (options only, no input).
- `combine: true` runs all uploaded files as one job (merge tools). `fileCount: 2` requires exactly two files (compare tools).
- `runtime: "server"` shows the upload notice and expects the processor to call an API route.
- Options: `select`, `number`, `range`, `text`, `textarea`, `checkbox`, `color`.

## 3. Not ready yet?

Set `status: "coming-soon"`. The tool is listed in a separate block, its page explains it does not run, and it is excluded from workflows and the "ready" counts. Never ship a button that pretends to work.

## 4. Test

Then open `/admin/checker` (admin only) and run the category: it generates random input for the new tool and reports whether it works. If the tool needs a particular input shape or a blank-by-default option filled in, add a case to `specialPlan()` in `src/lib/checker/run.ts` and, if you can, a verification of the output.

Add a case to the relevant file under `tests/`. Processors that only need pdf-lib, SheetJS, JSZip or pure functions run in Node. Canvas-based processors are exercised in the browser.

```bash
npm test
```

The registry test will fail if the id is duplicated, the processor family does not exist, or an option default has the wrong type.

## 5. New family?

Create `src/processors/<family>/index.ts` and add one line to `src/processors/index.ts`:

```ts
myfamily: () => import("./myfamily"),
```

It is code-split automatically.
