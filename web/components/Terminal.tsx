"use client";

import { useEffect } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import WhalesPage, { SECTIONS } from "./whales/WhalesPage";
import { useTerminal } from "../store/terminal";
import { useWhales } from "../store/whales";

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const addWidget = useTerminal((s) => s.addWidget);
  const page = useTerminal((s) => s.page);
  const setPage = useTerminal((s) => s.setPage);
  const setSection = useWhales((s) => s.setSection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      // ⌥W toggles Terminal ⇄ Whales (e.code: on macOS ⌥W types "∑").
      if (e.altKey && e.code === "KeyW") {
        e.preventDefault();
        setPage(page === "whales" ? "terminal" : "whales");
        return;
      }
      if (e.altKey && page === "whales") {
        const n = Number(e.code.replace("Digit", ""));
        if (n >= 1 && n <= 9 && SECTIONS[n - 1]) {
          e.preventDefault();
          setSection(SECTIONS[n - 1].id);
        }
        return;
      }
      if (e.altKey) {
        const map: Record<string, () => void> = {
          "1": () => addWidget("chart"),
          "2": () => addWidget("quote"),
          "3": () => addWidget("news"),
          "4": () => addWidget("screener"),
          "5": () => addWidget("heatmap"),
          "6": () => addWidget("crypto"),
          "7": () => addWidget("options"),
          "8": () => addWidget("portfolio"),
          "9": () => addWidget("ai"),
        };
        const fn = map[e.code.replace("Digit", "")];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, addWidget, page, setPage, setSection]);

  return (
    <div className="flex flex-col h-screen">
      <TopBar />
      {page === "whales" ? (
        <WhalesPage />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <Workspace />
          </main>
        </div>
      )}
      <CommandPalette />
    </div>
  );
}
