import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/target/**",
        "**/dist/**",
        "**/node_modules/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
