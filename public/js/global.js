const BASE_URL = 'https://randcdocumentations.up.railway.app';

//document.addEventListener("contextmenu", function (e) {
//e.preventDefault();
//});


function Logout() {
            // Call the logout function from main.js (or wherever it's defined)
            if (typeof logout === 'function') {
                logout();
            } else {
                // Fallback logout logic if logout() is not defined
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/';
                
            }
            logoutModal.hide();
        }
