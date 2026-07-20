// "Strip the Fluff" bolds the key phrases; "Put it Back" restores them.
// Two explicit buttons rather than one toggle, so each one's effect is
// unambiguous regardless of current state.
//
// Only the button whose action is currently available is highlighted:
// .is-active draws the black border (see .strip-fluff-btn in the page's
// stylesheet). On load that's "Strip the Fluff"; once stripped, it
// becomes "Put it Back".
var fluffEls = document.querySelectorAll('.fluff-text');
var stripBtn = document.getElementById('strip-fluff-button');
var restoreBtn = document.getElementById('put-it-back-button');

function setFluffStripped(stripped) {
  fluffEls.forEach(function (el) {
    el.classList.toggle('removed', stripped);
  });
  if (stripBtn) stripBtn.classList.toggle('is-active', !stripped);
  if (restoreBtn) restoreBtn.classList.toggle('is-active', stripped);
}

if (stripBtn) {
  stripBtn.addEventListener('click', function () { setFluffStripped(true); });
}

if (restoreBtn) {
  restoreBtn.addEventListener('click', function () { setFluffStripped(false); });
}

// Establish the initial state explicitly rather than relying on the
// markup's class staying in sync.
setFluffStripped(false);
