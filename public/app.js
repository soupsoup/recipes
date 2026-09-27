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

// Change profile: crop the chosen photo to a 256px square in the browser and
// send it as a small JPEG, so uploads stay tiny whatever the phone camera made.
const avatarFile = document.getElementById('avatar-file');
if (avatarFile) {
  const SIZE = 256;
  const hint = document.getElementById('avatar-hint');
  const preview = document.getElementById('avatar-preview');
  const data = document.getElementById('avatar-data');

  avatarFile.addEventListener('change', async () => {
    const file = avatarFile.files[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.getContext('2d').drawImage(
        bitmap,
        (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
        0, 0, SIZE, SIZE,
      );
      data.value = canvas.toDataURL('image/jpeg', 0.85);
      document.querySelectorAll('input[name="preset"]').forEach((radio) => { radio.checked = false; });
      preview.innerHTML = '';
      const img = new Image();
      img.className = 'avatar';
      img.alt = '';
      img.style.width = img.style.height = '96px';
      img.src = data.value;
      preview.append(img);
      hint.textContent = 'Looks good? Press Save to use this photo.';
    } catch {
      data.value = '';
      hint.textContent = "That file couldn't be opened as a picture. Try a JPEG or PNG photo.";
    }
  });
}

// Picking a food picture shows it in the preview and drops any photo chosen before.
document.querySelectorAll('input[name="preset"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const preview = document.getElementById('avatar-preview');
    const big = radio.parentElement.querySelector('.avatar').cloneNode(true);
    big.style.width = big.style.height = '96px';
    big.style.fontSize = '56px';
    preview.replaceChildren(big);
    document.getElementById('avatar-data').value = '';
    document.getElementById('avatar-file').value = '';
    const label = radio.parentElement.querySelector('.preset-label').textContent;
    document.getElementById('avatar-hint').textContent = `${label} it is! Press Save to use it.`;
  });
});
