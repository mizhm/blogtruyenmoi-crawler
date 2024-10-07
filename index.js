const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const xlsx = require('xlsx');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const baseUrl = 'https://blogtruyenmoi.com/ajax/Search/AjaxLoadListManga';
const totalPages = 1301;
const chunkSize = 10;
const maxRetries = 3;
const requestTimeout = 30000; // 30 seconds

let axiosInstance;

async function initializeAxiosInstance() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  const cookies = await page.cookies();
  const userAgent = await page.evaluate(() => navigator.userAgent);

  await browser.close();

  axiosInstance = axios.create({
    headers: {
      'User-Agent': userAgent,
      Cookie: cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; '),
      Referer: baseUrl,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: requestTimeout,
  });
}

async function fetchMangaLinks(pageNumber) {
  const url = `${baseUrl}?key=tatca&orderBy=1&p=${pageNumber}`;
  const response = await axiosInstance.get(url);
  const $ = cheerio.load(response.data);
  const mangaLinks = [];
  $('.tiptip a').each((index, element) => {
    const link = $(element).attr('href');
    if (link) {
      mangaLinks.push({
        title: $(element).text().trim().replace(/:$/, ''), // Remove colon at the end
        link: link.startsWith('http')
          ? link
          : `https://blogtruyenmoi.com${link}`,
      });
    }
  });
  return mangaLinks;
}

async function fetchMangaLinksChunk(startPage, endPage) {
  const promises = [];
  for (let currentPage = startPage; currentPage <= endPage; currentPage++) {
    promises.push(fetchMangaLinks(currentPage));
  }
  const results = await Promise.all(promises);
  return results.flat();
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
  const promises = mangaLinks.map(async (manga) => {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const response = await axiosInstance.get(manga.link);
        const $ = cheerio.load(response.data);
        const name = $('h1').text().trim();
        const author = $('a[href*="/tac-gia/"]')
          .map((i, el) => $(el).text().trim())
          .get()
          .join(', ');
        const genre = $('.description a[href*="/theloai/"]')
          .map((i, el) => $(el).text().trim())
          .get()
          .join(', ');
        const summary = $('.detail .content').text().trim();
        const pageViews = $('#PageViews').text().trim();
        const likeCount = $('#LikeCount').text().trim();
        const spanColorRed = $('.description span.color-red');
        const status = spanColorRed.length
          ? spanColorRed.last().text().trim()
          : '';
        const anotherName =
          spanColorRed.length > 1
            ? spanColorRed
                .slice(0, -1)
                .map((i, el) => $(el).text().trim())
                .get()
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
          link: manga.link,
        };
      } catch (error) {
        retries++;
        console.error(
          `Error fetching details for ${manga.link} (attempt ${retries}/${maxRetries}):`,
          error.message,
        );
        if (retries >= maxRetries) {
          console.error(
            `Failed to fetch details for ${manga.link} after ${maxRetries} attempts`,
          );
          return null;
        }
      }
    }
  });

  const results = await Promise.all(promises);
  return results.filter((result) => result !== null);
}

async function saveToJson(fileName, data) {
  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(fileName, jsonContent, 'utf8');
  console.log(`Saved to ${fileName}`);
}

async function saveToExcel(fileName, data) {
  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'MangaDetails');
  xlsx.writeFile(workbook, fileName);
  console.log(`Saved to ${fileName}`);
}

async function main() {
  await initializeAxiosInstance(); // Initialize Axios instance with Puppeteer
  const mangaLinks = await fetchAllMangaLinks();
  await saveToJson('manga_links.json', mangaLinks);
  const mangaDetails = await fetchMangaDetails(mangaLinks);
  await saveToJson('manga_details.json', mangaDetails);
  await saveToExcel('manga_details.xlsx', mangaDetails);
}

main();
