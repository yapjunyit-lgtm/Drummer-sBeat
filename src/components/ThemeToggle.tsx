"use client";

import { useLayoutEffect } from "react";

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#171614" : "#f5f2eb");
}

export default function ThemeToggle() {
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem("drummer-theme");
      if (saved === "light" || saved === "dark") applyTheme(saved);
    } catch { /* The toggle still works when storage is unavailable. */ }
  }, []);

  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("drummer-theme", next); } catch { /* Keep the current session preference. */ }
  };

  return (
    <button onClick={toggle} className="theme-toggle" title="Toggle light/dark mode 切换明暗模式">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path className="theme-moon" d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />
        <g className="theme-sun"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></g>
      </svg>
      <span className="sr-only theme-moon">Switch to dark mode 深色模式</span>
      <span className="sr-only theme-sun">Switch to light mode 浅色模式</span>
    </button>
  );
}
