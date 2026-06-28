// Mobile Navigation Handler
// This creates and manages the mobile navigation experience

(function() {
    'use strict';
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileNav);
    } else {
        initMobileNav();
    }
    
    function initMobileNav() {
        // Create mobile navigation elements
        createMobileNavigation();
        
        // Small delay to ensure elements are in DOM
        setTimeout(function() {
            setupMobileMenuToggle();
            setupMobileNavigation();
            handleResponsiveChanges();
            
            // Wrap the existing showSection function
            wrapShowSectionFunction();
        }, 100);
    }
    
    function createMobileNavigation() {
        // Create mobile header
        const mobileHeader = document.createElement('div');
        mobileHeader.className = 'mobile-header';
        mobileHeader.innerHTML = `
            <div class="mobile-header-title">
                <i class="bi bi-file-earmark-text-fill"></i>
                <span>Dashboard</span>
            </div>
            <button class="mobile-menu-toggle" id="mobileMenuToggle">
                <i class="bi bi-list"></i>
            </button>
        `;
        document.body.insertBefore(mobileHeader, document.body.firstChild);
        
        // Create mobile bottom navigation
        const mobileNav = document.createElement('div');
        mobileNav.className = 'mobile-bottom-nav';
        mobileNav.innerHTML = `
            <div class="mobile-nav-items">
                <a class="mobile-nav-item active" data-section="dashboardPanel">
                    <i class="bi bi-speedometer2"></i>
                    <span>Dashboard</span>
                </a>
                <a class="mobile-nav-item" data-section="appointmentPanel">
                    <i class="bi bi-calendar-check"></i>
                    <span>Appointments</span>
                </a>
                <a class="mobile-nav-item" data-section="transactionsPanel">
                    <i class="bi bi-file-earmark-text"></i>
                    <span>Transactions</span>
                </a>
                <a class="mobile-nav-item" data-section="userProfilePanel">
                    <i class="bi bi-person-circle"></i>
                    <span>Account</span>
                </a>
            </div>
        `;
        document.body.appendChild(mobileNav);
        
        // Create mobile sidebar overlay
        const overlay = document.createElement('div');
        overlay.className = 'mobile-sidebar-overlay';
        overlay.id = 'mobileSidebarOverlay';
        document.body.appendChild(overlay);
    }
    
    function setupMobileMenuToggle() {
        const menuToggle = document.getElementById('mobileMenuToggle');
        const sidebar = document.querySelector('.bottom-left-nav');
        const overlay = document.getElementById('mobileSidebarOverlay');
        
        if (menuToggle && sidebar && overlay) {
            menuToggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                sidebar.classList.toggle('mobile-menu-active');
                overlay.classList.toggle('active');
                
                // Update icon
                const icon = this.querySelector('i');
                if (sidebar.classList.contains('mobile-menu-active')) {
                    icon.className = 'bi bi-x-lg';
                } else {
                    icon.className = 'bi bi-list';
                }
            });
            
            // Close sidebar when overlay is clicked
            overlay.addEventListener('click', function() {
                sidebar.classList.remove('mobile-menu-active');
                overlay.classList.remove('active');
                const icon = menuToggle.querySelector('i');
                if (icon) icon.className = 'bi bi-list';
            });
            
            // Close sidebar when a menu item is clicked
            const sidebarMenuItems = sidebar.querySelectorAll('.sidebar-menu-item');
            sidebarMenuItems.forEach(item => {
                item.addEventListener('click', function() {
                    if (window.innerWidth <= 1024) {
                        setTimeout(function() {
                            sidebar.classList.remove('mobile-menu-active');
                            overlay.classList.remove('active');
                            const icon = menuToggle.querySelector('i');
                            if (icon) icon.className = 'bi bi-list';
                        }, 300);
                    }
                });
            });
        }
    }
    
    function setupMobileNavigation() {
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
        
        mobileNavItems.forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Remove active class from all items
                mobileNavItems.forEach(navItem => navItem.classList.remove('active'));
                
                // Add active class to clicked item
                this.classList.add('active');
                
                // Get section name and show it
                const sectionName = this.getAttribute('data-section');
                if (sectionName && typeof window.showSection === 'function') {
                    window.showSection(sectionName);
                }
                
                // Update page title in mobile header
                updateMobileHeaderTitle(this.querySelector('span').textContent);
            });
        });
    }
    
    function updateMobileHeaderTitle(title) {
        const headerTitle = document.querySelector('.mobile-header-title span');
        if (headerTitle && title) {
            headerTitle.textContent = title;
        }
    }
    
    function handleResponsiveChanges() {
        let resizeTimer;
        
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                const sidebar = document.querySelector('.bottom-left-nav');
                const overlay = document.getElementById('mobileSidebarOverlay');
                const menuToggle = document.getElementById('mobileMenuToggle');
                
                // Close mobile menu on desktop resize
                if (window.innerWidth > 1024) {
                    if (sidebar) sidebar.classList.remove('mobile-menu-active');
                    if (overlay) overlay.classList.remove('active');
                    if (menuToggle) {
                        const icon = menuToggle.querySelector('i');
                        if (icon) icon.className = 'bi bi-list';
                    }
                }
            }, 250);
        });
    }
    
    function syncMobileNavWithSection(sectionName) {
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
        mobileNavItems.forEach(item => {
            if (item.getAttribute('data-section') === sectionName) {
                item.classList.add('active');
                const itemText = item.querySelector('span');
                if (itemText) {
                    updateMobileHeaderTitle(itemText.textContent);
                }
            } else {
                item.classList.remove('active');
            }
        });
    }
    
    function wrapShowSectionFunction() {
        // Save reference to original function
        if (typeof window.showSection === 'function') {
            const originalShowSection = window.showSection;
            
            // Replace with wrapped version
            window.showSection = async function(sectionName) {
                // Call original function
                await originalShowSection.call(this, sectionName);
                
                // Sync mobile navigation
                syncMobileNavWithSection(sectionName);
                
                // Update sidebar menu items
                const sidebarItems = document.querySelectorAll('.sidebar-menu-item');
                sidebarItems.forEach(item => {
                    const onclick = item.getAttribute('onclick');
                    if (onclick && onclick.includes(sectionName)) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });
            };
        }
    }
    
    // Make sync function globally available for manual calls if needed
    window.syncMobileNav = syncMobileNavWithSection;
    
})();