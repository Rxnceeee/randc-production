// Points to the backend API.
// - Local dev: empty string → relative paths (backend also serves on :3000)
// - Production (Vercel): absolute Hostinger URL
// Update BACKEND_PROD_URL below before deploying.
const BACKEND_PROD_URL = 'https://YOUR-BACKEND.hostinger.app';

const BASE_URL = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? 'http://localhost:3000' : BACKEND_PROD_URL;


function Logout() {
            if (typeof logout === 'function') {
                logout();
            } else {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/';
            }
            logoutModal.hide();
        }
