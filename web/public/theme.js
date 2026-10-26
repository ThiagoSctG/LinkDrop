// Applies the saved or preferred theme before first paint (CSP forbids inline scripts).
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("linkdrop:theme");
  } catch (e) {}
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
