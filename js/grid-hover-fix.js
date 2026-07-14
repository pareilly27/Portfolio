// Prevents a hovered grid tile's overlay from riding along with the page
// while scrolling. Plain CSS :hover only gets recalculated on mouse
// movement, never on scroll, so without this a tile's overlay would stay
// stuck visible as it scrolls away.
//
// Fix: a transparent, fixed, full-viewport pane (#grid-scroll-blocker) sits
// above the grid. The instant scrolling starts, the pane switches to
// pointer-events: auto, so the mouse is effectively hovering the pane
// instead of whatever square is underneath -- that square's native :hover
// (and its overlay) clears immediately. Once scrolling settles, the pane
// goes back to pointer-events: none and plain :hover takes over again on
// the next real mouse move.
document.addEventListener('DOMContentLoaded', function () {
  var blocker = document.getElementById('grid-scroll-blocker');
  if (!blocker) return;

  var scrollTimer = null;

  function onScroll() {
    blocker.classList.add('is-blocking');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      blocker.classList.remove('is-blocking');
    }, 120);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
});
