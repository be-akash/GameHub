export function registerSW(onUpdateReady: (reg: ServiceWorkerRegistration) => void) {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Register after window load
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js")
            .then((reg) => {
                reg.addEventListener("updatefound", () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            // New version ready (waiting)
                            onUpdateReady(reg);
                        }
                    });
                });
            })
            .catch(console.error);
    });

    // Reload exactly once when the new SW activates and takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });
}
