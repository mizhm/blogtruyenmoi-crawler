const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const xlsx = require('xlsx');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const baseUrl = 'https://blogtruyenmoi.com/danhsach/tatca';
const totalPages = 1301;
const chunkSize = 10;

async function fetchMangaLinks(page) {
  const mangaLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('.tiptip a').forEach((element) => {
      const link = element.getAttribute('href');
      if (link) {
        links.push({
          title: element.textContent.trim().replace(/:$/, ''), // Remove colon at the end
          link: link.startsWith('http')
            ? link
            : `https://blogtruyenmoi.com${link}`,
        });
      }
    });
    return links;
  });
  return mangaLinks;
}

async function fetchMangaLinksChunk(startPage, endPage) {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for Puppeteer on GitHub Actions
      timeout: 120000,
      defaultViewport: null,
    }); // Increase protocolTimeout to 120 seconds
    const page = await browser.newPage();
    await page.goto(baseUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await page.evaluate((startPage) => {
      window.LoadListMangaPage(startPage);
    }, startPage);

    await page.waitForFunction(
      `document.querySelector(".current_page").textContent === "${startPage}"`,
      { timeout: 60000 },
    );

    const allMangaLinks = [];
    let currentPage = startPage;
    let hasNextPage = true;

    while (hasNextPage && currentPage <= endPage) {
      try {
        const mangaLinks = await fetchMangaLinks(page);
        allMangaLinks.push(...mangaLinks);

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
            { timeout: 60000 },
          );
          currentPage++;
        } else {
          hasNextPage = false;
        }
      } catch (error) {
        console.error(`Error on page ${currentPage}:`, error.message);
        hasNextPage = false;
      }
    }

    await browser.close();
    return allMangaLinks;
  } catch (error) {
    fetchMangaLinksChunk(startPage, endPage);
  }
}

async function fetchAllMangaLinks() {
  const allMangaLinks = [];
  for (let i = 0; i < totalPages; i += chunkSize) {
    const startPage = i + 1;
    const endPage = Math.min(i + chunkSize, totalPages);
    console.log(`Fetching pages ${startPage} to ${endPage}`);
    const mangaLinksChunk = await fetchMangaLinksChunk(startPage, endPage);
    allMangaLinks.push(...mangaLinksChunk);
  }
  return allMangaLinks;
}

async function fetchMangaDetails(mangaLinks) {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for Puppeteer on GitHub Actions
      defaultViewport: null,
      timeout: 120000,
    });
    const page = await browser.newPage();
    const mangaDetails = [];

    for (const manga of mangaLinks) {
      try {
        await page.goto(manga.link, {
          waitUntil: 'networkidle2',
          timeout: 60000,
        });
        const details = await page.evaluate(() => {
          const name = document.querySelector('h1').innerText.trim();
          const author = Array.from(
            document.querySelectorAll('a[href*="/tac-gia/"]'),
          )
            .map((el) => el.innerText.trim())
            .join(', ');
          const genre = Array.from(
            document.querySelectorAll('.description a[href*="/theloai/"]'),
          )
            .map((el) => el.innerText.trim())
            .join(', ');
          const summary = document
            .querySelector('.detail .content')
            .innerText.trim();

          const pageViews = document
            .querySelector('#PageViews')
            .innerText.trim();
          const likeCount = document
            .querySelector('#LikeCount')
            .innerText.trim();
          const spanColorRed = document.querySelectorAll(
            '.description span.color-red',
          );
          const status =
            spanColorRed.length != 0
              ? spanColorRed[spanColorRed.length - 1].innerText.trim()
              : spanColorRed[0].innerText.trim();
          const anotherName =
            spanColorRed.length > 1
              ? Array.from(spanColorRed)
                  .slice(0, -1)
                  .map((span) => span.innerText.trim())
                  .join(', ')
              : 'Khong co ten khac';
          return {
            name,
            author,
            genre,
            summary,
            pageViews,
            likeCount,
            status,
            anotherName,
          };
        });
        mangaDetails.push({ ...manga, ...details });
      } catch (error) {
        console.error(
          `Error fetching details for ${manga.link}:`,
          error.message,
        );
      }
    }

    await browser.close();
    return mangaDetails;
  } catch (error) {
    fetchMangaDetails(mangaLinks);
  }
}

async function saveToExcel(mangaDetails) {
  const worksheet = xlsx.utils.json_to_sheet(mangaDetails);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Manga Details');
  xlsx.writeFile(workbook, 'manga_details.xlsx');
  console.log('Manga details saved to manga_details.xlsx');
}

async function saveToJson(fileName, mangaDetails) {
  const jsonContent = JSON.stringify(mangaDetails, null, 2);
  fs.writeFileSync(fileName, jsonContent, 'utf8');
  console.log('saved to', fileName);
}

async function main() {
  const mangaLinks = await fetchAllMangaLinks();
  await saveToJson('manga_links.json', mangaLinks);
  const mangaDetails = await fetchMangaDetails(mangaLinks);
  await saveToExcel(mangaDetails);
}

main();
