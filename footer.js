// Footer component for consistent footer across all pages
(function() {
  'use strict';

  const footer = document.querySelector('footer');
  if (!footer) {
    console.error('Footer element not found');
    return;
  }

  const currentYear = new Date().getFullYear();
  
  // Build footer HTML
  const footerHTML = `
    <div class="footer-content">
      <div class="footer-section">
        <h4>Company</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/index.htm#about">About</a></li>
          <li><a href="/services.html">Services</a></li>
          <li><a href="/pricing.html">Pricing</a></li>
        </ul>
      </div>

      <div class="footer-section">
        <h4>Support</h4>
        <ul>
          <li><a href="/faq.html">FAQ</a></li>
          <li><a href="/support-portal.html">Support Portal</a></li>
          <li><a href="/customer-portal.html">Customer Portal</a></li>
          <li><a href="/support-login.html">Support Login</a></li>
        </ul>
      </div>

      <div class="footer-section">
        <h4>Legal & Security</h4>
        <ul>
          <li><a href="/privacy.html">Privacy Policy</a></li>
          <li><a href="/privacy.html#security">Security Practices</a></li>
          <li><a href="/privacy.html#gdpr">GDPR Compliance</a></li>
          <li><a href="/privacy.html#incident">Incident Response</a></li>
        </ul>
      </div>

      <div class="footer-section">
        <h4>Newsletter</h4>
        <p>Stay updated with our latest releases and tips.</p>
        <form class="footer-newsletter" onsubmit="handleFooterNewsletter(event)">
          <input 
            type="email" 
            placeholder="Enter your email" 
            required
            aria-label="Newsletter email"
          />
          <button type="submit" class="btn btn-primary">Subscribe</button>
        </form>
      </div>
    </div>

    <div class="footer-bottom">
      <p class="copyright">&copy; ${currentYear} CreatVi Web Solutions. All rights reserved.</p>
      <div class="footer-links">
        <a href="/privacy.html">Privacy</a>
        <span class="separator">•</span>
        <a href="/privacy.html#security">Security</a>
        <span class="separator">•</span>
        <a href="mailto:support@creatvi.com">Contact</a>
      </div>
    </div>
  `;

  footer.innerHTML = footerHTML;

  // Handle footer newsletter signup
  window.handleFooterNewsletter = function(e) {
    e.preventDefault();
    const input = e.target.querySelector('input[type="email"]');
    const email = input.value;
    
    let subscribers = JSON.parse(localStorage.getItem('newsletterSubscribers') || '[]');
    if (!subscribers.includes(email)) {
      subscribers.push(email);
      localStorage.setItem('newsletterSubscribers', JSON.stringify(subscribers));
    }
    
    if (window.gtag) {
      gtag('event', 'newsletter_signup', { 
        email_provided: true,
        location: 'footer'
      });
    }
    
    // Show confirmation
    const btn = e.target.querySelector('button');
    const originalText = btn.textContent;
    btn.textContent = 'Subscribed!';
    btn.disabled = true;
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      input.value = '';
    }, 3000);
  };
})();
