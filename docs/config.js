/* Site config. Edit and commit to change it for EVERY visitor.
   ADMIN PASSWORD: no default is configured. Set a strong password hash below for local/demo use.
   This client-side check is NOT security; use server-side authentication for public deployment.
   To configure a hash (not the password itself):
     Python:  python -c "import hashlib; print(hashlib.sha256(b'NEW_PASSWORD').hexdigest())"
     or open the site, press F12 → Console and run:  FC24_sha256("NEW_PASSWORD")
   Demo-level protection only: GitHub Pages has no server, so this check runs in the browser and
   anyone who reads the code can get past it. Do not protect real secrets with it. */
window.FC24_CONFIG = {
  adminPasswordSha256: "",   // Configure your own SHA-256 hash before enabling the demo login
  appTitle: "FC 24 Position Finder",
  defaultMode: "simple",          // "simple" or "advanced"
  theme: "light",                 // "light" or "dark"
  banner: ""                      // announcement shown at the top ("" = none)
};
