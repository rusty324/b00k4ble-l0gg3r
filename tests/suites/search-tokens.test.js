// Search on every tab matches each word of the query, anywhere and in any
// order — not the whole query as one run of text — and ignores accents and
// typographic punctuation.
const { launch, BASE, reporter } = require('../lib');
const { check, finish, crash } = reporter();
const J = JSON.stringify;

const BOOKS = [
  { id: 1700000000001, title: 'Storm Front', author: 'Jim Butcher', series: 'The Dresden Files #1', status: 'read', formats: ['ebook'] },
  { id: 1700000000002, title: 'One Hundred Years of Solitude', author: 'Gabriel García Márquez', status: 'want', formats: ['physical'] },
  { id: 1700000000003, title: 'Ender’s Game', author: 'Orson Scott Card', status: 'want', formats: ['ebook'] },
  { id: 1700000000004, title: 'The Hobbit', author: 'J. R. R. Tolkien', status: 'read', formats: ['physical'] },
];
const MEDIA = [
  { id: 1700000000101, title: 'Airplane!', type: 'movie', year: '1980', genre: ['Comedy'], status: 'want', formats: ['dvd'] },
  { id: 1700000000102, title: 'Amélie', type: 'movie', year: '2001', genre: ['Romance'], status: 'want', formats: ['bluray'] },
];
const GAMES = [
  { id: 1700000000201, title: 'Hades', genre: ['Roguelike'], status: 'want', platforms: [{ platform: 'steam', formats: ['digital'] }] },
  { id: 1700000000202, title: 'Celeste', genre: ['Platformer'], status: 'want', platforms: [{ platform: 'ps4', formats: ['physical'] }] },
];
const WISH = [
  { id: 1700000000301, type: 'book', title: 'Piranesi', creator: 'Susanna Clarke' },
  { id: 1700000000302, type: 'movie', title: 'Dune: Part Two', creator: 'Denis Villeneuve' },
];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/fonts.g**', r => r.abort()); await ctx.route('**/data/*.json', r => r.abort());
  await ctx.route('**/api.github.com/**', r => r.abort()); await ctx.route('**/openlibrary.org/**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([b, m, g, w]) => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.setItem('myLibrary', JSON.stringify(b)); localStorage.setItem('mediaLibrary', JSON.stringify(m));
    localStorage.setItem('videoGames', JSON.stringify(g)); localStorage.setItem('bookWishlist', JSON.stringify(w));
    localStorage.setItem('activeTab', 'books'); localStorage.setItem('viewMode', 'card');
  }, [BOOKS, MEDIA, GAMES, WISH]);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(800);

  const TABS = {
    books:    { input: '#searchInput',         list: '#booksGrid .book-title' },
    media:    { input: '#mediaSearchInput',    list: '#altContent .book-title' },
    games:    { input: '#gameSearchInput',     list: '#altContent .book-title' },
    wishlist: { input: '#wishlistSearchInput', list: '#altContent .book-title, #altContent .book-row-title, #altContent .wish-title' },
  };
  const search = async (tab, q) => {
    await page.click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(250);
    await page.fill(TABS[tab].input, q); await page.waitForTimeout(450);
    return page.locator(TABS[tab].list).allTextContents().then(a => a.map(t => t.trim()));
  };
  const cases = [
    ['books', 'dresden butcher', ['Storm Front'], 'words from series and author, apart'],
    ['books', 'butcher dresden', ['Storm Front'], 'in either order'],
    ['books', 'dresden tolkien', [], 'every word must match'],
    ['books', 'garcia marquez', ['One Hundred Years of Solitude'], 'without the accents'],
    ['books', "ender's card", ['Ender’s Game'], 'a straight apostrophe finds a curly one'],
    ['media', 'airplane 1980', ['Airplane!'], 'title and year'],
    ['media', 'comedy airplane', ['Airplane!'], 'genre and title'],
    ['media', 'amelie', ['Amélie'], 'without the accent'],
    ['games', 'hades steam', ['Hades'], 'title and platform'],
    ['games', 'roguelike steam', ['Hades'], 'genre and platform'],
    ['wishlist', 'piranesi clarke', ['Piranesi'], 'title and creator'],
    ['wishlist', 'dune villeneuve', ['Dune: Part Two'], 'title and creator, past punctuation'],
  ];
  for (const [tab, q, want, what] of cases) {
    const got = await search(tab, q);
    check(`${tab}: "${q}" — ${what}`, J(got) === J(want), J(got));
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = finish(); await browser.close(); process.exit(failed ? 1 : 0);
})().catch(crash);
