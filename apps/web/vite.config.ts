import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    // The API has no sign-in: other local sites may not read it through here.
    cors: false,
    proxy: { "/api": process.env.API_PROXY || "http://127.0.0.1:3001" },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 800 },
});
