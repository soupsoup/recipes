// The Halloween event: a spooky main menu and the Spooky Food Contest.
// It runs every October in US Eastern time, and the winner is announced
// on the main menu for the first two weeks of November.
const ZONE = 'America/New_York';
const ANNOUNCE_DAYS = 14;

function zonedParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

// The UTC instant of midnight on the given day in US Eastern time.
function zonedMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  const inZone = new Date(new Date(guess).toLocaleString('en-US', { timeZone: ZONE }));
  const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess + (asUtc - inZone));
}

function halloween(now) {
  const { year, month, day } = zonedParts(now);
  return {
    year,
    spooky: month === 10,
    contestOpen: month === 10,
    // After October, this year's contest is over and its winner can be decided.
    lastEndedYear: month >= 11 ? year : year - 1,
    announcing: month === 11 && day <= ANNOUNCE_DAYS,
  };
}

function contestStart(year) {
  return zonedMidnight(year, 10, 1);
}

function contestEnd(year) {
  return zonedMidnight(year, 11, 1);
}

module.exports = { halloween, contestStart, contestEnd, zonedMidnight };
