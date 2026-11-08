// bb-plugin-memory-explorer — the frontend entry.
//
// One sidebar page, Memory, at /plugins/memory-explorer/memory: BB memory as
// a table and a graph (pages/MemoryPage.tsx). BB loads this bundle and reads
// its default export; don't import this file directly.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MemoryPage } from "./pages/MemoryPage";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "memory",
    title: "Memory",
    // Brain: the page is everything agents remember, not only people.
    icon: "Brain",
    path: "memory",
    component: MemoryPage,
  });
});
