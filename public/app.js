// Heart buttons: toggle favorites without reloading the page.
// Without JavaScript the forms still work as normal posts.
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('.heart-form');
  if (!form) return;
  event.preventDefault();

  const button = form.querySelector('.heart');
  const wanted = form.elements.favorite.value === '1';
  button.disabled = true;
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'x-requested-with': 'fetch' },
      body: new URLSearchParams(new FormData(form)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { favorited } = await res.json();

    const title = button.getAttribute('aria-label').replace(/^(Add|Remove) | (to|from) favorites$/g, '');
    button.classList.toggle('on', favorited);
    button.setAttribute('aria-pressed', String(favorited));
    button.setAttribute('aria-label', `${favorited ? 'Remove' : 'Add'} ${title} ${favorited ? 'from' : 'to'} favorites`);
    form.elements.favorite.value = favorited ? '0' : '1';
    if (favorited && wanted) {
      button.classList.remove('pop');
      void button.offsetWidth; // restart the animation
      button.classList.add('pop');
    }

    const count = document.querySelector('.favorites-link .count');
    if (count) count.textContent = Math.max(0, Number(count.textContent) + (favorited ? 1 : -1));

    // On the Favorites page, an unfavorited recipe leaves the list.
    if (!favorited && location.pathname === '/recipes/favorites') {
      const item = form.closest('li');
      const list = item.parentElement;
      item.remove();
      if (!list.children.length) {
        list.outerHTML = '<p class="muted">You haven\'t favorited any recipes yet.</p>';
      }
    }
  } catch {
    form.submit(); // fall back to a normal page load
  } finally {
    button.disabled = false;
  }
});
