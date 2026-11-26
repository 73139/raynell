// Preview and field displays must describe the same draw rules used by the trip.
const {assert, boot, epoch, go} = require('./game-fixture.cjs');

const routes = [
  [0, 1, '10%', '25%', '10%', '25%'],
  [0, 2, '35%', '27%', '72.5%', '61.1%'],
  [1, 0, '8%', '20%', '8%', '20%'],
  [1, 2, '20%', '34%', '36%', '56.4%'],
  [2, 0, '15%', '30%', '38.6%', '65.7%'],
  [2, 1, '28%', '32%', '48.2%', '53.8%']
];

function checkCard(html, from, to, values) {
  const marker = 'data-route-card data-from="' + from + '" data-to="' + to + '"';
  assert.ok(html.includes(marker), 'missing route ' + from + ' → ' + to);
  const card = html.split(marker)[1].split('</article>')[0];
  const attributes = ['risk', 'supply', 'trip-risk', 'trip-supply'];
  attributes.forEach((attribute, index) => {
    assert.ok(card.includes('data-route-' + attribute + '>' + values[index] + '</dd>'),
      'wrong ' + attribute + ' for ' + from + ' → ' + to);
  });
}

for (const [from, to, ...values] of routes) {
  for (const weatherSlot of [0, 1, 2]) {
    const run = boot({}, {now:epoch + weatherSlot * 120000}, {}, '#map');
    run.click({cui:'inspect', index:String(from)});
    checkCard(run.content(), from, to, values);
    run.g.start();
    assert.equal(run.g.s.raid.zone, from);
    checkCard(run.g.readField(), from, to, values);
  }
}

const trip = boot({}, undefined, {}, '#map');
trip.g.start();
trip.setRolls([.9, .5, 0, .01]);
checkCard(trip.g.readField(), 0, 2, routes[1].slice(2));
go(trip, 'move', {index:2});
assert.deepEqual(Array.from(trip.g.s.field.journey.schedule.legs, leg => leg.outcome),
  ['contact', 'supply', 'clear'], 'opening a forecast must not consume a travel draw');
assert.doesNotMatch(trip.g.readField(), /data-route-trip-(risk|supply)/);
console.log('PASS six directed route odds, three weather states, planning and raid views, unchanged draw order and no future outcomes in transit.');
