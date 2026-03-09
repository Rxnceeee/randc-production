const BASE_URL = '';

//  document.addEventListener("contextmenu", function (e) {
//     e.preventDefault();
//   });


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