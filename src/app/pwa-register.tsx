"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    const secureLocalOrigin = window.location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if ("serviceWorker" in navigator && secureLocalOrigin) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
