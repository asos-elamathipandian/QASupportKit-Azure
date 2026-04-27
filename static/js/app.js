/* QASupportKit-Azure — client-side helpers */

/** Copy the XML output pre-block to clipboard */
function copyXml() {
  const pre = document.getElementById("xmlOutput");
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    const btn = document.querySelector('[onclick="copyXml()"]');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied!';
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    }
  });
}
