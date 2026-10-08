// Module workers normally start from their bundled file. A page in a sandboxed frame
// without same-origin rights (origin "null", possible inside an X post's player card) may
// not start a worker from its own server, but it may start one from a data: URL of the
// same file: Vite bundles each worker into a single file, and the server sends CORS
// headers. (Chrome refuses blob: module workers there; data: module workers run.)
//   create()     starts the worker the usual way (keep `new Worker(new URL(...))` literal
//                at the call site so Vite bundles it)
//   bundledUrl() imports `<worker>?worker&url`; only loaded on the fallback path
export async function openWorker(create, bundledUrl) {
  try {
    return create();
  } catch (error) {
    if (error?.name !== 'SecurityError') throw error;
    const url = new URL((await bundledUrl()).default, location.href);
    const source = await (await fetch(url)).text();
    return new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`, { type: 'module' });
  }
}
