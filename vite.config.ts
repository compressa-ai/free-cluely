import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Relative asset paths so the UI loads from Electron `loadFile()` (file://), not a dev server.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
