// Recipe videos: people paste an Instagram or YouTube link. Only links we can
// recognize are accepted, and the player is always built from the video's ID,
// never from the pasted text, so a link can't put some other site on the page.

function parseVideo(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id = null;
    let vertical = false;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live'].includes(parts[0])) {
      id = parts[1];
      vertical = parts[0] === 'shorts';
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return {
      site: 'youtube',
      id,
      vertical,
      link: vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      embed: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  }

  if (host === 'instagram.com') {
    const kind = { p: 'p', reel: 'reel', reels: 'reel', tv: 'tv' }[parts[0]];
    const code = parts[1];
    if (!kind || !code || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
    return {
      site: 'instagram',
      id: code,
      vertical: true,
      link: `https://www.instagram.com/${kind}/${code}/`,
      embed: `https://www.instagram.com/${kind}/${code}/embed`,
    };
  }
  return null;
}

module.exports = { parseVideo };
