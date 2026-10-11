// The kit's stories in a plain browser, for tests (main.tsx; docs/48). Every story file is
// crawled for dependencies at startup: found later (when a test loads them all), Vite
// re-optimizes and reloads the page under the test.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  logLevel: "error",
  optimizeDeps: { entries: ["main.tsx", "../../src/**/*.story.tsx"] },
});
