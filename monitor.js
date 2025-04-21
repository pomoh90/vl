const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');

// Конфигурация
const TOKEN = '7612131416:AAGe6WNwqouxsXRJZon-Jl2zrXj1HS3R3rw';
const API_URL = 'https://truthsocial.com/api/v1/accounts/107780257626128497/statuses?exclude_replies=true&only_replies=false&with_muted=true';
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');
const PUPPETEER_CACHE_DIR = path.join(__dirname, '.puppeteer_cache');

let lastPostId = null; // Хранит ID последнего отправленного поста
let subscribers = []; // Список ID подписчиков

// Инициализация Telegram-бота с polling
const bot = new TelegramBot(TOKEN, { polling: true });

// Удаляем все HTML-теги из строки
function stripHtmlTags(text) {
    return text.replace(/<\/?[^>]+(>|$)/g, "");
}

// Загрузка подписчиков из файла
async function loadSubscribers() {
    try {
        const data = await fs.readFile(SUBSCRIBERS_FILE, 'utf8');
        subscribers = JSON.parse(data);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Ошибка при загрузке подписчиков:', error);
        }
        subscribers = [];
    }
}

// Сохранение подписчиков в файл
async function saveSubscribers() {
    try {
        await fs.writeFile(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
    } catch (error) {
        console.error('Ошибка при сохранении подписчиков:', error);
    }
}

// Очистка кэша Puppeteer
async function clearPuppeteerCache() {
    try {
        await fs.rm(PUPPETEER_CACHE_DIR, { recursive: true, force: true });
    } catch (error) {
        console.error('Ошибка при очистке кэша Puppeteer:', error);
        // Проверка, осталась ли директория
        try {
            await fs.access(PUPPETEER_CACHE_DIR);
            console.error(`Директория ${PUPPETEER_CACHE_DIR} всё ещё существует после попытки удаления`);
        } catch {
            // Директория не существует, всё ок
        }
    }
}

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (!subscribers.includes(chatId)) {
        subscribers.push(chatId);
        await saveSubscribers();
        await bot.sendMessage(chatId, 'Вы подписались на обновления!');
    } else {
        await bot.sendMessage(chatId, 'Вы уже подписаны!');
    }
});

// Обработка команды /stop
bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    subscribers = subscribers.filter(id => id !== chatId);
    await saveSubscribers();
    await bot.sendMessage(chatId, 'Вы отписались от обновлений.');
});

// Получение постов
async function getPosts() {
    let browser;
    try {
        // Загрузка подписчиков
        await loadSubscribers();
        if (subscribers.length === 0) {
            return;
        }

        // Запуск Puppeteer
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            userDataDir: PUPPETEER_CACHE_DIR,
            executablePath: '/usr/bin/chromium-browser'
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto('https://truthsocial.com', { waitUntil: 'networkidle2', timeout: 60000 });

        // Получение куки
        await page.cookies();

        // Выполнение запроса к API
        const posts = await page.evaluate(async (apiUrl) => {
            try {
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': navigator.userAgent
                    },
                    credentials: 'include'
                });
                return response.ok ? await response.json() : [];
            } catch (error) {
                return [];
            }
        }, API_URL);

        const latestPost = posts[0];
        if (latestPost && latestPost.id !== lastPostId) {
            // Отправка поста с картинкой
            if (latestPost.media_attachments && latestPost.media_attachments.some(media => media.type === 'image')) {
                const imageUrl = latestPost.media_attachments[0].url;
                const imageMessage = `${stripHtmlTags(latestPost.content)}\n\nСсылка на пост: ${latestPost.url}`;
                for (const chatId of subscribers) {
                    await bot.sendPhoto(chatId, imageUrl, { caption: imageMessage }).catch(err => {
                        console.error(`Ошибка отправки фото в чат ${chatId}:`, err);
                    });
                }
            }

            // Отправка поста с видео
            if (latestPost.media_attachments && latestPost.media_attachments.some(media => media.type === 'video')) {
                const videoUrl = latestPost.media_attachments[0].url;
                const videoMessage = `${stripHtmlTags(latestPost.content)}\n\nСсылка на пост: ${latestPost.url}`;
                for (const chatId of subscribers) {
                    await bot.sendVideo(chatId, videoUrl, { caption: videoMessage }).catch(err => {
                        console.error(`Ошибка отправки видео в чат ${chatId}:`, err);
                    });
                }
            }

            // Отправка текстового поста
            if (!latestPost.media_attachments || latestPost.media_attachments.length === 0) {
                const textMessage = `${stripHtmlTags(latestPost.content)}\n\nСсылка на пост: ${latestPost.url}`;
                for (const chatId of subscribers) {
                    await bot.sendMessage(chatId, textMessage).catch(err => {
                        console.error(`Ошибка отправки текста в чат ${chatId}:`, err);
                    });
                }
            }

            lastPostId = latestPost.id;
        }

    } catch (error) {
        console.error('Ошибка при получении постов:', error);
    } finally {
        if (browser) {
            await browser.close();
            await clearPuppeteerCache();
        }
    }
}

// Периодическая проверка постов каждые 10 секунд
setInterval(getPosts, 10000);

// Выполнение запроса при старте
getPosts();