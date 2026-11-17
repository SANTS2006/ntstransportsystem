# NTS Transport marketing site

Static website (Vite, plain JavaScript, Three.js) that presents the system: features, how it works,
solutions, security, about, FAQ, contact and legal pages.

- `npm run dev:site` (from the repository root) starts it on http://localhost:5180
- `npm run build -w @nts/site` writes the finished site to `apps/site/dist`
- Contact details (email, phone, WhatsApp number and the first WhatsApp message) live in one place:
  `src/config.js`. The pages themselves carry the same details in their links, so change both when
  a detail changes (the pages are plain HTML files in this folder).
- The 3D scene is `src/scene.js` (a coach driving along a route, moved by the scroll position).
  It stands still for people who ask their device for reduced motion.
