import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_PROXY_TARGET;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3000,
      host: true,
      proxy: proxyTarget
        ? {
            "/api": {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
            "/health": {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
            "/socket.io": {
              target: proxyTarget,
              changeOrigin: true,
              ws: true,
              secure: false,
            },
          }
        : undefined,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
    optimizeDeps: {
      // Same alias for esbuild (Vite dev server pre-bundler).
      esbuildOptions: {
        conditions: ["import", "browser", "module", "default"],
      },
      exclude: ["lucide-react"],
    },
  };
});
