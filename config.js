// Deployment configuration for the Thai Boran app.
//
// apiBase: the address of the back-office server (Render web service).
//   - '' (empty) means "same origin" — only for local development.
//   - After deploying the server, set it to e.g.
//     'https://thai-boran-server.onrender.com'  (NO trailing slash)
//
// branchId must match a branches/<id>/ folder in the data repo.

window.TB_CONFIG = {
  apiBase: '',
  branchId: 'panacan',
};
