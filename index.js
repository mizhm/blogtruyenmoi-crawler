const fs = require('fs');
const xlsx = require('xlsx');
const axios = require('axios');
const cheerio = require('cheerio');

const baseUrl = 'https://blogtruyenmoi.com/ajax/Search/AjaxLoadListManga';
const totalPages = 1301; // Adjust this to the actual number of pages you want to fetch
const maxRetries = 3;
const requestTimeout = 1000 * 60 * 5; // 5 minutes
const delayBetweenRequests = 1000; // 1 second delay between requests
const progressFile = 'progress.json';
const mangaLinksFile = 'manga_links.json';
const mangaDetailsFile = 'manga_details.json';

function loadProgress() {
  if (fs.existsSync(progressFile)) {
    const data = fs.readFileSync(progressFile, 'utf8');
    return JSON.parse(data);
  }
  return { fetchedPages: [], mangaLinks: [], mangaDetails: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8');
}

function saveToJson(fileName, newData) {
  let existingData = [];
  if (fs.existsSync(fileName)) {
    const data = fs.readFileSync(fileName, 'utf8');
    existingData = JSON.parse(data);
  }
  const combinedData = existingData.concat(newData);
  const jsonContent = JSON.stringify(combinedData, null, 2);
  fs.writeFileSync(fileName, jsonContent, 'utf8');
  console.log(`Saved to ${fileName}`);
}

async function fetchMangaLinks(pageNumber, progress) {
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
      if (
        attempt === maxRetries ||
        (error.response && error.response.status !== 500)
      )
        throw error;
      const retryAfter =
        error.response && error.response.headers['retry-after'];
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : delayBetweenRequests * attempt; // Exponential backoff or Retry-After
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function fetchAllMangaLinks(progress) {
  const allMangaLinks = progress.mangaLinks;
  for (let page = 1; page <= totalPages; page++) {
    if (progress.fetchedPages.includes(page)) continue; // Skip already fetched pages
    console.log(`Fetching page ${page}`);
    const mangaLinks = await fetchMangaLinks(page, progress);
    allMangaLinks.push(...mangaLinks);
    progress.fetchedPages.push(page);
    progress.mangaLinks = allMangaLinks;
    saveProgress(progress); // Save progress after each page
    saveToJson(mangaLinksFile, mangaLinks); // Save fetched links to JSON file
    await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay between requests
  }
  return allMangaLinks;
}

async function fetchMangaDetails(manga, progress) {
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
      if (
        attempt === maxRetries ||
        (error.response && error.response.status !== 500)
      )
        throw error;
      const retryAfter =
        error.response && error.response.headers['retry-after'];
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : delayBetweenRequests * attempt; // Exponential backoff or Retry-After
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function fetchAllMangaDetails(mangaLinks, progress) {
  const allMangaDetails = progress.mangaDetails;
  for (const manga of mangaLinks) {
    if (allMangaDetails.some((detail) => detail.link === manga.link)) continue; // Skip already fetched details
    console.log(`Fetching details for ${manga.title}`);
    const mangaDetails = await fetchMangaDetails(manga, progress);
    if (mangaDetails) {
      allMangaDetails.push(mangaDetails);
      progress.mangaDetails = allMangaDetails;
      saveProgress(progress); // Save progress after each detail
      saveToJson(mangaDetailsFile, [mangaDetails]); // Save fetched details to JSON file
    }
    await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests)); // Delay between requests
  }
  return allMangaDetails;
}

async function saveToExcel(fileName, data) {
  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'MangaDetails');
  xlsx.writeFile(workbook, fileName);
  console.log(`Saved to ${fileName}`);
}

async function main() {
  const progress = loadProgress();
  const mangaLinks = await fetchAllMangaLinks(progress);
  const mangaDetails = await fetchAllMangaDetails(mangaLinks, progress);
  await saveToExcel('manga_details.xlsx', mangaDetails);
}

main();
