(() => {
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#mp-close');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.reload();
  }, true);
})();
