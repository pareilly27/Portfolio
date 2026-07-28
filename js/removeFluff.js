// One toggle (same .toggle-btn component as the home page's
// Linear/Experimental control): untoggled shows "Strip the Fluff" and
// bolds the key phrases when clicked; toggled shows "Put it Back" and
// restores them.
var fluffEls = document.querySelectorAll('.fluff-text');
var fluffToggle = document.getElementById('fluffToggle');
var fluffToggleLabel = document.getElementById('fluffToggleLabel');

function setFluffStripped(stripped) {
  fluffEls.forEach(function (el) {
    el.classList.toggle('removed', stripped);
  });
  if (fluffToggle) {
    fluffToggle.classList.toggle('toggled', stripped);
    fluffToggle.setAttribute('aria-pressed', String(stripped));
  }
  if (fluffToggleLabel) {
    fluffToggleLabel.textContent = stripped ? 'Put it Back' : 'Strip the Fluff';
  }
}

if (fluffToggle) {
  fluffToggle.addEventListener('click', function () {
    setFluffStripped(!fluffToggle.classList.contains('toggled'));
  });
}

// Establish the initial state explicitly rather than relying on the
// markup's class staying in sync.
setFluffStripped(false);
