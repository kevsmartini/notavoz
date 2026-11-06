// notavoz es solo para móvil. En ordenador se muestra un aviso en lugar de la app.
// (iPad con iPadOS se anuncia como Mac: lo detectamos por la pantalla táctil.)
window.IS_MOBILE = (navigator.userAgentData && navigator.userAgentData.mobile)
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if(!IS_MOBILE) document.documentElement.classList.add('desktop');
