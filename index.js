const fs = require('fs');
const xlsx = require('xlsx');
const axios = require('axios');
const cheerio = require('cheerio');

const baseUrl = 'https://blogtruyenmoi.com/ajax/Search/AjaxLoadListManga';
const totalPages = 1301;
const maxRetries = 3;
const requestTimeout = 1000 * 60 * 60; // 1 hour
const delayBetweenRequests = 1000; // 1 second delay between requests

async function fetchMangaLinks(pageNumber) {
  const url = `${baseUrl}?key=tatca&orderBy=1&p=${pageNumber}`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: requestTimeout });
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
    } catch (error) {
      console.error(
        `Error fetching links for page ${pageNumber} (attempt ${attempt}/${maxRetries}):`,
        error.message,
      );
      if (attempt === maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay before retrying
    }
  }
}

async function fetchAllMangaLinks() {
  const allMangaLinks = [];
  for (let page = 1; page <= totalPages; page++) {
    console.log(`Fetching page ${page}`);
    const mangaLinks = await fetchMangaLinks(page);
    allMangaLinks.push(...mangaLinks);
    await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay between requests
  }
  return allMangaLinks;
}

async function fetchMangaDetails(manga) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(manga.link, { timeout: requestTimeout });
      const $ = cheerio.load(response.data);
      const name = manga.title;
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
      console.error(
        `Error fetching details for ${manga.link} (attempt ${attempt}/${maxRetries}):`,
        error.message,
      );
      if (attempt === maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay before retrying
    }
  }
}

async function fetchAllMangaDetails(mangaLinks) {
  const allMangaDetails = [];
  for (const manga of mangaLinks) {
    console.log(`Fetching details for ${manga.title}`);
    const mangaDetails = await fetchMangaDetails(manga);
    if (mangaDetails) {
      allMangaDetails.push(mangaDetails);
    }
    await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay between requests
  }
  return allMangaDetails;
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
  const mangaDetails = await fetchAllMangaDetails(mangaLinks);
  await saveToJson('manga_details.json', mangaDetails);
  await saveToExcel('manga_details.xlsx', mangaDetails);
}

main();
