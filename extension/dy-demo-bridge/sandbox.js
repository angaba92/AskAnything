window.parent.postMessage({ type: 'dy-sandbox-ready' }, '*');
window.addEventListener('message', async function(e) {
  if (!e.data || e.data.type !== 'dy-eval') return;
  var id = e.data.id;
  try {
    var fn = new Function('return (' + e.data.expression + ')');
    var result = await Promise.resolve(fn());
    window.parent.postMessage({ type: 'dy-eval-result', id: id, result: result }, '*');
  } catch (err) {
    window.parent.postMessage({ type: 'dy-eval-result', id: id, error: String(err.message || err) }, '*');
  }
});
