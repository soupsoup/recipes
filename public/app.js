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

// Create recipe: shrink the chosen photo to at most 1000px wide before it's sent,
// so a big phone photo becomes a quick upload.
const photoFile = document.getElementById('photo-file');
if (photoFile) {
  const MAX_SIDE = 1000;
  const MAX_CHARS = 700 * 1024; // keeps the upload under the server's limit
  const preview = document.getElementById('photo-preview');
  const data = document.getElementById('photo-data');
  const hint = document.getElementById('photo-hint');
  const remove = document.getElementById('photo-remove');
  const removeFlag = document.getElementById('photo-remove-flag');

  photoFile.addEventListener('change', async () => {
    const file = photoFile.files[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let url = canvas.toDataURL('image/jpeg', 0.82);
      for (const quality of [0.7, 0.55]) {
        if (url.length <= MAX_CHARS) break;
        url = canvas.toDataURL('image/jpeg', quality);
      }
      data.value = url;
      removeFlag.value = '0';
      const img = new Image();
      img.alt = 'Your recipe photo';
      img.src = url;
      preview.replaceChildren(img);
      preview.hidden = false;
      remove.hidden = false;
      hint.textContent = 'Looking tasty! It will be shown with your recipe.';
    } catch {
      hint.textContent = "That file couldn't be opened as a photo. Try a JPEG or PNG.";
    }
    photoFile.value = '';
  });

  remove.addEventListener('click', () => {
    data.value = '';
    removeFlag.value = '1';
    preview.replaceChildren();
    preview.hidden = true;
    remove.hidden = true;
    hint.textContent = 'Show everyone what your dish looks like.';
  });
}
