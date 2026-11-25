import { defineConfig } from 'vite';

// base './' = relative asset paths, so the build works on GitHub Pages
// under https://<user>.github.io/<repo>/ without hardcoding the repo name.
export default defineConfig({
  base: './',
});
