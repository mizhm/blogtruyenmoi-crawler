const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const xlsx = require('xlsx');

const baseUrl = 'https://blogtruyenmoi.com/ajax/Search/AjaxLoadListManga';
const totalPages = 3;
const chunkSize = 10;
const maxRetries = 3;
const requestTimeout = 10000; // 10 seconds

const axiosInstance = axios.create({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
  },
  timeout: requestTimeout,
});

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
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const allMangaLinks = [];
      for (let currentPage = startPage; currentPage <= endPage; currentPage++) {
        try {
          const mangaLinks = await fetchMangaLinks(currentPage);
          allMangaLinks.push(...mangaLinks);
        } catch (error) {
          console.error(`Error on page ${currentPage}:`, error.message);
          break; // Exit the for loop and retry the chunk
        }
      }
      return allMangaLinks;
    } catch (error) {
      console.error(
        `Error fetching chunk ${startPage} to ${endPage}:`,
        error.message,
      );
      retries++;
      console.log(
        `Retrying chunk ${startPage} to ${endPage} (${retries}/${maxRetries})`,
      );
    }
  }
  console.error(
    `Failed to fetch chunk ${startPage} to ${endPage} after ${maxRetries} retries`,
  );
  return [];
}

async function fetchAllMangaLinks() {
  const allMangaLinks = [];
  for (let i = 0; i < totalPages; i += chunkSize) {
    const startPage = i + 1;
    const endPage = Math.min(i + chunkSize, totalPages);
    console.log(`Fetching pages ${startPage} to ${endPage}`);
    const mangaLinksChunk = await fetchMangaLinksChunk(startPage, endPage);
    if (Array.isArray(mangaLinksChunk)) {
      allMangaLinks.push(...mangaLinksChunk);
    } else {
      console.error('mangaLinksChunk is not an array:', mangaLinksChunk);
    }
  }
  return allMangaLinks;
}

async function fetchMangaDetails(mangaLinks) {
  const mangaDetails = [];
  for (const manga of mangaLinks) {
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

        mangaDetails.push({
          name,
          author,
          genre,
          summary,
          pageViews,
          likeCount,
          status,
          anotherName,
          link: manga.link,
        });
        break; // Exit the retry loop on success
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
        }
      }
    }
  }
  return mangaDetails;
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
  const mangaLinks = await fetchAllMangaLinks();
  await saveToJson('manga_links.json', mangaLinks);
  const mangaDetails = await fetchMangaDetails(mangaLinks);
  await saveToJson('manga_details.json', mangaDetails);
  await saveToExcel('manga_details.xlsx', mangaDetails);
}

main();
