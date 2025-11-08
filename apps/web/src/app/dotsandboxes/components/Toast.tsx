"use client";
import { useEffect, useState } from "react";

export default function Toast({
  message,
  show,
  onHide,
  timeout = 2200,
}: {
  message: string;
  show: boolean;
  onHide: () => void;
  timeout?: number;
}) {
  const [visible, setVisible] = useState(show);
  useEffect(() => {
    if (!show) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      onHide();
    }, timeout);
    return () => clearTimeout(t);
  }, [show, timeout, onHide]);

  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#111827",
        border: "1px solid #374151",
        color: "#e5e7eb",
        padding: "10px 14px",
        borderRadius: 10,
        boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
        zIndex: 50,
        fontSize: 14,
      }}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
