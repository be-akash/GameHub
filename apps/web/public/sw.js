/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "v1";
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Only skip waiting when the page asks for it
self.addEventListener("message", (event) => {
    if (event?.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
        )
    );
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.pathname === "/sw.js") return; // never cache/update this via SW

    // Navigations: network-first (avoid stale HTML + reload loops)
    if (req.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const fresh = await fetch(req);
                    const cache = await caches.open(RUNTIME_CACHE);
                    cache.put(req, fresh.clone());
                    return fresh;
                } catch {
                    const cache = await caches.open(RUNTIME_CACHE);
                    const cached = await cache.match(req);
                    if (cached) return cached;
                    return new Response("<!doctype html><h1>Offline</h1>", {
                        headers: { "Content-Type": "text/html" },
                        status: 200,
                    });
                }
            })()
        );
        return;
    }

    // Static assets: stale-while-revalidate
    const dest = req.destination;
    if (["script", "style", "image", "font"].includes(dest)) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(RUNTIME_CACHE);
                const cached = await cache.match(req);
                const network = fetch(req)
                    .then((res) => {
                        if (res && res.status === 200) cache.put(req, res.clone());
                        return res;
                    })
                    .catch(() => undefined);

                return cached || (await network) || new Response("", { status: 504 });
            })()
        );
    }
});
