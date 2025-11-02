"use client";
import { useEffect, useState } from "react";
import { registerSW } from "@/lib/register-sw";

export default function ServiceWorkerProvider({ children }: { children: React.ReactNode }) {
    const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

    useEffect(() => {
        registerSW((readyReg) => setReg(readyReg));
    }, []);

    const accept = () => {
        reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
    };

    return (
        <>
            {children}
            {reg && (
                <div
                    style={{
                        position: "fixed",
                        bottom: 16,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(0,0,0,.85)",
                        color: "white",
                        padding: "10px 14px",
                        borderRadius: 12,
                        zIndex: 1000,
                    }}
                >
                    New version available.
                    <button onClick={accept} style={{ marginLeft: 8, textDecoration: "underline" }}>
                        Update
                    </button>
                </div>
            )}
        </>
    );
}
