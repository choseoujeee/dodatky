import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite konfigurace pro React dashboard (statický build pro embed / Google Sites).
export default defineConfig({
  plugins: [react()],
  base: "./",
});
