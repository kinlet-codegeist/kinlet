import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  server: { strictPort: true },
  build: { outDir: mode === "forge" ? "dist/forge-ui" : "dist/local" },
}));
