const puppeteer = require('puppeteer');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const xlsx = require('xlsx');

puppeteer.use(StealthPlugin());

const baseUrl = 'https://blogtruyenmoi.com/danhsach/tatca';

async function fetchMangaLinks(page) {
  const mangaLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('.tiptip a').forEach((element) => {
      const link = element.getAttribute('href');
      if (link) {
        links.push({
          title: element.textContent.trim(),
          link: link.startsWith('http')
            ? link
            : `https://blogtruyenmoi.com${link}`,
        });
      }
    });
    return links;
  });
  console.log(`Fetched ${mangaLinks.length} links on current page`);
  return mangaLinks;
}

async function fetchAllMangaLinks() {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for Puppeteer on GitHub Actions
  }); // Increase protocolTimeout to 120 seconds
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  const allMangaLinks = [];
  let currentPage = 1;
  let hasNextPage = true;

  while (hasNextPage && currentPage <= maxPages) {
    try {
      const mangaLinks = await fetchMangaLinks(page);
      allMangaLinks.push(...mangaLinks);
      console.log(`Fetched ${allMangaLinks.length} manga links`);

      await page.screenshot({ path: `page-${currentPage}.png` });
      // Check if there is a next page button and click it
      const nextPageButton = await page.$(
        `span.page > a[href="javascript:LoadListMangaPage(${
          currentPage + 1
        })"]`,
      );
      if (nextPageButton) {
        await nextPageButton.evaluate((button) => button.click());
        await page.waitForFunction(
          `document.querySelector(".current_page").textContent === "${
            currentPage + 1
          }"`,
          { timeout: 300000 }, // Increase timeout to 30 seconds
        );
        currentPage++;
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error(`Error on page ${currentPage}:`, error);
      hasNextPage = false;
    }
  }

  await browser.close();
  return allMangaLinks;
}

async function fetchMangaDetails(mangaLinks) {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for Puppeteer on GitHub Actions
  });
  const page = await browser.newPage();
  const mangaDetails = [];

  for (const manga of mangaLinks) {
    try {
      await page.goto(manga.link, { waitUntil: 'networkidle2' });
      const details = await page.evaluate(() => {
        const name = document.querySelector('h1').innerText.trim();
        const author = document
          .querySelector('a[href*="/tac-gia/"]')
          .innerText.trim();
        const genre = Array.from(
          document.querySelectorAll('.description a[href*="/theloai/"]'),
        )
          .map((el) => el.innerText.trim())
          .join(', ');
        const summary = document
          .querySelector('.detail .content')
          .innerText.trim();

        const pageViews = document.querySelector('#PageViews').innerText.trim();
        const likeCount = document.querySelector('#LikeCount').innerText.trim();
        const status = document
          .querySelector('.description span.color-red')
          .innerText.trim();

        return { name, author, genre, summary, pageViews, likeCount, status };
      });
      mangaDetails.push({ ...manga, ...details });
    } catch (error) {
      console.error(`Error fetching details for ${manga.link}:`, error);
    }
  }

  await browser.close();
  return mangaDetails;
}

async function saveToExcel(mangaDetails) {
  const worksheet = xlsx.utils.json_to_sheet(mangaDetails);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Manga Details');
  xlsx.writeFile(workbook, 'manga_details.xlsx');
  console.log('Manga details saved to manga_details.xlsx');
}

async function main() {
  const mangaLinks = await fetchAllMangaLinks();
  const mangaDetails = await fetchMangaDetails(mangaLinks);
  await saveToExcel(mangaDetails);
}

main();
