// Centers each .scroll-section__viewport on load so the first and last
// images in the track start half off-screen (per the CSS sizing in
// workPage__NEW.css), and lets a normal mouse wheel scroll the row
// horizontally. Native overflow-x scrolling already stops the row the
// moment either bookend image reaches the edge, so no clamping logic
// is needed here.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.scroll-section__viewport').forEach(function (viewport) {
    function center() {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    }

    var imgs = viewport.querySelectorAll('img');
    if (imgs.length === 0) {
      center();
    } else {
      var pending = 0;
      imgs.forEach(function (img) {
        if (!img.complete) {
          pending++;
          img.addEventListener('load', function () {
            pending--;
            if (pending === 0) center();
          });
          img.addEventListener('error', function () {
            pending--;
            if (pending === 0) center();
          });
        }
      });
      // Set an initial best-guess immediately, then correct once every
      // image has actually loaded (image dimensions affect scrollWidth).
      center();
      if (pending === 0) center();
    }

    // Let a plain vertical mouse-wheel scroll this row horizontally.
    viewport.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        viewport.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  });
});
