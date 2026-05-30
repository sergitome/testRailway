const TelegramBot = require('node-telegram-bot-api');
const { chromium } = require('playwright');

const TOKEN = '8698697392:AAHNmu74kn-9eJ6ouO7S_GLtBUewabxKDKg';
const pendingRequests = new Map();

const FUEL_CONFIG = {
    benzina: {
        label: 'benzineres',
        title: 'TOP 5 benzineres més barates',
        errorMessage: 'Error obtenint preus de benzina',
        emptyMessage: 'No s’han trobat benzineres',
        path: 'precio-gasolina-95'
    },
    diesel: {
        label: 'gasoil',
        title: 'TOP 5 gasoil més barats',
        errorMessage: 'Error obtenint preus de diesel',
        emptyMessage: 'No s’han trobat benzineres per a diesel',
        path: 'precio-gasoil'
    }
};

console.log('Iniciant bot...');

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log('Bot started');

const escapeHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slugify = (text) => text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getToday = () => {
    const today = new Date();
    return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
};

const extractTown = (address = {}) =>
    address.city
    || address.town
    || address.village
    || address.municipality
    || address.suburb
    || address.county
    || null;

const extractRegion = (address = {}) =>
    address.state
    || address.region
    || address.province
    || address.county
    || null;

const buildKomparingUrl = (fuelType, town, region) => {
    const config = FUEL_CONFIG[fuelType];

    if (!config || !town || !region) {
        return null;
    }

    return `https://www.komparing.com/es/${config.path}/${slugify(region)}/${slugify(town)}`;
};

const buildMapsUrl = (name, town) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${town}`)}`;

const resolveTownFromCoordinates = async (latitude, longitude) => {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', latitude);
    url.searchParams.set('lon', longitude);
    url.searchParams.set('zoom', '10');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'ca');

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'testRailwayBot/1.0'
        }
    });

    if (!response.ok) {
        throw new Error(`Nominatim ha respost amb ${response.status}`);
    }

    const data = await response.json();
    const town = extractTown(data.address);
    const region = extractRegion(data.address);

    if (!town) {
        throw new Error('No s’ha pogut determinar la població');
    }

    return { town, region };
};

const fetchFuelPrices = async (fuelType, url) => {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    try {
        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(8000);
        await page.waitForSelector('table tbody tr', {
            timeout: 30000
        });

        return await page.$$eval(
            'table tbody tr',
            rows => rows.map(row => {
                const cols = row.querySelectorAll('td');

                if (cols.length < 2) {
                    return null;
                }

                const nom = cols[0].innerText.trim();
                const preuText = cols[1]
                    .innerText
                    .replace('€', '')
                    .replace(',', '.')
                    .trim();
                const preu = parseFloat(preuText);

                if (Number.isNaN(preu)) {
                    return null;
                }

                return { nom, preu };
            }).filter(Boolean)
        );
    } finally {
        await browser.close();
    }
};

const sendFuelPrompt = async (chatId, fuelType) => {
    pendingRequests.set(chatId, fuelType);

    await bot.sendMessage(
        chatId,
        'Envia la teva ubicació perquè pugui detectar a quina població ets.',
        {
            reply_markup: {
                keyboard: [[{
                    text: 'Compartir ubicació',
                    request_location: true
                }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
};

const sendFuelPrices = async (chatId, fuelType, town, region) => {
    const config = FUEL_CONFIG[fuelType];
    const requestedUrl = buildKomparingUrl(fuelType, town, region);
    const fallbackUrl = buildKomparingUrl(fuelType, 'Palma de Mallorca', 'Illes Balears');

    let benzineres = [];
    let usedTown = town;
    let targetUrl = requestedUrl;

    if (requestedUrl) {
        try {
            benzineres = await fetchFuelPrices(fuelType, requestedUrl);
        } catch (error) {
            console.warn(`No s'ha pogut obtenir ${fuelType} per ${town}:`, error.message);
        }
    }

    if (benzineres.length === 0) {
        benzineres = await fetchFuelPrices(fuelType, fallbackUrl);
        usedTown = 'Palma de Mallorca';
        targetUrl = fallbackUrl;
    }

    if (benzineres.length === 0) {
        await bot.sendMessage(chatId, config.emptyMessage, {
            reply_markup: {
                remove_keyboard: true
            }
        });
        return;
    }

    benzineres.sort((a, b) => a.preu - b.preu);

    let resposta = `Ets a ${escapeHtml(town)}.\n`;

    if (usedTown !== town) {
        resposta += `No he trobat dades per a aquesta població i t'ensenyo el llistat de ${escapeHtml(usedTown)}.\n`;
    }

    resposta += `\n⛽ ${config.title} - ${escapeHtml(usedTown)} - ${getToday()}\n\n`;

    benzineres.slice(0, 5).forEach((gasolinera, index) => {
        const url = buildMapsUrl(gasolinera.nom, usedTown);
        resposta += `${index + 1}. <a href="${url}">${escapeHtml(gasolinera.nom)}</a> - ${gasolinera.preu}€\n`;
    });

    resposta += `\n<a href="${targetUrl}">Veure llistat complet</a>`;

    await bot.sendMessage(chatId, resposta, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            remove_keyboard: true
        }
    });
};

bot.onText(/\/start|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMsg =
        'Accions disponibles:\n' +
        '/start - Inicia el bot\n' +
        '/benzina - Obtenir TOP 5 benzineres\n' +
        '/diesel - Obtenir TOP 5 gasoil\n' +
        '/help - Mostra aquesta llista';

    await bot.sendMessage(chatId, helpMsg);
});

bot.onText(/(^|\s)\/?benzina(\s|$)/i, async (msg) => {
    console.log('Comanda benzina rebuda');
    await sendFuelPrompt(msg.chat.id, 'benzina');
});

bot.onText(/(^|\s)\/?diesel(\s|$)/i, async (msg) => {
    console.log('Comanda diesel rebuda');
    await sendFuelPrompt(msg.chat.id, 'diesel');
});

bot.on('location', async (msg) => {
    const chatId = msg.chat.id;
    const fuelType = pendingRequests.get(chatId);

    if (!fuelType) {
        await bot.sendMessage(chatId, 'Primer escriu /benzina o /diesel i després comparteix la ubicació.');
        return;
    }

    pendingRequests.delete(chatId);

    await bot.sendMessage(chatId, 'Ubicació rebuda. Estic detectant la població i consultant els preus...');

    try {
        const { latitude, longitude } = msg.location;
        const { town, region } = await resolveTownFromCoordinates(latitude, longitude);

        await sendFuelPrices(chatId, fuelType, town, region);
    } catch (error) {
        console.error('================ ERROR UBICACIO ================');
        console.error(error);
        console.error('================================================');

        await bot.sendMessage(chatId, FUEL_CONFIG[fuelType].errorMessage, {
            reply_markup: {
                remove_keyboard: true
            }
        });
    }
});
