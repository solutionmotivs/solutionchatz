// Next.js 14.1 only picks up PostCSS config from .js/.cjs/.json (not .mjs), so Tailwind needs this file.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
