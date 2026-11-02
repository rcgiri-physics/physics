const form = document.getElementById('login');
const status = form.querySelector('.status');
form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('button');
  btn.disabled = true;
  status.textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PD-Admin': '1' },
      body: JSON.stringify({ username: form.username.value, password: form.password.value, code: form.code.value || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      const next = new URLSearchParams(location.search).get('next') || '/admin/';
      location.href = next.startsWith('/admin') ? next : '/admin/';
      return;
    }
    if (data.needCode) { form.querySelector('.code').hidden = false; form.code.focus(); }
    status.textContent = data.error || 'Could not sign in.';
  } catch (err) {
    status.textContent = 'No connection. Check your internet and try again.';
  }
  btn.disabled = false;
});
