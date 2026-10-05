/*! Vaulte pay button. Turns <a class="vaulte-pay" href="https://YOUR_HOST/pay/TOKEN">Pay</a> or
 *  <div data-vaulte-pay="https://YOUR_HOST/pay/TOKEN"></div> into a styled button that opens the hosted pay page.
 *  No tracking, no third-party calls, no card data: the hosted page does the payment. */
(function () {
  "use strict";
  var STYLE = "display:inline-block;padding:12px 22px;background:#0a0a0a;color:#f4f1ea;font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border:0;cursor:pointer";
  function safe(u) { try { var x = new URL(u, location.href); return (x.protocol === "https:" || x.hostname === "localhost") && /\/pay\/[A-Za-z0-9_-]+$/.test(x.pathname) ? x.toString() : null; } catch (e) { return null; } }
  function mount(el) {
    var url = safe(el.getAttribute("data-vaulte-pay") || el.getAttribute("href"));
    if (!url) { el.setAttribute("hidden", ""); return; }
    var a = el.tagName === "A" ? el : document.createElement("a");
    a.href = url; a.rel = "noopener"; a.setAttribute("style", STYLE);
    if (el.tagName !== "A") { a.textContent = el.getAttribute("data-label") || "Pay with Vaulte"; el.appendChild(a); }
    else if (!a.textContent.trim()) a.textContent = "Pay with Vaulte";
    if (el.getAttribute("data-target") === "popup") a.addEventListener("click", function (e) { e.preventDefault(); window.open(url, "vaulte-pay", "width=720,height=860,noopener"); });
  }
  function init() { [].forEach.call(document.querySelectorAll("a.vaulte-pay,[data-vaulte-pay]"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
