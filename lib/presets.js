// Food pictures people can pick instead of uploading a photo.
// The key is what the database stores; order is the order on the Change profile page.
const AVATAR_PRESETS = {
  donut: { emoji: '🍩', label: 'Donut', bg: '#FBD3E0' },
  spaghetti: { emoji: '🍝', label: 'Spaghetti', bg: '#FDE2C4' },
  pizza: { emoji: '🍕', label: 'Pizza', bg: '#FFE7A8' },
  sandwich: { emoji: '🥪', label: 'Sandwich', bg: '#E9DDC7' },
  onion: { emoji: '🧅', label: 'Onion', bg: '#EADCF2' },
  apple: { emoji: '🍎', label: 'Apple', bg: '#FAD0CC' },
  cheeseburger: { emoji: '🍔', label: 'Cheeseburger', bg: '#FCE3B0' },
  orange: { emoji: '🍊', label: 'Orange', bg: '#FFD8B0' },
  cupcake: { emoji: '🧁', label: 'Cupcake', bg: '#D9E8FB' },
  cake: { emoji: '🎂', label: 'Cake', bg: '#FDE0EC' },
  lollipop: { emoji: '🍭', label: 'Lollipop', bg: '#E4DAFB' },
  chocolate: { emoji: '🍫', label: 'Chocolate', bg: '#E8D5C8' },
  pineapple: { emoji: '🍍', label: 'Pineapple', bg: '#F4F1B8' },
};

module.exports = { AVATAR_PRESETS };
